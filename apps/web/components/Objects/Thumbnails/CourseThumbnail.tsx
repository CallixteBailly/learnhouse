'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ManageAccessPopover from '@components/Dashboard/Library/ManageAccessPopover'
import { getUriWithOrg } from '@services/config/config'
import { deleteCourseFromBackend, cloneCourse } from '@services/courses/courses'
import { exportCourse, downloadBlob, ExportStatus } from '@services/courses/transfer'
import { exportToast } from '@components/Objects/StyledElements/Toast/ExportToast'
import { useTrail } from '@/hooks/queries/useTrail'
import { getCourseThumbnailMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getCourseMetadata } from '@services/courses/courses'
import { BookMinus, FilePenLine, Settings2, MoreVertical, Copy, Download, CheckSquare, Square, Lock } from 'lucide-react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Link from 'next/link'
import React from 'react'
import toast from 'react-hot-toast'
import UserAvatar from '@components/Objects/UserAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@components/ui/dropdown-menu"
import { useTranslation } from 'react-i18next'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

/** Photos Unsplash de fallback quand un cours n'a pas de thumbnail.
 *  Détection par métier + pool aléatoire déterministe (stable par UUID). */
const METIER_PHOTOS: { keys: string[]; photo: string; label: string }[] = [
  { keys: ['restaurant', 'restaurat'], photo: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80', label: 'Restaurant' },
  { keys: ['coiffeur', 'barbier', 'salon'], photo: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=800&q=80', label: 'Coiffure' },
  { keys: ['garagist', 'auto', 'mécan'], photo: 'https://images.unsplash.com/photo-1632823471565-1ecdf5c6da77?auto=format&fit=crop&w=800&q=80', label: 'Garage' },
  { keys: ['artisan', 'btp', 'construct'], photo: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=800&q=80', label: 'Artisan' },
  { keys: ['immobilier', 'agent'], photo: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=800&q=80', label: 'Immobilier' },
  { keys: ['digital', 'transformation'], photo: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=800&q=80', label: 'Digital' },
  { keys: ['marketing', 'communication'], photo: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80', label: 'Marketing' },
  { keys: ['ia', 'intelligence', 'automatisation'], photo: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=800&q=80', label: 'IA' },
]

const FALLBACK_POOL = [
  'https://images.unsplash.com/photo-1488190211105-8b0e65b80b4e?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=800&q=80',
]

function getFallbackImage(course: any): string {
  const name = (course?.name || '').toLowerCase()
  const tags = Array.isArray(course?.tags) ? course.tags.join(' ').toLowerCase() : (course?.tags || '').toLowerCase()
  const haystack = `${name} ${tags}`
  for (const m of METIER_PHOTOS) {
    if (m.keys.some((k) => haystack.includes(k))) return m.photo
  }
  const uuid = course?.course_uuid || course?.name || ''
  const idx = uuid.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % FALLBACK_POOL.length
  return FALLBACK_POOL[idx]
}

function getCourseCategoryLabel(course: any): string {
  const name = (course?.name || '').toLowerCase()
  const tags = Array.isArray(course?.tags) ? course.tags.join(' ').toLowerCase() : (course?.tags || '').toLowerCase()
  const haystack = `${name} ${tags}`
  for (const m of METIER_PHOTOS) {
    if (m.keys.some((k) => haystack.includes(k))) return m.label
  }
  return ''
}

type Course = {
  course_uuid: string
  name: string
  description: string
  thumbnail_image: string
  org_id: string | number
  update_date: string
  public?: boolean
  published?: boolean
  tags?: string[]
  authors?: Array<{
    user: {
      id: string
      user_uuid: string
      avatar_image: string
      first_name: string
      last_name: string
      username: string
    }
    authorship: 'CREATOR' | 'CONTRIBUTOR' | 'MAINTAINER' | 'REPORTER'
    authorship_status: 'ACTIVE' | 'INACTIVE' | 'PENDING'
  }>
}

type PropsType = {
  course: Course
  orgslug: string
  customLink?: string
  isDashboard?: boolean
  isSelected?: boolean
  onToggleSelect?: (_courseUuid: string) => void
  isPriority?: boolean
}

export const removeCoursePrefix = (course_uuid: string) => course_uuid.replace('course_', '')

function CourseThumbnail({ course, orgslug, customLink, isDashboard = false, isSelected = false, onToggleSelect, isPriority = false }: PropsType) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('learner')
  const { data: trailData } = useTrail(org?.id)

  const cleanUuid = removeCoursePrefix(course.course_uuid)

  const courseProgress = (() => {
    if (!trailData?.runs) return 0
    const run = trailData.runs.find((r: any) => {
      const runUuid = r.course?.course_uuid?.replace('course_', '')
      return runUuid === cleanUuid
    })
    if (!run) return 0
    const completedCount = (run.steps || []).filter((s: any) => s.complete).length
    const totalActivities = run.course_total_steps || (run.steps || []).length
    return totalActivities > 0 ? Math.round((completedCount / totalActivities) * 100) : 0
  })()

  const handleCardOpen = () => {
    track(AnalyticsEvent.CourseCardOpened, {
      course_uuid: cleanUuid,
      source: isDashboard ? 'dashboard' : 'catalog',
    })
  }

  // Prefetch course meta on hover so the course page feels instant
  const handleMouseEnter = () => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.courses.meta(cleanUuid),
      queryFn: () => getCourseMetadata(cleanUuid, {}, session?.data?.tokens?.access_token, { slim: true }),
      staleTime: 60_000,
    })
  }

  const handleSelectClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onToggleSelect?.(course.course_uuid)
  }

  const activeAuthors = course.authors?.filter(author => author.authorship_status === 'ACTIVE') || []
  const displayedAuthors = activeAuthors.slice(0, 3)
  const hasMoreAuthors = activeAuthors.length > 3
  const remainingAuthorsCount = activeAuthors.length - 3

  const deleteCourse = async () => {
    const toastId = toast.loading(t('courses.deleting_course'))
    try {
      await deleteCourseFromBackend(course.course_uuid, session.data?.tokens?.access_token)
      queryClient.invalidateQueries({ queryKey: ['courses'] })
      toast.success(t('courses.course_deleted_success'))
    } catch (_error) {
      toast.error(t('courses.course_deleted_error'))
    } finally {
      toast.dismiss(toastId)
    }
  }

  const handleCloneCourse = async () => {
    const toastId = toast.loading(t('courses.cloning_course'))
    try {
      const result = await cloneCourse(course.course_uuid, session.data?.tokens?.access_token)
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['courses'] })
        toast.success(t('courses.course_cloned_success'))
      } else {
        toast.error(result.HTTPmessage || t('courses.course_cloned_error'))
      }
    } catch (_error) {
      toast.error(t('courses.course_cloned_error'))
    } finally {
      toast.dismiss(toastId)
    }
  }

  const handleExportCourse = async () => {
    const toastId = exportToast.start('single', course.name)

    try {
      const blob = await exportCourse(
        course.course_uuid,
        session.data?.tokens?.access_token,
        (progress, status) => {
          exportToast.update(toastId, status as ExportStatus, progress, course.name, undefined, 'single')
        }
      )
      const timestamp = new Date().toISOString().split('T')[0]
      downloadBlob(blob, `${course.name.replace(/[^a-z0-9]/gi, '_')}-${timestamp}.zip`)
      exportToast.complete(toastId, course.name, undefined, 'single')
    } catch (error: any) {
      exportToast.error(toastId, error.message || t('courses.course_exported_error'), course.name, undefined, 'single')
    }
  }

  const thumbnailImage = course.thumbnail_image
    ? getCourseThumbnailMediaDirectory(org?.org_uuid, course.course_uuid, course.thumbnail_image)
    : getFallbackImage(course)

  const courseLink = customLink ? customLink : getUriWithOrg(orgslug, `/course/${removeCoursePrefix(course.course_uuid)}`)

  const categoryLabel = getCourseCategoryLabel(course)

  return (
    <div onMouseEnter={handleMouseEnter} className={`group relative flex flex-col bg-white rounded-2xl border-2 border-[var(--ordria-border)] overflow-hidden w-full duo-card-hover ${isSelected ? 'ring-2 ring-[var(--ordria-accent)] ring-offset-2' : ''}`}>
      {/* Selection checkbox - visible on hover or when selected (dashboard only) */}
      {isDashboard && onToggleSelect && (
        <button
          onClick={handleSelectClick}
          aria-label={isSelected ? 'Deselect course' : 'Select course'}
          className={`absolute top-2 left-2 z-20 p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-all shadow-md ${
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-black" />
          ) : (
            <Square className="w-4 h-4 text-gray-500" />
          )}
        </button>
      )}

      {/* Options menu - visible on hover or when dropdown is open */}
      <AdminEditOptions
        course={course}
        orgSlug={orgslug}
        deleteCourse={deleteCourse}
        cloneCourse={handleCloneCourse}
        exportCourse={handleExportCourse}
        isDashboard={isDashboard}
      />

      <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, var(--ordria-accent), var(--ordria-accent-secondary))' }} />

      <Link prefetch={false} href={courseLink} onClick={handleCardOpen} className="block relative aspect-video overflow-hidden bg-gray-50">
        {/* Hidden img gives the browser a real resource hint so it can fetch the background-image early as an LCP candidate */}
        {isPriority && (
           
          <img
            src={thumbnailImage}
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            className="absolute w-0 h-0 opacity-0 pointer-events-none"
          />
        )}
        <div
          className="w-full h-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
          style={{ backgroundImage: `url(${thumbnailImage})` }}
        />
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-1 bg-white/90 backdrop-blur-sm rounded-lg text-xs font-semibold shadow-sm">
          {categoryLabel && <span>{categoryLabel}</span>}
        </div>
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
        {isDashboard && (
          <div className="absolute bottom-2 left-2">
            {course.published ? (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-green-100 text-green-700 rounded-full">
                {t('courses.published')}
              </span>
            ) : (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-yellow-100 text-yellow-700 rounded-full">
                {t('courses.unpublished')}
              </span>
            )}
          </div>
        )}
      </Link>

      <div className="p-3 flex flex-col space-y-1.5">
        <div className="flex items-start justify-between">
          <Link
            prefetch={false}
            href={courseLink}
            onClick={handleCardOpen}
            className="text-base font-bold text-[var(--ordria-foreground)] leading-tight hover:text-black transition-colors line-clamp-1"
            style={{ fontFamily: 'var(--font-display, Sora)' }}
          >
            {course.name}
          </Link>
        </div>
        
        {course.description && (
          <p className="text-[11px] text-[var(--ordria-muted)] line-clamp-2 min-h-[1.5rem]">
            {course.description}
          </p>
        )}

        <div className="duo-progress-bar mt-2">
          <div className="duo-progress-fill" style={{ width: `${courseProgress}%` }}></div>
        </div>
        {courseProgress > 0 && (
          <span className="text-[10px] font-bold mt-1" style={{ color: 'var(--ordria-accent-secondary)' }}>{courseProgress}%</span>
        )}

        <div className="pt-1.5 flex items-center gap-2 border-t border-[var(--ordria-border)]">
          {displayedAuthors.length > 0 && (
            <div className="flex -space-x-2 items-center">
              {displayedAuthors.map((author, index) => (
                <div 
                  key={author.user.user_uuid} 
                  className="relative"
                  style={{ zIndex: displayedAuthors.length - index }}
                >
                  <UserAvatar
                    border="border-2"
                    rounded="rounded-full"
                    avatar_url={author.user.avatar_image ? getUserAvatarMediaDirectory(author.user.user_uuid, author.user.avatar_image) : ''}
                    predefined_avatar={author.user.avatar_image ? undefined : 'empty'}
                    width={20}
                    showProfilePopup={true}
                    userId={author.user.id}
                  />
                </div>
              ))}
              {hasMoreAuthors && (
                <div className="relative z-0">
                  <div className="flex items-center justify-center w-[20px] h-[20px] text-[8px] font-bold text-gray-600 bg-gray-100 border-2 border-white rounded-full">
                    +{remainingAuthorsCount}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {course.update_date && (
            <span className="text-[9px] font-bold text-[var(--ordria-muted)] uppercase tracking-widest">
              {new Date(course.update_date).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        
        <Link prefetch={false} href={courseLink} onClick={handleCardOpen} className="block">
          <button className="duo-btn-success w-full mt-2" style={{ height: '40px', fontSize: '13px' }}>
            {t('courses.start_learning')}
          </button>
        </Link>
      </div>
    </div>
  )
}

const AdminEditOptions = ({ course, orgSlug, deleteCourse, cloneCourse, exportCourse, isDashboard = false }: {
  course: Course
  orgSlug: string
  deleteCourse: () => Promise<void>
  cloneCourse: () => Promise<void>
  exportCourse: () => Promise<void>
  isDashboard?: boolean
}) => {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = React.useState(false)
  const [accessOpen, setAccessOpen] = React.useState(false)

  return (
    <AuthenticatedClientElement
      action="update"
      ressourceType="courses"
      checkMethod="roles"
      orgId={course.org_id}
    >
      <div className={`absolute top-2 right-2 z-20 transition-opacity ${
        isDashboard && !isOpen ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'
      }`}>
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <DropdownMenuTrigger asChild>
            <button aria-label="Course actions"className="p-1.5 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-all shadow-md">
              <MoreVertical size={18} className="text-gray-700" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild>
              <Link prefetch={false} href={getUriWithOrg(orgSlug, `/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/content`)} className="flex items-center cursor-pointer">
                <FilePenLine className="mr-2 h-4 w-4" /> {t('courses.edit_content')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link prefetch={false} href={getUriWithOrg(orgSlug, `/dash/courses/course/${removeCoursePrefix(course.course_uuid)}/general`)} className="flex items-center cursor-pointer">
                <Settings2 className="mr-2 h-4 w-4" /> {t('common.settings')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationButtonText={t('courses.clone_course')}
                confirmationMessage={t('courses.clone_course_confirm')}
                dialogTitle={t('courses.clone_course_title', { name: course.name })}
                dialogTrigger={
                  <button className="w-full text-left flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors">
                    <Copy className="mr-2 h-4 w-4" /> {t('courses.clone_course')}
                  </button>
                }
                functionToExecute={cloneCourse}
                status="info"
              />
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <button
                onClick={exportCourse}
                className="w-full text-left flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
              >
                <Download className="mr-2 h-4 w-4" /> {t('courses.export_course')}
              </button>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <button
                onClick={() => setAccessOpen(true)}
                className="w-full text-left flex items-center px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
              >
                <Lock className="mr-2 h-4 w-4" /> {t('library.manage_access')}
              </button>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <ConfirmationModal
                confirmationButtonText={t('courses.delete_course')}
                confirmationMessage={t('courses.delete_course_confirm')}
                dialogTitle={t('courses.delete_course_title', { name: course.name })}
                dialogTrigger={
                  <button className="w-full text-left flex items-center px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-md transition-colors">
                    <BookMinus className="mr-2 h-4 w-4" /> {t('courses.delete_course')}
                  </button>
                }
                functionToExecute={deleteCourse}
                status="warning"
              />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Modal
          isDialogOpen={accessOpen}
          onOpenChange={setAccessOpen}
          minHeight="no-min"
          minWidth="md"
          dialogTitle={t('library.manage_access')}
          dialogContent={
            <ManageAccessPopover
              resource_uuid={course.course_uuid}
              resourceType="courses"
              orgslug={orgSlug}
            />
          }
        />
      </div>
    </AuthenticatedClientElement>
  )
}

export default CourseThumbnail
