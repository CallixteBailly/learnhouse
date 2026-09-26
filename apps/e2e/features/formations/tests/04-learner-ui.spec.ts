/**
 * E2E: Learner UI journey through a formation (browser-driven).
 *
 * Drives the real UI like a learner with the shared student session:
 *  - the formation appears in the org course catalog
 *  - the course page renders the formation name and its chapter
 *  - the video activity page loads and embeds the external video player
 *
 * The formation is seeded via the API and the shared student is enrolled
 * through the API, keeping browser time focused on the visible journey.
 */
import { test, expect } from '../../../core/fixtures'
import { BASE_URL } from '../../../core/instance'
import { STUDENT_STATE, sharedStudent } from '../../../core/sharedAuth'
import { adminToken } from '../scenario'
import * as api from '../api'

test.use({ storageState: STUDENT_STATE })

let formation: api.SeededCourse
let videoActivity: { id: number; name: string; uuid: string }

test.beforeAll(async () => {
  const token = await adminToken()
  const org = await api.getOrg()
  const name = `E2E UI Journey ${Date.now().toString(36)}`
  const course = await api.createCourse(token, org.id, name)
  const chapter = await api.createChapter(token, org.id, course.id, 'Découverte')
  const video = await api.createExternalVideoActivity(
    token, org.id, chapter.id, 'Vidéo de présentation',
  )
  await api.updateCourse(token, course.course_uuid, { public: true, published: true })

  formation = {
    orgId: org.id,
    courseId: course.id,
    courseUuid: course.course_uuid,
    name,
    chapters: [{ id: chapter.id, name: 'Découverte', activities: [] }],
  }
  videoActivity = { id: video.id, name: 'Vidéo de présentation', uuid: video.activity_uuid }

  // Enroll the shared student so the journey is tracked from the start.
  const student = sharedStudent()
  const studentToken = await api.login(student.email, student.password)
  await api.enrollInCourse(studentToken, org.id, student.id, course.course_uuid).catch(() => {})
})

test.describe('Learner UI journey', () => {
  test('the formation appears in the course catalog', async ({ page }) => {
    // The published image serves the catalog at /courses (org-scoped
    // /orgs/{slug}/courses routes are a fork-only multi-tenant path).
    await page.goto(`${BASE_URL}/courses`)
    await expect(page.getByText(formation.name).first()).toBeVisible({ timeout: 30_000 })
  })

  test('the course page renders the formation and its chapter', async ({ page }) => {
    const bare = formation.courseUuid.replace(/^course_/, '')
    await page.goto(`${BASE_URL}/course/${bare}`)
    await expect(page.getByText(formation.name).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Découverte').first()).toBeVisible({ timeout: 15_000 })
  })

  test('the video activity page loads the player', async ({ page }) => {
    const bareCourse = formation.courseUuid.replace(/^course_/, '')
    const bareActivity = videoActivity.uuid.replace(/^activity_/, '')
    await page.goto(`${BASE_URL}/course/${bareCourse}/activity/${bareActivity}`)
    await page.waitForLoadState('domcontentloaded')

    // The learner stays authenticated (not bounced to /login).
    await expect(page).not.toHaveURL(/\/(login|auth\/login)/, { timeout: 15_000 })

    // External videos embed through an iframe player.
    await expect(page.locator('iframe').first()).toBeVisible({ timeout: 30_000 })
  })
})
