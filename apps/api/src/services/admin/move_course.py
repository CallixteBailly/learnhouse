"""
Move a course (with chapters, activities, blocks) from one organization to
another, in place.

Why this exists: the export/import pipeline is the supported path BETWEEN
instances, but a same-instance org move through it re-uploads every file —
and video-heavy courses exceed the platform's upload limit (Cloudflare's
100 MB request cap on the Workers proxy), making the move impossible. On a
single instance both orgs share the same database and object storage, so the
move is a consistent org_id flip plus a thumbnail relocation.

Storage notes:
- Thumbnails are looked up by a path REBUILT from the owning org's uuid, so
  they are copied to the target org's content path (small files).
- Media files (videos, HLS renditions, documents) are served through URLs
  that embed the org uuid they were UPLOADED under; the stream routes
  authorize by the course (hence the NEW org) and read the object at the key
  embedded in the URL (unchanged). Existing media therefore keeps streaming
  without any copy. New uploads after the move land under the new org path,
  as usual.

All queries are parameterized ORM statements (values travel as bound
parameters, never concatenated into SQL text).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.blocks import Block
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.activity_versions import ActivityVersion
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.services.courses.cache import (
    invalidate_course_meta_cache,
    invalidate_courses_cache,
)

logger = logging.getLogger(__name__)


async def _copy_course_thumbnails(
    course: Course, old_org: Organization, new_org: Organization
) -> list[str]:
    """Copy the course thumbnail objects to the target org's content path.

    Thumbnails are resolved at read time from
    content/orgs/{org_uuid}/courses/{course_uuid}/thumbnails/{file}, so the
    owning-org flip requires the files to exist under the NEW org uuid.
    """
    from src.services.courses.transfer.storage_utils import file_exists
    from src.services.courses.courses import _copy_storage_file

    copied: list[str] = []
    base = "content/orgs"
    src_dir = f"{base}/{old_org.org_uuid}/courses/{course.course_uuid}/thumbnails"
    dst_dir = f"{base}/{new_org.org_uuid}/courses/{course.course_uuid}/thumbnails"

    for attr in ("thumbnail_image", "thumbnail_video"):
        filename = getattr(course, attr, None)
        if not filename:
            continue
        src = f"{src_dir}/{filename}"
        if file_exists(src):
            _copy_storage_file(src, f"{dst_dir}/{filename}")
            copied.append(attr)

    return copied


def migrate_course_media(
    course_uuid: str, from_org: Organization, to_org: Organization,
    delete_source: bool = False,
) -> dict:
    """Re-home every storage object of a course under the target org's prefix.

    Playback URLs are rebuilt client-side from the SESSION org uuid
    (apps/web Video.tsx uses OrgContext), so after an org move the stream
    routes look objects up under the NEW org's content prefix. This copies
    all objects (videos, HLS ladders, documents, block files) from
    content/orgs/{from_uuid}/courses/{course_uuid}/... to the same suffix
    under the target org, server-side (S3 CopyObject — no bandwidth).

    Idempotent: keys already present are simply overwritten identically.
    """
    import asyncio

    from src.services.courses.transfer.storage_utils import (
        get_storage_client,
        get_s3_bucket_name,
        is_s3_enabled,
    )

    base = "content/orgs"
    src_prefix = f"{base}/{from_org.org_uuid}/courses/{course_uuid}"
    dst_prefix = f"{base}/{to_org.org_uuid}/courses/{course_uuid}"

    if not is_s3_enabled():
        # Local filesystem dev mode: recursive copy + optional delete.
        import os
        import shutil
        if os.path.isdir(src_prefix):
            shutil.copytree(src_prefix, dst_prefix, dirs_exist_ok=True)
            if delete_source:
                shutil.rmtree(src_prefix)
            return {"mode": "local", "copied": "tree", "source_deleted": delete_source}
        return {"mode": "local", "copied": "none", "source_deleted": False}

    client = get_storage_client()
    bucket = get_s3_bucket_name()

    copied = 0
    bytes_copied = 0
    deleted = 0
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=src_prefix + "/"):
        for obj in page.get("Contents", []):
            src_key = obj["Key"]
            dst_key = dst_prefix + src_key[len(src_prefix):]
            client.copy_object(
                Bucket=bucket,
                Key=dst_key,
                CopySource={"Bucket": bucket, "Key": src_key},
            )
            copied += 1
            bytes_copied += int(obj.get("Size", 0))
            if delete_source:
                client.delete_object(Bucket=bucket, Key=src_key)
                deleted += 1

    return {
        "mode": "s3",
        "objects_copied": copied,
        "bytes_copied": bytes_copied,
        "source_objects_deleted": deleted,
    }


async def move_course_to_org(
    request: Request,
    course_uuid: str,
    target_org_id: int,
    db_session: AsyncSession,
) -> dict:
    course = (
        await db_session.scalars(
            select(Course).where(Course.course_uuid == course_uuid)
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    target_org = (
        await db_session.scalars(
            select(Organization).where(Organization.id == target_org_id)
        )
    ).first()
    if not target_org:
        raise HTTPException(status_code=404, detail="Target organization not found")

    old_org = (
        await db_session.scalars(
            select(Organization).where(Organization.id == course.org_id)
        )
    ).first()

    if course.org_id == target_org_id:
        raise HTTPException(
            status_code=400,
            detail=f"Course already belongs to organization {target_org_id}",
        )

    now = str(datetime.now())

    # Load the related rows through the ORM (parameterized selects), flip the
    # org on each object, and let the unit of work flush parameterized UPDATEs.
    counts: dict[str, int] = {}

    course.org_id = target_org_id
    course.update_date = now
    counts["course"] = 1

    chapters = (
        await db_session.scalars(
            select(Chapter).where(Chapter.course_id == course.id)
        )
    ).all()
    for ch in chapters:
        ch.org_id = target_org_id
    counts["chapters"] = len(chapters)

    course_chapters = (
        await db_session.scalars(
            select(CourseChapter).where(CourseChapter.course_id == course.id)
        )
    ).all()
    for cc in course_chapters:
        cc.org_id = target_org_id
    counts["course_chapters"] = len(course_chapters)

    chapter_activities = (
        await db_session.scalars(
            select(ChapterActivity).where(ChapterActivity.course_id == course.id)
        )
    ).all()
    for ca in chapter_activities:
        ca.org_id = target_org_id
    counts["chapter_activities"] = len(chapter_activities)

    activities = (
        await db_session.scalars(
            select(Activity).where(Activity.course_id == course.id)
        )
    ).all()
    for act in activities:
        act.org_id = target_org_id
    counts["activities"] = len(activities)

    activity_ids = [act.id for act in activities]
    versions: list = []
    if activity_ids:
        versions = (
            await db_session.scalars(
                select(ActivityVersion).where(
                    ActivityVersion.activity_id.in_(activity_ids)
                )
            )
        ).all()
        for v in versions:
            v.org_id = target_org_id
    counts["activity_versions"] = len(versions)

    blocks = (
        await db_session.scalars(
            select(Block).where(Block.course_id == course.id)
        )
    ).all()
    for blk in blocks:
        blk.org_id = target_org_id
    counts["blocks"] = len(blocks)

    thumbnails_copied: list[str] = []
    media_migration: dict = {}
    if old_org is not None:
        try:
            thumbnails_copied = await _copy_course_thumbnails(
                course, old_org, target_org
            )
        except Exception:
            logger.warning(
                "move_course: thumbnail copy failed for %s (course keeps its "
                "metadata; re-upload the cover if it does not display)",
                course_uuid,
                exc_info=True,
            )
        try:
            # The whole media tree follows the org: playback URLs are rebuilt
            # from the session org, so objects must exist under the new prefix.
            media_migration = await asyncio.to_thread(
                migrate_course_media, course_uuid, old_org, target_org
            )
        except Exception:
            logger.warning(
                "move_course: media migration failed for %s — run "
                "POST /admin/courses/{uuid}/migrate-media to retry",
                course_uuid,
                exc_info=True,
            )

    await db_session.commit()

    # Cached listings/meta must not keep serving the old org's view.
    for org in (old_org, target_org):
        if org is not None and org.slug:
            invalidate_courses_cache(org.slug)
    invalidate_course_meta_cache(course_uuid)

    return {
        "course_uuid": course.course_uuid,
        "course_name": course.name,
        "from_org": {"id": old_org.id, "slug": old_org.slug} if old_org else None,
        "to_org": {"id": target_org.id, "slug": target_org.slug},
        "rows_updated": counts,
        "thumbnails_copied": thumbnails_copied,
        "media_migration": media_migration,
    }


async def migrate_media_endpoint_service(
    course_uuid: str,
    from_org_id: int,
    db_session: AsyncSession,
) -> dict:
    """Standalone retry path for the media migration of a moved course."""
    course = (
        await db_session.scalars(
            select(Course).where(Course.course_uuid == course_uuid)
        )
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    to_org = (
        await db_session.scalars(
            select(Organization).where(Organization.id == course.org_id)
        )
    ).first()
    from_org = (
        await db_session.scalars(
            select(Organization).where(Organization.id == from_org_id)
        )
    ).first()
    if not to_org or not from_org:
        raise HTTPException(status_code=404, detail="Organization not found")

    result = await asyncio.to_thread(
        migrate_course_media, course_uuid, from_org, to_org
    )
    result.update(
        {
            "course_uuid": course_uuid,
            "from_org": {"id": from_org.id, "slug": from_org.slug},
            "to_org": {"id": to_org.id, "slug": to_org.slug},
        }
    )
    return result
