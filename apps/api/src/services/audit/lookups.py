"""
Parameterized lookups used by the audit recorder.

Each helper runs a SQLModel ``select`` through ``AsyncSession.scalars`` — the
compared values travel as bound parameters, never inside the SQL text. Kept in
a dedicated module so the ASGI middleware stays free of query construction.
"""

from __future__ import annotations

from typing import Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import _async_session_factory
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import User


def open_session() -> AsyncSession:
    """Standalone session — the middleware records after the request's own
    session has been closed, so it manages its own lifecycle."""
    return _async_session_factory()


async def find_user_by_email(db_session: AsyncSession, email: str) -> Optional[User]:
    statement = select(User).where(User.email == email)
    result = await db_session.scalars(statement)
    return result.first()


async def org_id_for_slug(db_session: AsyncSession, slug: str) -> Optional[int]:
    statement = select(Organization).where(Organization.slug == slug)
    result = await db_session.scalars(statement)
    org = result.first()
    return org.id if org else None


async def org_id_for_course(db_session: AsyncSession, course_uuid: str) -> Optional[int]:
    statement = select(Course).where(Course.course_uuid == course_uuid)
    result = await db_session.scalars(statement)
    course = result.first()
    return course.org_id if course else None


async def sole_membership_org_id(db_session: AsyncSession, user_id: int) -> Optional[int]:
    """
    The acting user's org when they belong to exactly one. Ambiguous cases
    (no membership, or several) return None rather than guessing.
    """
    statement = (
        select(UserOrganization).where(UserOrganization.user_id == user_id).limit(2)
    )
    result = await db_session.scalars(statement)
    memberships = result.all()
    if len(memberships) == 1:
        return memberships[0].org_id
    return None


async def sole_organization_id(db_session: AsyncSession) -> Optional[int]:
    """
    On a single-organization instance every request belongs to that org, so
    anonymous calls (login attempts, signups) can still be attributed. Returns
    None as soon as a second organization exists.
    """
    statement = select(Organization).limit(2)
    result = await db_session.scalars(statement)
    orgs = result.all()
    if len(orgs) == 1:
        return orgs[0].id
    return None
