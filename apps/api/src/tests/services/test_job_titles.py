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
