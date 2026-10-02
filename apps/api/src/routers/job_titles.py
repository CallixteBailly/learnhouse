# apps/api/src/routers/job_titles.py
from fastapi import APIRouter, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.job_titles import JobTitleCreate, JobTitleRead, JobTitleUpdate
from src.security.superadmin import require_superadmin
from src.services.job_titles.job_titles import (
    create_job_title,
    deactivate_job_title,
    list_active_job_titles,
    update_job_title,
)

router = APIRouter()


@router.get(
    "/public",
    response_model=list[JobTitleRead],
    tags=["job-titles"],
    summary="List active job titles (public)",
)
async def api_list_public_job_titles(
    db_session: AsyncSession = Depends(get_db_session),
):
    """Feeds the public signup form — actives only, ordered."""
    return await list_active_job_titles(db_session)


@router.post(
    "/admin",
    response_model=JobTitleRead,
    tags=["job-titles"],
    summary="Create a job title (superadmin)",
)
async def api_create_job_title(
    job_object: JobTitleCreate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(require_superadmin),
):
    return await create_job_title(db_session, job_object)


@router.put(
    "/admin/{job_title_id}",
    response_model=JobTitleRead,
    tags=["job-titles"],
    summary="Update a job title (superadmin)",
)
async def api_update_job_title(
    job_title_id: int,
    job_object: JobTitleUpdate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(require_superadmin),
):
    return await update_job_title(db_session, job_title_id, job_object)


@router.delete(
    "/admin/{job_title_id}",
    response_model=JobTitleRead,
    tags=["job-titles"],
    summary="Deactivate a job title (superadmin, soft delete)",
)
async def api_deactivate_job_title(
    job_title_id: int,
    db_session: AsyncSession = Depends(get_db_session),
    current_user=Depends(require_superadmin),
):
    return await deactivate_job_title(db_session, job_title_id)
