"""Tests for src/services/admin/move_course.py."""

from datetime import datetime

import pytest
from sqlmodel import select

from src.db.courses.activities import (
    Activity,
    ActivityLockType,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.blocks import Block, BlockTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.services.admin.move_course import move_course_to_org


@pytest.fixture
async def org2(db):
    o = Organization(
        id=2,
        name="Target Org",
        slug="target-org",
        email="target@org.com",
        org_uuid="org_target",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(o)
    await db.commit()
    return o


@pytest.fixture
async def full_course(db, org):
    """Course with one chapter, one activity and one block."""
    c = Course(
        id=1,
        name="Movable Course",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid="course_movable",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    await db.commit()

    ch = Chapter(
        chapter_uuid="chapter_m1",
        name="Chapter",
        description="",
        thumbnail_image="",
        org_id=org.id,
        course_id=c.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ch)
    await db.commit()

    cc = CourseChapter(
        order=0,
        course_id=c.id,
        chapter_id=ch.id,
        org_id=org.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(cc)
    await db.commit()

    ca = ChapterActivity(
        order=0,
        chapter_id=ch.id,
        activity_id=1,
        course_id=c.id,
        org_id=org.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ca)

    act = Activity(
        activity_uuid="activity_m1",
        name="Activity",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        chapter_id=ch.id,
        course_id=c.id,
        org_id=org.id,
        published=True,
        lock_type=ActivityLockType.PUBLIC,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        version=1,
        sequence=1,
    )
    db.add(act)
    await db.commit()

    blk = Block(
        block_type=BlockTypeEnum.BLOCK_CUSTOM,
        content={"hello": "world"},
        org_id=org.id,
        course_id=c.id,
        chapter_id=ch.id,
        activity_id=act.id,
        block_uuid="block_m1",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(blk)
    await db.commit()
    return c


async def _org_of(db, model, **filters):
    stmt = select(model)
    for attr, value in filters.items():
        stmt = stmt.where(getattr(model, attr) == value)
    rows = (await db.scalars(stmt)).all()
    return sorted(r.org_id for r in rows)


class TestMoveCourseToOrg:
    @pytest.mark.asyncio
    async def test_moves_every_related_row(
        self, db, org, org2, full_course, mock_request
    ):
        result = await move_course_to_org(
            mock_request, "course_movable", org2.id, db
        )

        assert result["to_org"]["id"] == org2.id
        assert result["from_org"]["id"] == org.id
        counts = result["rows_updated"]
        assert counts["course"] == 1
        assert counts["chapters"] == 1
        assert counts["course_chapters"] == 1
        assert counts["chapter_activities"] == 1
        assert counts["activities"] == 1
        assert counts["blocks"] == 1

        # Every related row now carries the target org id.
        assert await _org_of(db, Course, course_uuid="course_movable") == [org2.id]
        assert await _org_of(db, Chapter, course_id=full_course.id) == [org2.id]
        assert await _org_of(db, CourseChapter, course_id=full_course.id) == [org2.id]
        assert await _org_of(db, ChapterActivity, course_id=full_course.id) == [org2.id]
        assert await _org_of(db, Activity, course_id=full_course.id) == [org2.id]
        assert await _org_of(db, Block, course_id=full_course.id) == [org2.id]

    @pytest.mark.asyncio
    async def test_same_org_is_rejected(self, db, org, full_course, mock_request):
        with pytest.raises(Exception) as exc:
            await move_course_to_org(mock_request, "course_movable", org.id, db)
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_unknown_course_404(self, db, org, org2, mock_request):
        with pytest.raises(Exception) as exc:
            await move_course_to_org(mock_request, "course_nope", org2.id, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_unknown_target_org_404(self, db, org, full_course, mock_request):
        with pytest.raises(Exception) as exc:
            await move_course_to_org(mock_request, "course_movable", 999, db)
        assert exc.value.status_code == 404
