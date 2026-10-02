/**
 * E2E: Chapter (trail section) management inside a course.
 *
 * On a throwaway course:
 *  - chapters can be created and appear in the course meta in order
 *  - a chapter can be renamed
 *  - chapters can be reordered and the new order is readable in meta
 *  - a chapter can be deleted and disappears from meta
 */
import { test, expect } from '../../../core/fixtures'
import { adminToken } from '../scenario'
import * as api from '../api'

// Tests share accumulated chapter/activity state: keep serial so a failure
// skips the rest instead of restarting the worker with a fresh course.
test.describe.configure({ mode: 'serial' })

test.describe('Chapter management', () => {
  let token: string
  let orgId: number
  let courseUuid: string
  let chapterIds: number[]

  test.beforeAll(async () => {
    token = await adminToken()
    const org = await api.getOrg()
    orgId = org.id
    const course = await api.createCourse(token, orgId, `E2E Chapters ${Date.now().toString(36)}`)
    courseUuid = course.course_uuid

    chapterIds = []
    for (const n of ['Alpha', 'Beta', 'Gamma']) {
      const ch = await api.createChapter(token, orgId, course.id, `Chapter ${n}`)
      chapterIds.push(ch.id)
    }
  })

  test.afterAll(async () => {
    if (courseUuid) await api.deleteCourse(token, courseUuid).catch(() => {})
  })

  test('created chapters appear in course meta in creation order', async () => {
    const meta = await api.getCourseMeta(token, courseUuid)
    const names = meta.chapters.map((c: any) => c.name)
    expect(names).toEqual(['Chapter Alpha', 'Chapter Beta', 'Chapter Gamma'])
  })

  test('a chapter can be renamed', async () => {
    await api.updateChapter(token, chapterIds[1], { name: 'Chapter Beta Renamed' })

    const meta = await api.getCourseMeta(token, courseUuid)
    const names = meta.chapters.map((c: any) => c.name)
    expect(names).toEqual(['Chapter Alpha', 'Chapter Beta Renamed', 'Chapter Gamma'])
  })

  test('chapters can be reordered and the new order is readable', async () => {
    // Reverse the order.
    await api.reorderChapters(token, courseUuid, [
      { chapter_id: chapterIds[2], activities_order_by_ids: [] },
      { chapter_id: chapterIds[1], activities_order_by_ids: [] },
      { chapter_id: chapterIds[0], activities_order_by_ids: [] },
    ])

    const meta = await api.getCourseMeta(token, courseUuid)
    const names = meta.chapters.map((c: any) => c.name)
    expect(names).toEqual(['Chapter Gamma', 'Chapter Beta Renamed', 'Chapter Alpha'])
  })

  test('a chapter can be deleted and disappears from meta', async () => {
    await api.deleteChapter(token, chapterIds[0])

    const meta = await api.getCourseMeta(token, courseUuid)
    const names = meta.chapters.map((c: any) => c.name)
    expect(names).not.toContain('Chapter Alpha')
    expect(names.length).toBe(2)
  })

  test('a chapter with lock_type restricted is stored as such', async () => {
    const course = await api.getCourse(token, courseUuid)
    const restricted = await api.createChapter(
      token, orgId, course.id, 'Chapter Locked', 'restricted',
    )
    const meta = await api.getCourseMeta(token, courseUuid)
    const locked = meta.chapters.find((c: any) => c.id === restricted.id)
    expect(locked).toBeDefined()
    expect(String(locked.lock_type).toLowerCase()).toContain('restricted')
  })
})
