# apps/api/src/tests/services/test_signup_profile.py
"""Validation contract for the Ordria enriched signup (job/phone/consents)."""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.job_titles import JobTitle
from src.db.users import User, UserCreate, UserUpdate
from src.services.job_titles.job_titles import seed_default_job_titles
from src.services.users.signup_profile import (
    CONSENT_TEXT_VERSION,
    validate_and_normalize_signup_profile,
    validate_profile_update,
)
from src.services.users.users import update_user


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


@pytest.mark.asyncio
async def test_malformed_job_title_id_rejected_as_400(db):
    """A garbage title_id (non-numeric string) must 400, not 500."""
    user = _user(profile={"job": {"title_id": "abc"}},
                 extra_metadata={"consents": _consents()})
    with pytest.raises(HTTPException) as exc:
        await validate_and_normalize_signup_profile(db, user)
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "INVALID_JOB"


@pytest.mark.asyncio
async def test_validation_is_rerunnable_on_its_own_output(db):
    """Re-validating an already-normalized signup must not raise.

    The invite path delegates to create_user, which enforces the contract
    exactly once — but the validator must stay idempotent so any future
    double call cannot 400 on its own server-stamped consents.
    """
    # "other" free-text job shape.
    user = _user(profile={"job": {"other": "Architecte 3D"}, "phone": " 06 12 34 56 78 "},
                 extra_metadata={"consents": _consents()})
    await validate_and_normalize_signup_profile(db, user)
    await validate_and_normalize_signup_profile(db, user)  # must not raise
    for kind in ("terms", "privacy"):
        stamp = user.extra_metadata["consents"][kind]
        assert stamp["accepted"] is True
        assert stamp["version"] == CONSENT_TEXT_VERSION
        assert stamp["accepted_at"]

    # Catalog job shape: normalized output re-resolves via its title_id.
    await seed_default_job_titles(db)
    jt = (await db.execute(
        select(JobTitle).where(JobTitle.slug == "community_manager")
    )).scalars().first()
    user = _user(profile={"job": {"title_id": jt.id}},
                 extra_metadata={"consents": _consents()})
    await validate_and_normalize_signup_profile(db, user)
    await validate_and_normalize_signup_profile(db, user)  # must not raise
    assert user.profile["job"]["title_id"] == jt.id
    assert user.extra_metadata["consents"]["terms"]["accepted"] is True


# ---------------------------------------------------------------------------
# Profile-update validation (update_user path)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_validates_bad_phone(db):
    await seed_default_job_titles(db)
    user = UserUpdate(
        username="jdoe", email="jdoe@example.com",
        profile={"phone": "not-a-phone"},
    )
    with pytest.raises(HTTPException) as exc:
        await validate_profile_update(db, user)
    assert exc.value.detail["code"] == "INVALID_PHONE"


@pytest.mark.asyncio
async def test_update_accepts_valid_job_change(db):
    await seed_default_job_titles(db)
    from sqlmodel import select

    from src.db.job_titles import JobTitle as JT

    jt = (await db.execute(select(JT).where(JT.slug == "designer_ux_ui"))).scalars().first()
    user = UserUpdate(
        username="jdoe", email="jdoe@example.com",
        profile={"job": {"title_id": jt.id}},
    )
    await validate_profile_update(db, user)
    assert user.profile["job"]["slug"] == "designer_ux_ui"


@pytest.mark.asyncio
async def test_update_user_merges_profile_and_shields_consents(
    mock_request, db, regular_user
):
    """Full update_user service call: profile merges, consents stay append-only.

    A payload that ships a malicious extra_metadata.consents (rewriting /
    withdrawing the RGPD stamps) must leave the signup-stamped consents
    untouched, while other extra_metadata keys and a partial profile update
    still land.
    """
    row = await db.get(User, regular_user.id)
    row.profile = {
        "job": {"title_id": None, "slug": "other", "other": "Architecte 3D"},
        "phone": "+33612345678",
    }
    stamped_consents = {
        "terms": {
            "accepted": True,
            "accepted_at": "2026-09-23T10:00:00+00:00",
            "version": CONSENT_TEXT_VERSION,
        },
        "privacy": {
            "accepted": True,
            "accepted_at": "2026-09-23T10:00:00+00:00",
            "version": CONSENT_TEXT_VERSION,
        },
    }
    row.extra_metadata = {"consents": stamped_consents}
    db.add(row)
    await db.commit()

    with patch(
        "src.services.users.users.authorization_verify_if_user_is_anon",
        new_callable=AsyncMock,
    ), patch(
        "src.services.users.users.authorization_verify_based_on_roles_and_authorship",
        new_callable=AsyncMock,
    ):
        updated = await update_user(
            mock_request,
            db,
            regular_user.id,
            regular_user,
            UserUpdate(
                username="regular",
                first_name="Regular",
                last_name="User",
                email="regular@test.com",
                profile={"phone": "+33798765432"},
                extra_metadata={
                    "consents": {
                        "terms": {"accepted": False},
                        "privacy": {"accepted": False, "version": "tampered"},
                    },
                    "theme": "dark",
                },
            ),
        )

    # Profile merged: the new phone lands, the signup-collected job survives.
    assert updated.profile["phone"] == "+33798765432"
    assert updated.profile["job"]["other"] == "Architecte 3D"

    # Consents are byte-identical to the signup stamps; sibling keys merge.
    row = await db.get(User, regular_user.id)
    assert row.extra_metadata["consents"] == stamped_consents
    assert row.extra_metadata["theme"] == "dark"
