'use client'

import React from 'react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import TypeOfContentTitle from '@components/Objects/StyledElements/Titles/TypeOfContentTitle'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import NewCourseButton from '@components/Objects/StyledElements/Buttons/NewCourseButton'
import ContentPlaceHolderIfUserIsNotAdmin from '@components/Objects/ContentPlaceHolder'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { useTranslation } from 'react-i18next'
import { BookCopy, Play, ChevronRight } from 'lucide-react'
import { useTrail } from '@/hooks/queries/useTrail'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { useOrg } from '@components/Contexts/OrgContext'

interface LandingClassicProps {
  courses: any[]
  orgslug: string
  org_id: string | number
}

function LandingClassic({ courses, orgslug, org_id }: LandingClassicProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { data: trailData } = useTrail(org?.id)

  const displayedCourses = courses.slice(0, 12)
  const hasMoreCourses = courses.length > 12

  const inProgressRuns = (trailData?.runs || []).filter((run: any) => {
    const totalSteps = run.steps?.length || 0
    const completedSteps = run.steps?.filter((s: any) => s.complete)?.length || 0
    return completedSteps > 0 && completedSteps < totalSteps
  })

  const getNextActivityLink = (run: any) => {
    if (!run.steps || !run.course) return '#'
    const nextStep = run.steps.find((s: any) => !s.complete)
    if (nextStep) {
      const cleanCourseUuid = run.course.course_uuid?.replace('course_', '')
      const cleanActivityUuid = nextStep.activity_uuid?.replace('activity_', '')
      return getUriWithOrg(orgslug, `/course/${cleanCourseUuid}/activity/${cleanActivityUuid}`)
    }
    const cleanCourseUuid = run.course.course_uuid?.replace('course_', '')
    return getUriWithOrg(orgslug, `/course/${cleanCourseUuid}`)
  }

  const getProgressPercent = (run: any) => {
    const total = run.steps?.length || 1
    const completed = run.steps?.filter((s: any) => s.complete)?.length || 0
    return Math.round((completed / total) * 100)
  }

  return (
    <div className="w-full">
      <GeneralWrapperStyled>
        <div className="flex flex-col space-y-2">
          {inProgressRuns.length > 0 && (
            <div className="mb-4">
              <h2 className="text-lg font-bold text-[var(--ordria-foreground)] mb-3" style={{ fontFamily: 'var(--ordria-font-display)' }}>
                {t('courses.continue_learning', 'Continuer l\'apprentissage')}
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
                {inProgressRuns.slice(0, 5).map((run: any) => {
                  const progress = getProgressPercent(run)
                  const link = getNextActivityLink(run)
                  return (
                    <Link
                      key={run.course.course_uuid}
                      href={link}
                      className="flex-shrink-0 w-[280px] snap-start bg-white rounded-2xl border-2 border-[var(--ordria-border)] overflow-hidden duo-card-hover group"
                    >
                      <div className="relative h-[100px] bg-cover bg-center" style={{
                        backgroundImage: `url(${run.course.thumbnail_image
                          ? getCourseThumbnailMediaDirectory(org?.org_uuid, run.course.course_uuid, run.course.thumbnail_image)
                          : '/empty_thumbnail.png'})`
                      }}>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        <div className="absolute bottom-2 left-3 right-3">
                          <p className="text-white font-bold text-sm truncate">{run.course.name}</p>
                        </div>
                        <div className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Play size={14} className="text-[var(--ordria-foreground)] ml-0.5" fill="currentColor" />
                        </div>
                      </div>
                      <div className="p-3">
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="text-xs font-semibold text-[var(--ordria-muted)]">{progress}%</span>
                          <ChevronRight size={14} className="text-[var(--ordria-muted)] group-hover:text-[var(--ordria-accent)] transition-colors" />
                        </div>
                        <div className="duo-progress-bar" style={{ height: '5px' }}>
                          <div className="duo-progress-fill" style={{ width: `${progress}%` }}></div>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <TypeOfContentTitle title={t('courses.courses')} type="cou" />
            <AuthenticatedClientElement
              ressourceType="courses"
              action="create"
              checkMethod="roles"
              orgId={org_id}
            >
              <Link href={getUriWithOrg(orgslug, '/courses?new=true')}>
                <NewCourseButton />
              </Link>
            </AuthenticatedClientElement>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {displayedCourses.map((course: any) => (
              <div key={course.course_uuid} className="flex">
                <CourseThumbnail course={course} orgslug={orgslug} />
              </div>
            ))}
            {courses.length === 0 && (
              <div className="col-span-full flex flex-col justify-center items-center py-12 px-4 border-2 border-dashed border-gray-100 rounded-2xl bg-gray-50/30">
                <div className="p-4 bg-white rounded-full nice-shadow mb-4">
                  <BookCopy className="w-8 h-8 text-gray-300" strokeWidth={1.5} />
                </div>
                <h1 className="text-xl font-bold text-gray-600 mb-2">
                  {t('courses.no_courses')}
                </h1>
                <p className="text-md text-gray-400 mb-6 text-center max-w-xs">
                  <ContentPlaceHolderIfUserIsNotAdmin text={t('courses.create_courses_placeholder')} />
                </p>
              </div>
            )}
          </div>
          {hasMoreCourses && (
            <div className="mt-4 text-center">
              <Link
                href={getUriWithOrg(orgslug, '/courses')}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                {t('courses.view_all_courses')} ({courses.length})
              </Link>
            </div>
          )}
        </div>
      </GeneralWrapperStyled>
    </div>
  )
}

export default LandingClassic
