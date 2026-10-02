"""
OSS-native superadmin API · mounted under /ee/superadmin so the existing
superadmin dashboard (apps/web/app/admin) works unchanged on self-hosted
multi-tenant deployments.

Every route requires `is_superadmin` (src.security.superadmin.require_superadmin).
The EE implementation is replaced 1:1 by native queries against the same
PostgreSQL models the rest of the API already uses:

- organizations: list/create/detail + settings + per-feature admin toggles
  (persisted in OrganizationConfig.config["admin_toggles"], which
  features_utils.resolve.py ALREADY honors — toggles take real effect)
- members: add existing user / invite by email / change role / remove
  (reusing the orgs invites + users services)
- users: platform-wide directory with org memberships + update/delete
- analytics: same Tinybird pipes as the org analytics router, aggregated
- superadmin API tokens: thin routes over the existing service
"""

import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization, OrganizationCreate
from src.db.roles import Role
from src.db.superadmin_api_tokens import (
    SuperadminAPITokenCreate,
    SuperadminAPITokenCreatedResponse,
)
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.superadmin import require_superadmin
from src.services.api_tokens.superadmin_api_tokens import (
    create_superadmin_token,
    list_superadmin_tokens,
    revoke_superadmin_token,
)
from src.services.orgs.orgs import create_org

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ee/superadmin", tags=["superadmin"])

ADMIN_ROLE_ID = 1


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _contains(column: Any, needle: str) -> Any:
    """Case-insensitive substring match · parameterized by SQLAlchemy and
    autoescaped, so user-supplied % and _ cannot act as wildcards."""
    return func.lower(func.coalesce(column, "")).contains(needle.strip().lower(), autoescape=True)


async def _org_counts(db_session: AsyncSession) -> tuple[dict[int, int], dict[int, int], dict[int, list[dict]]]:
    """user_count / course_count / admin_users per org, in 3 grouped queries."""
    user_counts: dict[int, int] = {}
    rows = (await db_session.execute(
        select(UserOrganization.org_id, func.count(UserOrganization.id)).group_by(UserOrganization.org_id)
    )).all()
    for org_id, count in rows:
        user_counts[org_id] = count

    course_counts: dict[int, int] = {}
    rows = (await db_session.execute(
        select(Course.org_id, func.count(Course.id)).group_by(Course.org_id)
    )).all()
    for org_id, count in rows:
        course_counts[org_id] = count

    admins: dict[int, list[dict]] = {}
    rows = (await db_session.execute(
        select(UserOrganization, User)
        .join(User, User.id == UserOrganization.user_id)
        .where(UserOrganization.role_id == ADMIN_ROLE_ID)
    )).all()
    for user_org, user in rows:
        admins.setdefault(user_org.org_id, []).append({
            "username": user.username,
            "email": user.email,
            "avatar_image": user.avatar_image,
            "user_uuid": user.user_uuid,
        })

    return user_counts, course_counts, admins


def _org_to_row(
    org: Organization,
    user_count: int,
    course_count: int,
    admin_users: list[dict],
    config: Optional[dict] = None,
) -> dict:
    row: dict[str, Any] = {
        "id": org.id,
        "org_uuid": org.org_uuid,
        "name": org.name,
        "slug": org.slug,
        "description": getattr(org, "description", None),
        "email": getattr(org, "email", "") or "",
        "logo_image": getattr(org, "logo_image", None),
        "thumbnail_image": getattr(org, "thumbnail_image", None),
        "creation_date": org.creation_date,
        "update_date": org.update_date,
        "user_count": user_count,
        "course_count": course_count,
        "plan": "free",
        "custom_domains": [],
        "admin_users": admin_users,
    }
    if config is not None:
        row["config"] = config
    return row


async def _get_org_or_404(org_id: int, db_session: AsyncSession) -> Organization:
    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


async def _get_org_config(org_id: int, db_session: AsyncSession) -> dict:
    cfg = (await db_session.execute(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    )).scalars().first()
    return dict(cfg.config) if cfg and cfg.config else {}


async def _save_org_config(org_id: int, config: dict, db_session: AsyncSession) -> None:
    cfg = (await db_session.execute(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    )).scalars().first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Organization config not found")
    cfg.config = config
    cfg.update_date = str(datetime.now())
    db_session.add(cfg)
    await db_session.commit()


