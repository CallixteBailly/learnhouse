'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { useTranslation } from 'react-i18next'
import { useTrail } from '@/hooks/queries/useTrail'
import { useOrg } from '@components/Contexts/OrgContext'
import { Play, ArrowRight, Sparkles, Clock, Bookmark, Mail } from 'lucide-react'

interface LandingClassicProps {
  courses: any[]
  orgslug: string
  org_id: string | number
}

/* ───────────────────────────────────────────────────────────────────────────
   Helpers
   ─────────────────────────────────────────────────────────────────────────── */

function removeCoursePrefix(uuid: string) {
  return uuid?.replace('course_', '')
}

function getThumbnail(course: any, orgUuid?: string) {
  if (course?.thumbnail_image && orgUuid) {
    return getCourseThumbnailMediaDirectory(orgUuid, course.course_uuid, course.thumbnail_image)
  }
  return null
}

/** Parse tags d'un cours → tableau de strings */
function getCourseTags(course: any): string[] {
  const raw = course?.tags
  if (Array.isArray(raw)) return raw.filter(Boolean)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(Boolean) : raw.split(',').map((s) => s.trim()).filter(Boolean)
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return []
}

/** Durée fictive basée sur le nombre d'activités — donne un vibe YouTube */
function getCourseDuration(course: any): string | null {
  const activities =
    (course?.chapters?.reduce((acc: number, ch: any) => acc + (ch?.activities?.length || 0), 0)) || 0
  if (!activities) return null
  // ~8 min par activité en moyenne pédagogique
  const minutes = activities * 8
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m} min`
}

/** Visuel distinctif par métier quand pas de thumbnail image.
 *  Rendu JSX overlay (emoji géant + label) sur gradient signature.
 *  Détecte le métier depuis le nom du cours. */
const METIER_VISUALS: Record<string, { emoji: string; gradient: string; label: string }> = {
  restaurant: { emoji: '🍛', gradient: 'linear-gradient(135deg, oklch(0.62 0.18 35) 0%, oklch(0.40 0.15 30) 100%)', label: 'Restaurateur' },
  barbier: { emoji: '💈', gradient: 'linear-gradient(135deg, oklch(0.45 0.15 350) 0%, oklch(0.28 0.10 350) 100%)', label: 'Barbier' },
  artisan: { emoji: '🔨', gradient: 'linear-gradient(135deg, oklch(0.55 0.12 300) 0%, oklch(0.35 0.10 300) 100%)', label: 'Artisan' },
  garagiste: { emoji: '🔧', gradient: 'linear-gradient(135deg, oklch(0.50 0.13 200) 0%, oklch(0.30 0.10 210) 100%)', label: 'Garagiste' },
  coiffeur: { emoji: '✂️', gradient: 'linear-gradient(135deg, oklch(0.65 0.18 150) 0%, oklch(0.40 0.14 150) 100%)', label: 'Coiffeur' },
  ia: { emoji: '🤖', gradient: 'linear-gradient(135deg, oklch(0.55 0.20 263) 0%, oklch(0.23 0.06 264) 100%)', label: 'IA' },
}

function detectMetier(course: any): { emoji: string; gradient: string; label: string } {
  const name = (course?.name || '').toLowerCase()
  const tags = getCourseTags(course).join(' ').toLowerCase()
  const haystack = `${name} ${tags}`
  for (const [key, vis] of Object.entries(METIER_VISUALS)) {
    if (haystack.includes(key)) return vis
  }
  // défaut — IA cyan signature
  return METIER_VISUALS.ia
}

/** Rendu JSX d'un visuel fallback (emoji + gradient métier) pour une card */
function VisualFallback({ course, size = 'normal' }: { course: any; size?: 'normal' | 'hero' }) {
  const { emoji, gradient, label } = detectMetier(course)
  const emojiSize = size === 'hero' ? '8rem' : '3.5rem'
  const labelSize = size === 'hero' ? '0.95rem' : '0.7rem'
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center"
      style={{ background: gradient }}
      aria-hidden="true"
    >
      <span
        style={{
          fontSize: emojiSize,
          lineHeight: 1,
          filter: 'drop-shadow(0 8px 16px oklch(0 0 0 / 0.3))',
        }}
      >
        {emoji}
      </span>
      <span
        className="font-display font-bold uppercase tracking-widest mt-2 text-white/80"
        style={{ fontSize: labelSize, letterSpacing: '0.15em' }}
      >
        {label}
      </span>
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Section 1 — Hero cinématique 16:9
   Dernier cours publié, autoplay-on-hover (zoom + play)
   ─────────────────────────────────────────────────────────────────────────── */

function HeroFeature({ course, orgslug, orgUuid }: { course: any; orgslug: string; orgUuid?: string }) {
  const { t } = useTranslation()
  const thumb = getThumbnail(course, orgUuid)
  const link = getUriWithOrg(orgslug, `/course/${removeCoursePrefix(course.course_uuid)}`)
  const duration = getCourseDuration(course)

  return (
    <section className="relative" data-section-theme="dark">
      <div className="container-ordria pt-8 pb-12 md:pt-12 md:pb-16">
        <Link href={link} prefetch={false} className="block group">
          <div className="yt-hero shadow-cinematic">
            {/* Media */}
            {thumb ? (
              <div
                className="yt-hero__media"
                style={{ backgroundImage: `url(${thumb})` }}
              />
            ) : (
              <div className="yt-hero__media" style={{ background: detectMetier(course).gradient }}>
                <VisualFallback course={course} size="hero" />
              </div>
            )}
            <div className="yt-hero__overlay" />
            <div className="yt-hero__grain" />

            {/* Top bar — badges */}
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="yt-badge yt-badge--signal">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  Nouveau
                </span>
                {duration && (
                  <span className="yt-badge yt-badge--ghost">
                    <Clock size={11} /> {duration}
                  </span>
                )}
              </div>
              <span className="yt-badge yt-badge--ghost">À la une</span>
            </div>

            {/* Bottom content */}
            <div className="absolute bottom-0 left-0 right-0 p-5 md:p-10">
              <div className="max-w-2xl">
                <h1
                  className="display-ordria text-white"
                  style={{
                    fontSize: 'clamp(1.75rem, 1.2rem + 3vw, 3.25rem)',
                    lineHeight: 1.05,
                    marginBottom: '0.75rem',
                  }}
                >
                  {course.name}
                </h1>
                {course.description && (
                  <p
                    className="text-white/75 max-w-xl"
                    style={{
                      fontFamily: 'var(--ordria-font-body)',
                      fontSize: 'clamp(0.95rem, 0.9rem + 0.3vw, 1.125rem)',
                      lineHeight: 1.5,
                      textWrap: 'pretty',
                    }}
                  >
                    {course.description}
                  </p>
                )}
                <div className="mt-5 flex items-center gap-3">
                  <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--ordria-accent)] text-[var(--ordria-nuit)] font-display font-semibold text-sm transition-transform group-hover:translate-x-1">
                    <Play size={16} fill="currentColor" />
                    {t('courses.start_course', 'Commencer')}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Link>
      </div>
    </section>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Section 2 — Vidéothèque (Video Library)
   Grille chronologique avec filtres par catégorie, hover-to-preview
   ─────────────────────────────────────────────────────────────────────────── */

function VideoLibrary({ courses, orgslug, orgUuid }: { courses: any[]; orgslug: string; orgUuid?: string }) {
  const { t } = useTranslation()
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [shuffling, setShuffling] = useState(false)

  // Construit la liste des catégories depuis les tags
  const categories = useMemo(() => {
    const set = new Set<string>()
    courses.forEach((c) => getCourseTags(c).forEach((tag) => set.add(tag)))
    return ['all', ...Array.from(set).sort()]
  }, [courses])

  const filtered = useMemo(() => {
    if (activeFilter === 'all') return courses
    return courses.filter((c) => getCourseTags(c).includes(activeFilter))
  }, [courses, activeFilter])

  // Animation shuffle au changement de filtre
  useEffect(() => {
    if (activeFilter === 'all') return
    setShuffling(true)
    const id = setTimeout(() => setShuffling(false), 320)
    return () => clearTimeout(id)
  }, [activeFilter])

  return (
    <section className="bg-[var(--ordria-background)]">
      <div className="container-ordria py-12 md:py-20">
        {/* En-tête section */}
        <div className="flex items-end justify-between flex-wrap gap-4 mb-8">
          <div>
            <h2
              className="display-ordria text-[var(--ordria-foreground)]"
              style={{ fontSize: 'clamp(1.5rem, 1.2rem + 1.5vw, 2.25rem)', letterSpacing: '-0.03em' }}
            >
              {t('courses.library_title', 'La vidéothèque')}
            </h2>
            <p className="mt-1 text-[var(--ordria-muted)] text-sm md:text-base" style={{ maxWidth: '52ch' }}>
              {t('courses.library_subtitle', 'Toutes nos formations, triées par métier. Survolez pour voir l\'aperçu.')}
            </p>
          </div>
          <span className="text-[var(--ordria-muted)] text-sm font-display font-semibold">
            {filtered.length} {filtered.length > 1 ? 'formations' : 'formation'}
          </span>
        </div>

        {/* Filtres — chips */}
        {categories.length > 1 && (
          <div
            className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 mb-8"
            style={{ scrollbarWidth: 'none' }}
            role="tablist"
            aria-label={t('courses.filter_by_category', 'Filtrer par catégorie')}
          >
            {categories.map((cat) => (
              <button
                key={cat}
                role="tab"
                aria-pressed={activeFilter === cat}
                aria-selected={activeFilter === cat}
                onClick={() => setActiveFilter(cat)}
                className="yt-chip"
              >
                {cat === 'all' ? t('courses.all_categories', 'Tous') : cat}
              </button>
            ))}
          </div>
        )}

        {/* Grille vidéos */}
        <div
          className={shuffling ? 'yt-shuffle' : ''}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {filtered.map((course) => {
            const thumb = getThumbnail(course, orgUuid)
            const link = getUriWithOrg(orgslug, `/course/${removeCoursePrefix(course.course_uuid)}`)
            const duration = getCourseDuration(course)
            const tags = getCourseTags(course).slice(0, 2)
            return (
              <Link
                key={course.course_uuid}
                href={link}
                prefetch={false}
                className="group block"
                style={{ textDecoration: 'none' }}
              >
                <article>
                  {/* Thumbnail */}
                  <div className="yt-thumb shadow-cinematic">
                    {thumb ? (
                      <div
                        className="yt-thumb__media"
                        style={{ backgroundImage: `url(${thumb})` }}
                      />
                    ) : (
                      <div className="yt-thumb__media" style={{ background: detectMetier(course).gradient }}>
                        <VisualFallback course={course} />
                      </div>
                    )}
                    {/* Top badges */}
                    <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {tags[0] && <span className="yt-badge yt-badge--ghost">{tags[0]}</span>}
                      </div>
                      {duration && <span className="yt-badge yt-badge--ghost">{duration}</span>}
                    </div>
                    {/* Play overlay au hover */}
                    <div className="yt-thumb__play">
                      <div className="yt-thumb__play-ring">
                        <Play size={22} fill="currentColor" />
                      </div>
                    </div>
                  </div>
                  {/* Métadonnées */}
                  <div className="mt-3">
                    <h3
                      className="font-display font-bold text-[var(--ordria-foreground)] leading-snug group-hover:text-[var(--ordria-azur)] transition-colors"
                      style={{ fontSize: '1.0625rem', letterSpacing: '-0.01em' }}
                    >
                      {course.name}
                    </h3>
                    {course.description && (
                      <p
                        className="mt-1 text-[var(--ordria-muted)] text-sm leading-relaxed line-clamp-2"
                        style={{ textWrap: 'pretty' }}
                      >
                        {course.description}
                      </p>
                    )}
                  </div>
                </article>
              </Link>
            )
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16 text-[var(--ordria-muted)]">
            <p className="font-display font-semibold">
              {t('courses.no_courses_in_category', 'Aucune formation dans cette catégorie.')}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Section 3 — Reviews / Deep-dives
   Cours feature en format long "read-along" (sticky thumbnail + texte)
   ─────────────────────────────────────────────────────────────────────────── */

function DeepDives({ courses, orgslug, orgUuid }: { courses: any[]; orgslug: string; orgUuid?: string }) {
  const { t } = useTranslation()
  // Prend les 2 premiers cours avec une description comme "deep dives"
  const featured = courses.filter((c) => c.description).slice(0, 2)
  if (featured.length === 0) return null

  return (
    <section className="bg-white">
      <div className="container-ordria py-12 md:py-20">
        <div className="mb-10">
          <h2
            className="display-ordria text-[var(--ordria-foreground)]"
            style={{ fontSize: 'clamp(1.5rem, 1.2rem + 1.5vw, 2.25rem)', letterSpacing: '-0.03em' }}
          >
            {t('courses.deep_dives_title', 'Les dossiers')}
          </h2>
          <p className="mt-1 text-[var(--ordria-muted)] text-sm md:text-base" style={{ maxWidth: '52ch' }}>
            {t('courses.deep_dives_subtitle', 'Des parcours complets qu\'on prend le temps d\'expliquer. Lancez la formation, lisez le décryptage en parallèle.')}
          </p>
        </div>

        <div className="space-y-12">
          {featured.map((course, idx) => {
            const thumb = getThumbnail(course, orgUuid)
            const link = getUriWithOrg(orgslug, `/course/${removeCoursePrefix(course.course_uuid)}`)
            const duration = getCourseDuration(course)
            const isReversed = idx % 2 === 1
            return (
              <article
                key={course.course_uuid}
                className="grid gap-6 md:gap-12"
                style={{
                  gridTemplateColumns: 'minmax(0, 1fr)',
                }}
              >
                <div
                  className={`grid gap-6 md:gap-12 items-center grid-cols-1 ${isReversed ? 'md:grid-cols-[1fr_1.1fr]' : 'md:grid-cols-[1.1fr_1fr]'}`}
                >
                  {/* Sticky companion — thumbnail */}
                  <div className={isReversed ? 'md:order-2' : ''}>
                    <Link href={link} prefetch={false} className="block group">
                      <div className="yt-sticky-companion">
                        <div className="yt-thumb shadow-cinematic">
                          {thumb ? (
                            <div
                              className="yt-thumb__media"
                              style={{ backgroundImage: `url(${thumb})` }}
                            />
                          ) : (
                            <div className="yt-thumb__media" style={{ background: detectMetier(course).gradient }}>
                              <VisualFallback course={course} size="hero" />
                            </div>
                          )}
                          <div className="absolute top-2.5 left-2.5">
                            <span className="yt-badge yt-badge--neon">
                              <Sparkles size={11} /> Pick
                            </span>
                          </div>
                          {duration && (
                            <div className="absolute bottom-2.5 right-2.5">
                              <span className="yt-badge yt-badge--ghost">{duration}</span>
                            </div>
                          )}
                          <div className="yt-thumb__play">
                            <div className="yt-thumb__play-ring">
                              <Play size={22} fill="currentColor" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>

                  {/* Texte long */}
                  <div className={isReversed ? 'md:order-1' : ''}>
                    <span className="font-display text-xs font-bold uppercase tracking-wider text-[var(--ordria-azur)]">
                      {t('courses.deep_dive_label', 'Décryptage')} · {String(idx + 1).padStart(2, '0')}
                    </span>
                    <h3
                      className="display-ordria text-[var(--ordria-foreground)] mt-3"
                      style={{ fontSize: 'clamp(1.5rem, 1.2rem + 1.2vw, 2rem)', letterSpacing: '-0.025em', lineHeight: 1.1 }}
                    >
                      {course.name}
                    </h3>
                    <p
                      className="mt-4 text-[var(--ordria-foreground)] leading-relaxed"
                      style={{ fontFamily: 'var(--ordria-font-body)', fontSize: '1.0625rem', maxWidth: '52ch', textWrap: 'pretty' }}
                    >
                      {course.description}
                    </p>
                    <Link
                      href={link}
                      prefetch={false}
                      className="mt-6 inline-flex items-center gap-2 font-display font-semibold text-sm text-[var(--ordria-foreground)] hover:text-[var(--ordria-azur)] transition-colors link-underline-ordria"
                    >
                      {t('courses.read_and_watch', 'Lire et regarder')}
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Section 4 — Recommandations "Par où commencer"
   Cards curatoriales avec badge Débutant / Premium / Pick
   ─────────────────────────────────────────────────────────────────────────── */

function Recommendations({ courses, orgslug, orgUuid }: { courses: any[]; orgslug: string; orgUuid?: string }) {
  const { t } = useTranslation()
  // Prend 3 cours, attribue un badge curatoriale
  const picks = courses.slice(0, 3)
  if (picks.length === 0) return null

  const pickLabels = [
    { badge: 'yt-badge--accent', label: t('courses.pick_beginner', 'Débutant') },
    { badge: 'yt-badge--neon', label: t('courses.pick_favorite', 'Coup de cœur') },
    { badge: 'yt-badge--signal', label: t('courses.pick_advanced', 'Avancé') },
  ]

  return (
    <section className="bg-[var(--ordria-background)]">
      <div className="container-ordria py-12 md:py-20">
        <div className="mb-10 max-w-2xl">
          <h2
            className="display-ordria text-[var(--ordria-foreground)]"
            style={{ fontSize: 'clamp(1.5rem, 1.2rem + 1.5vw, 2.25rem)', letterSpacing: '-0.03em' }}
          >
            {t('courses.recommendations_title', 'Par où commencer')}
          </h2>
          <p className="mt-2 text-[var(--ordria-muted)] text-base md:text-lg" style={{ maxWidth: '52ch', textWrap: 'pretty' }}>
            {t('courses.recommendations_subtitle', 'Trois choix sûrs pour démarrer — selon votre niveau et votre métier.')}
          </p>
        </div>

        <div
          className="grid gap-5"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
        >
          {picks.map((course, idx) => {
            const thumb = getThumbnail(course, orgUuid)
            const link = getUriWithOrg(orgslug, `/course/${removeCoursePrefix(course.course_uuid)}`)
            const pick = pickLabels[idx % pickLabels.length]
            return (
              <Link key={course.course_uuid} href={link} prefetch={false} className="group" style={{ textDecoration: 'none' }}>
                <article className="h-full card-ordria" style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="yt-thumb" style={{ borderRadius: 0, boxShadow: 'none' }}>
                    {thumb ? (
                      <div
                        className="yt-thumb__media"
                        style={{ backgroundImage: `url(${thumb})` }}
                      />
                    ) : (
                      <div className="yt-thumb__media" style={{ background: detectMetier(course).gradient }}>
                        <VisualFallback course={course} />
                      </div>
                    )}
                    <div className="absolute top-2.5 left-2.5">
                      <span className={`yt-badge ${pick.badge}`}>{pick.label}</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3
                      className="font-display font-bold text-[var(--ordria-foreground)] leading-snug"
                      style={{ fontSize: '1rem', letterSpacing: '-0.01em' }}
                    >
                      {course.name}
                    </h3>
                    <p className="mt-1 text-[var(--ordria-muted)] text-xs line-clamp-2">
                      {course.description || t('courses.default_pick_desc', 'Notre recommandation pour démarrer.')}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1.5 font-display font-semibold text-xs text-[var(--ordria-azur)]">
                      {t('courses.start_here', 'Commencer ici')}
                      <ArrowRight size={12} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </article>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Section 5 — Newsletter
   Input avec placeholder typewriter qui cycle les pitches
   ─────────────────────────────────────────────────────────────────────────── */

const NEWSLETTER_PITCHES = [
  'Nouvelles formations chaque mois…',
  'Conseils pratiques pour votre métier…',
  'Offres exclusives abonnés…',
  'Webinaires en direct…',
]

function Newsletter() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pitchIdx, setPitchIdx] = useState(0)
  const [typed, setTyped] = useState('')
  const [isTyping, setIsTyping] = useState(true)
  const timeoutsRef = useRef<NodeJS.Timeout[]>([])

  // Typewriter effect qui cycle les pitches
  useEffect(() => {
    if (email) {
      setTyped('')
      return
    }
    const pitch = NEWSLETTER_PITCHES[pitchIdx]
    let charIdx = 0
    setIsTyping(true)
    setTyped('')

    const typeInterval = setInterval(() => {
      charIdx++
      setTyped(pitch.slice(0, charIdx))
      if (charIdx >= pitch.length) {
        clearInterval(typeInterval)
        setIsTyping(false)
        // Pause puis efface puis passe au suivant
        const pause = setTimeout(() => {
          const eraseInterval = setInterval(() => {
            charIdx--
            setTyped(pitch.slice(0, charIdx))
            if (charIdx <= 0) {
              clearInterval(eraseInterval)
              setPitchIdx((i) => (i + 1) % NEWSLETTER_PITCHES.length)
            }
          }, 30)
          timeoutsRef.current.push(eraseInterval as unknown as NodeJS.Timeout)
        }, 2200)
        timeoutsRef.current.push(pause)
      }
    }, 55)
    timeoutsRef.current.push(typeInterval as unknown as NodeJS.Timeout)

    return () => {
      timeoutsRef.current.forEach(clearTimeout)
      timeoutsRef.current = []
    }
  }, [pitchIdx, email])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setSubmitted(true)
  }

  return (
    <section className="bg-[var(--ordria-nuit)] text-white relative overflow-hidden">
      {/* Cyan glow */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 0%, oklch(0.80 0.13 213 / 0.18), transparent 60%)',
        }}
      />
      <div className="container-ordria relative py-16 md:py-24">
        <div className="max-w-2xl mx-auto text-center">
          <span className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-wider text-[var(--ordria-accent-hover)]">
            <Mail size={14} aria-hidden="true" /> Newsletter
          </span>
          <h2
            className="display-ordria mt-4"
            style={{ fontSize: 'clamp(1.75rem, 1.3rem + 2.2vw, 2.75rem)', letterSpacing: '-0.03em', lineHeight: 1.1 }}
          >
            {t('courses.newsletter_title', 'Une boîte mail, du concret.')}
          </h2>
          <p className="mt-3 text-white/70 text-base md:text-lg" style={{ maxWidth: '48ch', marginInline: 'auto', textWrap: 'pretty' }}>
            {t('courses.newsletter_subtitle', 'Pas de spam. Du contenu utile pour exploiter l\'IA dans votre métier. Désinscription en un clic.')}
          </p>

          {submitted ? (
            <div className="mt-8 inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-white/10 border border-white/15">
              <span className="w-2 h-2 rounded-full bg-[var(--ordria-accent)]" />
              <span className="font-display font-semibold text-sm">
                {t('courses.newsletter_thanks', 'Merci ! Vérifiez votre boîte mail pour confirmer.')}
              </span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 max-w-md mx-auto">
              <div className="flex items-end gap-3 border-b-2 border-white/20 focus-within:border-[var(--ordria-accent)] transition-colors pb-1">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={email ? '' : typed + (isTyping ? '▌' : '')}
                  className="flex-1 bg-transparent border-0 py-3 text-white text-lg font-body placeholder:text-white/50 focus:outline-none"
                  aria-label={t('courses.newsletter_email_label', 'Votre adresse email')}
                />
                <button
                  type="submit"
                  className="mb-1 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--ordria-accent)] text-[var(--ordria-nuit)] font-display font-semibold text-sm transition-transform hover:translate-x-0.5"
                >
                  {t('courses.newsletter_cta', 'Je m\'inscris')}
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Composant racine — LandingClassic
   ─────────────────────────────────────────────────────────────────────────── */

function LandingClassic({ courses, orgslug, org_id }: LandingClassicProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const orgUuid = org?.org_uuid

  const safeCourses = courses || []
  const latestCourse = safeCourses[0]
  const libraryCourses = safeCourses.slice(1)

  return (
    <div className="w-full bg-[var(--ordria-background)]">
      {/* Section 1 — Hero (dernier cours) */}
      {latestCourse && <HeroFeature course={latestCourse} orgslug={orgslug} orgUuid={orgUuid} />}

      {/* Section 2 — Vidéothèque (les autres cours) */}
      {libraryCourses.length > 0 && (
        <VideoLibrary courses={libraryCourses} orgslug={orgslug} orgUuid={orgUuid} />
      )}

      {/* Si un seul cours, on le montre quand même dans la library */}
      {safeCourses.length === 1 && (
        <VideoLibrary courses={safeCourses} orgslug={orgslug} orgUuid={orgUuid} />
      )}

      {/* Section 3 — Deep dives */}
      <DeepDives courses={safeCourses} orgslug={orgslug} orgUuid={orgUuid} />

      {/* Section 4 — Recommandations */}
      <Recommendations courses={safeCourses} orgslug={orgslug} orgUuid={orgUuid} />

      {/* Section 5 — Newsletter */}
      <Newsletter />
    </div>
  )
}

export default LandingClassic
