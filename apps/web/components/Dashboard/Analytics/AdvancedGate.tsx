'use client'
import React from 'react'
import { Lock } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

export function AdvancedGate({
  isAdvanced,
  currentPlan: _currentPlan,
  children,
}: {
  isAdvanced: boolean
  /** Conservé pour compatibilité des appelants — ignoré (pas de paliers de plan). */
  currentPlan?: string
  children: React.ReactNode
}) {
  void _currentPlan
  const { t } = useTranslation()

  // Ordria : pas de paliers de plan — l'état verrouillé affiche un simple
  // indicateur "non disponible", sans badge ni lien d'upgrade.
  return (
    <div className="relative min-h-[300px] min-w-0 overflow-hidden">
      {isAdvanced ? (
        children
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 rounded-xl border border-gray-100">
          <Lock className="text-gray-300 mb-3" size={28} weight="bold" />
          <p className="text-sm font-semibold text-gray-600">
            {t('analytics.advanced_gate.unavailable', {
              defaultValue: 'Cette vue n\'est pas disponible',
            })}
          </p>
        </div>
      )}
    </div>
  )
}
