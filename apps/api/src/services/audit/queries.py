"""
Read side of the audit trail: filtered listing, counting and CSV export.

Every filter is a bound parameter. Free-text filters use ILIKE with the
wildcard characters of the user's input escaped, so a search for "50%" matches
the literal string instead of turning into a pattern.
"""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass
from datetime import datetime
from typing import AsyncIterator, Optional

from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.audit_logs import AuditLog, AuditLogRead
from src.db.users import User
from src.services.orgs.users import _csv_safe

MAX_PAGE_SIZE = 200
EXPORT_BATCH_SIZE = 1000
EXPORT_MAX_ROWS = 50_000

_LIKE_ESCAPE = "\\"


@dataclass
class AuditLogFilters:
    org_id: int
    limit: int = 20
    offset: int = 0
    action: Optional[str] = None
    resource: Optional[str] = None
    status_code: Optional[int] = None
    user_id: Optional[int] = None
    username: Optional[str] = None
    name: Optional[str] = None
    ip_address: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


def _contains(value: str) -> str:
    """ILIKE pattern for a case-insensitive substring match of `value`."""
    escaped = (
        value.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
        .replace("%", _LIKE_ESCAPE + "%")
        .replace("_", _LIKE_ESCAPE + "_")
    )
    return f"%{escaped}%"


def _matching_user_ids(name: str):
    """Subquery of user ids whose display name contains `name`."""
    full_name = func.concat(User.first_name, " ", User.last_name)
    return select(User.id).where(
        full_name.ilike(_contains(name), escape=_LIKE_ESCAPE)
    )


def _apply_filters(statement, filters: AuditLogFilters):
    statement = statement.where(AuditLog.org_id == filters.org_id)

    if filters.action:
        statement = statement.where(
            AuditLog.action.ilike(_contains(filters.action), escape=_LIKE_ESCAPE)  # type: ignore[attr-defined]
        )
    if filters.resource:
        statement = statement.where(AuditLog.resource == filters.resource.strip().lower()[:64])
    if filters.status_code is not None:
        statement = statement.where(AuditLog.status_code == filters.status_code)
    if filters.user_id is not None:
        statement = statement.where(AuditLog.user_id == filters.user_id)
    if filters.username:
        statement = statement.where(
            AuditLog.username.ilike(_contains(filters.username), escape=_LIKE_ESCAPE)  # type: ignore[attr-defined]
        )
    if filters.name:
        statement = statement.where(AuditLog.user_id.in_(_matching_user_ids(filters.name)))  # type: ignore[attr-defined]
    if filters.ip_address:
        statement = statement.where(
            AuditLog.ip_address.ilike(_contains(filters.ip_address), escape=_LIKE_ESCAPE)  # type: ignore[attr-defined]
        )
    if filters.start_date is not None:
        statement = statement.where(AuditLog.created_at >= filters.start_date)
    if filters.end_date is not None:
        statement = statement.where(AuditLog.created_at <= filters.end_date)

    return statement


async def _display_names(db_session: AsyncSession, user_ids: set[int]) -> dict[int, tuple[str, str]]:
    """id → (username, full name) for the users referenced by a page of logs."""
    if not user_ids:
        return {}
    statement = select(User).where(User.id.in_(user_ids))  # type: ignore[attr-defined]
    users = (await db_session.scalars(statement)).all()
    return {
        user.id: (user.username, f"{user.first_name} {user.last_name}".strip())
        for user in users
        if user.id is not None
    }


def _to_read(log: AuditLog, names: dict[int, tuple[str, str]]) -> AuditLogRead:
    username, full_name = names.get(log.user_id or -1, (None, None))
    return AuditLogRead(
        id=log.id or 0,
        org_id=log.org_id,
        user_id=log.user_id,
        username=log.username or username,
        name=full_name or None,
        resource=log.resource,
        resource_id=log.resource_id,
        action=log.action,
        path=log.path,
        method=log.method,
        status_code=log.status_code,
        ip_address=log.ip_address,
        user_agent=log.user_agent,
        payload=log.payload,
        created_at=log.created_at,
    )


async def count_audit_logs(db_session: AsyncSession, filters: AuditLogFilters) -> int:
    statement = _apply_filters(select(func.count(AuditLog.id)), filters)  # type: ignore[arg-type]
    total = (await db_session.scalars(statement)).first()
    return int(total or 0)


async def list_audit_logs(
    db_session: AsyncSession, filters: AuditLogFilters
) -> tuple[list[AuditLogRead], int]:
    limit = max(1, min(filters.limit, MAX_PAGE_SIZE))
    offset = max(0, filters.offset)

    statement = (
        _apply_filters(select(AuditLog), filters)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())  # type: ignore[attr-defined]
        .offset(offset)
        .limit(limit)
    )
    logs = (await db_session.scalars(statement)).all()
    names = await _display_names(db_session, {log.user_id for log in logs if log.user_id})
    total = await count_audit_logs(db_session, filters)
    return [_to_read(log, names) for log in logs], total


CSV_COLUMNS = (
    "timestamp",
    "user_id",
    "username",
    "name",
    "resource",
    "resource_id",
    "method",
    "path",
    "action",
    "status_code",
    "ip_address",
    "payload",
)


def _csv_line(values: list[object]) -> str:
    buffer = io.StringIO()
    csv.writer(buffer).writerow([_csv_safe(value) for value in values])
    return buffer.getvalue()


async def iter_audit_logs_csv(
    db_session: AsyncSession, filters: AuditLogFilters
) -> AsyncIterator[str]:
    """Stream the filtered trail as CSV, oldest page first within each batch."""
    yield _csv_line(list(CSV_COLUMNS))

    exported = 0
    offset = 0
    while exported < EXPORT_MAX_ROWS:
        statement = (
            _apply_filters(select(AuditLog), filters)
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())  # type: ignore[attr-defined]
            .offset(offset)
            .limit(EXPORT_BATCH_SIZE)
        )
        logs = (await db_session.scalars(statement)).all()
        if not logs:
            break

        names = await _display_names(db_session, {log.user_id for log in logs if log.user_id})
        for log in logs:
            row = _to_read(log, names)
            yield _csv_line(
                [
                    row.created_at.isoformat(),
                    row.user_id if row.user_id is not None else "",
                    row.username or "",
                    row.name or "",
                    row.resource,
                    row.resource_id or "",
                    row.method,
                    row.path,
                    row.action,
                    row.status_code,
                    row.ip_address or "",
                    json.dumps(row.payload, ensure_ascii=False) if row.payload else "",
                ]
            )
            exported += 1
            if exported >= EXPORT_MAX_ROWS:
                break

        offset += len(logs)
        if len(logs) < EXPORT_BATCH_SIZE:
            break
