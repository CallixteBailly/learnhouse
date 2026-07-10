'use client'
import Link from 'next/link'
import { useEffect, useState, Suspense } from 'react'
import { getUriWithOrg } from '@services/config/config'
import { getCourseMetadata } from '@services/courses/courses'
import { useTrail } from '@/hooks/queries/useTrail'
import ActivityIndicators from '@components/Pages/Courses/ActivityIndicators'
import { useRouter } from 'next/navigation'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import {
  getCourseThumbnailMediaDirectory,
} from '@services/media/media'
import { ArrowRight, Check, Video, Image as ImageIcon, BookCopy, Lock } from 'lucide-react'
import { useOrg } from '@components/Contexts/OrgContext'
import { CourseProvider } from '@components/Contexts/CourseContext'
import { useMediaQuery } from 'usehooks-ts'
import CoursesActions from '@components/Objects/Courses/CourseActions/CoursesActions'
import CourseActionsMobile from '@components/Objects/Courses/CourseActions/CourseActionsMobile'
import CourseAuthors from '@components/Objects/Courses/CourseAuthors/CourseAuthors'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getActivityWithAuthHeader } from '@services/courses/activities'
import { useTranslation } from 'react-i18next'
import CourseCommunitySection from '@components/Objects/Communities/CourseCommunitySection'
import CourseShare from '@components/Objects/Courses/CourseShare/CourseShare'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

