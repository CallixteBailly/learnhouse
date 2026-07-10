import React from 'react'
import { BookCopy, SquareLibrary, Signpost, Headphones } from 'lucide-react'
import { ChalkboardSimple, Cube } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

interface TypeOfContentTitleProps {
  title: string
  type: 'col' | 'cou' | 'tra' | 'pod' | 'board' | 'pg' | string
}

function TypeOfContentTitle({ title, type }: TypeOfContentTitleProps) {
  const { t } = useTranslation()

  const getIcon = () => {
    switch (type) {
      case 'col':
        return <SquareLibrary className="w-4 h-4 text-[var(--ordria-accent)]" />
      case 'cou':
        return <BookCopy className="w-4 h-4 text-[var(--ordria-accent)]" />
      case 'tra':
        return <Signpost className="w-4 h-4 text-[var(--ordria-accent)]" />
      case 'pod':
        return <Headphones className="w-4 h-4 text-[#ce82ff]" />
      case 'board':
        return <ChalkboardSimple size={16} className="text-[#ce82ff]" weight="fill" />
      case 'pg':
        return <Cube size={16} className="text-[#ff9600]" weight="fill" />
      default:
        return null
    }
  }

  return (
    <div className="flex items-center gap-2.5 my-4 group cursor-default">
      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#f7f7f7] border-2 border-[#e5e5e5]">
        {getIcon()}
      </div>
      <h1 className="text-2xl font-black text-[#3c3c3c] tracking-tight" style={{ fontFamily: 'var(--font-display, Nunito)' }}>
        {title}
      </h1>
    </div>
  )
}

export default TypeOfContentTitle
