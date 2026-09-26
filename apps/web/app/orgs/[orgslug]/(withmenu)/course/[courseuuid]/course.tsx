'use client'
import Link from 'next/link'
import { useEffect, useState, Suspense } from 'react'
import { getUriWithOrg } from '@services/config/config'
import { getCourseMetadata } from '@services/courses/courses'
import { useTrail } from '@/hooks/queries/useTrail'
import ActivityIndicators from '@components/Pages/Courses/ActivityIndicators'
import CourseHeroProgress from '@components/Pages/Courses/CourseHeroProgress'
import CoursePlanAccordion from '@components/Pages/Courses/CoursePlanAccordion'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import {
  getCourseThumbnailMediaDirectory,
  getUserAvatarMediaDirectory,
} from '@services/media/media'
import { ArrowRight, Check, Video, Image as ImageIcon, BookCopy, ChevronRight } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { CourseProvider } from '@components/Contexts/CourseContext'
import { useMediaQuery } from 'usehooks-ts'
import CoursesActions from '@components/Objects/Courses/CourseActions/CoursesActions'
import CourseActionsMobile from '@components/Objects/Courses/CourseActions/CourseActionsMobile'
import CourseAuthors from '@components/Objects/Courses/CourseAuthors/CourseAuthors'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTranslation } from 'react-i18next'
import CourseCommunitySection from '@components/Objects/Communities/CourseCommunitySection'
import CourseShare from '@components/Objects/Courses/CourseShare/CourseShare'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

