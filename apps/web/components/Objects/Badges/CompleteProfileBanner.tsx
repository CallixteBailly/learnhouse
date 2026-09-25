// apps/web/components/Objects/Badges/CompleteProfileBanner.tsx
'use client'
import React from 'react'
import Link from 'next/link'
import { Briefcase, X } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'

const DISMISS_KEY = 'lh_profile_job_dismissed'

export function CompleteProfileBanner({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  // useLHSession() returns { data: Session | null, ... } | null — the session
  // user (UserRead) carries `profile`, so no extra getUser fetch is needed.
  const session = useLHSession() as any
  const [dismissed, setDismissed] = React.useState(true)

  React.useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
  }, [])

  // Show only for logged-in users whose profile has no job yet (OAuth-era
  // accounts and pre-Phase-1 accounts). Never blocking.
  const user = session?.data?.user
  const hasJob = !!user?.profile?.job
  if (!user || hasJob || dismissed) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 bg-[var(--ordria-accent)]/10 border-b border-[var(--ordria-accent)]/30 backdrop-blur-sm"
      style={{ zIndex: 'var(--z-nav-menu)' }}
    >
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3">
        <Briefcase size={16} className="text-[var(--ordria-accent)] shrink-0" />
        <p className="grow text-sm text-[var(--ordria-foreground)]">
          {t('signup.complete_profile_banner', {
            defaultValue: 'Complétez votre profil : indiquez votre métier pour des recommandations sur mesure.',
          })}
        </p>
        <Link
          href={`/${orgslug}/account/general`}
          onClick={() => sessionStorage.setItem(DISMISS_KEY, '1')}
          className="text-xs font-bold text-[var(--ordria-accent)] hover:underline shrink-0"
        >
          {t('signup.complete_profile_cta', { defaultValue: 'Compléter' })}
        </Link>
        <button
          onClick={() => {
            sessionStorage.setItem(DISMISS_KEY, '1')
            setDismissed(true)
          }}
          aria-label={t('common.close', { defaultValue: 'Fermer' })}
          className="text-[var(--ordria-muted)] hover:text-[var(--ordria-foreground)] shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

export default CompleteProfileBanner
