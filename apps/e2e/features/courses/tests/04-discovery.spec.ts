/**
 * E2E: Course discovery — catalog listing, counting and search.
 *
 * Against the scenario course (published in the shared default org):
 *  - the course appears in the org's course list
 *  - the count endpoint returns at least the number of listed courses
 *  - full-text search finds the course by (a slice of) its name
 *  - a nonsense query returns no result containing that nonsense
 */
import { test, expect } from '../../../core/fixtures'
import { setupScenario, type CoursesScenario } from '../scenario'
import * as api from '../api'

let s: CoursesScenario

test.beforeAll(async () => {
  s = await setupScenario()
})

test.describe('Course discovery', () => {
  test('the seeded course appears in the org course list', async () => {
    const courses = await api.listCoursesByOrgSlug(s.adminToken, s.org.slug)
    expect(courses.some(c => c.course_uuid === s.course.courseUuid)).toBe(true)
  })

  test('course count matches at least the first page length', async () => {
    const count = await api.countCoursesByOrgSlug(s.adminToken, s.org.slug)
    const firstPage = await api.listCoursesByOrgSlug(s.adminToken, s.org.slug, 1, 10)
    expect(count).toBeGreaterThanOrEqual(firstPage.length)
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('search finds the seeded course by name', async () => {
    // Search on a stable distinctive slice of the name.
    const needle = 'E2E Courses'
    const results = await api.searchCourses(s.adminToken, s.org.slug, needle)
    expect(results.some(c => c.course_uuid === s.course.courseUuid)).toBe(true)
  })

  test('search with a nonsense needle does not surface the seeded course', async () => {
    const results = await api.searchCourses(s.adminToken, s.org.slug, 'zzzznope')
    expect(results.some(c => c.course_uuid === s.course.courseUuid)).toBe(false)
  })

  test('the seeded course exposes full meta with chapters and activities', async () => {
    const meta = await api.getCourseMeta(s.adminToken, s.course.courseUuid)
    expect(meta.chapters.length).toBeGreaterThanOrEqual(1)
    const acts = meta.chapters[0].activities
    const types = acts.map((a: any) => a.activity_type)
    expect(types).toContain('TYPE_VIDEO')
    expect(types).toContain('TYPE_DOCUMENT')
    expect(types).toContain('TYPE_DYNAMIC')
  })
})
