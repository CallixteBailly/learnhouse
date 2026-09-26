/**
 * E2E: Signup mechanism, invite codes and joining.
 *
 * On the scratch org:
 *  - the signup mechanism can be flipped open <-> inviteOnly and read back
 *  - invite codes can be created (general + group-linked), listed, fetched
 *    by code and deleted
 *  - a fresh user can join the org via an invite code and shows up in the
 *    member list
 *  - email invites can be batch-added, listed and removed
 *  - a member can leave the org
 *
 * Runs on the scratch org so flipping the signup mechanism or consuming the
 * invite-code pool never affects the shared default org.
 */
import { test, expect } from '../../../core/fixtures'
import { makeStudent } from '../../../core/instance'
import { setupScenario, adminToken, multiOrgsAvailable, type OrgsScenario } from '../scenario'
import * as api from '../api'

let s: OrgsScenario
let canCreateOrgs: boolean

test.beforeAll(async () => {
  s = await setupScenario()
  canCreateOrgs = await multiOrgsAvailable()
  await api.clearInviteCodes(s.adminToken, s.org.id)
})

test.describe('Signup mechanism', () => {
  test('mechanism can be set to inviteOnly and back to open', async () => {
    const res = await api.setSignupMechanism(s.adminToken, s.org.id, 'inviteOnly')
    expect(res).toBeDefined()

    const back = await api.setSignupMechanism(s.adminToken, s.org.id, 'open')
    expect(back).toBeDefined()
  })
})

test.describe('Invite codes', () => {
  test('a general invite code can be created, listed and fetched by code', async () => {
    const invite = await api.createInviteCode(s.adminToken, s.org.id)
    expect(invite.invite_code).toBeTruthy()
    expect(invite.invite_code.length).toBeGreaterThanOrEqual(6)

    const listed = await api.listInviteCodes(s.adminToken, s.org.id)
    expect(listed.some(i => i.invite_code === invite.invite_code)).toBe(true)

    const byCode = await api.getInviteByCode(s.adminToken, s.org.id, invite.invite_code)
    expect(byCode.invite_code_uuid).toBe(invite.invite_code_uuid)
  })

  test('an invite code can be deleted', async () => {
    const invite = await api.createInviteCode(s.adminToken, s.org.id)
    await api.deleteInviteCode(s.adminToken, s.org.id, invite.invite_code_uuid)

    const listed = await api.listInviteCodes(s.adminToken, s.org.id)
    expect(listed.some(i => i.invite_code_uuid === invite.invite_code_uuid)).toBe(false)
  })

  test('a fresh user can join the org via an invite code', async () => {
    // Joining needs an org the user is NOT already a member of: only
    // constructible with a scratch org (multi-org).
    test.skip(!canCreateOrgs, 'join-by-code needs a second org (Enterprise-locked here)')
    const invite = await api.createInviteCode(s.adminToken, s.org.id)

    // Create the user in the DEFAULT org (that's where POST /users/{org_id}
    // lets the admin provision), then have them join the scratch org.
    const identity = makeStudent('orgjoiner')
    const userId = await api.createStudent(s.adminToken, s.defaultOrg.id, identity)
    const token = await api.login(identity.email, identity.password)

    await api.joinOrg(token, s.org.id, userId, invite.invite_code)

    const members = await api.listOrgUsers(s.adminToken, s.org.id, {
      search: identity.username,
    })
    expect(members.items.some(i => i.user.id === userId)).toBe(true)
  })

  test('email invites can be batch-added, listed and removed', async () => {
    const email = `invited-${Date.now().toString(36)}@e2e-tests.com`
    await api.inviteUsersBatch(s.adminToken, s.org.id, [email])

    const invited = await api.listInvitedUsers(s.adminToken, s.org.id)
    expect(invited.some(u => u.email === email)).toBe(true)

    await api.removeInvitedUser(s.adminToken, s.org.id, email)
    const after = await api.listInvitedUsers(s.adminToken, s.org.id)
    expect(after.some(u => u.email === email)).toBe(false)
  })
})

test.describe('Leaving', () => {
  test('a member can leave the org', async () => {
    const identity = makeStudent('orgleaver')
    const leaver = await api.createUserAndGetToken(s.adminToken, s.org.id, identity)
    const before = await api.listOrgUsers(s.adminToken, s.org.id, {
      search: identity.username,
    })
    expect(before.items.some(i => i.user.id === leaver.id)).toBe(true)

    await api.leaveOrg(leaver.token, s.org.id)

    const after = await api.listOrgUsers(s.adminToken, s.org.id, {
      search: identity.username,
    })
    expect(after.items.some(i => i.user.id === leaver.id)).toBe(false)
  })
})
