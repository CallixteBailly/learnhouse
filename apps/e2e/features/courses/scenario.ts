/**
 * Scenario orchestration for the courses-management E2E tests.
 *
 * One-call setup that seeds, in the shared default org:
 *  - a published course with one chapter and one activity of each major type
 *    (video, document, dynamic) used by structure/discovery specs
 *
 * Each mutation spec creates its OWN throwaway course so ordering/publish/
 * delete changes never leak into shared fixtures. Admin token is cached
 * module-level (workers: 1 means no race).
 */
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../../core/instance'
import { login, getOrg } from './api'
import * as api from './api'

let _adminToken: string | null = null

export async function adminToken(): Promise<string> {
  if (_adminToken) return _adminToken
  _adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  return _adminToken
}

export interface CoursesScenario {
  adminToken: string
  org: { id: number; slug: string }
  course: api.SeededCourse
}

let _scenario: CoursesScenario | null = null

export async function setupScenario(): Promise<CoursesScenario> {
  if (_scenario) return _scenario

  const token = await adminToken()
  const org = await getOrg()
  const course = await api.seedCourse(token, org.id, `E2E Courses ${Date.now().toString(36)}`)

  _scenario = { adminToken: token, org, course }
  return _scenario
}
