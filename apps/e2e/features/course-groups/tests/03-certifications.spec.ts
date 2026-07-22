/**
 * E2E: Valid certifications.
 *
 * Validates:
 * - A certification template can be created on a course
 * - The certification is retrievable via the course UUID
 * - A student who has NOT completed the course has no certificate
 * - After marking all activities complete, a certificate is awarded
 * - The awarded certificate is retrievable via the user's certificate list
 */
import { test, expect } from '../../../core/fixtures'
import { setupScenario, type Scenario } from '../scenario'
import * as api from '../api'

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario()
})

test.describe('Certifications', () => {

  test('certification template exists on coiffeur course', async () => {
    const certs = await api.getCourseCertifications(s.adminToken, s.coiffeurCourse.courseUuid)
    expect(certs.length).toBeGreaterThanOrEqual(1)
    expect(certs[0].course_id).toBe(s.coiffeurCourse.courseId)
  })

  test('certification has correct config', async () => {
    const certs = await api.getCourseCertifications(s.adminToken, s.coiffeurCourse.courseUuid)
    const cert = certs.find((c: any) => c.certification_uuid === s.coiffeurCertification.certification_uuid)
    expect(cert).toBeDefined()
    expect(cert!.config).toBeDefined()
    expect(cert!.config.template).toBe('gold')
  })

  test('student has no certificate before completing course', async () => {
    const userCerts = await api.getUserCertificateForCourse(
      s.coiffeurStudent.token,
      s.coiffeurCourse.courseUuid,
    )
    expect(userCerts.length).toBe(0)
  })

  test('student receives certificate after completing all activities', async () => {
    // Mark each activity as complete
    for (const activity of s.coiffeurCourse.activities) {
      await api.markActivityComplete(s.coiffeurStudent.token, activity.uuid)
    }

    // Wait a moment for the backend to process completion + create certificate
    await new Promise(r => setTimeout(r, 2000))

    const userCerts = await api.getUserCertificateForCourse(
      s.coiffeurStudent.token,
      s.coiffeurCourse.courseUuid,
    )
    expect(userCerts.length).toBeGreaterThanOrEqual(1)
    expect(userCerts[0].user_certification_uuid).toBeDefined()
  })

  test('awarded certificate appears in user full certificate list', async () => {
    const allCerts = await api.getUserCertificates(s.coiffeurStudent.token)
    expect(allCerts.length).toBeGreaterThanOrEqual(1)

    const courseCert = allCerts.find(
      (c: any) => c.certification?.course_id === s.coiffeurCourse.courseId,
    )
    expect(courseCert).toBeDefined()
  })

  test('garagiste course has NO certification (only coiffeur does)', async () => {
    const certs = await api.getCourseCertifications(s.adminToken, s.garagisteCourse.courseUuid)
    expect(certs.length).toBe(0)
  })

  test('certificate can be fetched by its UUID', async () => {
    const userCerts = await api.getUserCertificateForCourse(
      s.coiffeurStudent.token,
      s.coiffeurCourse.courseUuid,
    )
    expect(userCerts.length).toBeGreaterThanOrEqual(1)

    const certUuid = userCerts[0].user_certification_uuid
    const certDetail = await api.req<any>(
      'GET',
      `/certifications/certificate/${certUuid}`,
      null,
    )
    expect(certDetail).toBeDefined()
    expect(certDetail.user_certification_uuid).toBe(certUuid)
  })
})
