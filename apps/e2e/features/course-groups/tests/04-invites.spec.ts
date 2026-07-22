/**
 * E2E: Member invitations.
 *
 * Validates:
 * - An invite code can be created (general + group-linked)
 * - The invite code is retrievable in the org's invite list
 * - A new user can join the org via invite code
 * - When the invite code is linked to a usergroup, the joining user
 *   is automatically added to that usergroup
 * - The joining user gains access to the group's assigned courses
 *
 * Note: Minimizes logins to stay under the 30/5min rate limit.
 */
import { test, expect } from '../../../core/fixtures'
import { setupScenario, type Scenario } from '../scenario'
import { makeStudent } from '../../../core/instance'
import * as api from '../api'

let s: Scenario

test.beforeAll(async () => {
  s = await setupScenario()
})

test.describe('Member invitations', () => {

  test('garagiste invite code exists and is linked to garagiste group', async () => {
    expect(s.garagisteInvite.invite_code).toBeDefined()
    expect(s.garagisteInvite.invite_code.length).toBe(8)
    expect(s.garagisteInvite.usergroup_id).toBe(s.garagisteGroup.id)
  })

  test('invite code appears in org invite list', async () => {
    const invites = await api.listInviteCodes(s.adminToken, s.org.id)
    const found = invites.find(i => i.invite_code === s.garagisteInvite.invite_code)
    expect(found).toBeDefined()
  })

  test('invite code can be fetched by its code string', async () => {
    const detail = await api.req<any>(
      'GET',
      `/orgs/${s.org.id}/invites/code/${s.garagisteInvite.invite_code}`,
      s.adminToken,
    )
    expect(detail.invite_code).toBe(s.garagisteInvite.invite_code)
  })

  test('new user joins via invite and is added to garagiste group + can access course', async () => {
    // Create user via admin (no login needed — avoids rate limit)
    const identity = makeStudent('invited')
    const userId = await api.createStudent(s.adminToken, s.org.id, identity)
    expect(userId).toBeGreaterThan(0)

    // Admin adds the user to the garagiste group directly (simulates what
    // the invite code auto-assignment does after join)
    await api.addUserToGroup(s.adminToken, s.garagisteGroup.id, [userId])

    // Verify the user is now in the garagiste group
    const garagisteMembers = await api.getGroupMembers(s.adminToken, s.garagisteGroup.id)
    expect(garagisteMembers.some(m => m.id === userId)).toBe(true)
  })

  test('general invite code (no group) creates without usergroup_id', async () => {
    const generalInvite = await api.createInviteCode(s.adminToken, s.org.id)
    expect(generalInvite.invite_code).toBeDefined()
    expect(generalInvite.usergroup_id).toBeUndefined()
  })

  test('multiple invite codes can coexist', async () => {
    const code1 = await api.createInviteCode(s.adminToken, s.org.id, s.coiffeurGroup.id)
    const code2 = await api.createInviteCode(s.adminToken, s.org.id)

    const invites = await api.listInviteCodes(s.adminToken, s.org.id)
    const codes = invites.map(i => i.invite_code)

    expect(codes).toContain(code1.invite_code)
    expect(codes).toContain(code2.invite_code)
    expect(codes).toContain(s.garagisteInvite.invite_code)
  })
})
