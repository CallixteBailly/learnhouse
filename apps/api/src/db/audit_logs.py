from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel
from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AuditLog(SQLModel, table=True):
    """
    Immutable record of a state-changing API call (POST/PUT/PATCH/DELETE).

    Rows are written by the audit middleware after the response has been sent,
    so a failure here can never affect the request itself. user_id carries no
    FK on purpose: the trail must survive the deletion of the acting user, and
    `username` is a snapshot taken at write time for the same reason.
    """

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_org_created", "org_id", "created_at"),
        Index("ix_audit_log_org_user", "org_id", "user_id"),
        Index("ix_audit_log_org_resource", "org_id", "resource"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=True
        ),
    )
    user_id: Optional[int] = Field(default=None, index=True)
    username: Optional[str] = Field(default=None, max_length=255)
    resource: str = Field(default="", max_length=64)
    resource_id: Optional[str] = Field(default=None, max_length=128)
    action: str = Field(default="", max_length=255)
    path: str = Field(default="", max_length=512)
    method: str = Field(default="", max_length=10)
    status_code: int = Field(default=0)
    ip_address: Optional[str] = Field(default=None, max_length=45)
    user_agent: Optional[str] = Field(default=None, max_length=300)
    payload: Optional[dict[str, Any]] = Field(default=None, sa_column=Column(JSON, nullable=True))
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class AuditLogRead(BaseModel):
    id: int
    org_id: Optional[int] = None
    user_id: Optional[int] = None
    username: Optional[str] = None
    name: Optional[str] = None
    resource: str
    resource_id: Optional[str] = None
    action: str
    path: str
    method: str
    status_code: int
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    payload: Optional[dict[str, Any]] = None
    created_at: datetime


class AuditLogPage(BaseModel):
    items: list[AuditLogRead]
    total: int
    limit: int
    offset: int
