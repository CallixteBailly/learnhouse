# apps/api/src/tests/services/test_signup_profile.py
"""Validation contract for the Ordria enriched signup (job/phone/consents)."""
import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.job_titles import JobTitle
from src.db.users import UserCreate
from src.services.job_titles.job_titles import seed_default_job_titles
from src.services.users.signup_profile import (
    CONSENT_TEXT_VERSION,
    validate_and_normalize_signup_profile,
)


def _user(**overrides) -> UserCreate:
    base = dict(
        username="jdoe",
        email="jdoe@example.com",
        password="Str0ng!Pass1",
        first_name="John",
        last_name="Doe",
        profile={},
        extra_metadata={},
    )
    base.update(overrides)
    return UserCreate(**base)


def _consents() -> dict:
    return {"terms": True, "privacy": True}


@pytest.mark.asyncio
async def test_happy_path_with_job_from_list(db):
    await seed_default_job_titles(db)
    jt = (await db.execute(
        select(JobTitle).where(JobTitle.slug == "community_manager")
    )).scalars().first()

    user = _user(profile={"job": {"title_id": jt.id}, "phone": " 06 12 34 56 78 "},
                 extra_metadata={"consents": _consents()})
    await validate_and_normalize_signup_profile(db, user)

    assert user.profile["job"] == {
        "title_id": jt.id, "slug": "community_manager",
        "label": "Community Manager", "other": None,
    }
    assert user.profile["phone"] == "06 12 34 56 78"
    for kind in ("terms", "privacy"):
        stamp = user.extra_metadata["consents"][kind]
        assert stamp["accepted"] is True
        assert stamp["version"] == CONSENT_TEXT_VERSION
        assert stamp["accepted_at"]  # server-side ISO timestamp


@pytest.mark.asyncio
async def test_happy_path_with_other_job(db):
    user = _user(profile={"job": {"other": "Architecte 3D"}},
                 extra_metadata={"consents": _consents()})
    await validate_and_normalize_signup_profile(db, user)

    assert user.profile["job"]["slug"] == "other"
    assert user.profile["job"]["other"] == "Architecte 3D"
    assert user.profile["job"]["title_id"] is None


@pytest.mark.asyncio
async def test_missing_job_rejected(db):
    user = _user(extra_metadata={"consents": _consents()})
    with pytest.raises(HTTPException) as exc:
        await validate_and_normalize_signup_profile(db, user)
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "INVALID_JOB"


@pytest.mark.asyncio
async def test_inactive_job_id_rejected(db):
    from src.services.job_titles.job_titles import deactivate_job_title

    await seed_default_job_titles(db)
    await deactivate_job_title(db, 1)

    user = _user(profile={"job": {"title_id": 1}},
                 extra_metadata={"consents": _consents()})
    with pytest.raises(HTTPException) as exc:
        await validate_and_normalize_signup_profile(db, user)
    assert exc.value.detail["code"] == "INVALID_JOB"


@pytest.mark.asyncio
async def test_missing_consents_rejected(db):
    await seed_default_job_titles(db)
    user = _user(profile={"job": {"other": "Freelance"}},
                 extra_metadata={"consents": {"terms": True}})  # privacy absent
    with pytest.raises(HTTPException) as exc:
        await validate_and_normalize_signup_profile(db, user)
    assert exc.value.detail["code"] == "CONSENT_REQUIRED"


@pytest.mark.asyncio
async def test_invalid_phone_rejected(db):
    user = _user(profile={"job": {"other": "Freelance"}, "phone": "abc"},
                 extra_metadata={"consents": _consents()})
    with pytest.raises(HTTPException) as exc:
        await validate_and_normalize_signup_profile(db, user)
    assert exc.value.detail["code"] == "INVALID_PHONE"


@pytest.mark.asyncio
async def test_empty_job_other_rejected(db):
    user = _user(profile={"job": {"other": "   "}},
                 extra_metadata={"consents": _consents()})
    with pytest.raises(HTTPException) as exc:
        await validate_and_normalize_signup_profile(db, user)
    assert exc.value.detail["code"] == "INVALID_JOB"
