/**
 * Scenario orchestration for course-groups E2E tests.
 *
 * One-call setup that:
 *  - creates two metier-based usergroups (Coiffeurs, Garagistes)
 *  - creates two courses with all activity types (one per metier)
 *  - assigns courses to their respective usergroups
 *  - creates two students (one per metier) + a third with NO group
 *  - assigns students to their usergroups
 *  - creates a certification on one course
 *  - creates an invite code linked to a usergroup
 *
 * Admin token is cached module-level (workers:1 means no race).
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

export interface Scenario {
  adminToken: string
  org: { id: number; slug: string }

  // User groups by metier
  coiffeurGroup: api.UserGroup
  garagisteGroup: api.UserGroup

  // Courses (each has all 4 activity types: video, document, dynamic, assignment)
  coiffeurCourse: api.SeededCourse
  garagisteCourse: api.SeededCourse

  // Students
  coiffeurStudent: api.SeededUser
  garagisteStudent: api.SeededUser
  noGroupStudent: api.SeededUser

  // Certification on the coiffeur course
  coiffeurCertification: { id: number; certification_uuid: string }

  // Invite code linked to garagiste group
  garagisteInvite: api.InviteCode
}

let _scenario: Scenario | null = null

export async function setupScenario(): Promise<Scenario> {
  if (_scenario) return _scenario

  const token = await adminToken()
  const org = await getOrg()

  // ── Create user groups ──
  const coiffeurGroup = await api.createUserGroup(token, org.id, 'Coiffeurs E2E', 'Groupe test coiffeurs')
  const garagisteGroup = await api.createUserGroup(token, org.id, 'Garagistes E2E', 'Groupe test garagistes')

  // ── Create courses with all activity types ──
  const coiffeurCourse = await api.seedCourse(token, org.id, 'E2E Formation Coiffeurs', 'Coiffure')
  const garagisteCourse = await api.seedCourse(token, org.id, 'E2E Formation Garagistes', 'Garage')

  // ── Assign courses to their groups ──
  await api.addCourseToGroup(token, coiffeurGroup.id, [coiffeurCourse.courseUuid])
  await api.addCourseToGroup(token, garagisteGroup.id, [garagisteCourse.courseUuid])

  // ── Create students (one per group + one without group) ──
  const coiffeurIdentity = makeStudent('coiffeur')
  const garagisteIdentity = makeStudent('garagiste')
  const noGroupIdentity = makeStudent('nogroup')

  const coiffeurStudent = await api.createUserAndGetToken(token, org.id, coiffeurIdentity)
  const garagisteStudent = await api.createUserAndGetToken(token, org.id, garagisteIdentity)
  const noGroupStudent = await api.createUserAndGetToken(token, org.id, noGroupIdentity)

  // ── Assign students to their groups ──
  await api.addUserToGroup(token, coiffeurGroup.id, [coiffeurStudent.id])
  await api.addUserToGroup(token, garagisteGroup.id, [garagisteStudent.id])

  // ── Create certification on coiffeur course ──
  const coiffeurCertification = await api.createCertification(token, org.id, coiffeurCourse.courseId, {
    template: 'gold',
    title: 'Certificat Coiffeur E2E',
  })

  // ── Create invite code for garagiste group ──
  const garagisteInvite = await api.createInviteCode(token, org.id, garagisteGroup.id)

  _scenario = {
    adminToken: token,
    org,
    coiffeurGroup,
    garagisteGroup,
    coiffeurCourse,
    garagisteCourse,
    coiffeurStudent,
    garagisteStudent,
    noGroupStudent,
    coiffeurCertification,
    garagisteInvite,
  }

  return _scenario
}
