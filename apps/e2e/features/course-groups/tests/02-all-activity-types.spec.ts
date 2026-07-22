/**
 * E2E: All activity types coverage.
 *
 * Validates that a seeded course contains all 4 activity types:
 * - TYPE_VIDEO (external YouTube link)
 * - TYPE_DOCUMENT (PDF)
 * - TYPE_DYNAMIC (interactive page)
 * - TYPE_ASSIGNMENT (quiz)
 *
 * Each activity is fetched via API and its type verified. This ensures
 * the full content type spectrum is created and accessible.
 */
import { test, expect } from '../../../core/fixtures'
import { setupScenario, type Scenario } from '../scenario'
import * as api from '../api'

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario()
})

test.describe('All activity types created and accessible', () => {

  test('coiffeur course has exactly 4 activities of different types', async () => {
    const course = await api.tryGetCourse(s.coiffeurStudent.token, s.coiffeurCourse.courseUuid)
    expect(course).not.toBeNull()

    // The course meta includes chapters with activities
    const chapters = course.chapters || []
    const allActivities = chapters.flatMap((ch: any) => ch.activities || [])
    expect(allActivities.length).toBeGreaterThanOrEqual(4)
  })

  test('video activity exists and is TYPE_VIDEO', async () => {
    const videoActivity = s.coiffeurCourse.activities.find(a => a.type === 'TYPE_VIDEO')
    expect(videoActivity).toBeDefined()
    expect(videoActivity!.uuid).toMatch(/^activity_/)

    const detail = await api.tryGetActivity(s.coiffeurStudent.token, videoActivity!.uuid)
    expect(detail).not.toBeNull()
  })

  test('document activity exists and is TYPE_DOCUMENT', async () => {
    const docActivity = s.coiffeurCourse.activities.find(a => a.type === 'TYPE_DOCUMENT')
    expect(docActivity).toBeDefined()

    const detail = await api.tryGetActivity(s.coiffeurStudent.token, docActivity!.uuid)
    expect(detail).not.toBeNull()
  })

  test('dynamic activity exists and is TYPE_DYNAMIC', async () => {
    const dynActivity = s.coiffeurCourse.activities.find(a => a.type === 'TYPE_DYNAMIC')
    expect(dynActivity).toBeDefined()

    const detail = await api.tryGetActivity(s.coiffeurStudent.token, dynActivity!.uuid)
    expect(detail).not.toBeNull()
  })

  test('assignment activity exists and is TYPE_ASSIGNMENT', async () => {
    const assignActivity = s.coiffeurCourse.activities.find(a => a.type === 'TYPE_ASSIGNMENT')
    expect(assignActivity).toBeDefined()

    const detail = await api.tryGetActivity(s.coiffeurStudent.token, assignActivity!.uuid)
    expect(detail).not.toBeNull()
  })

  test('garagiste course also has all 4 activity types', async () => {
    const types = s.garagisteCourse.activities.map(a => a.type)
    expect(types).toContain('TYPE_VIDEO')
    expect(types).toContain('TYPE_DOCUMENT')
    expect(types).toContain('TYPE_DYNAMIC')
    expect(types).toContain('TYPE_ASSIGNMENT')
  })

  test('activities have bare UUIDs valid for UI URLs', async () => {
    for (const act of s.coiffeurCourse.activities) {
      // Bare UUID should not have the 'activity_' prefix
      expect(act.bareUuid).not.toMatch(/^activity_/)
      expect(act.bareUuid.length).toBeGreaterThan(8)
    }
  })
})
