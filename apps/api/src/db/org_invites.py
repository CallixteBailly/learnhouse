"""Persistent org invitation storage (PostgreSQL).

Replaces the container-local Redis keys (org_invite_code_* / invited_user:*)
which were wiped on every container recreation, losing pending invitations
and invite codes at each API deploy. Same response shapes as the Redis
implementation so routers and the dashboard keep working unchanged.
"""

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import Column, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel

# Parity with the previous Redis TTLs (informational · enforced on read).
INVITE_CODE_TTL_SECONDS = 365 * 24 * 3600  # codes stay valid ~1 year
INVITED_USER_TTL_DAYS = 60  # pending invitations lapse after 60 days


class OrganizationInviteCode(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("org_id", "code", name="uq_invitecode_org_code"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    code_uuid: str = Field(default="", unique=True, index=True)
    org_id: int = Field(
        default=None,
        sa_column=Column(Integer, nullable=False, index=True),
    )
    code: str = Field(default="", index=True)
    code_type: str = "signup"
    # Plain integer column (no FK): usergroups may be managed elsewhere and a
    # dangling FK would break the auto-created table on mixed-version deploys.
    usergroup_id: Optional[int] = None
    created_by: str = ""  # user_uuid of the creator
    creation_date: str = ""
    update_date: str = ""
    # ISO date after which the code stops working · empty = never expires.
    expires_at: str = ""


class OrganizationInvitedUser(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("org_id", "email", name="uq_inviteduser_org_email"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        default=None,
        sa_column=Column(Integer, nullable=False, index=True),
    )
    email: str = Field(default="", index=True)
    invite_code_uuid: Optional[str] = None
    pending: bool = True
    email_sent: bool = False
    created_by: str = ""  # user_uuid of the inviter
    creation_date: str = ""
    update_date: str = ""
    # ISO date after which the pending invitation lapses · empty = never.
    expires_at: str = ""


def invite_code_is_expired(row: OrganizationInviteCode) -> bool:
    if not row.expires_at:
        return False
    try:
        return datetime.fromisoformat(row.expires_at) <= datetime.now()
    except ValueError:
        return False


def invited_user_is_expired(row: OrganizationInvitedUser) -> bool:
    if not row.expires_at:
        return False
    try:
        return datetime.fromisoformat(row.expires_at) <= datetime.now()
    except ValueError:
        return False


def default_code_expiry_iso() -> str:
    return (datetime.now() + timedelta(seconds=INVITE_CODE_TTL_SECONDS)).isoformat()


def default_invited_expiry_iso() -> str:
    return (datetime.now() + timedelta(days=INVITED_USER_TTL_DAYS)).isoformat()
