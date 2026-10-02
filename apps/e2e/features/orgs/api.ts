/**
 * E2E API helpers for the orgs (organization management) feature module.
 *
 * Covers: org CRUD, member listing/search/pagination, role management,
 * member removal / leaving, signup mechanism, invite codes + email invites,
 * feature & branding configuration, usage, and user CSV export.
 *
 * Builds on the generic `req` / `login` / `createStudent` from core/client.
 */
import { req, login, getOrg, createStudent, apiGet } from '../../core/client'
import type { Org as CoreOrg } from '../../core/client'
import { API_URL } from '../../core/instance'

export { login, getOrg, createStudent, req, apiGet }
export type { CoreOrg }

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Org {
  id: number
  slug: string
  name: string
  org_uuid: string
  description?: string | null
  email?: string | null
  config?: Record<string, any> | null
}

export interface OrgMember {
  user: { id: number; email: string; username: string; first_name?: string; last_name?: string }
  role: { id: number; name: string; role_uuid: string }
  usergroups: { id: number; name: string }[]
  joined_at?: string
}

export interface OrgUsersPage {
  items: OrgMember[]
  total: number
  page: number
  limit: number
}

export interface Role {
  id: number
  name: string
  role_uuid: string
  description?: string
  org_id?: number
}

export interface InviteCode {
  invite_code: string
  invite_code_uuid: string
  invite_code_expires: number
  invite_code_type: string
  usergroup_id?: number
}

export interface InvitedUser {
  email: string
}

export interface SeededUser {
  email: string
  username: string
  password: string
  id: number
  token: string
}

// ─── Org CRUD ───────────────────────────────────────────────────────────────

export async function createOrg(
  token: string,
  fields: { name: string; description?: string; about?: string; slug?: string; email?: string },
): Promise<Org> {
  // The published image's OrganizationCreate requires slug + email; derive a
  // unique slug from the name when the caller doesn't pick one.
  const slug =
    fields.slug ??
    `e2e-org-${fields.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)}-${Date.now().toString(36)}`
  return req<Org>('POST', '/orgs/', token, {
    ...fields,
    slug,
    email: fields.email ?? 'orgs-e2e@e2e-tests.com',
  })
}

export function getOrgBySlug(slug: string): Promise<Org> {
  return req<Org>('GET', `/orgs/slug/${slug}`, null)
}

export function getOrgByUuid(token: string, orgUuid: string): Promise<Org> {
  return req<Org>('GET', `/orgs/uuid/${orgUuid}`, token)
}

export function updateOrg(
  token: string,
  orgId: number,
  patch: Record<string, unknown>,
): Promise<Org> {
  return req<Org>('PUT', `/orgs/${orgId}`, token, patch)
}

export async function deleteOrg(token: string, orgId: number): Promise<void> {
  await req('DELETE', `/orgs/${orgId}`, token)
}

/** Fetch an org by slug, returning null when it 404s (deleted / never existed). */
export async function tryGetOrgBySlug(slug: string): Promise<Org | null> {
  try {
    return await getOrgBySlug(slug)
  } catch {
    return null
  }
}

// ─── Members listing / search / export ──────────────────────────────────────

export async function listOrgUsers(
  token: string,
  orgId: number,
  params: { page?: number; limit?: number; search?: string; role_id?: number } = {},
): Promise<OrgUsersPage> {
  const qs = new URLSearchParams()
  if (params.page) qs.set('page', String(params.page))
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.search) qs.set('search', params.search)
  if (params.role_id) qs.set('role_id', String(params.role_id))
  const q = qs.toString()
  return req<OrgUsersPage>('GET', `/orgs/${orgId}/users${q ? `?${q}` : ''}`, token)
}

/** Raw CSV export read-back (bypasses the JSON helper on purpose). */
export async function exportOrgUsersCsv(token: string, orgId: number): Promise<string> {
  const res = await fetch(`${API_URL}/orgs/${orgId}/users/export`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`export CSV -> ${res.status}: ${await res.text()}`)
  return res.text()
}

export function updateMemberRole(
  token: string,
  orgId: number,
  userId: number,
  roleUuid: string,
): Promise<unknown> {
  return req('PUT', `/orgs/${orgId}/users/${userId}/role/${roleUuid}`, token)
}

export async function removeMember(token: string, orgId: number, userId: number): Promise<void> {
  await req('DELETE', `/orgs/${orgId}/users/${userId}`, token)
}

export async function leaveOrg(token: string, orgId: number): Promise<void> {
  await req('DELETE', `/orgs/${orgId}/leave`, token)
}

// ─── Signup mechanism ───────────────────────────────────────────────────────

export async function setSignupMechanism(
  token: string,
  orgId: number,
  mechanism: 'open' | 'inviteOnly',
): Promise<unknown> {
  return req(
    'PUT',
    `/orgs/${orgId}/signup_mechanism?signup_mechanism=${mechanism}`,
    token,
  )
}

