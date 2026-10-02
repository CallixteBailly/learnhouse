// apps/web/components/Objects/Badges/CompleteProfileBanner.tsx
'use client'
import React, { createContext, useContext } from 'react'
import Link from 'next/link'
import { Briefcase, X } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import { useJoinBannerVisible, JOIN_BANNER_HEIGHT } from '@components/Objects/Banners/OrgJoinBanner'

const DISMISS_KEY = 'lh_profile_job_dismissed'

// Fixed height so OrgMenu can offset the (also fixed) navbar by exactly this
// much when the banner is visible — the banner must never overlap and swallow
// clicks meant for the navigation underneath it.
export const PROFILE_BANNER_HEIGHT = 40

interface ProfileBannerState {
  isVisible: boolean
  dismiss: () => void
}

const ProfileBannerContext = createContext<ProfileBannerState>({
  isVisible: false,
  dismiss: () => {},
})

export function useProfileBannerVisible() {
  return useContext(ProfileBannerContext).isVisible
}

/**
 * Owns the banner's visibility (logged-in user with no profile.job, not
 * session-dismissed) so the navbar can offset itself in sync, including when
 * the user dismisses the banner.
 */
export function ProfileBannerProvider({ children }: { children: React.ReactNode }) {
  const session = useLHSession() as any
  const [dismissed, setDismissed] = React.useState(true)

  React.useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
  }, [])

  // Show only for logged-in users whose profile has no job yet (OAuth-era
  // accounts and pre-Phase-1 accounts). Never blocking.
  const user = session?.data?.user
  const isVisible = !!user && !user?.profile?.job && !dismissed

  const dismiss = React.useCallback(() => {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }, [])

  const value = React.useMemo(() => ({ isVisible, dismiss }), [isVisible, dismiss])

  return <ProfileBannerContext.Provider value={value}>{children}</ProfileBannerContext.Provider>
}

export function CompleteProfileBanner({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const { isVisible, dismiss } = useContext(ProfileBannerContext)
  const { isVisible: isJoinBannerVisible } = useJoinBannerVisible()

  if (!isVisible) return null

  return (
    <div
      // pointer-events-none on the bar itself: the banner is overlaid on the
      // top of the viewport and must never intercept clicks aimed at the
      // navbar below. Only the CTA link and the close button are interactive.
      className="pointer-events-none fixed left-0 right-0 bg-[var(--ordria-accent)]/10 border-b border-[var(--ordria-accent)]/30 backdrop-blur-sm"
      style={{
        zIndex: 'var(--z-nav-menu)',
        top: isJoinBannerVisible ? JOIN_BANNER_HEIGHT : 0,
        height: PROFILE_BANNER_HEIGHT,
      }}
    >
      <div className="max-w-5xl mx-auto px-4 h-full flex items-center gap-3">
        <Briefcase size={16} className="text-[var(--ordria-accent)] shrink-0" />
        <p className="grow text-sm text-[var(--ordria-foreground)]">
          {t('signup.complete_profile_banner', {
            defaultValue: 'Complétez votre profil : indiquez votre métier pour des recommandations sur mesure.',
          })}
        </p>
        <Link
          href={getUriWithOrg(orgslug, '/account/general')}
          onClick={() => sessionStorage.setItem(DISMISS_KEY, '1')}
          className="pointer-events-auto text-xs font-bold text-[var(--ordria-accent)] hover:underline shrink-0"
        >
          {t('signup.complete_profile_cta', { defaultValue: 'Compléter' })}
        </Link>
        <button
          onClick={dismiss}
          aria-label={t('common.close', { defaultValue: 'Fermer' })}
          className="pointer-events-auto text-[var(--ordria-muted)] hover:text-[var(--ordria-foreground)] shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

export default CompleteProfileBanner
