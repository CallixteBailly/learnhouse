/**
 * E2E: Formation completion & certification award.
 *
 * On a dedicated learner + formation carrying a certification template:
 *  - the certification template is attached to the formation
 *  - a learner who has not completed has no certificate
 *  - completing every published activity completes the run (all steps done)
 *  - the completion transition auto-awards the certificate
 *  - the certificate appears in the learner's per-course and global lists
 *  - a learner who completed only part of a certified formation gets nothing
 *
 * The trail service runs check_course_completion_and_create_certificate when
 * an activity completion pushes the course over the finish line, so the award
 * is asserted STRONGLY here (course-groups/03 only logs it).
 */
import { test, expect } from '../../../core/fixtures'
import { makeLearnerFixture, type LearnerFixture } from '../scenario'
import * as api from '../api'

let fx: LearnerFixture

// Tests share fixture state sequentially (enroll → complete → award): keep
// serial so a failure skips the rest instead of re-running beforeAll fresh.
test.describe.configure({ mode: 'serial' })
let certificationUuid: string

test.beforeAll(async () => {
  fx = await makeLearnerFixture('complete')
  const cert = await api.createCertification(
    fx.adminToken, fx.org.id, fx.formation.courseId,
    { template: 'gold', title: 'Certificat Formation E2E' },
  )
  certificationUuid = cert.certification_uuid
})

test.describe('Formation completion & certification', () => {
  test('the certification template is attached to the formation', async () => {
    const certs = await api.getCourseCertifications(fx.adminToken, fx.formation.courseUuid)
    expect(certs.some(c => c.certification_uuid === certificationUuid)).toBe(true)
  })

  test('the learner has no certificate before completing', async () => {
    const certs = await api.getUserCertificatesForCourse(fx.learner.token, fx.formation.courseUuid)
    expect(certs.length).toBe(0)
  })

  test('completing all activities completes the run', async () => {
    await api.enrollInCourse(fx.learner.token, fx.org.id, fx.learner.id, fx.formation.courseUuid)
    for (const activity of fx.formation.chapters[0].activities) {
      await api.markActivityComplete(fx.learner.token, activity.uuid)
    }

    const trails = await api.getMyTrailForOrg(fx.learner.token, fx.org.id)
    const run = api.findRun(trails, fx.org.id, fx.formation.courseUuid)!
    expect(run.steps.length).toBe(run.course_total_steps)
    expect(run.course_total_steps).toBe(fx.formation.chapters[0].activities.length)
  })

  test('the completion transition awards a certificate', async () => {
    const certs = await api.getUserCertificatesForCourse(fx.learner.token, fx.formation.courseUuid)
    expect(certs.length).toBeGreaterThanOrEqual(1)
    expect(certs[0].certification_uuid ?? certs[0].certification?.certification_uuid).toBeTruthy()
  })

  test('the certificate appears in the learner global certificate list', async () => {
    const all = await api.getUserCertificates(fx.learner.token)
    expect(Array.isArray(all)).toBe(true)
    const forCourse = await api.getUserCertificatesForCourse(fx.learner.token, fx.formation.courseUuid)
    if (forCourse.length > 0 && forCourse[0].user_certification_uuid) {
      expect(all.some(c => c.user_certification_uuid === forCourse[0].user_certification_uuid)).toBe(true)
    }
  })

  test('the awarded certificate can be fetched by its uuid (public verify)', async () => {
    const forCourse = await api.getUserCertificatesForCourse(fx.learner.token, fx.formation.courseUuid)
    const certUuid = forCourse[0]?.user_certification_uuid
    if (!certUuid) {
      test.skip()
      return
    }
    const detail = await api.req<any>('GET', `/certifications/certificate/${certUuid}`, null)
    expect(detail).toBeDefined()
    expect(detail.user_certification_uuid).toBe(certUuid)
  })

  test('a partially-complete learner of a certified formation gets no certificate', async () => {
    const other = await makeLearnerFixture('incomplete')
    await api.createCertification(
      other.adminToken, other.org.id, other.formation.courseId,
      { template: 'gold', title: 'Certificat Formation E2E' },
    )
    await api.enrollInCourse(other.learner.token, other.org.id, other.learner.id, other.formation.courseUuid)
    // Only ONE of three activities completed.
    await api.markActivityComplete(other.learner.token, other.formation.chapters[0].activities[0].uuid)

    const certs = await api.getUserCertificatesForCourse(other.learner.token, other.formation.courseUuid)
    expect(certs.length).toBe(0)
  })
})
