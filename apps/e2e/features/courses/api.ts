/**
 * E2E API helpers for the courses management feature module.
 *
 * Covers: course CRUD + metadata, chapters CRUD + reordering, activities of
 * every type (create/update/publish/delete), course discovery (pagination,
 * count, search), course cloning, and course updates (announcements).
 *
 * Builds on the generic `req` / `login` / `createStudent` from core/client.
 */
import { req, login, getOrg, createStudent } from '../../core/client'
import { API_URL } from '../../core/instance'

export { login, getOrg, createStudent, req }

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Chapter {
  id: number
  name: string
  chapter_uuid?: string
  lock_type?: string
  activities?: Activity[]
}

export interface Activity {
  id: number
  name: string
  activity_uuid: string
  activity_type: string
  activity_sub_type?: string
  published?: boolean
  lock_type?: string
}

export interface SeededCourse {
  orgId: number
  courseId: number
  courseUuid: string
  name: string
  chapters: Chapter[]
}

// ─── Course CRUD ────────────────────────────────────────────────────────────

/** Create a course. The endpoint expects multipart form fields + ?org_id=. */
export async function createCourse(
  token: string,
  orgId: number,
  name: string,
  tags = '',
  description = 'E2E course-management course',
): Promise<{ id: number; course_uuid: string }> {
  const form = new FormData()
  form.append('name', name)
  form.append('description', description)
  form.append('public', 'true')
  form.append('about', description)
  form.append('learnings', '[]')
  form.append('tags', tags)
  form.append('thumbnail_type', 'image')
  form.append('open_to_contributors', 'false')
  const res = await fetch(`${API_URL}/courses/?org_id=${orgId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`createCourse -> ${res.status}: ${text}`)
  return JSON.parse(text)
}

export function getCourse(token: string, courseUuid: string): Promise<any> {
  return req('GET', `/courses/${courseUuid}`, token)
}

/** Full course read: course fields + chapters + nested activities + authors. */
export function getCourseMeta(token: string, courseUuid: string): Promise<any> {
  return req('GET', `/courses/${courseUuid}/meta`, token)
}

export function updateCourse(
  token: string,
  courseUuid: string,
  patch: Record<string, unknown>,
): Promise<any> {
  return req('PUT', `/courses/${courseUuid}`, token, patch)
}

export async function deleteCourse(token: string, courseUuid: string): Promise<void> {
  await req('DELETE', `/courses/${courseUuid}`, token)
}

/** Fetch course meta, returning null on failure (deleted / forbidden). */
export async function tryGetCourseMeta(token: string, courseUuid: string): Promise<any | null> {
  try {
    return await getCourseMeta(token, courseUuid)
  } catch {
    return null
  }
}

export function cloneCourse(token: string, courseUuid: string): Promise<any> {
  return req('POST', `/courses/${courseUuid}/clone`, token)
}

// ─── Discovery ──────────────────────────────────────────────────────────────

export function listCoursesByOrgSlug(
  token: string,
  orgSlug: string,
  page = 1,
  limit = 50,
): Promise<any[]> {
  return req('GET', `/courses/org_slug/${orgSlug}/page/${page}/limit/${limit}`, token)
}

export function countCoursesByOrgSlug(token: string, orgSlug: string): Promise<number> {
  return req<number>('GET', `/courses/org_slug/${orgSlug}/count`, token)
}

export function searchCourses(token: string, orgSlug: string, query: string): Promise<any[]> {
  // The endpoint's full-text parameter is `query` (not `search`).
  return req(
    'GET',
    `/courses/org_slug/${orgSlug}/search?query=${encodeURIComponent(query)}`,
    token,
  )
}

// ─── Chapters ───────────────────────────────────────────────────────────────

export function createChapter(
  token: string,
  orgId: number,
  courseId: number,
  name: string,
  lockType: 'public' | 'authenticated' | 'restricted' = 'public',
): Promise<{ id: number; chapter_uuid: string }> {
  return req('POST', '/chapters/', token, {
    name,
    description: `Chapter ${name}`,
    org_id: orgId,
    course_id: courseId,
    lock_type: lockType,
  })
}

export function updateChapter(
  token: string,
  chapterId: number,
  patch: Record<string, unknown>,
): Promise<any> {
  return req('PUT', `/chapters/${chapterId}`, token, patch)
}

export async function deleteChapter(token: string, chapterId: number): Promise<void> {
  await req('DELETE', `/chapters/${chapterId}`, token)
}

/** Reorder chapters (and their activities) within a course. */
export function reorderChapters(
  token: string,
  courseUuid: string,
  order: { chapter_id: number; activities_order_by_ids: { activity_id: number }[] }[],
): Promise<unknown> {
  return req('PUT', `/chapters/course/${courseUuid}/order`, token, {
    chapter_order_by_ids: order,
  })
}

// ─── Activities ─────────────────────────────────────────────────────────────

export function createActivity(
  token: string,
  orgId: number,
  chapterId: number,
  name: string,
  activityType: string,
  activitySubType: string,
  published = true,
  lockType: 'public' | 'authenticated' | 'restricted' = 'public',
): Promise<{ id: number; activity_uuid: string }> {
  return req('POST', `/activities/?coursechapter_id=${chapterId}&org_id=${orgId}`, token, {
    name,
    activity_type: activityType,
    activity_sub_type: activitySubType,
    chapter_id: chapterId,
    published,
    lock_type: lockType,
    content: {},
    details: {},
  })
}

/** TYPE_VIDEO via the external-video helper (YouTube link), then published.
 * (The external_video endpoint creates the activity unpublished by default,
 * which hides it from the learner-facing course meta.) */
export async function createVideoActivity(
  token: string,
  orgId: number,
  chapterId: number,
  name: string,
): Promise<{ id: number; activity_uuid: string }> {
  const video = await req<{ id: number; activity_uuid: string }>(
    'POST',
    '/activities/external_video',
    token,
    {
      name,
      type: 'youtube',
      uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      chapter_id: chapterId,
      org_id: orgId,
      details: JSON.stringify({ startTime: 0, endTime: 0, autoplay: false, muted: false }),
    },
  )
  await updateActivity(token, video.activity_uuid, { published: true }).catch(() => {})
  return video
}

export function createDynamicActivity(
  token: string,
  orgId: number,
  chapterId: number,
  name: string,
): Promise<{ id: number; activity_uuid: string }> {
  return createActivity(token, orgId, chapterId, name, 'TYPE_DYNAMIC', 'SUBTYPE_DYNAMIC_PAGE')
}

export function createDocumentActivity(
  token: string,
  orgId: number,
  chapterId: number,
  name: string,
): Promise<{ id: number; activity_uuid: string }> {
  return createActivity(token, orgId, chapterId, name, 'TYPE_DOCUMENT', 'SUBTYPE_DOCUMENT_PDF')
}

export function updateActivity(
  token: string,
  activityUuid: string,
  patch: Record<string, unknown>,
): Promise<any> {
  return req('PUT', `/activities/${activityUuid}`, token, patch)
}

export async function deleteActivity(token: string, activityUuid: string): Promise<void> {
  await req('DELETE', `/activities/${activityUuid}`, token)
}

export function publishCourse(token: string, courseUuid: string): Promise<any> {
  return updateCourse(token, courseUuid, { public: true, published: true })
}

// ─── Course updates (announcements) ────────────────────────────────────────

export function createCourseUpdate(
  token: string,
  orgId: number,
  courseUuid: string,
  title: string,
  content: string,
): Promise<any> {
  return req('POST', `/courses/${courseUuid}/updates`, token, {
    title,
    content,
    org_id: orgId,
  })
}

export function listCourseUpdates(token: string, courseUuid: string): Promise<any[]> {
  return req('GET', `/courses/${courseUuid}/updates`, token)
}

export function updateCourseUpdate(
  token: string,
  courseUuid: string,
  updateUuid: string,
  patch: Record<string, unknown>,
): Promise<any> {
  return req('PUT', `/courses/${courseUuid}/update/${updateUuid}`, token, patch)
}

export async function deleteCourseUpdate(
  token: string,
  courseUuid: string,
  updateUuid: string,
): Promise<void> {
  await req('DELETE', `/courses/${courseUuid}/update/${updateUuid}`, token)
}

// ─── Full seeder ────────────────────────────────────────────────────────────

/** Seed a course with one chapter holding one activity of each major type. */
export async function seedCourse(
  adminToken: string,
  orgId: number,
  name: string,
  tags = '',
): Promise<SeededCourse> {
  const course = await createCourse(adminToken, orgId, name, tags)
  const chapter = await createChapter(adminToken, orgId, course.id, `${name} — Chapter 1`)

  const video = await createVideoActivity(adminToken, orgId, chapter.id, `${name} — Video`)
  const doc = await createDocumentActivity(adminToken, orgId, chapter.id, `${name} — Document`)
  const dynamic = await createDynamicActivity(adminToken, orgId, chapter.id, `${name} — Interactive`)
  await publishCourse(adminToken, course.course_uuid)

  return {
    orgId,
    courseId: course.id,
    courseUuid: course.course_uuid,
    name,
    chapters: [
      {
        id: chapter.id,
        name: `${name} — Chapter 1`,
        activities: [
          { id: video.id, name: `${name} — Video`, activity_uuid: video.activity_uuid, activity_type: 'TYPE_VIDEO' },
          { id: doc.id, name: `${name} — Document`, activity_uuid: doc.activity_uuid, activity_type: 'TYPE_DOCUMENT' },
          { id: dynamic.id, name: `${name} — Interactive`, activity_uuid: dynamic.activity_uuid, activity_type: 'TYPE_DYNAMIC' },
        ],
      },
    ],
  }
}
