'use client'
import React, { useMemo } from 'react'
import Link from 'next/link'
import { Buildings, CaretDown, Check } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { isMultiOrgModeEnabled } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'

/**
 * Org switcher badge for the top navigation.
 *
 * Central-LMS deployments host every org on the SAME hostname (org context
 * carried by the LH_org cookie), so nothing in the UI tells the user which
 * organization they are currently browsing · they can feel "stuck" in an org
 * without knowing how to leave. This badge shows the current org name next to
 * the logo and lists the user's other organizations, switching through the
 * /enter/{slug} bridge which re-pins the cookie.
 *
 * Rendered only in multi-org mode AND when the user belongs to more than one
 * organization (single-org members see nothing · no noise).
 */
export const OrgSwitcherBadge = () => {
  const session = useLHSession() as any
  const org = useOrg() as any
  const { t } = useTranslation()

  const myOrgs = useMemo(() => {
    const roles = session?.data?.roles || []
    const seen = new Set<number>()
    const orgs: any[] = []
    for (const r of roles) {
      const o = r?.org
      if (o && o.id != null && !seen.has(o.id)) { seen.add(o.id); orgs.push(o) }
    }
    return orgs
  }, [session?.data?.roles])

  if (!isMultiOrgModeEnabled() || myOrgs.length < 2) {
    return null
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-white/90 text-xs font-semibold hover:bg-white/10 transition-colors focus:outline-none"
          aria-label={t('common.switch_organization', { defaultValue: 'Changer d\'organisation' })}
          title={t('common.switch_organization', { defaultValue: 'Changer d\'organisation' })}
        >
          <Buildings size={14} weight="fill" className="opacity-80 shrink-0" />
          <span className="max-w-[110px] truncate">{org?.name || ''}</span>
          <CaretDown size={11} weight="bold" className="opacity-70 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Buildings size={16} weight="fill" />
          <span>{t('common.organizations', { defaultValue: 'Organisations' })}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {myOrgs.map((o: any) => {
          const isCurrent = o.id === org?.id
          // Direct org-scoped URL · the org stays visible in the address bar
          // (the middleware pins LH_org from the path).
          const href = isCurrent ? undefined : `/orgs/${o.slug}/`
          const inner = (
            <>
              {o.logo_image ? (
                <img
                  src={getOrgLogoMediaDirectory(o.org_uuid, o.logo_image)}
                  alt=""
                  className="w-5 h-5 rounded object-cover shrink-0 ring-1 ring-inset ring-black/5"
                />
              ) : (
                <span className="w-5 h-5 rounded bg-gray-100 text-gray-600 text-[10px] font-bold flex items-center justify-center shrink-0">
                  {(o.name || '?').charAt(0).toUpperCase()}
                </span>
              )}
              <span className="truncate flex-1">{o.name}</span>
              {isCurrent && <Check size={14} weight="bold" className="text-green-600 shrink-0" />}
            </>
          )
          return isCurrent ? (
            <DropdownMenuItem key={o.id} className="flex items-center gap-2" disabled>
              {inner}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={o.id} asChild>
              <Link href={href as string} className="flex items-center gap-2 cursor-pointer">
                {inner}
              </Link>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default OrgSwitcherBadge
