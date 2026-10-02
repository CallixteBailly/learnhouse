/**
 * E2E: Course cloning.
 *
 * On a throwaway source course:
 *  - a course with chapters + activities can be cloned
 *  - the clone is a NEW course (different id/uuid) carrying the same
 *    chapter and activity structure
 *  - editing the clone does not touch the source
 */
import { test, expect } from '../../../core/fixtures'
import { adminToken } from '../scenario'
import * as api from '../api'

test.describe('Course cloning', () => {
  let token: string
  let orgId: number
  let sourceUuid: string
  let cloneUuid: string

  test.beforeAll(async () => {
    token = await adminToken()
    const org = await api.getOrg()
    orgId = org.id
    const source = await api.seedCourse(token, orgId, `E2E Clone Src ${Date.now().toString(36)}`)
    sourceUuid = source.courseUuid
  })

  test.afterAll(async () => {
    if (sourceUuid) await api.deleteCourse(token, sourceUuid).catch(() => {})
    if (cloneUuid) await api.deleteCourse(token, cloneUuid).catch(() => {})
  })

  test('a course can be cloned into a new independent course', async () => {
    const clone = await api.cloneCourse(token, sourceUuid)
    cloneUuid = clone.course_uuid

    expect(clone.id).toBeGreaterThan(0)
    expect(clone.course_uuid).not.toBe(sourceUuid)

    const sourceMeta = await api.getCourseMeta(token, sourceUuid)
    const cloneMeta = await api.getCourseMeta(token, cloneUuid)

    // Same chapter count, same activity types inside the first chapter.
    expect(cloneMeta.chapters.length).toBe(sourceMeta.chapters.length)
    const sourceTypes = sourceMeta.chapters[0].activities.map((a: any) => a.activity_type).sort()
    const cloneTypes = cloneMeta.chapters[0].activities.map((a: any) => a.activity_type).sort()
    expect(cloneTypes).toEqual(sourceTypes)
  })

  test('editing the clone leaves the source untouched', async () => {
    const clone = await api.getCourse(token, cloneUuid)
    const renamed = await api.updateCourse(token, cloneUuid, {
      description: 'Clone-specific description',
    })
    expect(renamed.description).toBe('Clone-specific description')

    const source = await api.getCourse(token, sourceUuid)
    expect(source.description).not.toBe('Clone-specific description')
  })
})
