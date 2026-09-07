"""
Audit trail endpoints — org administrators only.

Backs the "Audit Logs" page of the dashboard (list with filters + CSV export).
Rows are produced by the AuditLogMiddleware; this router never writes.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.audit_logs import AuditLogPage
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.org_auth import require_org_admin
from src.services.audit.queries import (
    MAX_PAGE_SIZE,
    AuditLogFilters,
    iter_audit_logs_csv,
    list_audit_logs,
)

router = APIRouter()


async def _authorize(
    current_user: PublicUser | AnonymousUser | APITokenUser,
    org_id: int,
    db_session: AsyncSession,
) -> None:
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    await require_org_admin(resolve_acting_user_id(current_user), org_id, db_session)


def _filters(
    org_id: int,
    limit: int,
    offset: int,
    action: Optional[str],
    resource: Optional[str],
    status_code: Optional[int],
    user_id: Optional[int],
    username: Optional[str],
    name: Optional[str],
    ip_address: Optional[str],
    start_date: Optional[datetime],
    end_date: Optional[datetime],
) -> AuditLogFilters:
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be before end_date")
    return AuditLogFilters(
        org_id=org_id,
        limit=limit,
        offset=offset,
        action=(action or "").strip()[:255] or None,
        resource=(resource or "").strip()[:64] or None,
        status_code=status_code,
        user_id=user_id,
        username=(username or "").strip()[:255] or None,
        name=(name or "").strip()[:255] or None,
        ip_address=(ip_address or "").strip()[:45] or None,
        start_date=start_date,
        end_date=end_date,
    )


@router.get(
    "/",
    response_model=AuditLogPage,
    summary="List audit log entries",
    description="Paginated, filterable trail of state-changing API calls for an organization. Requires org admin privileges.",
    responses={
        200: {"description": "Page of audit entries"},
        400: {"description": "Invalid filter"},
        401: {"description": "Authentication required"},
        403: {"description": "Admin access required for this organization"},
    },
)
async def get_audit_logs(
    org_id: int = Query(..., ge=1),
    limit: int = Query(20, ge=1, le=MAX_PAGE_SIZE),
    offset: int = Query(0, ge=0),
    action: Optional[str] = Query(None, max_length=255),
    resource: Optional[str] = Query(None, max_length=64),
    status_code: Optional[int] = Query(None, ge=100, le=599),
    user_id: Optional[int] = Query(None, ge=1),
    username: Optional[str] = Query(None, max_length=255),
    name: Optional[str] = Query(None, max_length=255),
    ip_address: Optional[str] = Query(None, max_length=45),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> AuditLogPage:
    await _authorize(current_user, org_id, db_session)
    filters = _filters(
        org_id, limit, offset, action, resource, status_code,
        user_id, username, name, ip_address, start_date, end_date,
    )
    items, total = await list_audit_logs(db_session, filters)
    return AuditLogPage(items=items, total=total, limit=limit, offset=offset)


@router.get(
    "/export",
    summary="Export audit log entries as CSV",
    description="Streams the filtered audit trail as a CSV file (capped at 50 000 rows). Requires org admin privileges.",
    responses={
        200: {"description": "CSV stream", "content": {"text/csv": {}}},
        400: {"description": "Invalid filter"},
        401: {"description": "Authentication required"},
        403: {"description": "Admin access required for this organization"},
    },
)
async def export_audit_logs(
    org_id: int = Query(..., ge=1),
    action: Optional[str] = Query(None, max_length=255),
    resource: Optional[str] = Query(None, max_length=64),
    status_code: Optional[int] = Query(None, ge=100, le=599),
    user_id: Optional[int] = Query(None, ge=1),
    username: Optional[str] = Query(None, max_length=255),
    name: Optional[str] = Query(None, max_length=255),
    ip_address: Optional[str] = Query(None, max_length=45),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    await _authorize(current_user, org_id, db_session)
    filters = _filters(
        org_id, 0, 0, action, resource, status_code,
        user_id, username, name, ip_address, start_date, end_date,
    )
    filename = f"audit_logs_org{org_id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter_audit_logs_csv(db_session, filters),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
