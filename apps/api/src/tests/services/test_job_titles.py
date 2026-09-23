# apps/api/src/tests/services/test_job_titles.py
"""Tests for the job_title model + service (Ordria enriched signup, Phase 1)."""
import pytest

from src.db.job_titles import JobTitle


@pytest.mark.asyncio
async def test_job_title_model_roundtrip(db):
    jt = JobTitle(label="Community Manager", slug="community_manager", sort_order=1)
    db.add(jt)
    await db.commit()
    await db.refresh(jt)

    assert jt.id is not None
    assert jt.is_active is True
    assert jt.slug == "community_manager"


from src.services.job_titles.job_titles import (
    DEFAULT_JOB_TITLES,
    create_job_title,
    deactivate_job_title,
    list_active_job_titles,
    seed_default_job_titles,
    slugify_job_title,
)
from src.db.job_titles import JobTitleCreate


@pytest.mark.asyncio
async def test_slugify_strips_accents():
    assert slugify_job_title("Responsable e-commerce") == "responsable_e_commerce"
    assert slugify_job_title("Développeur / Développeuse") == "developpeur_developpeuse"


@pytest.mark.asyncio
async def test_seed_is_idempotent(db):
    first = await seed_default_job_titles(db)
    second = await seed_default_job_titles(db)

    assert first == len(DEFAULT_JOB_TITLES)
    assert second == 0  # second boot inserts nothing

    titles = await list_active_job_titles(db)
    assert len(titles) == len(DEFAULT_JOB_TITLES)


@pytest.mark.asyncio
async def test_list_active_excludes_inactive_and_sorts(db):
    await seed_default_job_titles(db)
    await deactivate_job_title(db, 1)  # Community Manager -> inactive

    titles = await list_active_job_titles(db)

    assert all(t.is_active for t in titles)
    assert "community_manager" not in [t.slug for t in titles]
    orders = [t.sort_order for t in titles]
    assert orders == sorted(orders)


@pytest.mark.asyncio
async def test_create_conflict_rejected(db):
    await seed_default_job_titles(db)
    with pytest.raises(Exception) as exc:
        await create_job_title(db, JobTitleCreate(label="Community Manager"))
    assert exc.value.status_code == 400
