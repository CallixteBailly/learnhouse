/**
 * E2E: Organization members, roles and user export.
 *
 * On the scratch org (never the shared default org):
 *  - members are listed with pagination metadata
 *  - search narrows the member list by username/email
 *  - the org exposes its default roles
 *  - a member's role can be changed and read back
 *  - a custom role can be created and deleted
 *  - a member can be removed from the org and disappears from the list
 *  - the member list can be exported as CSV containing the member emails
 */
import { test, expect } from '../../../core/fixtures'
import { makeStudent } from '../../../core/instance'
import { setupScenario, type OrgsScenario } from '../scenario'
import * as api from '../api'

let s: OrgsScenario

test.beforeAll(async () => {
  s = await setupScenario()
})

test.describe('Organization members & roles', () => {
  test('members are listed with pagination metadata', async () => {
    const page = await api.listOrgUsers(s.adminToken, s.org.id, { limit: 100 })
    expect(page.total).toBeGreaterThanOrEqual(3) // admin owner + author + plain member
    const ids = page.items.map(i => i.user.id)
    expect(ids).toContain(s.authorMember.id)
    expect(ids).toContain(s.plainMember.id)
    expect(page.page).toBe(1)
    expect(page.limit).toBe(100)
  })

  test('search narrows the member list', async () => {
    const page = await api.listOrgUsers(s.adminToken, s.org.id, {
      search: s.plainMember.username,
    })
    expect(page.items.length).toBe(1)
    expect(page.items[0].user.id).toBe(s.plainMember.id)
  })

  test('search on email finds the member too', async () => {
    const page = await api.listOrgUsers(s.adminToken, s.org.id, {
      search: s.authorMember.email,
    })
    expect(page.items.some(i => i.user.id === s.authorMember.id)).toBe(true)
  })

  test('org exposes default roles', async () => {
    expect(s.roles.length).toBeGreaterThanOrEqual(2)
    const names = s.roles.map(r => r.name.toLowerCase())
    // Every LearnHouse install has at least an admin-ish and a member-ish role.
    expect(
      names.some(n => n.includes('admin') || n.includes('owner') || n.includes('maintainer')),
    ).toBe(true)
  })

  test('a member has a role attached in the listing', async () => {
    const page = await api.listOrgUsers(s.adminToken, s.org.id, {
      search: s.plainMember.username,
    })
    const member = page.items[0]
    expect(member.role).toBeDefined()
    expect(member.role.role_uuid).toBeTruthy()
  })

  test("a member's role can be changed and read back", async () => {
    const current = (await api.listOrgUsers(s.adminToken, s.org.id, {
      search: s.plainMember.username,
    })).items[0].role.name

    const target = s.roles.find(r => r.name.toLowerCase() !== current.toLowerCase())
    expect(target).toBeDefined()

    await api.updateMemberRole(s.adminToken, s.org.id, s.plainMember.id, target!.role_uuid)

    const after = (await api.listOrgUsers(s.adminToken, s.org.id, {
      search: s.plainMember.username,
    })).items[0]
    expect(after.role.role_uuid).toBe(target!.role_uuid)
  })

  test('a custom role can be created and deleted', async () => {
    const role = await api.createOrgRole(s.adminToken, s.org.id, `E2E Role ${Date.now().toString(36)}`)
    expect(role.id).toBeGreaterThan(0)
    expect(role.role_uuid).toBeTruthy()

    const rolesAfterCreate = await api.listOrgRoles(s.adminToken, s.org.id)
    expect(rolesAfterCreate.some(r => r.id === role.id)).toBe(true)

    await api.deleteOrgRole(s.adminToken, role.id)
    const rolesAfterDelete = await api.listOrgRoles(s.adminToken, s.org.id)
    expect(rolesAfterDelete.some(r => r.id === role.id)).toBe(false)
  })

  test('a member can be removed from the org', async () => {
    // Fresh member so other specs keep theirs.
    const token = s.adminToken
    const identity = makeStudent('orgsremoval')
    const userId = await api.createStudent(token, s.org.id, identity)
    const before = await api.listOrgUsers(token, s.org.id, { search: identity.username })
    expect(before.items.some(i => i.user.id === userId)).toBe(true)

    await api.removeMember(token, s.org.id, userId)

    const after = await api.listOrgUsers(token, s.org.id, { search: identity.username })
    expect(after.items.some(i => i.user.id === userId)).toBe(false)
  })

  test('members can be exported as CSV', async () => {
    const csv = await api.exportOrgUsersCsv(s.adminToken, s.org.id)
    expect(csv).toContain(s.authorMember.email)
    expect(csv).toContain(s.plainMember.email)
  })
})
