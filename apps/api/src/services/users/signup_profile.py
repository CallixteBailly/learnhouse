# apps/api/src/services/users/signup_profile.py
"""Ordria enriched-signup contract: job (required), phone (optional), RGPD consents.

Storage (spec 2026-09-23):
  profile["job"]   {"title_id": int|None, "slug": str, "label": str, "other": str|None}
  profile["phone"] str | None
  extra_metadata["consents"]["terms"|"privacy"] =
      {"accepted": True, "accepted_at": <server ISO>, "version": CONSENT_TEXT_VERSION}
"""
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.job_titles import JobTitle

# Bump when the CGV / privacy texts change materially so new consents carry
# the new version (old consents keep their historical version — proof trail).
CONSENT_TEXT_VERSION = "2026-09"

PHONE_REGEX = re.compile(r"^\+?[0-9 .()-]{6,20}$")
OTHER_JOB_SLUG = "other"


def _http(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=400, detail={"code": code, "message": message})


async def _resolve_job(db_session: AsyncSession, job: Any) -> Optional[dict]:
    if not isinstance(job, dict):
        return None
    title_id = job.get("title_id")
    other = job.get("other")
    other = other.strip() if isinstance(other, str) else ""

    if title_id is not None:
        jt = (
            await db_session.execute(
                select(JobTitle).where(
                    JobTitle.id == int(title_id),
                    JobTitle.is_active == True,  # noqa: E712
                )
            )
        ).scalars().first()
        if not jt:
            raise _http("INVALID_JOB", "Unknown or inactive job title")
        return {"title_id": jt.id, "slug": jt.slug, "label": jt.label, "other": None}

    if other:
        if len(other) > 100:
            raise _http("INVALID_JOB", "Job 'other' must be at most 100 characters")
        return {"title_id": None, "slug": OTHER_JOB_SLUG, "other": other}
    return None


def _consent_stamp() -> dict:
    return {
        "accepted": True,
        "accepted_at": datetime.now(timezone.utc).isoformat(),
        "version": CONSENT_TEXT_VERSION,
    }


async def validate_and_normalize_signup_profile(
    db_session: AsyncSession, user_object
) -> None:
    """Enforce the enriched-signup contract. Mutates user_object in place."""
    profile = dict(user_object.profile or {})
    extra = dict(user_object.extra_metadata or {})

    job = await _resolve_job(db_session, profile.get("job"))
    if job is None:
        raise _http("INVALID_JOB", "A job title is required at signup")
    profile["job"] = job

    phone = profile.get("phone")
    if phone is not None:
        phone = str(phone).strip()
        if phone and not PHONE_REGEX.match(phone):
            raise _http("INVALID_PHONE", "Phone number format is invalid")
        profile["phone"] = phone or None

    raw = extra.get("consents")
    raw = raw if isinstance(raw, dict) else {}
    if raw.get("terms") is not True or raw.get("privacy") is not True:
        raise _http("CONSENT_REQUIRED", "Terms and privacy consents are required")
    extra["consents"] = {"terms": _consent_stamp(), "privacy": _consent_stamp()}

    user_object.profile = profile
    user_object.extra_metadata = extra


async def validate_profile_update(db_session: AsyncSession, user_object) -> None:
    """Validate job/phone on profile updates. Consents are never touched here."""
    profile = dict(user_object.profile or {})
    if profile.get("job") is not None:
        job = await _resolve_job(db_session, profile.get("job"))
        if job is None:
            raise _http("INVALID_JOB", "Job title is invalid")
        profile["job"] = job
    if profile.get("phone") is not None:
        phone = str(profile["phone"]).strip()
        if phone and not PHONE_REGEX.match(phone):
            raise _http("INVALID_PHONE", "Phone number format is invalid")
        profile["phone"] = phone or None
    user_object.profile = profile
