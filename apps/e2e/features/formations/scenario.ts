/**
 * Scenario orchestration for the formations (learner journey) E2E tests.
 *
 * One-call setup that seeds, in the shared default org:
 *  - a published formation (course + chapter + 3 published dynamic activities)
 *  - a dedicated learner with a clean trail
 *
 * Every spec that mutates progression or completion creates its OWN learner
 * so state never leaks between specs. Admin token is cached module-level.
 */
import { ADMIN_EMAIL, ADMIN_PASSWORD, makeStudent } from '../../core/instance'
import { login, getOrg } from './api'
import * as api from './api'

let _adminToken: string | null = null

export async function adminToken(): Promise<string> {
  if (_adminToken) return _adminToken
  _adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  return _adminToken
}

export interface FormationsScenario {
  adminToken: string
  org: { id: number; slug: string }
  formation: api.SeededCourse
  learner: api.SeededUser
}

let _scenario: FormationsScenario | null = null

export async function setupScenario(): Promise<FormationsScenario> {
  if (_scenario) return _scenario

  const token = await adminToken()
  const org = await getOrg()
  const formation = await api.seedFormation(token, org.id, `E2E Formation ${Date.now().toString(36)}`)
  const learner = await api.createUserAndGetToken(token, org.id, makeStudent('learner'))

  _scenario = { adminToken: token, org, formation, learner }
  return _scenario
}

/** Fresh learner + fresh formation for mutating specs (progression etc.). */
export interface LearnerFixture {
  adminToken: string
  org: { id: number; slug: string }
  formation: api.SeededCourse
  learner: api.SeededUser
}

export async function makeLearnerFixture(label: string): Promise<LearnerFixture> {
  const token = await adminToken()
  const org = await getOrg()
  const formation = await api.seedFormation(token, org.id, `E2E ${label} ${Date.now().toString(36)}`)
  const learner = await api.createUserAndGetToken(token, org.id, makeStudent(label))
  return { adminToken: token, org, formation, learner }
}
