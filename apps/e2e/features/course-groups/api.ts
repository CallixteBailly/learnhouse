/**
 * E2E API helpers for the course-groups feature module.
 *
 * Covers: course creation (all activity types), usergroups (metier-based
 * access groups), course/chapter restriction by usergroup, certifications,
 * and org invites.
 *
 * Builds on the generic `req` / `login` / `createStudent` from core/client.
 */
import { req } from '../../core/client'
import { API_URL } from '../../core/instance'
import { login, getOrg, createStudent } from '../../core/client'

export { login, getOrg, createStudent, req }

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Ids {
  orgId: number
  courseId: number
  courseUuid: string        // includes 'course_' prefix
  bareCourseUuid: string    // stripped, for UI URLs
  chapterId: number
}

export interface UserGroup {
  id: number
  name: string
  description: string
  org_id: number
  usergroup_uuid: string
}

export interface SeededUser {
  email: string
  username: string
  password: string
  id: number
  token: string
}

export interface SeededCourse extends Ids {
  name: string
  activityUuids: { [activityId: number]: string }
  activities: { id: number; uuid: string; bareUuid: string; type: string; name: string }[]
}

// ─── Course creation (multipart FormData, same pattern as assignments/api.ts) ──

export async function createCourse(
  token: string,
  orgId: number,
  name: string,
  tags = '',
  description = 'E2E test course',
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

// ─── Chapter creation ───────────────────────────────────────────────────────

export async function createChapter(
  token: string,
  orgId: number,
  courseId: number,
  name: string,
  lockType: 'public' | 'authenticated' | 'restricted' = 'public',
): Promise<{ id: number; chapter_uuid: string }> {
  return req('POST', '/chapters/', token, {
    name,
    description: `Chapter for ${name}`,
    org_id: orgId,
    course_id: courseId,
    lock_type: lockType,
  })
}

// ─── Activity creation (generic + typed helpers) ────────────────────────────

export async function createActivity(
  token: string,
  orgId: number,
  chapterId: number,
  name: string,
  activityType: string,
  activitySubType: string,
  published = true,
  lockType: 'public' | 'authenticated' | 'restricted' = 'public',
): Promise<{ id: number; activity_uuid: string }> {
  return req(
    'POST',
    `/activities/?coursechapter_id=${chapterId}&org_id=${orgId}`,
    token,
    {
      name,
      activity_type: activityType,
      activity_sub_type: activitySubType,
      chapter_id: chapterId,
      published,
      lock_type: lockType,
      content: {},
      details: {},
    },
  )
}

/** Create a TYPE_VIDEO activity (external YouTube/Vimeo link). */
export function createVideoActivity(
  token: string,
  orgId: number,
  chapterId: number,
  name: string,
): Promise<{ id: number; activity_uuid: string }> {
  return req(
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
}

/** Create a TYPE_DYNAMIC activity (interactive page). */
export function createDynamicActivity(
  token: string,
  orgId: number,
  chapterId: number,
  name: string,
): Promise<{ id: number; activity_uuid: string }> {
  return createActivity(
    token, orgId, chapterId, name,
    'TYPE_DYNAMIC', 'SUBTYPE_DYNAMIC_PAGE', true,
  )
}

/** Create a TYPE_DOCUMENT activity (PDF). */
export async function createDocumentActivity(
  token: string,
  orgId: number,
  chapterId: number,
  name: string,
): Promise<{ id: number; activity_uuid: string }> {
  // Create the activity shell as TYPE_DOCUMENT, then the block is uploaded
  // separately via /blocks/pdf. For E2E we create the activity shell.
  return createActivity(
    token, orgId, chapterId, name,
    'TYPE_DOCUMENT', 'SUBTYPE_DOCUMENT_PDF', true,
  )
}

/** Create a TYPE_ASSIGNMENT activity (quiz/text). */
export function createAssignmentActivity(
  token: string,
  orgId: number,
  chapterId: number,
  name: string,
): Promise<{ id: number; activity_uuid: string }> {
  return createActivity(
    token, orgId, chapterId, name,
    'TYPE_ASSIGNMENT', 'SUBTYPE_ASSIGNMENT_ANY', true,
  )
}

// ─── Publish helpers ─────────────────────────────────────────────────────────

export async function publishCourse(
  token: string,
  courseUuid: string,
): Promise<void> {
  await req('PUT', `/courses/${courseUuid}`, token, {
    public: true,
    published: true,
  }).catch(() => {})
}

// ─── Full course seeder (creates course + chapter + all activity types) ─────

export async function seedCourse(
  adminToken: string,
  orgId: number,
  name: string,
  tags = '',
): Promise<SeededCourse> {
  const course = await createCourse(adminToken, orgId, name, tags)
  const chapter = await createChapter(adminToken, orgId, course.id, `${name} - Chapter 1`)

  const activities: SeededCourse['activities'] = []

  // Video
  const video = await createVideoActivity(adminToken, orgId, chapter.id, `${name} - Video`)
  activities.push({ id: video.id, uuid: video.activity_uuid, bareUuid: video.activity_uuid.replace(/^activity_/, ''), type: 'TYPE_VIDEO', name: `${name} - Video` })

  // Document (PDF)
  const doc = await createDocumentActivity(adminToken, orgId, chapter.id, `${name} - Document`)
  activities.push({ id: doc.id, uuid: doc.activity_uuid, bareUuid: doc.activity_uuid.replace(/^activity_/, ''), type: 'TYPE_DOCUMENT', name: `${name} - Document` })

  // Dynamic (interactive page)
  const dynamic = await createDynamicActivity(adminToken, orgId, chapter.id, `${name} - Interactive`)
  activities.push({ id: dynamic.id, uuid: dynamic.activity_uuid, bareUuid: dynamic.activity_uuid.replace(/^activity_/, ''), type: 'TYPE_DYNAMIC', name: `${name} - Interactive` })

  // Assignment (quiz)
  const assignment = await createAssignmentActivity(adminToken, orgId, chapter.id, `${name} - Assignment`)
  activities.push({ id: assignment.id, uuid: assignment.activity_uuid, bareUuid: assignment.activity_uuid.replace(/^activity_/, ''), type: 'TYPE_ASSIGNMENT', name: `${name} - Assignment` })

  await publishCourse(adminToken, course.course_uuid)

  return {
    orgId,
    courseId: course.id,
    courseUuid: course.course_uuid,
    bareCourseUuid: course.course_uuid.replace(/^course_/, ''),
    chapterId: chapter.id,
    name,
    activityUuids: {},
    activities,
  }
}

// ─── UserGroups (metier-based access groups) ──────────────────────────────────

export async function createUserGroup(
  adminToken: string,
  orgId: number,
  name: string,
  description = '',
): Promise<UserGroup> {
  return req('POST', `/usergroups/?org_id=${orgId}`, adminToken, {
    name,
    description,
    org_id: orgId,
  })
}

export async function addUserToGroup(
  adminToken: string,
  usergroupId: number,
  userIds: number[],
): Promise<void> {
  await req(
    'POST',
    `/usergroups/${usergroupId}/add_users?user_ids=${userIds.join(',')}`,
    adminToken,
  )
}

export async function addCourseToGroup(
  adminToken: string,
  usergroupId: number,
  resourceUuids: string[],
): Promise<void> {
  await req(
    'POST',
    `/usergroups/${usergroupId}/add_resources?resource_uuids=${resourceUuids.join(',')}`,
    adminToken,
  )
}

export async function getUserGroups(adminToken: string, orgId: number): Promise<UserGroup[]> {
  return req('GET', `/usergroups/org/${orgId}`, adminToken)
}

export async function getGroupMembers(adminToken: string, usergroupId: number): Promise<any[]> {
  return req('GET', `/usergroups/${usergroupId}/users`, adminToken)
}

// ─── Course access verification ─────────────────────────────────────────────

/** Try to fetch course metadata as a user. Returns null if 403/forbidden. */
export async function tryGetCourse(token: string, courseUuid: string): Promise<any | null> {
  try {
    return await req('GET', `/courses/${courseUuid}/meta`, token)
  } catch {
    return null
  }
}

/** Try to open an activity (navigate would be UI; here we check API access). */
export async function tryGetActivity(token: string, activityUuid: string): Promise<any | null> {
  try {
    return await req('GET', `/activities/${activityUuid}`, token)
  } catch {
    return null
  }
}

// ─── Certifications ───────────────────────────────────────────────────────────

export async function createCertification(
  adminToken: string,
  orgId: number,
  courseId: number,
  config: Record<string, unknown> = { template: 'gold' },
): Promise<{ id: number; certification_uuid: string }> {
  return req('POST', `/certifications/?org_id=${orgId}`, adminToken, {
    course_id: courseId,
    config,
  })
}

export async function getCourseCertifications(
  token: string,
  courseUuid: string,
): Promise<any[]> {
  return req('GET', `/certifications/course/${courseUuid}`, token)
}

export async function getUserCertificates(token: string): Promise<any[]> {
  return req('GET', '/certifications/user/all', token)
}

export async function getUserCertificateForCourse(
  token: string,
  courseUuid: string,
): Promise<any[]> {
  return req('GET', `/certifications/user/course/${courseUuid}`, token)
}

// ─── Trail / activity completion (to trigger certification award) ──────────

/** Mark an activity as complete for the authenticated user.
 * Uses the trail API: add_activity adds it to the trail as completed. */
export async function markActivityComplete(
  token: string,
  activityUuid: string,
): Promise<void> {
  await req('POST', `/trail/add_activity/${activityUuid}`, token).catch(() => {})
}

/** Add a course to the user's trail (enrollment / start tracking). */
export async function addCourseToTrail(
  token: string,
  courseUuid: string,
): Promise<void> {
  await req('POST', `/trail/add_course/${courseUuid}`, token).catch(() => {})
}

// ─── Invites ──────────────────────────────────────────────────────────────

export interface InviteCode {
  invite_code: string
  invite_code_uuid: string
  invite_code_expires: number
  invite_code_type: string
  usergroup_id?: number
}

export async function createInviteCode(
  adminToken: string,
  orgId: number,
  usergroupId?: number,
): Promise<InviteCode> {
  const query = usergroupId ? `?usergroup_id=${usergroupId}` : ''
  return req('POST', `/orgs/${orgId}/invites${query}`, adminToken)
}

export async function listInviteCodes(
  adminToken: string,
  orgId: number,
): Promise<InviteCode[]> {
  return req('GET', `/orgs/${orgId}/invites`, adminToken)
}

export async function joinOrg(
  token: string,
  orgId: number,
  userId: number | string,
  inviteCode?: string,
): Promise<void> {
  await req('POST', '/orgs/join', token, {
    org_id: orgId,
    user_id: userId,
    invite_code: inviteCode,
  })
}

export async function setSignupMechanism(
  adminToken: string,
  orgId: number,
  mechanism: 'open' | 'inviteOnly',
): Promise<void> {
  await req('PUT', `/orgs/${orgId}/signup_mechanism?signup_mechanism=${mechanism}`, adminToken)
}

// ─── User creation with token (full identity) ──────────────────────────────

export async function createUserAndGetToken(
  adminToken: string,
  orgId: number,
  identity: { email: string; username: string; password: string; first_name?: string; last_name?: string },
): Promise<SeededUser> {
  const userId = await createStudent(adminToken, orgId, identity)
  const token = await login(identity.email, identity.password)
  return { ...identity, id: userId, token }
}
