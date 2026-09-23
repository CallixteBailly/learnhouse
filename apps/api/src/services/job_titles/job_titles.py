# apps/api/src/services/job_titles/job_titles.py
import re
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.job_titles import JobTitle, JobTitleCreate, JobTitleUpdate

# (label, sort_order) — catalogue de départ, modifiable par le superadmin.
DEFAULT_JOB_TITLES = [
    ("Community Manager", 1),
    ("Responsable marketing", 2),
    ("Chargé de communication", 3),
    ("Développeur / Développeuse", 4),
    ("Designer UX/UI", 5),
    ("Product Manager", 6),
    ("Chef de projet digital", 7),
    ("Traffic manager", 8),
    ("Graphiste", 9),
    ("Motion designer", 10),
    ("Rédacteur / Rédactrice web", 11),
    ("Consultant SEO", 12),
    ("Consultant data", 13),
    ("Commercial / Commerciale", 14),
    ("Responsable e-commerce", 15),
    ("Assistant(e) de direction", 16),
    ("Dirigeant(e) d'entreprise", 17),
    ("Indépendant / Freelance", 18),
    ("Étudiant(e)", 19),
    ("Demandeur d'emploi", 20),
]


def slugify_job_title(label: str) -> str:
    s = label.strip().lower()
    for accents, plain in (("àâä", "a"), ("éèêë", "e"), ("îï", "i"), ("ôö", "o"), ("ûüù", "u"), ("ç", "c")):
        for ch in accents:
            s = s.replace(ch, plain)
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


async def seed_default_job_titles(db_session: AsyncSession) -> int:
    """Insert the default catalog once. Idempotent: safe on every container boot."""
    existing = (await db_session.execute(select(JobTitle).limit(1))).scalars().first()
    if existing:
        return 0
    now = str(datetime.now())
    for label, order in DEFAULT_JOB_TITLES:
        db_session.add(
            JobTitle(
                label=label,
                slug=slugify_job_title(label),
                sort_order=order,
                creation_date=now,
                update_date=now,
            )
        )
    await db_session.commit()
    return len(DEFAULT_JOB_TITLES)


async def list_active_job_titles(db_session: AsyncSession) -> list[JobTitle]:
    statement = (
        select(JobTitle)
        .where(JobTitle.is_active == True)  # noqa: E712
        .order_by(JobTitle.sort_order, JobTitle.label)
    )
    return list((await db_session.execute(statement)).scalars().all())


async def get_job_title_by_id(
    db_session: AsyncSession, job_title_id: int
) -> Optional[JobTitle]:
    return (
        await db_session.execute(select(JobTitle).where(JobTitle.id == job_title_id))
    ).scalars().first()


async def create_job_title(db_session: AsyncSession, obj: JobTitleCreate) -> JobTitle:
    slug = obj.slug or slugify_job_title(obj.label)
    conflict = (
        await db_session.execute(
            select(JobTitle).where(
                (JobTitle.slug == slug) | (JobTitle.label == obj.label.strip())
            )
        )
    ).scalars().first()
    if conflict:
        raise HTTPException(status_code=400, detail="Job title already exists")
    now = str(datetime.now())
    jt = JobTitle(
        label=obj.label.strip(),
        slug=slug,
        sort_order=obj.sort_order,
        creation_date=now,
        update_date=now,
    )
    db_session.add(jt)
    await db_session.commit()
    await db_session.refresh(jt)
    return jt


async def update_job_title(
    db_session: AsyncSession, job_title_id: int, obj: JobTitleUpdate
) -> JobTitle:
    jt = await get_job_title_by_id(db_session, job_title_id)
    if not jt:
        raise HTTPException(status_code=404, detail="Job title not found")
    if obj.label is not None:
        jt.label = obj.label.strip()
        jt.slug = slugify_job_title(jt.label)
    if obj.sort_order is not None:
        jt.sort_order = obj.sort_order
    if obj.is_active is not None:
        jt.is_active = obj.is_active
    jt.update_date = str(datetime.now())
    db_session.add(jt)
    await db_session.commit()
    await db_session.refresh(jt)
    return jt


async def deactivate_job_title(
    db_session: AsyncSession, job_title_id: int
) -> JobTitle:
    return await update_job_title(
        db_session, job_title_id, JobTitleUpdate(is_active=False)
    )
