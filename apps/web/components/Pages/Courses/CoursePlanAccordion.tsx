'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpenCheck, Check, ChevronRight, FileText, Layers, Lock, Trophy, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getUriWithOrg } from '@services/config/config'

interface CoursePlanAccordionProps {
  course: any
  orgslug: string
  courseuuid: string
  currentActivityUuid: string | null
  isStarted?: boolean
  isActivityDone: (activity: any) => boolean
  guardLink: (activityPath: string) => string
}

function TypeIcon({ activityType }: { activityType: string }) {
  switch (activityType) {
    case 'TYPE_VIDEO':
      return <Video size={14} />
    case 'TYPE_ASSIGNMENT':
      return <BookOpenCheck size={14} />
    case 'TYPE_DYNAMIC':
      return <Layers size={14} />
    default:
      return <FileText size={14} />
  }
}

/**
 * Plan du cours en accordéon (wireframe v1/v2 · remplace la timeline verticale).
 * Chapitres repliables, rangées d'activités avec état (terminé / en cours / à venir),
 * pill d'action et ligne certificat en fin de parcours. Toutes les rangées restent
 * cliquables : rien n'est verrouillé côté apprenant.
 */
function CoursePlanAccordion({
  course,
  orgslug,
  courseuuid,
  currentActivityUuid,
  isStarted = false,
  isActivityDone,
  guardLink,
}: CoursePlanAccordionProps) {
  const { t } = useTranslation()
  const chapters = course?.chapters ?? []

  const [expandedChapters, setExpandedChapters] = useState<{ [key: string]: boolean }>(() => {
    const defaultExpanded: { [key: string]: boolean } = {}
    const currentChapter = currentActivityUuid
      ? chapters.find((ch: any) =>
          ch.activities?.some(
            (a: any) => a.activity_uuid?.replace('activity_', '') === currentActivityUuid
          )
        )
      : null
    chapters.forEach((chapter: any, idx: number) => {
      defaultExpanded[chapter.chapter_uuid] =
        chapter === currentChapter || (!currentChapter && idx === 0)
    })
    return defaultExpanded
  })

  const [hasUserToggled, setHasUserToggled] = useState(false)
  const toggleChapter = (chapterUuid: string) => {
    setHasUserToggled(true)
    setExpandedChapters((prev) => ({ ...prev, [chapterUuid]: !prev[chapterUuid] }))
  }

  // Le trail arrive APRÈS le premier rendu : ouvrir le chapitre de l'activité
  // courante dès qu'elle est connue. Tant que l'utilisateur n'a pas touché
  // l'accordéon, ce chapitre devient le seul ouvert (état initial deviné
  // = chapitre 1, corrigé dès que le trail révèle la vraie position).
  useEffect(() => {
    if (!currentActivityUuid) return
    const owningChapter = chapters.find((ch: any) =>
      ch.activities?.some(
        (a: any) => a.activity_uuid?.replace('activity_', '') === currentActivityUuid
      )
    )
    if (owningChapter) {
      setExpandedChapters((prev) => {
        if (prev[owningChapter.chapter_uuid] && hasUserToggled) return prev
        if (hasUserToggled) {
          return prev[owningChapter.chapter_uuid] ? prev : { ...prev, [owningChapter.chapter_uuid]: true }
        }
        return { [owningChapter.chapter_uuid]: true }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentActivityUuid])

  const getActivityTypeLabel = (activityType: string) => {
    switch (activityType) {
      case 'TYPE_VIDEO':
        return t('activities.video')
      case 'TYPE_DOCUMENT':
        return t('activities.document')
      case 'TYPE_DYNAMIC':
        return t('activities.page')
      case 'TYPE_ASSIGNMENT':
        return t('activities.quiz', 'Quiz')
      default:
        return t('activities.learning_material')
    }
  }

  const allActivities = chapters.flatMap((ch: any) => ch.activities ?? [])
  const totalActivities = allActivities.length
  const completedActivities = allActivities.filter((a: any) => isActivityDone(a)).length
  const allDone = totalActivities > 0 && completedActivities === totalActivities

  return (
    <section id="plan-du-cours" className="w-full scroll-mt-24" data-testid="course-plan-accordion">
      <h2
        className="py-5 text-xl md:text-2xl font-bold"
        style={{ fontFamily: 'var(--ordria-font-display)', color: 'var(--ordria-foreground)' }}
      >
        {t('courses.course_plan', 'Plan du cours')}
      </h2>

      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--ordria-surface)', border: '2px solid var(--ordria-border)' }}
      >
        {chapters.map((chapter: any, index: number) => {
          const chapterActivities = chapter.activities ?? []
          const chapterDone = chapterActivities.filter((a: any) => isActivityDone(a)).length
          const isExpanded = !!expandedChapters[chapter.chapter_uuid]

          return (
            <div
              key={chapter.chapter_uuid || `ch-${index}`}
              style={{ borderTop: index === 0 ? 'none' : '2px solid var(--ordria-border)' }}
            >
              {/* En-tête de chapitre */}
              <button
                onClick={() => toggleChapter(chapter.chapter_uuid)}
                aria-expanded={isExpanded}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--ordria-surface)]"
              >
                <ChevronRight
                  size={16}
                  className="shrink-0 transition-transform"
                  style={{
                    color: 'var(--ordria-muted)',
                    transform: isExpanded ? 'rotate(90deg)' : 'none',
                  }}
                />
                <span
                  className="font-mono text-[11px] font-bold tracking-wider shrink-0"
                  style={{ color: 'var(--ordria-accent-secondary)' }}
                >
                  {t('courses.chapter', 'Chapitre')} {index + 1}
                </span>
                <span
                  className="font-bold text-sm truncate flex-1"
                  style={{ color: 'var(--ordria-foreground)' }}
                >
                  {chapter.name}
                </span>
                <span
                  className="font-mono text-[11px] shrink-0"
                  style={{ color: 'var(--ordria-muted)' }}
                >
                  {chapterDone}/{chapterActivities.length} {t('activities.activities', 'activités')}
                </span>
              </button>

              {/* Activités du chapitre */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--ordria-border)' }}>
                  {chapterActivities.map((activity: any, actIdx: number) => {
                    const done = isActivityDone(activity)
                    const isCurrent =
                      activity.activity_uuid?.replace('activity_', '') === currentActivityUuid
                    const cleanUuid = activity.activity_uuid?.replace('activity_', '')
                    const link = cleanUuid
                      ? guardLink(
                          getUriWithOrg(orgslug, `/course/${courseuuid}/activity/${cleanUuid}`)
                        )
                      : '#'

                    return (
                      <Link
                        key={activity.activity_uuid || `act-${actIdx}`}
                        href={link}
                        prefetch={false}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors"
                        style={{
                          borderTop: actIdx === 0 ? 'none' : '1px solid var(--ordria-border)',
                          background: isCurrent ? 'var(--ordria-accent-bg)' : 'transparent',
                          borderLeft: isCurrent
                            ? '3px solid var(--ordria-accent)'
                            : '3px solid transparent',
                        }}
                      >
                        {/* État */}
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                          style={
                            done
                              ? { background: 'var(--ordria-foreground)', color: '#fff' }
                              : isCurrent
                                ? {
                                    background: 'var(--ordria-accent)',
                                    color: '#fff',
                                  }
                                : {
                                    background: 'var(--ordria-surface)',
                                    color: 'var(--ordria-muted)',
                                    border: '1.5px solid var(--ordria-border)',
                                  }
                          }
                        >
                          {done ? (
                            <Check size={13} />
                          ) : isCurrent ? (
                            <span className="block w-2 h-2 rounded-full bg-white" />
                          ) : (
                            <TypeIcon activityType={activity.activity_type} />
                          )}
                        </span>

                        {/* Titre */}
                        <span
                          className="text-sm truncate flex-1 min-w-0"
                          style={{
                            color: done ? 'var(--ordria-muted)' : 'var(--ordria-foreground)',
                            textDecoration: done ? 'none' : 'none',
                          }}
                        >
                          {activity.name}
                        </span>

                        {/* Badge type */}
                        <span
                          className="hidden sm:inline-block text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-md shrink-0"
                          style={{
                            background: 'var(--ordria-surface)',
                            color: 'var(--ordria-muted)',
                            border: '1px solid var(--ordria-border)',
                          }}
                        >
                          {getActivityTypeLabel(activity.activity_type)}
                        </span>

                        {/* Pill d'action */}
                        <span
                          className="text-[11px] font-bold px-2.5 py-1 rounded-lg shrink-0"
                          style={
                            isCurrent
                              ? {
                                  background: 'var(--ordria-accent)',
                                  color: '#fff',
                                  boxShadow: '0 2px 0 var(--ordria-accent-secondary)',
                                }
                              : {
                                  background: 'var(--ordria-surface)',
                                  color: 'var(--ordria-foreground)',
                                  border: '1.5px solid var(--ordria-border)',
                                }
                          }
                        >
                          {done
                            ? t('courses.review_activity', 'Revoir')
                            : isCurrent
                              ? isStarted
                                ? t('courses.resume', 'Reprendre')
                                : t('courses.start_course', 'Commencer')
                              : t('courses.open_activity', 'Ouvrir')}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* Ligne certificat */}
        <div
          className="flex items-center gap-3 px-4 py-3.5"
          style={{ borderTop: '2px solid var(--ordria-border)' }}
        >
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
            style={
              allDone
                ? { background: 'var(--ordria-foreground)', color: '#fff' }
                : {
                    background: 'var(--ordria-surface)',
                    color: 'var(--ordria-muted)',
                    border: '1.5px solid var(--ordria-border)',
                  }
            }
          >
            {allDone ? <Trophy size={13} /> : <Lock size={12} />}
          </span>
          {allDone ? (
            <Link
              href={guardLink(getUriWithOrg(orgslug, `/course/${courseuuid}/activity/end`))}
              prefetch={false}
              className="text-sm font-bold flex-1"
              style={{ color: 'var(--ordria-foreground)' }}
            >
              {t('courses.certificate_unlocked', 'Certificat débloqué')}
            </Link>
          ) : (
            <span className="text-sm font-semibold flex-1" style={{ color: 'var(--ordria-muted)' }}>
              {t('courses.certificate_locked_progress', {
                completed: completedActivities,
                total: totalActivities,
                defaultValue: 'Certificat · se débloque à {{total}}/{{total}} activités',
              })}
            </span>
          )}
          <span className="font-mono text-[11px] shrink-0" style={{ color: 'var(--ordria-muted)' }}>
            {completedActivities}/{totalActivities}
          </span>
        </div>
      </div>
    </section>
  )
}

export default CoursePlanAccordion
