/**
 * E2E API helpers for the formations (learner journey / trail) feature module.
 *
 * Covers: trail lifecycle (start / read / add & remove course & activities),
 * progression read-back through the trail runs, and the completion ->
 * certification award transition.
 *
 * Builds on the generic `req` / `login` / `createStudent` from core/client.
 */
import { req, login, getOrg, createStudent } from '../../core/client'
import { API_URL } from '../../core/instance'

export { login, getOrg, createStudent, req }

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SeededUser {
  email: string
  username: string
  password: string
  id: number
  token: string
}

export interface TrailStep {
  id?: number
  activity_uuid?: string
  chapter_activity_id?: number
}

export interface TrailRun {
  id: number
  course_id: number
  org_id: number
  user_id: number
  status: string
  course_total_steps: number
  steps: TrailStep[]
  course?: { name?: string; course_uuid?: string } | null
}

export interface TrailRead {
  id: number
  org_id: number
  user_id: number
  runs: TrailRun[]
}

export interface SeededCourse {
  orgId: number
  courseId: number
  courseUuid: string
  name: string
  chapters: { id: number; name: string; activities: { id: number; name: string; uuid: string; type: string }[] }[]
}

// ─── Trail lifecycle ────────────────────────────────────────────────────────

/** Ensure the learner has a trail in the org (idempotent; safe to re-call). */
export async function startTrail(
  token: string,
  orgId: number,
  userId: number,
): Promise<void> {
  await req('POST', '/trail/start', token, { org_id: orgId, user_id: userId }).catch(() => {})
}

/**
 * Enroll a learner: start their trail in the org if needed (the published
 * image's add_course 404s with "Trail not found" without one), then attach
 * the course.
 */
export async function enrollInCourse(
  token: string,
  orgId: number,
  userId: number,
  courseUuid: string,
): Promise<void> {
  await startTrail(token, orgId, userId)
  await req('POST', `/trail/add_course/${courseUuid}`, token)
}

export function getMyTrail(token: string): Promise<TrailRead[]> {
  return req<TrailRead[]>('GET', '/trail/', token)
}

export function getMyTrailForOrg(token: string, orgId: number): Promise<TrailRead[]> {
  return req<TrailRead[]>('GET', `/trail/org/${orgId}/trail`, token)
}

export function addCourseToTrail(token: string, courseUuid: string): Promise<unknown> {
  return req('POST', `/trail/add_course/${courseUuid}`, token)
}

export function removeCourseFromTrail(token: string, courseUuid: string): Promise<unknown> {
  return req('DELETE', `/trail/remove_course/${courseUuid}`, token)
}

export function markActivityComplete(token: string, activityUuid: string): Promise<unknown> {
  return req('POST', `/trail/add_activity/${activityUuid}`, token)
}

export function unmarkActivity(token: string, activityUuid: string): Promise<unknown> {
  return req('DELETE', `/trail/remove_activity/${activityUuid}`, token)
}

/** Find the run for a course inside a trail read (null when absent).
 * The trail endpoints return a single TrailRead (with nested runs), but we
 * also tolerate an array for forward compatibility. */
export function findRun(
  trails: TrailRead | TrailRead[],
  orgId: number,
  courseUuid: string,
): TrailRun | null {
  const arr = Array.isArray(trails) ? trails : [trails]
  for (const t of arr) {
    if (!t || t.org_id !== orgId) continue
    for (const r of t.runs ?? []) {
      if (r.course?.course_uuid === courseUuid) return r
    }
  }
  return null
}

// ─── Certifications ─────────────────────────────────────────────────────────

export function getUserCertificates(token: string): Promise<any[]> {
  return req('GET', '/certifications/user/all', token)
}

export function getUserCertificatesForCourse(token: string, courseUuid: string): Promise<any[]> {
  return req('GET', `/certifications/user/course/${courseUuid}`, token)
}

export function createCertification(
  adminToken: string,
  orgId: number,
  courseId: number,
  config: Record<string, unknown> = { template: 'gold' },
): Promise<{ id: number; certification_uuid: string }> {
  return req('POST', '/certifications/?org_id=' + orgId, adminToken, {
    course_id: courseId,
    config,
  })
}

export function getCourseCertifications(token: string, courseUuid: string): Promise<any[]> {
  return req('GET', `/certifications/course/${courseUuid}`, token)
}

// ─── Course seeding ─────────────────────────────────────────────────────────

export async function createCourse(
  token: string,
  orgId: number,
  name: string,
): Promise<{ id: number; course_uuid: string }> {
  const form = new FormData()
  form.append('name', name)
  form.append('description', 'Formations E2E course')
  form.append('public', 'true')
  form.append('about', 'Formations E2E course')
  form.append('learnings', '[]')
  form.append('tags', '')
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

export function createChapter(
  token: string,
  orgId: number,
  courseId: number,
  name: string,
): Promise<{ id: number; chapter_uuid: string }> {
  return req('POST', '/chapters/', token, {
    name,
    description: '',
    org_id: orgId,
    course_id: courseId,
    lock_type: 'public',
  })
}

/** TYPE_VIDEO via the external-video helper (YouTube link), then published. */
export async function createExternalVideoActivity(
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

/** Update an activity (name, published, lock_type, content…). */
export function updateActivity(
  token: string,
  activityUuid: string,
  patch: Record<string, unknown>,
): Promise<any> {
  return req('PUT', `/activities/${activityUuid}`, token, patch)
}

export function createActivity(
  token: string,
  orgId: number,
  chapterId: number,
  name: string,
  type = 'TYPE_DYNAMIC',
  subType = 'SUBTYPE_DYNAMIC_PAGE',
): Promise<{ id: number; activity_uuid: string }> {
  return req('POST', `/activities/?coursechapter_id=${chapterId}&org_id=${orgId}`, token, {
    name,
    activity_type: type,
    activity_sub_type: subType,
    chapter_id: chapterId,
    published: true,
    lock_type: 'public',
    content: {},
    details: {},
  })
}

export async function updateCourse(
  token: string,
  courseUuid: string,
  patch: Record<string, unknown>,
): Promise<any> {
  return req('PUT', `/courses/${courseUuid}`, token, patch)
}

/** Seed a published course with one chapter and N dynamic activities. */
export async function seedFormation(
  adminToken: string,
  orgId: number,
  name: string,
  activityCount = 3,
): Promise<SeededCourse> {
  const course = await createCourse(adminToken, orgId, name)
  const chapter = await createChapter(adminToken, orgId, course.id, `${name} — Parcours`)
  const activities = []
  for (let i = 1; i <= activityCount; i++) {
    const a = await createActivity(adminToken, orgId, chapter.id, `${name} — Leçon ${i}`)
    activities.push({ id: a.id, name: `${name} — Leçon ${i}`, uuid: a.activity_uuid, type: 'TYPE_DYNAMIC' })
  }
  await updateCourse(adminToken, course.course_uuid, { public: true, published: true })
  return {
    orgId,
    courseId: course.id,
    courseUuid: course.course_uuid,
    name,
    chapters: [{ id: chapter.id, name: `${name} — Parcours`, activities }],
  }
}

// ─── Identity ───────────────────────────────────────────────────────────────

export async function createUserAndGetToken(
  adminToken: string,
  orgId: number,
  identity: { email: string; username: string; password: string; first_name?: string; last_name?: string },
): Promise<SeededUser> {
  const userId = await createStudent(adminToken, orgId, identity)
  const token = await login(identity.email, identity.password)
  return { ...identity, id: userId, token }
}
