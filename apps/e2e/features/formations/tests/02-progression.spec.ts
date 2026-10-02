/**
 * E2E: Formation progression — completing activities one by one.
 *
 * On a dedicated learner + formation:
 *  - a freshly enrolled run has zero completed steps
 *  - each completed activity adds exactly one step to the run
 *  - the run status is "in progress" until every activity is done
 *  - unmarking an activity removes its step
 */
import { test, expect } from '../../../core/fixtures'
import { makeLearnerFixture, type LearnerFixture } from '../scenario'
import * as api from '../api'

let fx: LearnerFixture

// Tests share fixture state sequentially (enroll → complete → award): keep
// serial so a failure skips the rest instead of re-running beforeAll fresh.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  fx = await makeLearnerFixture('progress')
  await api.enrollInCourse(fx.learner.token, fx.org.id, fx.learner.id, fx.formation.courseUuid)
})

test.describe('Formation progression', () => {
  test('a fresh run has zero completed steps', async () => {
    const trails = await api.getMyTrailForOrg(fx.learner.token, fx.org.id)
    const run = api.findRun(trails, fx.org.id, fx.formation.courseUuid)!
    expect(run.steps.length).toBe(0)
  })

  test('completing one activity adds one step', async () => {
    const activity = fx.formation.chapters[0].activities[0]
    await api.markActivityComplete(fx.learner.token, activity.uuid)

    const trails = await api.getMyTrailForOrg(fx.learner.token, fx.org.id)
    const run = api.findRun(trails, fx.org.id, fx.formation.courseUuid)!
    expect(run.steps.length).toBe(1)
  })

  test('completing the same activity twice does not double-count', async () => {
    const activity = fx.formation.chapters[0].activities[0]
    await api.markActivityComplete(fx.learner.token, activity.uuid)

    const trails = await api.getMyTrailForOrg(fx.learner.token, fx.org.id)
    const run = api.findRun(trails, fx.org.id, fx.formation.courseUuid)!
    expect(run.steps.length).toBe(1)
  })

  test('completing a second activity accumulates to two steps', async () => {
    const activity = fx.formation.chapters[0].activities[1]
    await api.markActivityComplete(fx.learner.token, activity.uuid)

    const trails = await api.getMyTrailForOrg(fx.learner.token, fx.org.id)
    const run = api.findRun(trails, fx.org.id, fx.formation.courseUuid)!
    expect(run.steps.length).toBe(2)
    expect(run.course_total_steps).toBe(3)
    expect(String(run.status).toLowerCase()).toContain('progress')
  })

  test('unmarking an activity removes its step', async () => {
    const activity = fx.formation.chapters[0].activities[1]
    await api.unmarkActivity(fx.learner.token, activity.uuid)

    const trails = await api.getMyTrailForOrg(fx.learner.token, fx.org.id)
    const run = api.findRun(trails, fx.org.id, fx.formation.courseUuid)!
    expect(run.steps.length).toBe(1)
  })
})
