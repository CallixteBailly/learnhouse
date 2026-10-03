# apps/api/src/services/orgs/invites.py
"""
Org invitation codes + pending email invitations, stored in PostgreSQL.

Replaces the container-local Redis keys (org_invite_code_* / invited_user:*)
which were wiped on every API container recreation, losing pending
invitations and invite codes at each deploy. Query work lives in
org_invites_store.py; this module keeps the original function signatures
and response shapes so routers and dashboards are unchanged.
"""

import logging
import secrets
import string
import uuid
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, Request, status
from pydantic import EmailStr
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import OrganizationRead
from src.db.users import AnonymousUser, PublicUser, UserRead
from src.services.orgs import org_invites_store as store
from src.services.orgs.orgs import get_org_default_language, rbac_check
from src.services.users.emails import send_invitation_email

logger = logging.getLogger(__name__)

CODE_ALPHABET = string.ascii_letters + string.digits
MAX_CODES_PER_ORG = 6
CODE_TTL_SECONDS = 365 * 24 * 3600  # parity with the previous Redis TTL


def _generate_code(length: int = 8) -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))


def _code_row_to_dict(row) -> dict:
    return {
        "invite_code": row.code,
        "invite_code_uuid": row.code_uuid,
        "invite_code_expires": CODE_TTL_SECONDS,
        "invite_code_type": row.code_type,
        "usergroup_id": row.usergroup_id,
        "created_at": row.creation_date,
        "created_by": row.created_by,
    }


def _invited_row_to_dict(row) -> dict:
    expires_seconds = 0
    if row.expires_at:
        try:
            remaining = datetime.fromisoformat(row.expires_at) - datetime.now()
            expires_seconds = max(0, int(remaining.total_seconds()))
        except ValueError:
            expires_seconds = 0
    return {
        "email": row.email,
        "org_id": row.org_id,
        "invite_code_uuid": row.invite_code_uuid,
        "pending": row.pending,
        "email_sent": row.email_sent,
        "expires": expires_seconds,
        "created_at": row.creation_date,
        "created_by": row.created_by,
    }


async def _authorized_org(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    action: str,
    db_session: AsyncSession,
):
    org = await store.get_org_by_id(db_session, int(org_id))
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )
    await rbac_check(request, org.org_uuid, current_user, action, db_session)
    return org


async def create_invite_code(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
    usergroup_id: Optional[int] = None,
):
    """Create an invite code, persisted in PostgreSQL (survives deploys)."""
    org = await _authorized_org(request, org_id, current_user, "update", db_session)

    existing = await store.list_codes(db_session, org.id)
    if len(existing) >= MAX_CODES_PER_ORG:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum number of invite codes reached",
        )

    row = await store.insert_invite_code(
        db_session,
        org_id=org.id,
        code=_generate_code(),
        code_uuid=f"org_invite_code_{uuid.uuid4()}",
        created_by=getattr(current_user, "user_uuid", ""),
        usergroup_id=int(usergroup_id) if usergroup_id is not None else None,
    )
    return _code_row_to_dict(row)


async def get_invite_codes(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    """List the organization's invite codes (non-expired, newest first)."""
    org = await _authorized_org(request, org_id, current_user, "read", db_session)
    rows = await store.list_codes(db_session, org.id)
    return [_code_row_to_dict(r) for r in rows]


async def get_invite_code(
    request: Request,
    org_id: int,
    invite_code: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    """Look up one invite code by value (alphanumeric guard kept for parity)."""
    safe_code = str(invite_code).strip()
    if not safe_code.isalnum():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite code not found",
        )

    org = await _authorized_org(request, org_id, current_user, "read", db_session)
    row = await store.find_code(db_session, org.id, safe_code)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite code not found",
        )
    return _code_row_to_dict(row)


async def delete_invite_code(
    request: Request,
    org_id: int,
    org_invite_code_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    """Delete an invite code by UUID."""
    org = await _authorized_org(request, org_id, current_user, "update", db_session)

    safe_uuid = str(org_invite_code_uuid).strip()
    for row in await store.list_codes(db_session, org.id):
        if row.code_uuid == safe_uuid:
            await store.delete_code_row(db_session, row)
            return {"detail": "Invite code deleted"}

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Invite code not found",
    )


async def upsert_invited_user(
    db_session: AsyncSession,
    org_id: int,
    email: str,
    created_by: str,
    invite_code_uuid: Optional[str],
    email_sent: bool,
):
    """Create or refresh a pending invitation row · internal (invite_batch_users)."""
    return await store.upsert_invited(
        db_session,
        org_id=int(org_id),
        email=str(email).strip(),
        created_by=created_by,
        invite_code_uuid=invite_code_uuid,
        email_sent=email_sent,
    )


async def get_list_of_invited_users(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    """Pending email invitations for the organization (newest first)."""
    org = await _authorized_org(request, org_id, current_user, "read", db_session)
    rows = await store.list_invited(db_session, org.id)
    return [_invited_row_to_dict(r) for r in rows]


async def remove_invited_user(
    request: Request,
    org_id: int,
    email: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    """Cancel a pending invitation by email (case-insensitive match)."""
    org = await _authorized_org(request, org_id, current_user, "update", db_session)

    row = await store.find_invited_lower(db_session, org.id, str(email))
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invited user not found",
        )
    await store.delete_invited_row(db_session, row)
    return {"detail": "Invited user removed"}


async def delete_invited_user_row(org_id: int, email: str, db_session: AsyncSession) -> None:
    """Best-effort consumption of a pending invitation when its user joins.

    No permission checks on purpose: called from join_org after the join
    succeeded. Tolerant to case and missing rows.
    """
    safe_email = str(email or "").strip()
    if not safe_email:
        return
    try:
        row = await store.find_invited_lower(db_session, int(org_id), safe_email)
        if row:
            await store.delete_invited_row(db_session, row)
    except Exception:
        logger.warning("Could not consume pending invitation", exc_info=True)


async def send_invite_email(
    org: OrganizationRead,
    invite_code_uuid: str | None,
    user: UserRead,
    email: EmailStr,
    request: Request,
    db_session=None,
):
    invite_code = None

    # Look up the invite code from PostgreSQL if a UUID was provided
    safe_uuid = str(invite_code_uuid or "").strip()
    if safe_uuid and db_session is not None:
        row = await store.find_code_by_uuid(db_session, safe_uuid)
        if row:
            invite_code = row.code

    # Build signup URL rooted at the org's own frontend subdomain (or primary
    # verified custom domain if one is configured — passing db_session opts in).
    from src.services.email.utils import get_org_signup_base_url
    org_base_url = await get_org_signup_base_url(
        org.slug, request, db_session=db_session, org_id=org.id
    )

    if invite_code:
        signup_url = f"{org_base_url}/signup?inviteCode={invite_code}"
    else:
        signup_url = f"{org_base_url}/signup"

    lang = "en"
    if db_session is not None:
        try:
            from src.security.integrations import get_org_default_language as _gol

            org_config = await store.get_org_config(db_session, org.id)
            lang = _gol(org_config)
        except Exception:
            pass

    try:
        result = send_invitation_email(
            email=email,
            org_name=org.name,
            inviter_username=user.username,
            invite_code=invite_code,
            signup_url=signup_url,
            lang=lang,
        )
        return result is not None
    except Exception:
        logger.exception("Failed to send invite email to %s", email)
        return False