const CourseClient = (props: any) => {
  const { t } = useTranslation()
  const [learnings, setLearnings] = useState<any>([])
  const [expandedChapters, setExpandedChapters] = useState<{[key: string]: boolean}>({})
  const [activeThumbnailType, setActiveThumbnailType] = useState<'image' | 'video'>('image')
  const courseuuid = props.courseuuid
  const orgslug = props.orgslug
  const initialCourse = props.course
  const serverError = props.serverError
  const org = useOrg() as any
  const _router = useRouter()
  const isMobile = useMediaQuery('(max-width: 768px)')
  const session = useLHSession() as any;
  const access_token = session?.data?.tokens?.access_token;
  const queryClient = useQueryClient()

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

  // Must be before any early returns (React rules of hooks)
  useEffect(() => {
    if (!course) return

    getLearningTags(course)

    if (course?.chapters) {
      const totalActivities = course.chapters.reduce((sum: number, chapter: any) => sum + (chapter.activities?.length || 0), 0)
      const defaultExpanded: {[key: string]: boolean} = {}
      course.chapters.forEach((chapter: any, idx: number) => {
        defaultExpanded[chapter.chapter_uuid] = idx === 0 ? true : totalActivities <= 5
      })
      setExpandedChapters(defaultExpanded)
    }
  }, [course])

  // Show loading state if fetching course data client-side
  if (!initialCourse && !serverError && courseLoading) {
    return (
      <GeneralWrapperStyled>
        <div className="animate-pulse">
          {/* Breadcrumb placeholder */}
          <div className="pb-4 flex items-center gap-2">
            <div className="h-3 bg-gray-200 rounded w-16" />
            <div className="h-3 bg-gray-200 rounded w-2" />
            <div className="h-3 bg-gray-200 rounded w-32" />
          </div>

          {/* Course title + share row */}
          <div className="pb-2 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div className="h-9 bg-gray-200 rounded w-2/3" />
            <div className="h-8 bg-gray-200 rounded-lg w-24" />
          </div>

          {/* Main content: left 3/4 + right 1/4 sidebar */}
          <div className="flex flex-col md:flex-row gap-8 pt-2">
            {/* Left column */}
            <div className="w-full md:w-3/4 space-y-4">
              {/* Thumbnail */}
              <div className="bg-gray-200 rounded-lg w-full h-[200px] md:h-[400px]" />
              {/* About text block */}
              <div className="space-y-2 py-2">
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-5/6" />
                <div className="h-3 bg-gray-200 rounded w-4/6" />
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-3/4" />
              </div>
            </div>

            {/* Right sidebar */}
            <div className="w-full md:w-1/4 space-y-4">
              {/* Actions box */}
              <div className="bg-gray-200 rounded-lg h-40" />
              {/* Authors box */}
              <div className="bg-gray-200 rounded-lg h-24" />
            </div>
          </div>

          {/* Chapter list */}
          <div className="w-full my-5 mb-10">
            <div className="h-7 bg-gray-200 rounded w-40 mb-5" />
            <div className="bg-white shadow-md shadow-gray-300/25 outline outline-1 outline-neutral-200/40 rounded-lg overflow-hidden">
              {Array.from({ length: 3 }).map((_, chIdx) => (
                <div key={chIdx}>
                  {/* Chapter header */}
                  <div className="flex items-center gap-3 py-4 px-4 bg-neutral-50 outline outline-1 outline-neutral-200/40">
                    <div className="h-5 w-5 bg-gray-200 rounded-full flex-shrink-0" />
                    <div className="h-5 bg-gray-200 rounded w-5 flex-shrink-0" />
                    <div className="h-5 bg-gray-200 rounded w-1/3" />
                  </div>
                  {/* Activity rows — only expand first chapter */}
                  {chIdx === 0 && Array.from({ length: 3 }).map((_, aIdx) => (
                    <div key={aIdx} className="flex items-center gap-3 px-4 py-4 border-t border-neutral-100">
                      <div className="h-4 w-4 bg-gray-200 rounded flex-shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-4 bg-gray-200 rounded w-1/2" />
                        <div className="h-3 bg-gray-200 rounded w-20" />
                      </div>
                      <div className="h-4 w-4 bg-gray-200 rounded flex-shrink-0" />
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

  const getActivityTypeLabel = (activityType: string) => {
    switch (activityType) {
      case 'TYPE_VIDEO':
        return t('activities.video')
      case 'TYPE_DOCUMENT':
        return t('activities.document')
      case 'TYPE_DYNAMIC':
        return t('activities.page')
      case 'TYPE_ASSIGNMENT':
        return t('activities.assignment')
      default:
        return t('activities.learning_material')
    }
  }

  const _getActivityTypeBadgeColor = (activityType: string) => {
    switch (activityType) {
      case 'TYPE_VIDEO':
        return 'bg-neutral-100 text-neutral-500'
      case 'TYPE_DOCUMENT':
        return 'bg-neutral-100 text-neutral-500'
      case 'TYPE_DYNAMIC':
        return 'bg-neutral-100 text-neutral-500'
      case 'TYPE_ASSIGNMENT':
        return 'bg-neutral-100 text-neutral-500'
      default:
        return 'bg-neutral-100 text-neutral-500'
    }
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
    return !!run.steps.find((step: any) => step.activity_id == activity.id)
  }

  const isActivityCurrent = (activity: any) => {
    if (!activity?.activity_uuid) return false
    const activity_uuid = activity.activity_uuid.replace('activity_', '')
    return props.current_activity === activity_uuid
  }

  const handleActivityMouseEnter = (activity: any) => {
    if (!activity?.activity_uuid) return
    const cleanUuid = activity.activity_uuid.replace('activity_', '')
    queryClient.prefetchQuery({
      queryKey: queryKeys.activity.detail(cleanUuid),
      queryFn: () => getActivityWithAuthHeader(cleanUuid, {}, access_token),
      staleTime: 60_000,
    })
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

  const firstActivity = course?.chapters?.[0]?.activities?.[0]
  const continueLink = props.current_activity
    ? getUriWithOrg(orgslug, `/course/${courseuuid}/activity/${props.current_activity}`)
    : firstActivity
      ? getUriWithOrg(orgslug, `/course/${courseuuid}/activity/${firstActivity.activity_uuid?.replace('activity_', '')}`)
      : '#'

  const totalModules = course?.chapters?.length || 0
  const totalActivitiesCount = (course?.chapters ?? []).reduce((sum: number, ch: any) => sum + (ch.activities?.length || 0), 0)
  const completedActivitiesCount = (course?.chapters ?? []).reduce((sum: number, ch: any) => {
    return sum + (ch.activities?.filter((a: any) => isActivityDone(a)).length || 0)
  }, 0)
  const progressPercent = totalActivitiesCount > 0 ? Math.round((completedActivitiesCount / totalActivitiesCount) * 100) : 0
  const completedModules = (course?.chapters ?? []).filter((ch: any) =>
    ch.activities?.length > 0 && ch.activities.every((a: any) => isActivityDone(a))
  ).length

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
            <div className="pb-4 hidden md:block">
              <Breadcrumbs items={[
                { label: t('courses.courses'), href: getUriWithOrg(orgslug, '/courses'), icon: <BookCopy size={14} /> },
                { label: course.name }
              ]} />
            </div>

            {/* Desktop: Commencer/Continuer button — prominent, top-right */}
            <div className="hidden md:flex justify-between items-center mb-2">
              <h1 className="text-3xl font-bold truncate" style={{ fontFamily: 'var(--ordria-font-display)', color: 'var(--ordria-foreground)' }}>{course.name}</h1>
              <div className="flex items-center gap-3">
                <CourseShare courseName={course.name} courseUrl={getUriWithOrg(orgslug, `/course/${courseuuid}`)} />
                <Link href={continueLink} prefetch={false} className="no-underline">
                  <div className="px-8 py-3 rounded-xl font-bold text-base active:translate-y-0.5 transition-all" style={{ fontFamily: 'var(--ordria-font-display)', background: 'var(--ordria-accent)', color: '#fff', boxShadow: '0 4px 0 var(--ordria-accent-secondary)' }}>
                    {isStarted ? '▶ Continuer' : '★ Commencer'}
                  </div>
                </Link>
              </div>
            </div>

            {/* Mobile: title only (sticky Commencer button added at bottom) */}
            <h1 className="md:hidden text-xl font-bold truncate mb-3" style={{ fontFamily: 'var(--ordria-font-display)', color: 'var(--ordria-foreground)' }}>{course.name}</h1>

            <div className="flex flex-col md:flex-row gap-8 pt-2">
              <div className="w-full md:w-3/4 space-y-4">
                {(() => {
                  const showVideo = course.thumbnail_type === 'video' || (course.thumbnail_type === 'both' && activeThumbnailType === 'video');
                  const showImage = course.thumbnail_type === 'image' || (course.thumbnail_type === 'both' && activeThumbnailType === 'image') || !course.thumbnail_type;

                    if (showVideo && course.thumbnail_video) {
                    return (
                      <div className="relative inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl w-full h-[120px] md:h-[400px] hidden md:block">
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
                        <div className="w-full h-full">
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
                      </div>
                    );
                    } else if (showImage && course.thumbnail_image) {
                    return (
                      <div className="relative inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl w-full h-[120px] md:h-[400px] bg-cover bg-center hidden md:block"
                        style={{
                          backgroundImage: `url(${getCourseThumbnailMediaDirectory(
                            org?.org_uuid,
                            course?.course_uuid,
                            course?.thumbnail_image
                          )})`,
                        }}
                      >
                        {/* Hidden img with fetchpriority="high" so the browser fetches this LCP image immediately */}
                        { }
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
                        className="inset-0 ring-1 ring-inset ring-black/10 rounded-lg shadow-xl relative w-full h-[120px] md:h-[400px] bg-cover bg-center hidden md:block"
                        style={{
                          backgroundImage: `url('/empty_thumbnail.png')`,
                          backgroundSize: 'auto',
                        }}
                      ></div>
                    );
                  }
                })()}

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

                <div className="course_metadata_left space-y-2 hidden md:block">
                  <div className="">
                    <p className="py-5 whitespace-pre-line break-words w-full leading-relaxed tracking-normal text-pretty hyphens-auto text-[var(--ordria-foreground)]">{course.about}</p>
                  </div>
                </div>
              </div>

              <div className='course_metadata_right w-full md:w-1/4 space-y-4 hidden md:block'>
                {/* Actions Box */}
                <CoursesActions courseuuid={courseuuid} orgslug={orgslug} course={course} trailData={trailData} />
                
                {/* Authors & Updates Box */}
                <div className="bg-white rounded-2xl border-2 border-[var(--ordria-border)] duo-card-hover overflow-hidden p-4">
                  <CourseProvider courseuuid={course.course_uuid}>
                    <CourseAuthors authors={course.authors} />
                  </CourseProvider>
                </div>
              </div>
            </div>

            {(() => {
              const displayLearnings = learnings.filter((l: any) => {
                const text = typeof l === 'string' ? l : l?.text
                return text && text.trim() !== '' && text !== 'null'
              })
              if (displayLearnings.length === 0) return null
              return (
                <div className="w-full hidden md:block">
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
              )
            })()}

            {/* Course Progress + Learning Path */}
            <div className="w-full my-5 mb-2">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
                {/* Main: Progress + Learning Path */}
                <div>
                  {/* Progress section */}
                  <div className="rounded-2xl p-4 mb-8" style={{ background: 'var(--ordria-surface)', border: '2px solid var(--ordria-border)' }}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-bold text-sm" style={{ fontFamily: 'var(--ordria-font-display)', color: 'var(--ordria-foreground)' }}>
                        {completedModules} sur {totalModules} modules terminés
                      </span>
                      <span className="font-mono font-black text-2xl" style={{ color: 'var(--ordria-accent-secondary)' }}>
                        {progressPercent}%
                      </span>
                    </div>
                    <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--ordria-background)', border: '1px solid var(--ordria-border)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${progressPercent}%`, background: 'linear-gradient(90deg, var(--ordria-accent), var(--ordria-accent-secondary))' }}
                      />
                    </div>
                  </div>

                  {/* Learning Path — simple vertical timeline with Ordria tokens */}
                  <div className="flex flex-col items-center py-6">
                    {(course.chapters ?? []).map((chapter: any, index: number) => {
                      const chapterActivities = chapter.activities || []
                      const isChapterCompleted = chapterActivities.length > 0 && chapterActivities.every((a: any) => isActivityDone(a))
                      const firstNonCompletedIdx = (course.chapters ?? []).findIndex((ch: any) => {
                        const chActs = ch.activities || []
                        return !(chActs.length > 0 && chActs.every((a: any) => isActivityDone(a)))
                      })
                      const isCurrent = firstNonCompletedIdx === index && !isChapterCompleted
                      const isLocked = !isChapterCompleted && !isCurrent
                      const firstActivity = chapterActivities[0]
                      const chapterLink = firstActivity
                        ? getUriWithOrg(orgslug, `/course/${courseuuid}/activity/${firstActivity.activity_uuid?.replace('activity_', '')}`)
                        : '#'
                      const isLast = index === (course.chapters ?? []).length - 1

                      return (
                        <div key={chapter.chapter_uuid || `ch-${index}`} className="flex flex-col items-center">
                          {isLocked ? (
                            <div
                              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl"
                              style={{ background: 'var(--ordria-surface)', color: 'var(--ordria-muted)', boxShadow: '0 4px 0 var(--ordria-border)' }}
                            >🔒</div>
                          ) : (
                            <Link href={chapterLink} prefetch={false}>
                              <div
                                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold transition-all active:translate-y-1 duo-pulse"
                                style={{
                                  background: isChapterCompleted ? 'var(--ordria-success)' : 'var(--ordria-accent)',
                                  color: '#fff',
                                  boxShadow: `0 4px 0 ${isChapterCompleted ? '#1e7a4d' : 'var(--ordria-accent-secondary)'}`,
                                }}
                              >
                                {isChapterCompleted ? '✓' : '▶'}
                              </div>
                            </Link>
                          )}

                          <h3 className="font-bold text-sm mt-2 text-center px-4" style={{ fontFamily: 'var(--ordria-font-display)', color: 'var(--ordria-foreground)' }}>
                            {chapter.name}
                          </h3>

                          {/* Show activity checklist for current module */}
                          {isCurrent && chapterActivities.length > 0 && (
                            <div className="mt-2 w-full max-w-[260px] space-y-1">
                              {chapterActivities.map((activity: any, actIdx: number) => {
                                const actDone = isActivityDone(activity)
                                const actCleanUuid = activity.activity_uuid?.replace('activity_', '')
                                const actLink = getUriWithOrg(orgslug, `/course/${courseuuid}/activity/${actCleanUuid}`)
                                return (
                                  <Link
                                    key={actIdx}
                                    href={actLink}
                                    prefetch={false}
                                    className="flex items-center gap-2 p-2 rounded-lg transition-colors hover:bg-[var(--ordria-surface)]"
                                  >
                                    <span
                                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 font-bold"
                                      style={actDone
                                        ? { background: 'var(--ordria-success)', color: '#fff' }
                                        : { background: 'var(--ordria-surface)', color: 'var(--ordria-muted)' }
                                      }
                                    >
                                      {actDone ? '✓' : activity.activity_type === 'TYPE_VIDEO' ? '🎬' : activity.activity_type === 'TYPE_ASSIGNMENT' ? '🎯' : '📄'}
                                    </span>
                                    <span className="text-xs truncate" style={{ color: actDone ? 'var(--ordria-muted)' : 'var(--ordria-foreground)', textDecoration: actDone ? 'line-through' : 'none' }}>
                                      {activity.name}
                                    </span>
                                  </Link>
                                )
                              })}
                              {(() => {
                                const remaining = chapterActivities.filter((a: any) => !isActivityDone(a)).length
                                return remaining > 0 ? (
                                  <p className="text-xs text-center pt-1" style={{ color: 'var(--ordria-accent-secondary)' }}>
                                    {remaining} activité{remaining > 1 ? 's' : ''} restante{remaining > 1 ? 's' : ''}
                                  </p>
                                ) : null
                              })()}
                            </div>
                          )}

                          {isChapterCompleted && (
                            <span className="text-xs mb-3 font-semibold" style={{ color: 'var(--ordria-success)' }}>
                              ✓ {chapterActivities.length} activités terminées
                            </span>
                          )}
                          {isLocked && (
                            <span className="text-xs mb-4" style={{ color: 'var(--ordria-muted)' }}>
                              {chapterActivities.length} {chapterActivities.length > 1 ? 'activités' : 'activité'}
                            </span>
                          )}
                          {isCurrent && (
                            <span className="text-xs mb-4" style={{ color: 'var(--ordria-muted)' }}>
                              {chapterActivities.length} {chapterActivities.length > 1 ? 'activités' : 'activité'}
                            </span>
                          )}

                          {!isLast && (
                            <div
                              className="w-1 rounded-full mb-4"
                              style={{ height: '32px', background: isChapterCompleted ? 'var(--ordria-success)' : 'var(--ordria-border)' }}
                            />
                          )}
                        </div>
                      )
                    })}

                    {/* Certificate node — shows when all modules are completed OR as a locked goal */}
                    {(() => {
                      const allDone = (course.chapters ?? []).every((ch: any) => {
                        const acts = ch.activities || []
                        return acts.length > 0 && acts.every((a: any) => isActivityDone(a))
                      })
                      const endLink = getUriWithOrg(orgslug, `/course/${courseuuid}/activity/end`)

                      return (
                        <>
                          {/* Connector to certificate */}
                          <div className="w-1 rounded-full mb-4" style={{ height: '32px', background: allDone ? 'var(--ordria-success)' : 'var(--ordria-border)' }} />

                          {/* Certificate circle */}
                          {allDone ? (
                            <Link href={endLink} prefetch={false}>
                              <div
                                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl transition-all active:translate-y-1 duo-pulse"
                                style={{ background: 'var(--ordria-warning)', color: '#fff', boxShadow: '0 4px 0 #8a6420' }}
                              >
                                🏆
                              </div>
                            </Link>
                          ) : (
                            <div
                              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl"
                              style={{ background: 'var(--ordria-surface)', color: 'var(--ordria-muted)', boxShadow: '0 4px 0 var(--ordria-border)' }}
                            >
                              🔒
                            </div>
                          )}

                          <h3 className="font-bold text-sm mt-2 text-center px-4" style={{ fontFamily: 'var(--ordria-font-display)', color: 'var(--ordria-foreground)' }}>
                            {allDone ? 'Certificat débloqué !' : 'Certificat'}
                          </h3>
                          <span className="text-xs text-center" style={{ color: 'var(--ordria-muted)' }}>
                            {allDone ? 'Touchez pour récupérer votre certificat' : 'Terminez tous les modules'}
                          </span>

                          {/* Info message for stuck users */}
                          {!allDone && (
                            <div className="mt-6 p-3 rounded-xl text-xs text-center max-w-xs" style={{ background: 'var(--ordria-surface)', color: 'var(--ordria-muted)' }}>
                              💡 Terminez toutes les activités d'un module pour débloquer le suivant.
                              {progressPercent > 0 && progressPercent < 100 && (
                                <span className="block mt-1 font-semibold" style={{ color: 'var(--ordria-accent-secondary)' }}>
                                  Plus que {100 - progressPercent}% avant le certificat !
                                </span>
                              )}
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>

                {/* Sidebar (desktop only) */}
                <div className="hidden lg:block">
                  <div className="bg-[var(--ordria-surface)] rounded-2xl p-5 sticky top-20">
                    <h3
                      className="font-bold text-sm uppercase tracking-wider text-[var(--ordria-muted)] mb-4"
                      style={{ fontFamily: 'var(--ordria-font-display)' }}
                    >
                      {t('courses.course_info', 'Informations du cours')}
                    </h3>

                    <div className="space-y-3 mb-6">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-[var(--ordria-accent-bg)] flex items-center justify-center text-lg">📚</div>
                        <div>
                          <div className="text-xs text-[var(--ordria-muted)]">{t('courses.modules', 'Modules')}</div>
                          <div className="text-sm font-semibold text-[var(--ordria-foreground)]">
                            {totalModules} {t('courses.modules_unit', 'modules')}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-[var(--ordria-accent-bg)] flex items-center justify-center text-lg">📝</div>
                        <div>
                          <div className="text-xs text-[var(--ordria-muted)]">{t('activities.activities', 'Activités')}</div>
                          <div className="text-sm font-semibold text-[var(--ordria-foreground)]">
                            {totalActivitiesCount} {t('activities.activities')}
                          </div>
                        </div>
                      </div>
                      {course.authors?.[0] && (
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-[var(--ordria-accent-bg)] flex items-center justify-center text-lg">👤</div>
                          <div>
                            <div className="text-xs text-[var(--ordria-muted)]">{t('courses.instructor', 'Formateur')}</div>
                            <div className="text-sm font-semibold text-[var(--ordria-foreground)]">
                              @{course.authors[0].user?.username || 'admin'}
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-[var(--ordria-accent-bg)] flex items-center justify-center text-lg">📊</div>
                        <div>
                          <div className="text-xs text-[var(--ordria-muted)]">{t('courses.progress', 'Progression')}</div>
                          <div className="text-sm font-semibold text-[var(--ordria-foreground)]">{progressPercent}%</div>
                        </div>
                      </div>
                    </div>

                    {/* Certificate preview */}
                    <div className="p-4 rounded-xl border-2 border-amber-300 bg-amber-50">
                      <div className="text-2xl mb-1">🏆</div>
                      <div className="font-bold text-sm text-[var(--ordria-warning)]">
                        {t('courses.certificate', 'Certificat')}
                      </div>
                      <div className="text-xs text-[var(--ordria-muted)] mt-1">
                        {t('courses.certificate_desc', 'Obtenez votre certificat en terminant tous les modules')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Community Section */}
            <Suspense fallback={<div className="animate-pulse h-48 bg-gray-100 rounded-lg mt-4" />}>
              <div className="hidden md:block">
                <CourseCommunitySection courseUuid={course.course_uuid} orgslug={orgslug} />
              </div>
            </Suspense>

            {/* Mobile: Creator info at the bottom */}
            {course.authors?.[0] && (
              <div className="md:hidden mt-8 mb-4 text-center">
                <p className="text-xs text-[var(--ordria-muted)]">
                  Créé par @{course.authors[0].user?.username || 'admin'}
                </p>
              </div>
            )}
          </GeneralWrapperStyled>

          {/* Mobile: Sticky Commencer/Continuer button — only if NOT enrolled yet */}
          {!isStarted && (
            <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 p-3" style={{ background: 'linear-gradient(to top, var(--ordria-background) 70%, transparent)' }}>
              <Link href={continueLink} prefetch={false} className="block no-underline">
                <div className="w-full text-center py-3.5 rounded-xl font-bold text-base active:translate-y-0.5 transition-all" style={{ fontFamily: 'var(--ordria-font-display)', background: 'var(--ordria-accent)', color: '#fff', boxShadow: '0 4px 0 var(--ordria-accent-secondary)' }}>
                  ★ Commencer
                </div>
              </Link>
            </div>
          )}

          {/* Mobile Actions Box */}
          {isMobile && (
            <CourseActionsMobile courseuuid={courseuuid} orgslug={orgslug} course={course} trailData={trailData} />
          )}
        </>
      )}
    </>
  )
}

export default CourseClient