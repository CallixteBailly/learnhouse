'use client'
import React, { useEffect, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useCommandPalette } from './CommandPaletteContext'

interface Props {
  isCollapsed?: boolean
}

export default function CommandPaletteTrigger({ isCollapsed = false }: Props) {
  const { t } = useTranslation()
  const { setOpen } = useCommandPalette()
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMac(/Mac|iPhone|iPad/.test(navigator.platform))
    }
  }, [])

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('dashboard.search.trigger')}
        className="flex h-10 w-full items-center justify-center rounded-xl text-[#afafaf] transition-colors hover:bg-[#f7f7f7] hover:text-[#3c3c3c] border-2 border-transparent"
      >
        <MagnifyingGlass size={16} weight="bold" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={t('dashboard.search.trigger')}
      className="group flex h-10 w-full items-center gap-2.5 rounded-xl bg-[#f7f7f7] px-3 text-left transition-colors hover:bg-[#efefef] border-2 border-[#e5e5e5]"
    >
      <MagnifyingGlass size={14} weight="bold" className="shrink-0 text-[#afafaf] group-hover:text-[#3c3c3c]" />
      <span className="flex-1 text-[12.5px] font-semibold text-[#afafaf] group-hover:text-[#3c3c3c]">
        {t('dashboard.search.trigger')}
      </span>
      <kbd className="hidden sm:inline-flex shrink-0 h-[18px] items-center rounded-md bg-white px-1.5 font-sans text-[10.5px] font-bold leading-none tracking-wide text-[#777] border border-[#e5e5e5]">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  )
}
