/**
 * E2E: Formation enrollment (a learner adding/removing a course to their
 * trail — the "Mes formations" lifecycle), driven as one sequential journey
 * on a single learner to also stay lean on logins.
 *
 *  - a fresh learner's trail starts without the formation
 *  - adding the course creates a trail run for the org
 *  - the run exposes the course with its total step count
 *  - removing the course drops it from the trail again
 *  - the global trail endpoint agrees with the org-scoped one
 */
import { test, expect } from '../../../core/fixtures'
import { setupScenario, makeLearnerFixture, type LearnerFixture } from '../scenario'
import * as api from '../api'

let fx: LearnerFixture

test.beforeAll(async () => {
  fx = await makeLearnerFixture('enroll')
})

// The whole file is one sequential journey on a single learner: keep it
// serial so a mid-file failure skips the rest instead of restarting the
// worker with a fresh (unenrolled) fixture.
test.describe.configure({ mode: 'serial' })

test.describe('Formation enrollment', () => {
  test('a fresh learner has no run for a formation they never started', async () => {
    const trails = await api.getMyTrailForOrg(fx.learner.token, fx.org.id)
    expect(api.findRun(trails, fx.org.id, fx.formation.courseUuid)).toBeNull()
  })

  test('enrolling creates a run for the org', async () => {
    await api.enrollInCourse(fx.learner.token, fx.org.id, fx.learner.id, fx.formation.courseUuid)

    const trails = await api.getMyTrailForOrg(fx.learner.token, fx.org.id)
    const run = api.findRun(trails, fx.org.id, fx.formation.courseUuid)
    expect(run).not.toBeNull()
  })

  test('the run knows the formation total step count', async () => {
    const trails = await api.getMyTrailForOrg(fx.learner.token, fx.org.id)
    const run = api.findRun(trails, fx.org.id, fx.formation.courseUuid)
    expect(run!.course_total_steps).toBe(fx.formation.chapters[0].activities.length)
  })

  test('the run references the formation course', async () => {
    const trails = await api.getMyTrailForOrg(fx.learner.token, fx.org.id)
    const run = api.findRun(trails, fx.org.id, fx.formation.courseUuid)
    expect(run!.course).toBeTruthy()
    expect(run!.course!.name).toContain('E2E')
  })

  test('the global trail endpoint also lists the enrolled formation', async () => {
    // The endpoint returns a single TrailRead object (runs nested).
    const trails = await api.getMyTrail(fx.learner.token)
    expect(api.findRun(trails, fx.org.id, fx.formation.courseUuid)).not.toBeNull()
  })

  test('removing the course drops the run from the trail', async () => {
    await api.removeCourseFromTrail(fx.learner.token, fx.formation.courseUuid)

    const trails = await api.getMyTrailForOrg(fx.learner.token, fx.org.id)
    expect(api.findRun(trails, fx.org.id, fx.formation.courseUuid)).toBeNull()
  })

  test('a learner can re-enroll after removing', async () => {
    await api.enrollInCourse(fx.learner.token, fx.org.id, fx.learner.id, fx.formation.courseUuid)
    const trails = await api.getMyTrailForOrg(fx.learner.token, fx.org.id)
    expect(api.findRun(trails, fx.org.id, fx.formation.courseUuid)).not.toBeNull()
  })
})

test.describe('Scenario formation is enrolled by the shared learner', () => {
  test('shared learner can enroll in the scenario formation', async () => {
    const s = await setupScenario()
    await api.enrollInCourse(s.learner.token, s.org.id, s.learner.id, s.formation.courseUuid)
    const trails = await api.getMyTrailForOrg(s.learner.token, s.org.id)
    expect(api.findRun(trails, s.org.id, s.formation.courseUuid)).not.toBeNull()
  })
})
