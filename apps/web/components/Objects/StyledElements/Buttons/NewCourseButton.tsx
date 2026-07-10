'use client'
import { useTranslation } from 'react-i18next'

interface NewCourseButtonProps {
  disabled?: boolean
}

function NewCourseButton({ disabled = false }: NewCourseButtonProps) {
  const { t } = useTranslation()
  return (
    <div
      className={`rounded-xl bg-[var(--ordria-accent)] transition-all duration-100 ease-linear antialiased px-5 py-2.5 my-auto text-xs font-extrabold uppercase tracking-wide text-white flex space-x-2 items-center ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-105'
      }`}
      style={{ boxShadow: '0 4px 0 var(--ordria-accent-secondary)' }}
    >
      <div>{t('courses.new_course')} </div>
      <div className="text-md bg-[var(--ordria-accent-secondary)] px-1.5 rounded-full">+</div>
    </div>
  )
}

export default NewCourseButton