def _invalidate_user_session(user_id: int) -> None:
    """Drop the cached /users/session payload so role/rights changes apply now."""
    from src.routers.users import _invalidate_session_cache
    _invalidate_session_cache(user_id)


def _run_analytics_pipes() -> Any:
    """Import lazily so a missing/unconfigured analytics backend degrades gracefully."""
    from src.routers.analytics import _execute_tinybird_query, _build_sql
    from src.services.analytics.queries import ALL_QUERIES
    return _execute_tinybird_query, _build_sql, ALL_QUERIES


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


@router.get("/status", summary="Superadmin surface status")
async def superadmin_status(
    request: Request,
    current_user=Depends(require_superadmin),
) -> dict:
    return {
        "active": True,
        "edition": "oss-native",
        "multi_org": True,
    }


# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------


@router.get("/organizations", summary="List all organizations (paginated)")
async def list_organizations(
    request: Request,
    page: int = 1,
    limit: int = 20,
    sort: str = "id",
    search: Optional[str] = None,
    plan: Optional[str] = None,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    if page < 1:
        page = 1
    if limit < 1 or limit > 100:
        limit = 20

    statement = select(Organization)
    count_statement = select(func.count(Organization.id))

    # OSS-native: every org runs the free feature set · a paid plan filter
    # matches nothing, "free" matches everything.
    if plan and plan not in ("all", "free"):
        return {"items": [], "total": 0, "page": page, "limit": limit}

    if search:
        match = (
            _contains(Organization.name, search)
            | _contains(Organization.slug, search)
            | _contains(Organization.email, search)
        )
        statement = statement.where(match)
        count_statement = count_statement.where(match)

    total = (await db_session.execute(count_statement)).scalars().first() or 0

    sort_columns = {
        "id": Organization.id,
        "-id": Organization.id.desc(),  # type: ignore[attr-defined]
        "name": Organization.name,
        "-name": Organization.name.desc(),  # type: ignore[attr-defined]
        "creation_date": Organization.creation_date,
        "-creation_date": Organization.creation_date.desc(),  # type: ignore[attr-defined]
    }
    order = sort_columns.get(sort, Organization.id)
    statement = statement.order_by(order).offset((page - 1) * limit).limit(limit)
    orgs = (await db_session.execute(statement)).scalars().all()

    user_counts, course_counts, admins = await _org_counts(db_session)
    items = [
        _org_to_row(
            org,
            user_counts.get(org.id, 0),
            course_counts.get(org.id, 0),
            admins.get(org.id, []),
        )
        for org in orgs
    ]
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/organizations/visits", summary="7-day visit counts per org (analytics sparklines)")
async def organizations_visits(
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    rows: list[dict] = []
    try:
        _execute_tinybird_query, _build_sql, all_queries = _run_analytics_pipes()
        orgs = (await db_session.execute(select(Organization.id))).scalars().all()
        for org_id in orgs:
            if "daily_active_users" not in all_queries:
                break
            sql_template, default_days = all_queries["daily_active_users"]
            sql = _build_sql(sql_template, org_id, 7)
            result = await _execute_tinybird_query("daily_active_users", sql, org_id, 7)
            for row in result.get("data", []):
                rows.append({
                    "org_id": org_id,
                    "date": row.get("date"),
                    "views": row.get("dau", 0),
                })
    except HTTPException:
        # Analytics not configured / upstream error · empty sparklines, not a 502
        logger.info("superadmin visits: analytics unavailable")
    return {"data": rows}


class SuperadminOrgCreate(BaseModel):
    name: str
    slug: str
    email: str
    description: Optional[str] = None
    plan: Optional[str] = None  # accepted for SaaS parity · ignored in OSS


@router.post("/organizations", summary="Create an organization")
async def superadmin_create_org(
    request: Request,
    org_object: SuperadminOrgCreate,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    create_payload = OrganizationCreate(
        name=org_object.name,
        slug=org_object.slug,
        email=org_object.email,
        description=org_object.description or "",
    )
    org = await create_org(request, create_payload, current_user, db_session)
    return {
        "id": org.id,
        "org_uuid": org.org_uuid,
        "name": org.name,
        "slug": org.slug,
    }


@router.get("/organizations/{org_id}", summary="Organization detail")
async def organization_detail(
    org_id: int,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    org = await _get_org_or_404(org_id, db_session)
    user_counts, course_counts, admins = await _org_counts(db_session)
    config = await _get_org_config(org_id, db_session)
    return _org_to_row(
        org,
        user_counts.get(org.id, 0),
        course_counts.get(org.id, 0),
        admins.get(org.id, []),
        config=config,
    )


@router.get("/organizations/{org_id}/usage", summary="Organization feature usage")
async def organization_usage(
    org_id: int,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _get_org_or_404(org_id, db_session)
    user_counts, course_counts, admins = await _org_counts(db_session)
    # OSS has no plan ceilings · 0 = "unlimited" (the dashboard renders it so)
    return {
        "features": {
            "courses": {"usage": course_counts.get(org_id, 0), "limit": 0},
            "members": {"usage": user_counts.get(org_id, 0), "limit": 0},
            "admin_seats": {"usage": len(admins.get(org_id, [])), "limit": 0},
        }
    }


@router.get("/organizations/{org_id}/courses", summary="Organization courses (paginated)")
async def organization_courses(
    org_id: int,
    request: Request,
    page: int = 1,
    limit: int = 20,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _get_org_or_404(org_id, db_session)
    if page < 1:
        page = 1

    total = (await db_session.execute(
        select(func.count(Course.id)).where(Course.org_id == org_id)
    )).scalars().first() or 0
    courses = (await db_session.execute(
        select(Course)
        .where(Course.org_id == org_id)
        .order_by(Course.id.desc())  # type: ignore[attr-defined]
        .offset((page - 1) * limit)
        .limit(limit)
    )).scalars().all()

    items = [
        {
            "id": c.id,
            "course_uuid": c.course_uuid,
            "name": c.name,
            "slug": getattr(c, "slug", ""),
            "description": getattr(c, "description", None),
            "thumbnail_image": getattr(c, "thumbnail_image", None),
            "public": getattr(c, "public", None),
            "published": getattr(c, "published", None),
            "creation_date": c.creation_date,
        }
        for c in courses
    ]
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/organizations/{org_id}/users", summary="Organization members (paginated, searchable)")
async def organization_users(
    org_id: int,
    request: Request,
    page: int = 1,
    limit: int = 20,
    search: Optional[str] = None,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _get_org_or_404(org_id, db_session)
    if page < 1:
        page = 1

    membership = (
        select(UserOrganization.user_id, UserOrganization.role_id, UserOrganization.creation_date)
        .where(UserOrganization.org_id == org_id)
        .subquery()
    )
    statement = (
        select(User, membership.c.role_id, membership.c.creation_date)
        .join(membership, membership.c.user_id == User.id)
    )
    count_statement = (
        select(func.count(User.id))
        .select_from(membership)
        .join(User, User.id == membership.c.user_id)
    )
    if search:
        match = (
            _contains(User.username, search)
            | _contains(User.email, search)
            | _contains(User.first_name, search)
            | _contains(User.last_name, search)
        )
        statement = statement.where(match)
        count_statement = count_statement.where(match)

    total = (await db_session.execute(count_statement)).scalars().first() or 0
    rows = (await db_session.execute(
        statement.order_by(membership.c.creation_date.desc()).offset((page - 1) * limit).limit(limit)
    )).all()

    role_ids = {r for _, r, _ in rows}
    roles: dict[int, str] = {}
    if role_ids:
        role_rows = (await db_session.execute(select(Role).where(Role.id.in_(role_ids)))).scalars().all()
        roles = {r.id: r.name for r in role_rows}

    items = [
        {
            "id": user.id,
            "user_uuid": user.user_uuid,
            "username": user.username,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "avatar_image": user.avatar_image,
            "role_id": role_id,
            "role_name": roles.get(role_id, "Member"),
            "creation_date": joined,
        }
        for user, role_id, joined in rows
    ]
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/organizations/{org_id}/analytics", summary="Organization analytics (Tinybird pipes)")
async def organization_analytics(
    org_id: int,
    request: Request,
    days: int = 30,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _get_org_or_404(org_id, db_session)
    _execute_tinybird_query, _build_sql, all_queries = _run_analytics_pipes()

    wanted = [
        "live_users", "daily_active_users", "enrollment_funnel", "event_counts",
        "top_courses", "visitors_by_country", "visitors_by_device", "visitors_by_referrer",
    ]
    out: dict[str, dict] = {}
    for name in wanted:
        if name not in all_queries:
            continue
        sql_template, default_days = all_queries[name]
        effective_days = days if default_days > 0 else 0
        sql = _build_sql(sql_template, org_id, effective_days)
        out[name] = await _execute_tinybird_query(name, sql, org_id, effective_days)
    return out


class SuperadminOrgSettings(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    description: Optional[str] = None


@router.put("/organizations/{org_id}/settings", summary="Update organization basics")
async def organization_settings(
    org_id: int,
    settings: SuperadminOrgSettings,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    org = await _get_org_or_404(org_id, db_session)
    if settings.name is not None:
        org.name = settings.name
    if settings.email is not None:
        org.email = settings.email
    if settings.description is not None:
        org.description = settings.description
    org.update_date = str(datetime.now())
    db_session.add(org)
    await db_session.commit()
    return {"message": "Organization updated"}


@router.get("/organizations/{org_id}/admin_toggles", summary="Per-feature admin toggles")
async def get_admin_toggles(
    org_id: int,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _get_org_or_404(org_id, db_session)
    config = await _get_org_config(org_id, db_session)
    return {
        "version": "2.0",
        "toggles": config.get("admin_toggles", {}),
    }


class AdminTogglesPayload(BaseModel):
    toggles: dict


@router.put("/organizations/{org_id}/admin_toggles", summary="Persist per-feature admin toggles")
async def put_admin_toggles(
    org_id: int,
    payload: AdminTogglesPayload,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _get_org_or_404(org_id, db_session)
    config = await _get_org_config(org_id, db_session)
    config["admin_toggles"] = payload.toggles
    config["config_version"] = "2.0"
    await _save_org_config(org_id, config, db_session)
    return {"message": "Admin toggles saved"}


class PlanPayload(BaseModel):
    plan: str


@router.put("/organizations/{org_id}/plan", summary="Set plan (OSS: stored, not enforced)")
async def put_plan(
    org_id: int,
    payload: PlanPayload,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _get_org_or_404(org_id, db_session)
    config = await _get_org_config(org_id, db_session)
    config["plan"] = payload.plan
    await _save_org_config(org_id, config, db_session)
    return {"message": f"Plan set to {payload.plan}"}


# ---------------------------------------------------------------------------
# Org member management (add existing user / invite by email / role / remove)
# ---------------------------------------------------------------------------


@router.get("/organizations/{org_id}/roles", summary="Roles usable in an organization")
async def organization_roles(
    org_id: int,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> list:
    await _get_org_or_404(org_id, db_session)
    roles = (await db_session.execute(
        select(Role)
        .where((Role.org_id == org_id) | (Role.org_id == None))  # noqa: E711
        .order_by(Role.id)
    )).scalars().all()
    return [
        {"id": r.id, "name": r.name, "description": r.description}
        for r in roles
    ]


class AddMemberPayload(BaseModel):
    email_or_username: str
    role_id: int = 3


@router.post("/organizations/{org_id}/users", summary="Add an existing user to the organization")
async def add_org_member(
    org_id: int,
    payload: AddMemberPayload,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _get_org_or_404(org_id, db_session)

    needle = payload.email_or_username.strip().lower()
    target = (await db_session.execute(
        select(User).where(
            (func.lower(func.coalesce(User.email, "")) == needle)
            | (func.lower(User.username) == needle)
        )
    )).scalars().first()
    if not target:
        raise HTTPException(status_code=404, detail="No user found with this email or username")

    existing = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == target.id,
            UserOrganization.org_id == org_id,
        )
    )).scalars().first()
    if existing:
        raise HTTPException(status_code=409, detail="This user is already a member of the organization")

    now = str(datetime.now())
    link = UserOrganization(
        user_id=target.id,
        org_id=org_id,
        role_id=payload.role_id,
        creation_date=now,
        update_date=now,
    )
    db_session.add(link)
    await db_session.commit()

    _invalidate_user_session(target.id)

    return {"message": f"{target.username} added to the organization", "user_id": target.id}


class RolePayload(BaseModel):
    role_id: int


@router.put("/organizations/{org_id}/users/{user_id}/role", summary="Change a member's role")
async def change_member_role(
    org_id: int,
    user_id: int,
    payload: RolePayload,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    link = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == org_id,
        )
    )).scalars().first()
    if not link:
        raise HTTPException(status_code=404, detail="User is not a member of this organization")

    role = (await db_session.execute(select(Role).where(Role.id == payload.role_id))).scalars().first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    link.role_id = payload.role_id
    link.update_date = str(datetime.now())
    db_session.add(link)
    await db_session.commit()

    _invalidate_user_session(user_id)

    return {"message": f"Role updated to {role.name}"}


@router.delete("/organizations/{org_id}/users/{user_id}", summary="Remove a member from the organization")
async def remove_org_member(
    org_id: int,
    user_id: int,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    link = (await db_session.execute(
        select(UserOrganization).where(
            UserOrganization.user_id == user_id,
            UserOrganization.org_id == org_id,
        )
    )).scalars().first()
    if not link:
        raise HTTPException(status_code=404, detail="User is not a member of this organization")

    # Guard: never remove the last admin of an organization.
    if link.role_id == ADMIN_ROLE_ID:
        role_rows = (await db_session.execute(
            select(UserOrganization.role_id).where(UserOrganization.org_id == org_id)
        )).all()
        admin_count = sum(1 for r in role_rows if r[0] == ADMIN_ROLE_ID)
        if admin_count <= 1:
            raise HTTPException(
                status_code=409,
                detail="Cannot remove the last admin of the organization",
            )

    await db_session.delete(link)
    await db_session.commit()

    _invalidate_user_session(user_id)

    return {"message": "Member removed from the organization"}


class InvitePayload(BaseModel):
    emails: str  # comma-separated
    role_id: int = 3


@router.post("/organizations/{org_id}/users/invite", summary="Invite users by email (sends invitation emails)")
async def invite_org_users(
    org_id: int,
    payload: InvitePayload,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    from src.services.orgs.users import invite_batch_users

    emails = payload.emails.strip()
    if not emails:
        raise HTTPException(status_code=400, detail="At least one email is required")

    result = await invite_batch_users(
        request, org_id, emails, None, db_session, current_user
    )
    return result if isinstance(result, dict) else {"message": "Invitations sent"}


@router.get("/organizations/{org_id}/invited-users", summary="Pending email invitations for the organization")
async def list_invited_users(
    org_id: int,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> list:
    await _get_org_or_404(org_id, db_session)
    from src.services.orgs import org_invites_store as invites_store

    rows = await invites_store.list_invited(db_session, org_id)
    return [
        {
            "email": row.email,
            "org_id": row.org_id,
            "invite_code_uuid": row.invite_code_uuid,
            "pending": row.pending,
            "email_sent": row.email_sent,
            "created_at": row.creation_date,
            "created_by": row.created_by,
        }
        for row in rows
    ]


@router.delete("/organizations/{org_id}/invited-users/{email}", summary="Cancel a pending email invitation")
async def cancel_invited_user(
    org_id: int,
    email: str,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    await _get_org_or_404(org_id, db_session)
    from src.services.orgs import org_invites_store as invites_store

    row = await invites_store.find_invited_lower(db_session, org_id, email)
    if not row:
        raise HTTPException(status_code=404, detail="No pending invitation for this email")

    await invites_store.delete_invited_row(db_session, row)
    return {"message": "Invitation cancelled"}


# ---------------------------------------------------------------------------
# Users (platform-wide)
# ---------------------------------------------------------------------------


@router.get("/users", summary="List all platform users (paginated, searchable)")
async def list_users(
    request: Request,
    page: int = 1,
    limit: int = 20,
    search: Optional[str] = None,
    superadmin: Optional[str] = None,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    if page < 1:
        page = 1

    statement = select(User)
    count_statement = select(func.count(User.id))
    if search:
        match = (
            _contains(User.username, search)
            | _contains(User.email, search)
            | _contains(User.first_name, search)
            | _contains(User.last_name, search)
        )
        statement = statement.where(match)
        count_statement = count_statement.where(match)
    if superadmin == "yes":
        statement = statement.where(User.is_superadmin == True)  # noqa: E712
        count_statement = count_statement.where(User.is_superadmin == True)  # noqa: E712
    elif superadmin == "no":
        statement = statement.where(User.is_superadmin == False)  # noqa: E712
        count_statement = count_statement.where(User.is_superadmin == False)  # noqa: E712

    total = (await db_session.execute(count_statement)).scalars().first() or 0
    users = (await db_session.execute(
        statement.order_by(User.id).offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    user_ids = [u.id for u in users]
    memberships: dict[int, list[dict]] = {}
    if user_ids:
        rows = (await db_session.execute(
            select(UserOrganization, Organization, Role)
            .join(Organization, Organization.id == UserOrganization.org_id)
            .join(Role, Role.id == UserOrganization.role_id)
            .where(UserOrganization.user_id.in_(user_ids))
        )).all()
        for user_org, org, role in rows:
            memberships.setdefault(user_org.user_id, []).append({
                "id": org.id,
                "name": org.name,
                "slug": org.slug,
                "role_name": role.name,
            })

    items = [
        {
            "id": u.id,
            "user_uuid": u.user_uuid,
            "username": u.username,
            "email": u.email,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "avatar_image": u.avatar_image,
            "is_superadmin": bool(u.is_superadmin),
            "org_count": len(memberships.get(u.id, [])),
            "orgs": memberships.get(u.id, []),
            "creation_date": u.creation_date,
            "update_date": u.update_date,
        }
        for u in users
    ]
    return {"items": items, "total": total, "page": page, "limit": limit}


class SuperadminUserUpdate(BaseModel):
    username: str
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    is_superadmin: Optional[bool] = None


@router.put("/users/{user_id}", summary="Update a platform user")
async def superadmin_update_user(
    user_id: int,
    payload: SuperadminUserUpdate,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    from src.db.users import UserUpdate
    from src.services.users.users import update_user

    user_object = UserUpdate(
        username=payload.username.strip(),
        email=payload.email.strip(),
        first_name=payload.first_name or "",
        last_name=payload.last_name or "",
    )
    await update_user(request, db_session, user_id, current_user, user_object)

    if payload.is_superadmin is not None:
        user = (await db_session.execute(select(User).where(User.id == user_id))).scalars().first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user.is_superadmin = payload.is_superadmin
        db_session.add(user)
        await db_session.commit()

    _invalidate_user_session(user_id)

    return {"message": "User updated"}


@router.delete("/users/{user_id}", summary="Delete a platform user")
async def superadmin_delete_user(
    user_id: int,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    from src.services.users.users import delete_user_by_id

    acting_user_id = getattr(current_user, "id", None)
    if acting_user_id == user_id:
        raise HTTPException(status_code=403, detail="You cannot delete your own account")

    return await delete_user_by_id(request, db_session, current_user, user_id)


# ---------------------------------------------------------------------------
# Global analytics
# ---------------------------------------------------------------------------


@router.get("/analytics/global", summary="Platform-wide analytics (Tinybird pipes, aggregated)")
async def global_analytics(
    request: Request,
    days: int = 30,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    _execute_tinybird_query, _build_sql, all_queries = _run_analytics_pipes()
    orgs = (await db_session.execute(select(Organization.id))).scalars().all()

    wanted = [
        "live_users", "daily_active_users", "enrollment_funnel", "event_counts",
        "top_courses", "visitors_by_country", "visitors_by_device", "visitors_by_referrer",
    ]
    out: dict[str, dict] = {}
    for name in wanted:
        if name not in all_queries:
            continue
        sql_template, default_days = all_queries[name]
        effective_days = days if default_days > 0 else 0
        merged: dict = {"data": [], "rows": 0, "meta": []}
        seen: set = set()
        for org_id in orgs:
            sql = _build_sql(sql_template, org_id, effective_days)
            result = await _execute_tinybird_query(name, sql, org_id, effective_days)
            for row in result.get("data", []):
                key = repr(sorted(row.items()))
                if key not in seen:
                    seen.add(key)
                    merged["data"].append(row)
        merged["rows"] = len(merged["data"])
        out[name] = merged
    return out


# ---------------------------------------------------------------------------
# Superadmin API tokens
# ---------------------------------------------------------------------------


@router.get("/tokens/", summary="List superadmin API tokens")
async def list_tokens(
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> list:
    return await list_superadmin_tokens(db_session)


@router.post("/tokens/", response_model=SuperadminAPITokenCreatedResponse, summary="Mint a superadmin API token")
async def mint_token(
    request: Request,
    token_data: SuperadminAPITokenCreate,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> SuperadminAPITokenCreatedResponse:
    if not getattr(current_user, "id", None):
        raise HTTPException(status_code=401, detail="User id unavailable")
    return await create_superadmin_token(db_session, token_data, current_user.id)


@router.delete("/tokens/{token_uuid}", summary="Revoke a superadmin API token")
async def revoke_token(
    token_uuid: str,
    request: Request,
    current_user=Depends(require_superadmin),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await revoke_superadmin_token(db_session, token_uuid)
