'use client'

import { useEffect } from 'react'
import { useOrg } from './OrgContext'
import i18n, { changeLanguage } from '@/lib/i18n'

const USER_PICKED_KEY = 'i18nextLng_userPicked'

export default function OrgLanguageSync() {
  // DÉSACTIVÉ — OrdIA Learning : Français forcé, ignorer la config org.
  // Pour réactiver : supprimer ce bloc et décommenter ci-dessous.
  useEffect(() => {
    if (i18n.language.split('-')[0] !== 'fr') {
      i18n.changeLanguage('fr')
    }
  }, [])
  return null

  /* eslint-disable */
  /*
  const org = useOrg() as any

  const orgDefault: string | undefined =
    org?.config?.config?.customization?.general?.default_language ||
    org?.config?.config?.general?.default_language

  useEffect(() => {
    if (!orgDefault) return

    let userPicked: string | null = null
    try {
      userPicked = localStorage.getItem(USER_PICKED_KEY)
    } catch {}
    if (userPicked) return

    if (i18n.language.split('-')[0] !== orgDefault) {
      changeLanguage(orgDefault)
    }
  }, [orgDefault])

  return null
  */
}
