'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { canManageOrgFromSession } from '@components/Hooks/useAdminStatus'
import { useLHAnalytics } from '@services/analytics/useLHAnalytics'
import { AnalyticsEvent } from '@services/analytics/events'
import UserAvatar from '@components/Objects/UserAvatar'
import { getAPIUrl, getUriWithOrg, getLEARNHOUSE_PLATFORM_URL_VAL } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { signOut } from '@components/Contexts/AuthContext'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { deleteOrganizationFromBackend, leaveOrg } from '@services/organizations/orgs'
import { ChevronRight, Languages, Check, LogOut, Settings, TentTree, LogIn, Plus, MoreVertical, CreditCard, Trash2, AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import React, { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from '@/lib/i18n'
import { CopyrightFooter } from '@components/Footers/LegalFooters'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@components/ui/dialog'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'

function HomeClient() {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()
  const access_token = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const isLoading = session?.status === 'loading'
  const platformUrl = getLEARNHOUSE_PLATFORM_URL_VAL()

  const { data: orgs, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs', 'user'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/user/page/1/limit/50`, access_token),
    enabled: isAuthenticated,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isLoading, isAuthenticated, router])

  // A brand-new (org-less) user has no orgs yet — send them straight to create
  // their first org rather than a confusing empty hub. Mirrors the platform's
  // post-signup onboarding hop.
  useEffect(() => {
    if (isAuthenticated && Array.isArray(orgs) && orgs.length === 0) {
      router.replace('/new')
    }
  }, [isAuthenticated, orgs, router])

  return (
    <div className="fixed inset-0 z-[100] bg-[#fff] overflow-y-auto">
      <div className="relative min-h-screen">
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            backgroundImage: `
              radial-gradient(circle at 20% 20%, rgba(88,204,2,0.06) 0%, transparent 40%),
              radial-gradient(circle at 80% 60%, rgba(28,176,246,0.06) 0%, transparent 40%),
              radial-gradient(circle at 50% 90%, rgba(206,130,255,0.05) 0%, transparent 40%),
            `,
          }}
        />

        <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-12">
          <div className="w-full max-w-md flex flex-col items-center">
            <div className="flex flex-col items-center mb-10">
              { }
              <img
                src="/lrn.svg"
                alt="LearnHouse"
                width={56}
                height={56}
                className="opacity-90 duo-bounce"
              />
              <h1 className="mt-6 font-black tracking-tight text-3xl text-[#3c3c3c] text-center" style={{ fontFamily: 'var(--font-display, Nunito)' }}>
                {t('common.your_organizations')}
              </h1>
              <p className="mt-2 text-sm text-[#afafaf] text-center font-semibold">
                {t('common.choose_an_organization_to_continue', {
                  defaultValue: 'Choose an organization to continue',
                })}
              </p>
            </div>

            {isAuthenticated && (
              <div className="w-full mb-6 flex items-center justify-between bg-white rounded-2xl border-2 border-[#e5e5e5] px-4 py-3" style={{ boxShadow: '0 4px 0 #e5e5e5' }}>
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar border="border-2" rounded="rounded-full" width={36} />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-bold text-[#3c3c3c] truncate capitalize">
                      {session?.data?.user?.first_name} {session?.data?.user?.last_name}
                    </span>
                    <span className="text-xs text-[#afafaf] truncate font-semibold">
                      {session?.data?.user?.email}
                    </span>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={t('common.settings')}
                      className="p-2 rounded-lg text-[#afafaf] hover:text-[#3c3c3c] hover:bg-[#f7f7f7] transition-colors"
                    >
                      <Settings size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end">
                    <DropdownMenuLabel>
                      <div className="flex flex-col">
                        <p className="text-sm font-bold">
                          {session?.data?.user?.first_name} {session?.data?.user?.last_name}
                        </p>
                        <p className="text-xs text-[#afafaf] font-semibold">{session?.data?.user?.email}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="flex items-center space-x-2">
                        <Languages size={14} />
                        <span>{t('common.language')}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          {AVAILABLE_LANGUAGES.map((language) => (
                            <DropdownMenuItem
                              key={language.code}
                              onClick={() => changeLanguage(language.code)}
                              className="flex items-center justify-between"
                            >
                              <span>
                                {t(language.translationKey)} ({language.nativeName})
                              </span>
                              {i18n.language.split('-')[0] === language.code && <Check size={14} />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => signOut({ redirect: true, callbackUrl: '/login' })}
                      className="flex items-center space-x-2 text-[#ff4b4b] focus:text-[#ff4b4b]"
                    >
                      <LogOut size={16} />
                      <span>{t('user.sign_out')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            <div className="w-full space-y-3">
              {(isLoading || (isAuthenticated && orgsLoading)) && (
                <>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-[72px] w-full rounded-2xl bg-[#f7f7f7] animate-pulse"
                    />
                  ))}
                </>
              )}

              {!isLoading && !isAuthenticated && (
                <button
                  onClick={() => router.push('/login')}
                  className="w-full duo-btn-blue"
                >
                  <LogIn size={18} />
                  {t('auth.sign_in', { defaultValue: 'Sign in' })}
                </button>
              )}

              {isAuthenticated && orgs && orgs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-14 px-6 bg-white rounded-2xl border-2 border-dashed border-[#e5e5e5]">
                  <TentTree className="text-[#afafaf]" size={64} />
                  <p className="mt-4 text-sm font-bold text-[#777] text-center">
                    {t('common.no_orgs_message')}
                  </p>
                </div>
              )}

              {isAuthenticated &&
                orgs &&
                orgs.map((org: any) => (
                  <OrgRow key={org.id ?? org.slug} org={org} access_token={access_token} />
                ))}

              {isAuthenticated && orgs && (
                <button
                  onClick={() => router.push('/new')}
                  className="w-full duo-btn-success"
                >
                  <Plus size={18} />
                  {t('common.create_organization', { defaultValue: 'Create organization' })}
                </button>
              )}
            </div>

            {platformUrl ? (
              <a
                href={platformUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-10 flex items-center gap-1.5 text-[11px] text-[#afafaf] hover:text-[#3c3c3c] transition-colors font-semibold"
              >
                <span>{t('common.powered_by', { defaultValue: 'Powered by' })}</span>
                <span className="font-extrabold tracking-tight text-[#777]">LearnHouse</span>
              </a>
            ) : (
              <div className="mt-10 flex items-center gap-1.5 text-[11px] text-[#afafaf] font-semibold">
                <span>{t('common.powered_by', { defaultValue: 'Powered by' })}</span>
                <span className="font-extrabold tracking-tight text-[#777]">LearnHouse</span>
              </div>
            )}
            <CopyrightFooter year={new Date().getFullYear()} className="mt-4 pt-0" />
          </div>
        </div>
      </div>
    </div>
  )
}

function OrgRow({ org, access_token }: { org: any; access_token: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const orgSession = useLHSession() as any
  const { track } = useLHAnalytics('hub')
  // Only org managers (admins/superadmins) see the billing / Manage-Upgrade entry.
  const canManageOrg = canManageOrgFromSession(orgSession, org?.id)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const initial = (org.name || org.slug || '?').trim().charAt(0).toUpperCase()
  const canDelete = confirmText.trim() === org.slug

  const handleDelete = async () => {
    if (!canDelete || deleting) return
    setDeleting(true)
    setError(null)
    track(AnalyticsEvent.OrgDeleteInitiated, { slug: org.slug })
    try {
      await deleteOrganizationFromBackend(org.id, access_token)
      track(AnalyticsEvent.OrgDeleted, { slug: org.slug })
      await queryClient.invalidateQueries({ queryKey: ['orgs', 'user'] })
      setConfirmOpen(false)
      setConfirmText('')
    } catch {
      setError(
        t('common.delete_organization_error', {
          defaultValue: 'Could not delete this organization. Please try again.',
        })
      )
    } finally {
      setDeleting(false)
    }
  }

  const handleLeave = async () => {
    if (leaving) return
    setLeaving(true)
    setError(null)
    try {
      await leaveOrg(org.id, access_token)
      await queryClient.invalidateQueries({ queryKey: ['orgs', 'user'] })
      setLeaveOpen(false)
    } catch (e: any) {
      setError(
        e?.data?.detail ||
          t('common.leave_organization_error', {
            defaultValue: 'Could not leave this organization. Please try again.',
          })
      )
    } finally {
      setLeaving(false)
    }
  }

  return (
    <div className="relative flex items-center p-4 bg-white rounded-2xl border-2 border-[#e5e5e5] hover:border-[var(--ordria-accent)] transition-all group duo-card-hover" style={{ boxShadow: '0 4px 0 #e5e5e5' }}>
      <Link
        href={getUriWithOrg(org.slug, '/')}
        className="flex items-center flex-1 min-w-0"
      >
        {org.logo_image ? (

          <img
            src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)}
            alt={org.name}
            className="w-12 h-12 rounded-xl object-cover flex-shrink-0 border-2 border-[#f7f7f7]"
          />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#e5f9d8] to-[#ddf4ff] flex items-center justify-center text-[var(--ordria-accent)] font-black text-xl flex-shrink-0 border-2 border-[#e5e5e5]">
            {initial}
          </div>
        )}

        <div className="ml-3 flex-1 min-w-0">
          <div className="font-bold text-[#3c3c3c] tracking-tight truncate">
            {org.name}
          </div>
          {org.description ? (
            <p className="text-xs text-[#afafaf] truncate mt-0.5 font-semibold">{org.description}</p>
          ) : (
            <p className="text-xs text-[#afafaf] truncate mt-0.5 font-semibold">{org.slug}</p>
          )}
        </div>

        <ChevronRight
          size={20}
          className="ml-3 text-[#afafaf] group-hover:text-[var(--ordria-accent)] group-hover:translate-x-0.5 transition-all flex-shrink-0"
        />
      </Link>

      {/* Admin actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={t('common.org_actions', { defaultValue: 'Organization actions' })}
            className="ml-1.5 p-2 rounded-lg text-black/30 hover:text-black hover:bg-black/[0.04] transition-colors flex-shrink-0"
          >
            <MoreVertical size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52" align="end">
          {canManageOrg && (
            <DropdownMenuItem asChild>
              <Link href={`/billing?org=${org.slug}`} className="flex items-center space-x-2">
                <CreditCard size={14} />
                <span>{t('common.manage_upgrade', { defaultValue: 'Manage / Upgrade' })}</span>
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link
              href={getUriWithOrg(org.slug, '/dash/org/settings/general')}
              className="flex items-center space-x-2"
            >
              <Settings size={14} />
              <span>{t('common.settings', { defaultValue: 'Settings' })}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {canManageOrg ? (
            // Admins can delete the whole organization.
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setError(null)
                setConfirmText('')
                setConfirmOpen(true)
              }}
              className="flex items-center space-x-2 text-red-600 focus:text-red-600"
            >
              <Trash2 size={14} />
              <span>{t('common.delete', { defaultValue: 'Delete' })}</span>
            </DropdownMenuItem>
          ) : (
            // Non-admin members can only leave the org (quit their membership).
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setError(null)
                setLeaveOpen(true)
              }}
              className="flex items-center space-x-2 text-red-600 focus:text-red-600"
            >
              <LogOut size={14} />
              <span>{t('common.leave_organization', { defaultValue: 'Leave organization' })}</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Typed-confirmation delete dialog */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (deleting) return
          setConfirmOpen(open)
          if (!open) {
            setConfirmText('')
            setError(null)
          }
        }}
      >
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-red-50 text-red-600 flex-shrink-0">
                <AlertTriangle size={18} />
              </div>
              <DialogTitle>
                {t('common.delete_organization', { defaultValue: 'Delete organization' })}
              </DialogTitle>
            </div>
            <DialogDescription className="mt-3">
              {t('common.delete_organization_warning', {
                defaultValue:
                  'This permanently deletes {{name}} and all of its data. This action cannot be undone.',
                name: org.name,
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <label className="block text-xs font-medium text-black/50 mb-1.5">
              {t('common.delete_organization_confirm_label', {
                defaultValue: 'Type {{slug}} to confirm',
                slug: org.slug,
              })}
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={org.slug}
              autoComplete="off"
              className="w-full px-3 py-2 text-sm rounded-xl border border-black/10 bg-white focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400 transition-colors"
            />
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </div>

          <DialogFooter className="mt-5 gap-2">
            <button
              type="button"
              onClick={() => {
                if (deleting) return
                setConfirmOpen(false)
                setConfirmText('')
                setError(null)
              }}
              disabled={deleting}
              className="px-4 py-2 text-sm font-semibold rounded-xl text-gray-700 bg-black/[0.04] hover:bg-black/[0.07] transition-colors disabled:opacity-50"
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!canDelete || deleting}
              className="px-4 py-2 text-sm font-semibold rounded-xl text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleting
                ? t('common.deleting', { defaultValue: 'Deleting…' })
                : t('common.delete_organization', { defaultValue: 'Delete organization' })}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave-organization confirmation (non-admin members) */}
      <Dialog
        open={leaveOpen}
        onOpenChange={(open) => {
          if (leaving) return
          setLeaveOpen(open)
          if (!open) setError(null)
        }}
      >
        <DialogContent className="max-w-md p-6">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-red-50 text-red-600 flex-shrink-0">
                <LogOut size={16} />
              </div>
              <DialogTitle className="text-lg">
                {t('common.leave_organization_title', { defaultValue: 'Leave organization?' })}
              </DialogTitle>
            </div>
          </DialogHeader>
          <p className="text-sm text-black/60 mt-1">
            {t('common.leave_organization_desc', {
              defaultValue: 'You will lose access to {{org}} and be removed from its members. You can re-join later if invited.',
              org: org.name || org.slug,
            })}
          </p>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <DialogFooter className="mt-5 gap-2">
            <button
              onClick={() => setLeaveOpen(false)}
              disabled={leaving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-black/60 hover:bg-black/[0.04] transition-colors disabled:opacity-50"
            >
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              onClick={handleLeave}
              disabled={leaving}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {leaving
                ? t('common.leaving', { defaultValue: 'Leaving…' })
                : t('common.leave_organization', { defaultValue: 'Leave organization' })}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default HomeClient
