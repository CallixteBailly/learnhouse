import React from 'react'
import Logo from '@components/Objects/Brand/Logo'
import { useOrg } from '../Contexts/OrgContext'
import { useTranslation } from 'react-i18next'
import { usePlan } from '@components/Hooks/usePlan'
import { getDeploymentMode } from '@services/config/config'

function Watermark() {
    const { t } = useTranslation()
    const org = useOrg() as any

    const mode = getDeploymentMode()
    const plan = usePlan()
    const watermarkConfig = org?.config?.config?.customization?.general?.watermark ?? org?.config?.config?.general?.watermark

    // Visibility rules, in priority order:
    //   1. EE         → always hidden (white-label is part of the EE license).
    //   2. SaaS free  → always shown (free tier is branded).
    //   3. Otherwise  → respect the admin's toggle (default on).
    if (mode === 'ee') return null
    const showWatermark = plan === 'free' || watermarkConfig !== false
    if (!showWatermark) return null

    return (
        <div className='fixed bottom-4 right-4 sm:bottom-8 sm:right-8 z-50'>
            <Logo
                variant="lockup"
                size="sm"
                href="https://ordria.fr"
                ariaLabel="Ordria Learning"
                className="flex items-center cursor-pointer bg-white/80 backdrop-blur-lg text-gray-700 rounded-xl sm:rounded-2xl p-1.5 sm:p-2 light-shadow text-[10px] sm:text-xs px-3 sm:px-5 font-semibold space-x-1.5 sm:space-x-2"
            />
        </div>
    )
}

export default Watermark