// ─── Roles ──────────────────────────────────────────────────────────────────

export function listOrgRoles(token: string, orgId: number): Promise<Role[]> {
  return req<Role[]>('GET', `/roles/org/${orgId}`, token)
}

export function createOrgRole(
  token: string,
  orgId: number,
  name: string,
  description = 'E2E role',
): Promise<Role> {
  return req<Role>('POST', `/roles/org/${orgId}`, token, { name, description })
}

export async function deleteOrgRole(token: string, roleId: number): Promise<void> {
  await req('DELETE', `/roles/${roleId}`, token)
}

// ─── Invite codes ───────────────────────────────────────────────────────────

export function createInviteCode(
  token: string,
  orgId: number,
  usergroupId?: number,
): Promise<InviteCode> {
  const query = usergroupId ? `?usergroup_id=${usergroupId}` : ''
  return req<InviteCode>('POST', `/orgs/${orgId}/invites${query}`, token)
}

export function listInviteCodes(token: string, orgId: number): Promise<InviteCode[]> {
  return req<InviteCode[]>('GET', `/orgs/${orgId}/invites`, token)
}

export function getInviteByCode(token: string, orgId: number, code: string): Promise<InviteCode> {
  return req<InviteCode>('GET', `/orgs/${orgId}/invites/code/${code}`, token)
}

export async function deleteInviteCode(token: string, orgId: number, inviteUuid: string): Promise<void> {
  await req('DELETE', `/orgs/${orgId}/invites/${inviteUuid}`, token)
}

/** The org keeps a small pool of invite codes (max ~6): clear leftovers so a
 * long-running suite never exhausts them mid-run. */
export async function clearInviteCodes(token: string, orgId: number): Promise<void> {
  try {
    for (const inv of await listInviteCodes(token, orgId)) {
      await deleteInviteCode(token, orgId, inv.invite_code_uuid).catch(() => {})
    }
  } catch {
    /* ignore */
  }
}

export async function joinOrg(
  token: string,
  orgId: number,
  userId: number | string,
  inviteCode?: string,
): Promise<void> {
  await req('POST', '/orgs/join', token, {
    org_id: orgId,
    user_id: userId,
    invite_code: inviteCode,
  })
}

// ─── Email invites (pre-invited users list) ────────────────────────────────

export async function inviteUsersBatch(
  token: string,
  orgId: number,
  emails: string[],
): Promise<void> {
  await req(
    'POST',
    `/orgs/${orgId}/invites/users/batch?emails=${encodeURIComponent(emails.join(','))}`,
    token,
  )
}

export function listInvitedUsers(token: string, orgId: number): Promise<InvitedUser[]> {
  return req<InvitedUser[]>('GET', `/orgs/${orgId}/invites/users`, token)
}

export async function removeInvitedUser(token: string, orgId: number, email: string): Promise<void> {
  await req('DELETE', `/orgs/${orgId}/invites/users/${encodeURIComponent(email)}`, token)
}

// ─── Feature & branding configuration ───────────────────────────────────────

export type FeatureConfigKey =
  | 'ai'
  | 'communities'
  | 'payments'
  | 'courses'
  | 'folders'
  | 'folders-sort'
  | 'podcasts'
  | 'boards'
  | 'playgrounds'

/** PUT /orgs/{id}/config/{key}?{flag}=value — returns {"detail": "..."} on 200. */
export async function putFeatureConfig(
  token: string,
  orgId: number,
  key: FeatureConfigKey,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(flags)) qs.set(k, String(v))
  await req('PUT', `/orgs/${orgId}/config/${key}?${qs.toString()}`, token)
}

export type BrandingConfigKey =
  | 'color'
  | 'font'
  | 'footer_text'
  | 'default_language'
  | 'watermark'
  | 'menu'

export async function putBrandingConfig(
  token: string,
  orgId: number,
  key: BrandingConfigKey,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(flags)) qs.set(k, String(v))
  await req('PUT', `/orgs/${orgId}/config/${key}?${qs.toString()}`, token)
}

// ─── Usage ──────────────────────────────────────────────────────────────────

export function getOrgUsage(token: string, orgId: number): Promise<Record<string, any>> {
  return req('GET', `/orgs/${orgId}/usage`, token)
}

// ─── Identity helper ────────────────────────────────────────────────────────

export async function createUserAndGetToken(
  adminToken: string,
  orgId: number,
  identity: { email: string; username: string; password: string; first_name?: string; last_name?: string },
): Promise<SeededUser> {
  const userId = await createStudent(adminToken, orgId, identity)
  const token = await login(identity.email, identity.password)
  return { ...identity, id: userId, token }
}
