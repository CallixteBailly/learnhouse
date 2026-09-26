/**
 * E2E: Activity management inside a course chapter.
 *
 * On a throwaway course:
 *  - activities of every major type can be created (video, document, dynamic,
 *    assignment) and appear in the chapter meta
 *  - an activity can be renamed
 *  - an activity can be unpublished (hidden from learner meta) and republished
 *  - an activity can be deleted and disappears
 */
import { test, expect } from '../../../core/fixtures'
import { adminToken } from '../scenario'
import * as api from '../api'

// Tests share accumulated chapter/activity state: keep serial so a failure
// skips the rest instead of restarting the worker with a fresh course.
test.describe.configure({ mode: 'serial' })

test.describe('Activity management', () => {
  let token: string
  let orgId: number
  let courseUuid: string
  let chapterId: number
  let created: { id: number; activity_uuid: string; type: string }[] = []

  test.beforeAll(async () => {
    token = await adminToken()
    const org = await api.getOrg()
    orgId = org.id
    const course = await api.createCourse(token, orgId, `E2E Activities ${Date.now().toString(36)}`)
    courseUuid = course.course_uuid
    const chapter = await api.createChapter(token, orgId, course.id, 'Activity Lab')
    chapterId = chapter.id

    const video = await api.createVideoActivity(token, orgId, chapterId, 'Lab Video')
    const doc = await api.createDocumentActivity(token, orgId, chapterId, 'Lab Document')
    const dynamic = await api.createDynamicActivity(token, orgId, chapterId, 'Lab Interactive')
    const assignment = await api.createActivity(
      token, orgId, chapterId, 'Lab Assignment', 'TYPE_ASSIGNMENT', 'SUBTYPE_ASSIGNMENT_ANY',
    )
    created = [
      { id: video.id, activity_uuid: video.activity_uuid, type: 'TYPE_VIDEO' },
      { id: doc.id, activity_uuid: doc.activity_uuid, type: 'TYPE_DOCUMENT' },
      { id: dynamic.id, activity_uuid: dynamic.activity_uuid, type: 'TYPE_DYNAMIC' },
      { id: assignment.id, activity_uuid: assignment.activity_uuid, type: 'TYPE_ASSIGNMENT' },
    ]
  })

  test.afterAll(async () => {
    if (courseUuid) await api.deleteCourse(token, courseUuid).catch(() => {})
  })

  function chapterActivities(meta: any): any[] {
    const chapter = meta.chapters.find((c: any) => c.id === chapterId)
    return chapter?.activities ?? []
  }

  test('all four activity types are present in chapter meta', async () => {
    const meta = await api.getCourseMeta(token, courseUuid)
    const acts = chapterActivities(meta)
    const types = acts.map((a: any) => a.activity_type)
    expect(types).toContain('TYPE_VIDEO')
    expect(types).toContain('TYPE_DOCUMENT')
    expect(types).toContain('TYPE_DYNAMIC')
    expect(types).toContain('TYPE_ASSIGNMENT')
    expect(acts.length).toBe(4)
  })

  test('an activity can be renamed', async () => {
    const target = created.find(c => c.type === 'TYPE_DYNAMIC')!
    await api.updateActivity(token, target.activity_uuid, { name: 'Lab Interactive Renamed' })

    const meta = await api.getCourseMeta(token, courseUuid)
    const act = chapterActivities(meta).find((a: any) => a.id === target.id)
    expect(act.name).toBe('Lab Interactive Renamed')
  })

  test('an activity can be unpublished and republished', async () => {
    const target = created.find(c => c.type === 'TYPE_DOCUMENT')!

    await api.updateActivity(token, target.activity_uuid, { published: false })
    let meta = await api.getCourseMeta(token, courseUuid)
    // Unpublished activities are hidden from the (learner-facing) meta.
    let act = chapterActivities(meta).find((a: any) => a.id === target.id)
    expect(act).toBeUndefined()

    await api.updateActivity(token, target.activity_uuid, { published: true })
    meta = await api.getCourseMeta(token, courseUuid)
    act = chapterActivities(meta).find((a: any) => a.id === target.id)
    expect(act).toBeDefined()
  })

  test('an activity can be deleted and disappears from meta', async () => {
    const target = created.find(c => c.type === 'TYPE_ASSIGNMENT')!
    await api.deleteActivity(token, target.activity_uuid)

    const meta = await api.getCourseMeta(token, courseUuid)
    const acts = chapterActivities(meta)
    expect(acts.find((a: any) => a.id === target.id)).toBeUndefined()
    expect(acts.length).toBe(3)
  })

  test('activity uuids carry the activity_ prefix', async () => {
    for (const c of created) {
      expect(c.activity_uuid).toMatch(/^activity_/)
    }
  })
})
