# apps/api/src/services/orgs/org_invites_store.py
"""
Internal data-access layer for org invitations (codes + pending invitees).

SECURITY CONTRACT
-----------------
Every function here is INTERNAL-ONLY and must be called exclusively from
`services/orgs/invites.py` (which enforces `rbac_check` first) or from
`routers/ee_superadmin.py` (which enforces `require_superadmin` first).
No function in this module performs authorization itself.

All queries use the SQLAlchemy 2.0 `session.scalars(statement)` API —
values in WHERE clauses are bound as statement parameters by SQLAlchemy's
expression compiler, exactly like every other query in this codebase.
"""

from datetime import datetime
from typing import List, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.org_invites import (
    OrganizationInviteCode,
    OrganizationInvitedUser,
    default_code_expiry_iso,
    default_invited_expiry_iso,
    invited_user_is_expired,
    invite_code_is_expired,
)

__all__ = [
    "get_org_by_id",
    "insert_invite_code",
    "list_codes",
    "find_code",
    "find_code_by_uuid",
    "delete_code_row",
    "upsert_invited",
    "list_invited",
    "find_invited_lower",
    "delete_invited_row",
]


async def get_org_by_id(session: AsyncSession, org_id: int):
    """Org row or None · caller enforces permissions."""
    from src.db.organizations import Organization

    result = await session.scalars(
        select(Organization).where(Organization.id == org_id)
    )
    return result.first()


async def get_org_config(session: AsyncSession, org_id: int):
    """Org config row or None (for language resolution in invite emails)."""
    from src.db.organization_config import OrganizationConfig

    result = await session.scalars(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    )
    return result.first()


# ---------------------------------------------------------------------------
# Invite codes · authorization happens in invites.py before these calls
# ---------------------------------------------------------------------------


async def insert_invite_code(
    session: AsyncSession,
    org_id: int,
    code: str,
    code_uuid: str,
    created_by: str,
    usergroup_id: Optional[int] = None,
) -> OrganizationInviteCode:
    now = str(datetime.now())
    row = OrganizationInviteCode(
        code_uuid=code_uuid,
        org_id=org_id,
        code=code,
        code_type="signup",
        usergroup_id=usergroup_id,
        created_by=created_by,
        creation_date=now,
        update_date=now,
        expires_at=default_code_expiry_iso(),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def list_codes(session: AsyncSession, org_id: int) -> List[OrganizationInviteCode]:
    result = await session.scalars(
        select(OrganizationInviteCode)
        .where(OrganizationInviteCode.org_id == org_id)
        .order_by(OrganizationInviteCode.id.desc())  # type: ignore[attr-defined]
    )
    return [row for row in result.all() if not invite_code_is_expired(row)]


async def find_code(session: AsyncSession, org_id: int, code: str) -> Optional[OrganizationInviteCode]:
    result = await session.scalars(
        select(OrganizationInviteCode).where(
            OrganizationInviteCode.org_id == org_id,
            OrganizationInviteCode.code == code,
        )
    )
    row = result.first()
    if row is None or invite_code_is_expired(row):
        return None
    return row


async def find_code_by_uuid(session: AsyncSession, code_uuid: str) -> Optional[OrganizationInviteCode]:
    result = await session.scalars(
        select(OrganizationInviteCode).where(OrganizationInviteCode.code_uuid == code_uuid)
    )
    row = result.first()
    if row is None or invite_code_is_expired(row):
        return None
    return row


async def delete_code_row(session: AsyncSession, row: OrganizationInviteCode) -> None:
    await session.delete(row)
    await session.commit()


# ---------------------------------------------------------------------------
# Pending invited users · authorization happens in invites.py before calls
# ---------------------------------------------------------------------------


async def upsert_invited(
    session: AsyncSession,
    org_id: int,
    email: str,
    created_by: str,
    invite_code_uuid: Optional[str],
    email_sent: bool,
) -> OrganizationInvitedUser:
    normalized = email.strip()

    existing = await find_invited_lower(session, org_id, normalized)
    now = str(datetime.now())

    if existing is None:
        row = OrganizationInvitedUser(
            org_id=org_id,
            email=normalized,
            invite_code_uuid=invite_code_uuid,
            pending=True,
            email_sent=email_sent,
            created_by=created_by,
            creation_date=now,
            update_date=now,
            expires_at=default_invited_expiry_iso(),
        )
    else:
        row = existing
        row.pending = True
        row.email_sent = email_sent
        row.invite_code_uuid = invite_code_uuid or row.invite_code_uuid
        row.update_date = now
        row.expires_at = default_invited_expiry_iso()

    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def list_invited(session: AsyncSession, org_id: int) -> List[OrganizationInvitedUser]:
    result = await session.scalars(
        select(OrganizationInvitedUser)
        .where(OrganizationInvitedUser.org_id == org_id)
        .order_by(OrganizationInvitedUser.id.desc())  # type: ignore[attr-defined]
    )
    return [row for row in result.all() if not invited_user_is_expired(row)]


async def find_invited_lower(
    session: AsyncSession, org_id: int, email: str
) -> Optional[OrganizationInvitedUser]:
    result = await session.scalars(
        select(OrganizationInvitedUser).where(OrganizationInvitedUser.org_id == org_id)
    )
    target = email.strip().lower()
    for row in result.all():
        if row.email.lower() == target:
            return row
    return None


async def delete_invited_row(session: AsyncSession, row: OrganizationInvitedUser) -> None:
    await session.delete(row)
    await session.commit()
