/**
 * E2E: Organization CRUD lifecycle.
 *
 * Multi-org mode (scratch org): create → read by slug/uuid → update → delete.
 * Enterprise-locked images: creation/deletion tests skip; metadata updates
 * run against the shared default org (description/about/email only, never
 * name/slug, so the other feature modules are unaffected).
 */
import { test, expect } from '../../../core/fixtures'
import { setupScenario, adminToken, multiOrgsAvailable, type OrgsScenario } from '../scenario'
import * as api from '../api'

let s: OrgsScenario
let canCreateOrgs: boolean

test.beforeAll(async () => {
  s = await setupScenario()
  canCreateOrgs = await multiOrgsAvailable()
})

test.describe('Organization CRUD', () => {
  test('an org can be created and fetched by slug', async () => {
    test.skip(!canCreateOrgs, 'multi-org creation is Enterprise-locked on this image')
    const token = await adminToken()
    const suffix = Date.now().toString(36)
    const created = await api.createOrg(token, {
      name: `E2E Crud Org ${suffix}`,
      description: 'Created by the orgs CRUD spec',
    })
    expect(created.id).toBeGreaterThan(0)
    expect(created.slug).toBeTruthy()

    const bySlug = await api.getOrgBySlug(created.slug)
    expect(bySlug.id).toBe(created.id)
    expect(bySlug.name).toBe(`E2E Crud Org ${suffix}`)

    // cleanup so repeated runs don't accumulate orgs
    await api.deleteOrg(token, created.id).catch(() => {})
  })

  test('an org can be fetched by uuid (authenticated)', async () => {
    test.skip(!canCreateOrgs, 'multi-org creation is Enterprise-locked on this image')
    const token = await adminToken()
    const suffix = Date.now().toString(36)
    const created = await api.createOrg(token, {
      name: `E2E Uuid Org ${suffix}`,
      description: 'uuid lookup spec',
    })
    const byUuid = await api.getOrgByUuid(token, created.org_uuid)
    expect(byUuid.id).toBe(created.id)
    await api.deleteOrg(token, created.id).catch(() => {})
  })

  test('org metadata (description/about/email) can be updated and read back', async () => {
    // Never touch name/slug: the shared default org must stay addressable.
    const updated = await api.updateOrg(s.adminToken, s.org.id, {
      description: `Updated description ${Date.now()}`,
      about: 'Updated about text',
      email: 'orgs-e2e@e2e-tests.com',
    })
    expect(updated.id).toBe(s.org.id)

    // Slug read-back (updates bust the org slug cache).
    const bySlug = await api.getOrgBySlug(s.org.slug)
    expect(bySlug.description).toContain('Updated description')
    expect(bySlug.email).toBe('orgs-e2e@e2e-tests.com')
  })

  test('the working org exists and is readable by slug', async () => {
    const bySlug = await api.getOrgBySlug(s.org.slug)
    expect(bySlug.id).toBe(s.org.id)
  })

  test('scratch org is separate from the default org (multi-org only)', async () => {
    test.skip(!canCreateOrgs, 'multi-org creation is Enterprise-locked on this image')
    expect(s.org.id).not.toBe(s.defaultOrg.id)
  })

  test('an org can be deleted and then 404s by slug', async () => {
    test.skip(!canCreateOrgs, 'multi-org creation is Enterprise-locked on this image')
    const token = await adminToken()
    const suffix = Date.now().toString(36)
    const created = await api.createOrg(token, {
      name: `E2E Doomed Org ${suffix}`,
      description: 'will be deleted',
    })
    await api.deleteOrg(token, created.id)
    const gone = await api.tryGetOrgBySlug(created.slug)
    expect(gone).toBeNull()
  })

  test('default org is readable by slug without authentication', async () => {
    const org = await api.getOrgBySlug(s.defaultOrg.slug)
    expect(org.id).toBe(s.defaultOrg.id)
  })
})