const CourseClient = (props: any) => {
  const { t } = useTranslation()
  const [learnings, setLearnings] = useState<any>([])
  const [activeThumbnailType, setActiveThumbnailType] = useState<'image' | 'video'>('image')
  const courseuuid = props.courseuuid
  const orgslug = props.orgslug
  const initialCourse = props.course
  const serverError = props.serverError
  const org = useOrg() as any
  const isMobile = useMediaQuery('(max-width: 768px)')
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;

  const { data: clientCourseData, error: courseError, isLoading: courseLoading } = useQuery({
    queryKey: queryKeys.courses.meta(courseuuid),
    queryFn: () => getCourseMetadata(courseuuid, {}, access_token, { slim: true }),
    enabled: !!courseuuid && !serverError,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const course = initialCourse || clientCourseData;

  const { track } = useLHAnalytics('learner')

  // Track course view
  const courseId = course?.id
  const courseUuidForTracking = course?.course_uuid
  useEffect(() => {
    if (courseId && courseUuidForTracking) {
      track(AnalyticsEvent.CourseViewed, {
        course_uuid: courseUuidForTracking,
      })
    }
  }, [courseId, courseUuidForTracking, track])

  // Fetch trail data — shared cache with useTrail hook used elsewhere
  const { data: trailData } = useTrail(org?.id);

  useEffect(() => {
    if (!course) return
    getLearningTags(course)
  }, [course])

  // Show loading state if fetching course data client-side
  if (!initialCourse && !serverError && courseLoading) {
    return (
      <GeneralWrapperStyled>
        <div className="animate-pulse">
          {/* Hero: titre + colonnes 7/5 */}
          <div className="pb-2 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div className="h-9 bg-gray-200 rounded w-2/3" />
            <div className="h-8 bg-gray-200 rounded-lg w-24" />
          </div>
          <div className="flex flex-col md:flex-row gap-8 pt-2">
            <div className="w-full md:w-7/12 space-y-4">
              <div className="space-y-2">
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-5/6" />
                <div className="h-3 bg-gray-200 rounded w-4/6" />
              </div>
              <div className="h-3 bg-gray-200 rounded w-1/2" />
              <div className="bg-gray-200 rounded-lg h-28" />
            </div>
            <div className="w-full md:w-5/12 space-y-4">
              <div className="bg-gray-200 rounded-lg w-full h-[220px]" />
              <div className="bg-gray-200 rounded-lg h-40" />
            </div>
          </div>

          {/* Strip stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 my-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-gray-200 rounded-lg h-16" />
            ))}
          </div>

          {/* Plan du cours */}
          <div className="w-full my-5 mb-10">
            <div className="h-7 bg-gray-200 rounded w-40 mb-5" />
            <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
              {Array.from({ length: 3 }).map((_, chIdx) => (
                <div key={chIdx}>
                  <div className="flex items-center gap-3 py-4 px-4 bg-neutral-50 outline outline-1 outline-neutral-200/40">
                    <div className="h-5 w-5 bg-gray-200 rounded-full flex-shrink-0" />
                    <div className="h-5 bg-gray-200 rounded w-1/3" />
                  </div>
                  {chIdx === 0 && Array.from({ length: 3 }).map((_, aIdx) => (
                    <div key={aIdx} className="flex items-center gap-3 px-4 py-4 border-t border-neutral-100">
                      <div className="h-6 w-6 bg-gray-200 rounded-full flex-shrink-0" />
                      <div className="h-4 bg-gray-200 rounded w-1/2" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </GeneralWrapperStyled>
    )
  }

  // Determine the active error (server-side or client-side)
  const activeError = serverError || courseError

  // Show error if course fetch failed
  if (!course && activeError) {
    return (
      <GeneralWrapperStyled>
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
          <h2 className="text-xl font-semibold text-gray-700 mb-2">
            {t('course.accessDenied', 'Unable to access this course')}
          </h2>
          <p className="text-gray-500 mb-4">
            {activeError?.status === 403
              ? t('course.noPermission', 'You do not have permission to view this course.')
              : t('course.loadError', 'This course could not be found or there was an error loading it.')}
          </p>
          <Link href={getUriWithOrg(orgslug, '/courses')} className="text-blue-600 hover:underline">
            {t('course.backToCourses', 'Back to Courses')}
          </Link>
        </div>
      </GeneralWrapperStyled>
    )
  }

  function getLearningTags(courseData: any) {
    if (!courseData?.learnings) {
      setLearnings([])
      return
    }

    try {
      // Try to parse as JSON (new format)
      const parsedLearnings = JSON.parse(courseData.learnings)
      if (Array.isArray(parsedLearnings)) {
        // New format: array of learning items with text and emoji
        setLearnings(parsedLearnings)
        return
      }
    } catch (_e) {
      // Not valid JSON, continue to legacy format handling
    }

    // Legacy format: comma-separated string (changed from pipe-separated)
    const learningItems = courseData.learnings.split(',').map((text: string) => ({
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      text: text.trim(), // Trim whitespace that might be present after commas
      emoji: '📝' // Default emoji for legacy items
    }))

    setLearnings(learningItems)
  }

  const isActivityDone = (activity: any) => {
    if (!course?.course_uuid || !trailData?.runs || !Array.isArray(trailData.runs)) {
      return false
    }
    const cleanCourseUuid = course.course_uuid.replace('course_', '')
    const run = trailData.runs.find((run: any) => {
      const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '')
      return cleanRunCourseUuid === cleanCourseUuid
    })
    if (!run || !Array.isArray(run.steps)) return false
    const step = run.steps.find((step: any) => step.activity_id == activity.id)
    return step?.complete === true
  }

  // Generate JSON-LD structured data for SEO
  const generateJsonLd = () => {
    if (!course || !org) return null
    const seo = course.seo || {}

    // Check if JSON-LD is enabled (defaults to true if not set)
    if (seo.enable_jsonld === false) return null

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Course',
      name: seo.title || course.name,
      description: seo.description || course.description || '',
      provider: {
        '@type': 'Organization',
        name: org.name,
        ...(org.description && { description: org.description }),
      },
      ...(course.thumbnail_image && {
        image: getCourseThumbnailMediaDirectory(
          org?.org_uuid,
          course?.course_uuid,
          course?.thumbnail_image
        ),
      }),
      ...(course.creation_date && { dateCreated: course.creation_date }),
      ...(course.update_date && { dateModified: course.update_date }),
    }

    return jsonLd
  }

  const jsonLd = generateJsonLd()

  const isStarted = !!(trailData?.runs?.find(
    (run: any) => {
      const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '')
      return cleanRunCourseUuid === course?.course_uuid?.replace('course_', '')
    }
  ))

  /**
   * Garde-fou d'accès : si l'utilisateur n'est pas connecté, on renvoie vers /signup
   * au lieu de pointer directement vers l'activité (sinon on bypass l'inscription).
   * Appliqué aux liens du plan du cours et au certificat.
   */
  const guardLink = (activityPath: string) => {
    if (!session?.data?.user) return getUriWithOrg(orgslug, '/signup')
    return activityPath
  }

  // ---- Modèle d'état « formation commencée » (wireframe v2) ----
  const flatActivities = (course?.chapters ?? []).flatMap((ch: any) => ch.activities ?? [])
  const totalModules = course?.chapters?.length || 0
  const totalActivitiesCount = flatActivities.length
  const completedActivitiesCount = flatActivities.filter((a: any) => isActivityDone(a)).length
  const progressPercent = totalActivitiesCount > 0 ? Math.round((completedActivitiesCount / totalActivitiesCount) * 100) : 0
  const quizCount = flatActivities.filter((a: any) => a.activity_type === 'TYPE_ASSIGNMENT').length
  // Activité courante : première non terminée (fallback : la première du cours)
  const nextActivity = flatActivities.find((a: any) => !isActivityDone(a)) ?? flatActivities[0] ?? null
  const currentActivityUuid = props.current_activity
    ?? (nextActivity ? nextActivity.activity_uuid?.replace('activity_', '') : null)

  const courseTags: string[] = (course?.tags || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean)

  const courseDescription = course?.description || course?.about || ''
  const authorUsername = course?.authors?.[0]?.user?.username || 'admin'

  const displayLearnings = learnings.filter((l: any) => {
    const text = typeof l === 'string' ? l : l?.text
    return text && text.trim() !== '' && text !== 'null'
  })

  const statBlocks = [
    { value: String(totalModules), label: t('courses.modules', 'Modules') },
    { value: String(totalActivitiesCount), label: t('activities.activities', 'Activités') },
    { value: `${completedActivitiesCount}/${totalActivitiesCount}`, label: t('courses.completed_label', 'Terminées') },
    { value: String(quizCount), label: t('activities.quiz', 'Quiz') },
    { value: `@${authorUsername}`, label: t('courses.instructor', 'Formateur') },
  ]

  const heroProgress = () => (
    <CourseHeroProgress
      orgslug={orgslug}
      courseuuid={courseuuid}
      isStarted={isStarted}
      completedActivities={completedActivitiesCount}
      totalActivities={totalActivitiesCount}
      progressPercent={progressPercent}
      currentActivity={nextActivity ? { activity_uuid: nextActivity.activity_uuid, name: nextActivity.name } : null}
      guardLink={guardLink}
    />
  )

  const tagsRow = (scrollable: boolean) => (
    <div className={`flex gap-2 ${scrollable ? 'overflow-x-auto pb-1' : 'flex-wrap'}`}>
      {courseTags.map((tag) => (
        <span
          key={tag}
          className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full"
          style={{
            background: 'var(--ordria-surface)',
            color: 'var(--ordria-muted)',
            border: '1.5px solid var(--ordria-border)',
            fontFamily: 'var(--ordria-font-body)',
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  )

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {!course || !org ? null : (
        <>
          <GeneralWrapperStyled>
            <div className="flex flex-col gap-6 md:gap-8">
            {/* Breadcrumb (desktop) */}
            <div className="pb-4 hidden md:block order-first">
              <Breadcrumbs items={[
                { label: t('courses.courses'), href: getUriWithOrg(orgslug, '/courses'), icon: <BookCopy size={14} /> },
                { label: course.name }
              ]} />
            </div>

            {/* ===== Héros — mobile (wireframe M1) ===== */}
            <div className="md:hidden order-2 space-y-3">
              {/* Couverture 16:9 pleine largeur */}
              <img
                src={course.thumbnail_image
                  ? getCourseThumbnailMediaDirectory(org?.org_uuid, course?.course_uuid, course?.thumbnail_image)
                  : '/empty_thumbnail.png'}
                alt={course.name}
                className="block w-full aspect-video rounded-lg object-cover ring-1 ring-inset ring-black/10 shadow-lg bg-[var(--ordria-surface)]"
                fetchPriority="high"
              />
              <h1
                className="text-xl font-bold"
                style={{ fontFamily: 'var(--ordria-font-display)', color: 'var(--ordria-foreground)' }}
              >
                {course.name}
              </h1>
              {courseDescription && (
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: 'var(--ordria-muted)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                >
                  {courseDescription}
                </p>
              )}
              {courseTags.length > 0 && tagsRow(true)}
              {heroProgress()}
            </div>

            {/* ===== Héros — desktop 7/5 (wireframe D1) ===== */}
            <div className="hidden md:grid grid-cols-[7fr_5fr] gap-8 order-2 items-start">
              <div className="min-w-0 space-y-4">
                <div className="flex justify-between items-start gap-4">
                  <h1
                    className="text-3xl font-bold"
                    style={{ fontFamily: 'var(--ordria-font-display)', color: 'var(--ordria-foreground)' }}
                  >
                    {course.name}
                  </h1>
                  <CourseShare courseName={course.name} courseUrl={getUriWithOrg(orgslug, `/course/${courseuuid}`)} />
                </div>
                {courseDescription && (
                  <p
                    className="text-base leading-relaxed"
                    style={{ color: 'var(--ordria-muted)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                  >
                    {courseDescription}
                  </p>
                )}
                {courseTags.length > 0 && tagsRow(false)}
                {heroProgress()}
              </div>

              <div className="space-y-4">
                {/* Couverture avec toggle image / vidéo */}
                {(() => {
                  const showVideo = course.thumbnail_type === 'video' || (course.thumbnail_type === 'both' && activeThumbnailType === 'video');
                  const showImage = course.thumbnail_type === 'image' || (course.thumbnail_type === 'both' && activeThumbnailType === 'image') || !course.thumbnail_type;

                  if (showVideo && course.thumbnail_video) {
                    return (
                      <div className="relative inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl w-full aspect-video overflow-hidden">
                        {course.thumbnail_type === 'both' && (
                          <div className="absolute top-3 right-3 z-10">
                            <div className="bg-black/20 backdrop-blur-sm rounded-lg p-1 flex space-x-1">
                              <button
                                onClick={() => setActiveThumbnailType('image')}
                                className={`flex items-center px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                                  activeThumbnailType === 'image'
                                    ? 'bg-white/90 text-gray-900 shadow-sm'
                                    : 'text-white/80 hover:text-white hover:bg-white/10'
                                }`}
                              >
                                <ImageIcon size={12} className="mr-1" />
                                {t('courses.image')}
                              </button>
                              <button
                                onClick={() => setActiveThumbnailType('video')}
                                className={`flex items-center px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                                  activeThumbnailType === 'video'
                                    ? 'bg-white/90 text-gray-900 shadow-sm'
                                    : 'text-white/80 hover:text-white hover:bg-white/10'
                                }`}
                              >
                                <Video size={12} className="mr-1" />
                                {t('activities.video')}
                              </button>
                            </div>
                          </div>
                        )}
                        <video
                          src={getCourseThumbnailMediaDirectory(
                            org?.org_uuid,
                            course?.course_uuid,
                            course?.thumbnail_video
                          )}
                          className="w-full h-full bg-black rounded-lg"
                          controls
                          autoPlay
                          muted
                          preload="metadata"
                          playsInline
                        />
                      </div>
                    );
                  } else if (showImage && course.thumbnail_image) {
                    return (
                      <div className="relative inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl w-full aspect-video bg-cover bg-center"
                        style={{
                          backgroundImage: `url(${getCourseThumbnailMediaDirectory(
                            org?.org_uuid,
                            course?.course_uuid,
                            course?.thumbnail_image
                          )})`,
                        }}
                      >
                        {/* Hidden img with fetchpriority="high" so the browser fetches this LCP image immediately */}
                        <img
                          src={getCourseThumbnailMediaDirectory(org?.org_uuid, course?.course_uuid, course?.thumbnail_image)}
                          alt=""
                          aria-hidden="true"
                          fetchPriority="high"
                          className="absolute w-0 h-0 opacity-0 pointer-events-none"
                        />
                        {course.thumbnail_type === 'both' && (
                          <div className="absolute top-3 right-3 z-10">
                            <div className="bg-black/20 backdrop-blur-sm rounded-lg p-1 flex space-x-1">
                              <button
                                onClick={() => setActiveThumbnailType('image')}
                                className={`flex items-center px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                                  activeThumbnailType === 'image'
                                    ? 'bg-white/90 text-gray-900 shadow-sm'
                                    : 'text-white/80 hover:text-white hover:bg-white/10'
                                }`}
                              >
                                <ImageIcon size={12} className="mr-1" />
                                {t('courses.image')}
                              </button>
                              <button
                                onClick={() => setActiveThumbnailType('video')}
                                className={`flex items-center px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                                  activeThumbnailType === 'video'
                                    ? 'bg-white/90 text-gray-900 shadow-sm'
                                    : 'text-white/80 hover:text-white hover:bg-white/10'
                                }`}
                              >
                                <Video size={12} className="mr-1" />
                                {t('activities.video')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  } else {
                    return (
                      <div
                        className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-full aspect-video bg-cover bg-center overflow-hidden"
                        style={{
                          backgroundImage: `url('/empty_thumbnail.png')`,
                          backgroundSize: 'auto',
                        }}
                      ></div>
                    );
                  }
                })()}

                {/* Actions (Commencer/Quitter, offres payantes, contributeur) — logique inchangée */}
                <CoursesActions courseuuid={courseuuid} orgslug={orgslug} course={course} trailData={trailData} />

                {/* Auteurs — version compacte rétractable */}
                <details className="bg-white rounded-2xl border border-[var(--ordria-border)] overflow-hidden group">
                  <summary className="cursor-pointer p-3 list-none flex items-center gap-2 hover:bg-[var(--ordria-surface)] transition-colors">
                    {course.authors?.[0]?.user && (
                      <img
                        src={getUserAvatarMediaDirectory(course.authors[0].user.user_uuid, course.authors[0].user.avatar_image)}
                        alt={course.authors[0].user.username}
                        className="w-7 h-7 rounded-full object-cover"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--ordria-muted)] font-semibold uppercase tracking-wider">{t('courses.author', 'Auteur')}</p>
                      <p className="text-sm font-bold text-[var(--ordria-foreground)] truncate">
                        @{authorUsername}
                      </p>
                    </div>
                    <ChevronRight size={14} className="text-[var(--ordria-muted)] transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="border-t border-[var(--ordria-border)] max-h-[300px] overflow-y-auto">
                    <CourseProvider courseuuid={course.course_uuid}>
                      <CourseAuthors authors={course.authors} />
                    </CourseProvider>
                  </div>
                </details>
              </div>
            </div>

            {/* ===== Strip stats (5 blocs · 2 colonnes sur mobile) ===== */}
            <div
              className="order-3 w-full grid grid-cols-2 md:grid-cols-5 rounded-2xl overflow-hidden"
              style={{ background: 'var(--ordria-surface)', border: '2px solid var(--ordria-border)' }}
              data-testid="course-stats-strip"
            >
              {statBlocks.map((block, idx) => (
                <div
                  key={block.label}
                  className={`px-4 py-3.5 text-center ${idx % 2 === 1 ? 'border-l-2' : ''} md:border-l-2 ${idx === 0 ? 'md:border-l-0' : ''} ${idx >= 2 ? 'border-t-2 md:border-t-0' : ''} ${idx === 4 ? 'col-span-2 md:col-span-1' : ''}`}
                  style={{ borderColor: 'var(--ordria-border)' }}
                >
                  <div className="text-lg font-black truncate" style={{ color: 'var(--ordria-foreground)', fontFamily: 'var(--ordria-font-display)' }}>
                    {block.value}
                  </div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ordria-muted)' }}>
                    {block.label}
                  </div>
                </div>
              ))}
            </div>

            {/* ===== Learnings ===== */}
            {displayLearnings.length > 0 && (
              <>
                {/* Desktop : carte */}
                <div className="hidden md:block order-4">
                  <h2 className="py-5 text-xl md:text-2xl font-bold" style={{ fontFamily: 'var(--ordria-font-display)' }}>{t('courses.what_you_will_learn')}</h2>
                  <div className="bg-white rounded-2xl border-2 border-[var(--ordria-border)] duo-card-hover overflow-hidden px-5 py-5 space-y-2">
                    {displayLearnings.map((learning: any) => {
                      const learningText = typeof learning === 'string' ? learning : learning.text
                      const learningEmoji = typeof learning === 'string' ? null : learning.emoji
                      const learningId = typeof learning === 'string' ? learning : learning.id || learning.text
                      return (
                        <div
                          key={learningId}
                          className="flex space-x-2 items-center font-semibold text-[var(--ordria-foreground)]"
                        >
                          <div className="px-2 py-2 rounded-full bg-[var(--ordria-accent-bg)]">
                            {learningEmoji ? (
                              <span>{learningEmoji}</span>
                            ) : (
                              <Check className="text-[var(--ordria-success)]" size={15} />
                            )}
                          </div>
                          <p>{learningText}</p>
                          {learning.link && (
                            <a
                              href={learning.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:underline text-sm"
                            >
                              <span className="sr-only">Link to {learningText}</span>
                              <ArrowRight size={14} />
                            </a>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Mobile : bloc repliable */}
                <details className="md:hidden order-4 rounded-2xl group" style={{ background: 'var(--ordria-surface)', border: '2px solid var(--ordria-border)' }}>
                  <summary className="cursor-pointer p-4 list-none flex items-center justify-between font-bold text-sm" style={{ fontFamily: 'var(--ordria-font-display)', color: 'var(--ordria-foreground)' }}>
                    {t('courses.what_you_will_learn')}
                    <ChevronRight size={16} className="text-[var(--ordria-muted)] transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="px-4 pb-4 space-y-2">
                    {displayLearnings.map((learning: any) => {
                      const learningText = typeof learning === 'string' ? learning : learning.text
                      const learningEmoji = typeof learning === 'string' ? null : learning.emoji
                      const learningId = typeof learning === 'string' ? learning : learning.id || learning.text
                      return (
                        <div key={learningId} className="flex space-x-2 items-center text-sm font-semibold text-[var(--ordria-foreground)]">
                          <div className="px-2 py-1.5 rounded-full bg-[var(--ordria-accent-bg)] shrink-0">
                            {learningEmoji ? <span>{learningEmoji}</span> : <Check className="text-[var(--ordria-success)]" size={13} />}
                          </div>
                          <p>{learningText}</p>
                        </div>
                      )
                    })}
                  </div>
                </details>
              </>
            )}

            {/* ===== Plan du cours (accordéon, wireframe v1/v2) ===== */}
            <CoursePlanAccordion
              course={course}
              orgslug={orgslug}
              courseuuid={courseuuid}
              currentActivityUuid={currentActivityUuid}
              isActivityDone={isActivityDone}
              guardLink={guardLink}
            />

            {/* ActivityIndicators — conservé masqué (préchargement / parité de données) */}
            {(() => {
              const cleanCourseUuid = course.course_uuid?.replace('course_', '');
              const run = trailData?.runs?.find(
                (run: any) => {
                  const cleanRunCourseUuid = run.course?.course_uuid?.replace('course_', '');
                  return cleanRunCourseUuid === cleanCourseUuid;
                }
              );
              return run;
            })() && (
              <div className="hidden">
                <ActivityIndicators
                  course_uuid={course.course_uuid}
                  orgslug={orgslug}
                  course={course}
                  trailData={trailData}
                />
              </div>
            )}

            {/* Community Section */}
            <div className="order-6">
              <Suspense fallback={<div className="animate-pulse h-48 bg-gray-100 rounded-lg mt-4" />}>
                <div className="hidden md:block">
                  <CourseCommunitySection courseUuid={course.course_uuid} orgslug={orgslug} />
                </div>
              </Suspense>
            </div>

            {/* Mobile: Creator info at the bottom */}
            {course.authors?.[0] && (
              <div className="md:hidden mt-8 mb-4 text-center order-7">
                <p className="text-xs text-[var(--ordria-muted)]">
                  {t('courses.created_by', { author: authorUsername })}
                </p>
              </div>
            )}
            </div>{/* ferme le flex flex-col wrapper d'ordre */}
          </GeneralWrapperStyled>

          {/* Mobile Actions Box — CTA collant (Commencer/Quitter), conservé */}
          {isMobile && (
            <div className="md:hidden sticky bottom-0 z-30 pb-3 -mx-4 px-4 pt-3 mt-6"
              style={{
                background: 'linear-gradient(to top, var(--ordria-background) 80%, transparent)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <CourseActionsMobile courseuuid={courseuuid} orgslug={orgslug} course={course} trailData={trailData} />
            </div>
          )}
        </>
      )}
    </>
  )
}

export default CourseClient
