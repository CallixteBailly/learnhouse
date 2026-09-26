'use client'
import Link from 'next/link'
import { ArrowRight, PlayCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getUriWithOrg } from '@services/config/config'

interface CourseHeroProgressProps {
  orgslug: string
  courseuuid: string
  isStarted: boolean
  completedActivities: number
  totalActivities: number
  progressPercent: number
  currentActivity: { activity_uuid: string; name: string } | null
  guardLink: (activityPath: string) => string
}

/**
 * Carte de progression du héros de la page cours (wireframe v2 · écrans M1/D1).
 * État non commencé : « Prêt à commencer » + CTA Commencer.
 * État commencé : anneau %, X/Y activités, chip activité en cours + CTA Reprendre.
 * Les CTA sont de simples liens : add_activity_to_trail crée le run manquant
 * (apps/api src/services/trail/trail.py), l'inscription explicite reste dans CoursesActions.
 */
function CourseHeroProgress({
  orgslug,
  courseuuid,
  isStarted,
  completedActivities,
  totalActivities,
  progressPercent,
  currentActivity,
  guardLink,
}: CourseHeroProgressProps) {
  const { t } = useTranslation()

  const targetUuid = currentActivity?.activity_uuid?.replace('activity_', '')
  const targetHref = targetUuid
    ? guardLink(getUriWithOrg(orgslug, `/course/${courseuuid}/activity/${targetUuid}`))
    : '#'

  const ringRadius = 28
  const ringCircumference = 2 * Math.PI * ringRadius

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--ordria-surface)', border: '2px solid var(--ordria-border)' }}
      data-testid="course-hero-progress"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {/* Anneau de progression */}
        <div className="relative w-[72px] h-[72px] shrink-0">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r={ringRadius} fill="none" stroke="var(--ordria-border)" strokeWidth="6" />
            {progressPercent > 0 && (
              <circle
                cx="32"
                cy="32"
                r={ringRadius}
                fill="none"
                stroke="var(--ordria-accent)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringCircumference * (1 - progressPercent / 100)}
                className="transition-all duration-500"
              />
            )}
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-mono font-black text-sm" style={{ color: 'var(--ordria-foreground)' }}>
              {progressPercent}%
            </span>
          </div>
        </div>

        {/* Infos progression */}
        <div className="flex-1 min-w-[180px]">
          <p className="text-sm font-bold" style={{ color: 'var(--ordria-foreground)' }}>
            {isStarted
              ? t('courses.hero_completed_of', {
                  completed: completedActivities,
                  total: totalActivities,
                  defaultValue: '{{completed}}/{{total}} activités terminées',
                })
              : t('courses.hero_ready_to_begin', {
                  count: totalActivities,
                  defaultValue: 'Prêt à commencer · {{count}} activités',
                })}
          </p>
          {isStarted && currentActivity && (
            <span
              className="inline-block mt-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold tracking-wide"
              style={{ background: 'var(--ordria-accent-bg)', color: 'var(--ordria-accent-secondary)' }}
            >
              {t('courses.hero_current_activity', 'Activité en cours')} · {currentActivity.name}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Link
            href={targetHref}
            prefetch={false}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all active:translate-y-[2px] truncate"
            style={{
              background: 'var(--ordria-accent)',
              color: '#fff',
              boxShadow: '0 4px 0 var(--ordria-accent-secondary)',
            }}
            title={currentActivity ? `${isStarted ? t('courses.resume', 'Reprendre') : t('courses.start_course')} · ${currentActivity.name}` : undefined}
            data-testid="course-hero-cta"
          >
            {isStarted ? <PlayCircle size={16} /> : <ArrowRight size={16} />}
            <span className="truncate">
              {isStarted
                ? `${t('courses.resume', 'Reprendre')} · ${currentActivity?.name ?? ''}`
                : t('courses.start_course')}
            </span>
          </Link>
          <a
            href="#plan-du-cours"
            className="flex-1 sm:flex-none inline-flex items-center justify-center px-5 py-3 rounded-xl text-sm font-semibold transition-all active:translate-y-[2px]"
            style={{
              background: 'var(--ordria-surface)',
              color: 'var(--ordria-foreground)',
              border: '2px solid var(--ordria-foreground)',
              boxShadow: '0 4px 0 var(--ordria-foreground)',
            }}
          >
            {t('courses.view_plan', 'Revoir le plan')}
          </a>
        </div>
      </div>
    </div>
  )
}

export default CourseHeroProgress
