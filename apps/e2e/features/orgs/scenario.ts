/**
 * Scenario orchestration for the orgs (organization management) E2E tests.
 *
 * Prefers a DEDICATED scratch org so mutations (role changes, member
 * removals, signup mechanism toggles, config flips) never touch the shared
 * "default" org used by the other feature modules.
 *
 * On images where multi-org is locked behind Enterprise (the published
 * self-host image), the module degrades gracefully: everything runs against
 * the shared default org instead, using scratch members for mutations, and
 * the create/delete lifecycle tests skip. `multiOrgsAvailable()` tells specs
 * which mode they are in.
 */
import { ADMIN_EMAIL, ADMIN_PASSWORD, ORG_SLUG, makeStudent } from '../../core/instance'
import type { Org as CoreOrg } from '../../core/client'
import * as api from './api'

let _adminToken: string | null = null

export async function adminToken(): Promise<string> {
  if (_adminToken) return _adminToken
  _adminToken = await api.login(ADMIN_EMAIL, ADMIN_PASSWORD)
  return _adminToken
}

export interface OrgsScenario {
  adminToken: string
  defaultOrg: CoreOrg
  /** Scratch org when multi-org is allowed; otherwise the default org. */
  org: CoreOrg
  /** True when a dedicated scratch org was created (multi-org allowed). */
  multiOrg: boolean
  roles: api.Role[]
  authorMember: api.SeededUser
  plainMember: api.SeededUser
}

let _scenario: OrgsScenario | null = null

export async function setupScenario(): Promise<OrgsScenario> {
  if (_scenario) return _scenario

  const token = await adminToken()
  const defaultOrg = await api.getOrg()

  let scratch: api.Org | null = null
  try {
    const suffix = Date.now().toString(36)
    scratch = await api.createOrg(token, {
      name: `E2E Orgs ${suffix}`,
      description: 'Scratch org for organization-management E2E',
      about: 'Scratch org for organization-management E2E',
    })
  } catch (e) {
    console.log(`  multi-org unavailable on this image (${(e as Error).message.slice(0, 80)}…) — falling back to the default org`)
  }

  const org: CoreOrg = scratch ?? defaultOrg
  const roles = await api.listOrgRoles(token, org.id)

  // Members created in the target org (scratch users either way).
  const authorMember = await api.createUserAndGetToken(token, org.id, makeStudent('orgauthor'))
  const plainMember = await api.createUserAndGetToken(token, org.id, makeStudent('orgmember'))

  _scenario = {
    adminToken: token,
    defaultOrg,
    org,
    multiOrg: scratch !== null,
    roles,
    authorMember,
    plainMember,
  }
  return _scenario
}

/** True when the instance allows creating extra orgs (multi-org). */
export async function multiOrgsAvailable(): Promise<boolean> {
  try {
    return (await setupScenario()).multiOrg
  } catch {
    return false
  }
}

export { ORG_SLUG }
