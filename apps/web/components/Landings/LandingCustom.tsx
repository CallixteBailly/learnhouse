'use client'

import React from 'react'
import { LandingSection, LandingBackground, LandingStatItem, LandingButton } from '@components/Dashboard/Pages/Org/OrgEditLanding/landing_types'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getOrgCourses } from '@services/courses/courses'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import CourseThumbnailLanding from '@components/Objects/Thumbnails/CourseThumbnailLanding'
import UserAvatar from '@components/Objects/UserAvatar'
import { useTranslation } from 'react-i18next'

interface LandingCustomProps {
  landing: {
    sections: LandingSection[]
    enabled: boolean
  }
  orgslug: string
}

const HEX_COLOR = /^#?([0-9a-f]{6})$/i

// Light/dark helper: picks the ring + shadow treatment for a card from its
// background colors, so dark gradient panels and white cards both sit right.
function isDarkBackground(bg?: LandingBackground): boolean {
  if (!bg) return false
  const hexes = bg.type === 'gradient' ? bg.colors || [] : bg.color ? [bg.color] : []
  if (!hexes.length) return false
  let r = 0, g = 0, b = 0, n = 0
  for (const c of hexes) {
    const m = c.replace(/ /g, '').match(HEX_COLOR)
    if (!m) continue
    r += parseInt(m[1].slice(0, 2), 16)
    g += parseInt(m[1].slice(2, 4), 16)
    b += parseInt(m[1].slice(4, 6), 16)
    n++
  }
  if (!n) return false
  return (r / n) * 0.299 + (g / n) * 0.587 + (b / n) * 0.114 < 128
}

function LandingCustom({ landing, orgslug }: LandingCustomProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  // Fetch all courses for the organization
  const { data: allCourses } = useQuery({
    queryKey: queryKeys.courses.list(orgslug),
    queryFn: () => getOrgCourses(orgslug, null, access_token),
    enabled: !!orgslug,
    staleTime: 60_000,
  })

  // Optional section background (solid/gradient) as a CSSProperties object.
  // Undefined for absent config so callers keep their default look.
  const bgStyle = (bg?: LandingBackground): React.CSSProperties | undefined => {
    if (!bg) return undefined
    const background =
      bg.type === 'gradient'
        ? `linear-gradient(${bg.direction || '135deg'}, ${(bg.colors || []).join(', ')})`
        : bg.color
    return background ? { background } : undefined
  }

  // Pill button shared by every section · solid = filled, ghost = outlined.
  // The engine owns the type scale and the motion; config only sets colors.
  const renderButton = (button: LandingButton, index: number) => (
    <a
      key={index}
      href={button.link}
      className={`group inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 sm:w-auto ${
        button.variant === 'ghost'
          ? 'border hover:bg-white/10'
          : 'shadow-[0_1px_2px_rgba(20,22,27,0.2)] hover:shadow-[0_10px_28px_-8px_rgba(20,22,27,0.45)]'
      }`}
      style={
        button.variant === 'ghost'
          ? { color: button.color, borderColor: `${button.color}55`, background: 'transparent' }
          : { backgroundColor: button.background, color: button.color }
      }
    >
      {button.text}
      <span className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden>→</span>
    </a>
  )

  // Body copy renderer · paragraphs split on blank lines render as a feature
  // grid (3+ items), "Lead · rest" lines get the lead emphasized in accent.
  const renderBody = (text: string, textColor: string, accentColor: string) => {
    const paragraphs = text.split(/\n\s*\n/).filter(Boolean)
    const gridded = paragraphs.length >= 3
    return (
      <div className={`${gridded ? 'grid gap-x-10 gap-y-7 sm:grid-cols-2' : ''} max-w-none`}>
        {paragraphs.map((p, i) => {
          const sep = p.indexOf('·')
          const lead = sep > 0 ? p.slice(0, sep).trim() : null
          const rest = lead ? p.slice(sep + 1).trim() : p
          return (
            <p key={i} className="text-[0.95rem] leading-relaxed sm:text-base" style={{ color: textColor }}>
              {lead && (
                <>
                  <strong className="font-bold" style={{ color: accentColor }}>{lead}</strong>
                  {' · '}
                </>
              )}
              {rest}
            </p>
          )
        })}
      </div>
    )
  }

  // Stat cells shared by the hero band and the standalone stats section.
  const renderStats = (items: LandingStatItem[], labelColor: string, withDividers: boolean) => (
    <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
      {items.map((item, index) => (
        <div
          key={index}
          className={`flex flex-col items-center text-center ${withDividers && index > 0 ? 'lg:border-l lg:border-l-[#e3c76638] lg:pl-6' : ''}`}
        >
          <span
            className="text-4xl font-extrabold tabular-nums tracking-[-0.02em] sm:text-[2.75rem]"
            style={{ color: item.valueColor || '#c9a227' }}
          >
            {item.value}
          </span>
          <span className="mt-1.5 text-sm font-medium" style={{ color: labelColor }}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )

  const renderSection = (section: LandingSection) => {
    switch (section.type) {
      case 'hero': {
        const heroCols = {
          small: 'lg:grid-cols-[1.35fr_0.65fr]',
          medium: 'lg:grid-cols-[1.2fr_0.8fr]',
          large: 'lg:grid-cols-[1.05fr_0.95fr]',
        }[section.illustration?.size || 'large']

        const illustration = section.illustration?.image?.url ? (
          <div className={`flex items-center justify-center ${section.illustration?.position === 'left' ? 'lg:order-first' : 'lg:order-last'}`}>
            <img
              src={section.illustration!.image.url}
              alt={section.illustration!.image.alt}
              fetchPriority="high"
              decoding="async"
              className="landing-float w-full max-w-[560px] object-contain drop-shadow-[0_28px_44px_rgba(0,0,0,0.5)]"
            />
          </div>
        ) : null

        return (
          <div
            key={`hero-${section.title}`}
            className="relative mt-4 w-full overflow-hidden rounded-2xl px-6 pt-12 ring-1 ring-[#c9a227]/20 sm:mt-8 sm:px-12 sm:pt-16"
            style={bgStyle(section.background)}
          >
            <div className={`grid w-full items-center gap-10 pb-12 sm:pb-16 ${illustration ? heroCols : ''}`}>
              <div className={`flex flex-col ${section.contentAlign === 'center' ? 'items-center text-center' : 'items-start text-left'}`}>
                {section.badge?.text && (
                  <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#e3c76659] bg-[#c9a2271f] px-3.5 py-1.5 text-xs font-semibold tracking-wide text-[#e3c766]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#c9a227]" aria-hidden />
                    {section.badge.text}
                  </span>
                )}
                <h1
                  className="max-w-xl text-[1.9rem] font-extrabold leading-[1.06] tracking-[-0.03em] sm:text-4xl lg:text-[3.4rem]"
                  style={{ color: section.heading.color }}
                >
                  {section.heading.text}
                </h1>
                {section.subheading.text && (
                  <p
                    className="mt-4 max-w-xl text-[0.95rem] leading-relaxed sm:text-lg"
                    style={{ color: section.subheading.color }}
                  >
                    {section.subheading.text}
                  </p>
                )}
                {section.buttons.length > 0 && (
                  <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                    {section.buttons.map(renderButton)}
                  </div>
                )}
              </div>
              {illustration}
            </div>
            {section.stats && section.stats.length > 0 && (
              <div className="border-t border-[#e3c76638] py-8 sm:py-10">
                {renderStats(section.stats, section.statLabelColor || 'rgba(255,255,255,0.72)', true)}
              </div>
            )}
          </div>
        )
      }
      case 'text-and-image': {
        const dark = isDarkBackground(section.background)
        const centered = section.align === 'center'
        const image = section.image?.url ? (
          <div className="flex items-center justify-center">
            {section.image.fit === 'contain' ? (
              <div className="w-full max-w-[380px] rounded-xl bg-white p-5 shadow-[0_2px_10px_rgba(20,22,27,0.12)]">
                <img src={section.image.url} alt={section.image.alt} loading="lazy" decoding="async" className="h-auto w-full object-contain" />
              </div>
            ) : (
              <div className="group relative w-full max-w-[440px] overflow-hidden rounded-xl ring-1 ring-black/10">
                <img
                  src={section.image.url}
                  alt={section.image.alt}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[3/4] w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.025]"
                />
              </div>
            )}
          </div>
        ) : null

        return (
          <div key={`text-image-${section.title}`} className="w-full">
            <div
              className={`flex flex-col gap-10 md:flex-row md:gap-14 ${
                section.flow === 'right' ? 'md:flex-row-reverse' : ''
              } ${section.background ? 'rounded-2xl p-7 sm:p-10 lg:p-12' : ''} ${
                section.background
                  ? dark
                    ? 'ring-1 ring-white/10 shadow-[0_24px_60px_-32px_rgba(0,0,0,0.6)]'
                    : 'ring-1 ring-black/[0.06] shadow-[0_2px_8px_rgba(30,33,40,0.05),0_28px_56px_-32px_rgba(30,33,40,0.25)]'
                  : ''
              } ${centered ? 'items-center' : ''}`}
              style={bgStyle(section.background)}
            >
              <div className={`flex-1 ${centered ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}`}>
                <h2
                  className={`text-2xl font-extrabold leading-tight tracking-[-0.02em] sm:text-[2rem] ${centered ? 'sm:text-4xl' : ''}`}
                  style={{ color: section.titleColor || (dark ? '#ffffff' : '#1e2128') }}
                >
                  {section.title}
                </h2>
                <div className={`mt-5 ${centered ? '' : 'sm:mt-6'}`}>
                  {renderBody(
                    section.text,
                    section.textColor || (dark ? 'rgba(255,255,255,0.82)' : '#57606b'),
                    dark ? '#e3c766' : '#c9a227'
                  )}
                </div>
                {section.buttons?.length > 0 && (
                  <div className={`mt-8 flex flex-wrap gap-3 ${centered ? 'justify-center' : ''}`}>
                    {section.buttons.map(renderButton)}
                  </div>
                )}
              </div>
              {image}
            </div>
          </div>
        )
      }
      case 'stats':
        return (
          <div
            key={`stats-${section.title || section.items.map(i => i.value).join('-')}`}
            className="w-full rounded-2xl px-6 py-12 ring-1 ring-white/10 sm:px-12 sm:py-14"
            style={bgStyle(section.background)}
          >
            {section.title && (
              <h2
                className="mb-10 text-center text-2xl font-extrabold tracking-[-0.02em] sm:text-3xl"
                style={{ color: section.labelColor || '#f3e6bf' }}
              >
                {section.title}
              </h2>
            )}
            <div className="mx-auto max-w-5xl">
              {renderStats(section.items, section.labelColor || 'rgba(255,255,255,0.75)', false)}
            </div>
          </div>
        )
      case 'logos':
        return (
          <div
            key={`logos-${section.title}`}
            className="w-full rounded-2xl px-6 py-12 sm:px-12 sm:py-16"
            style={bgStyle(section.background)}
          >
            {section.title && (
              <h2 className="text-center text-2xl font-extrabold tracking-[-0.02em] text-[#1e2128] sm:text-3xl">
                {section.title}
              </h2>
            )}
            {section.subtitle && (
              <p className="mx-auto mt-4 max-w-2xl px-2 text-center text-[0.95rem] leading-relaxed text-[#57606b]">
                {section.subtitle}
              </p>
            )}
            <div className="mt-10 flex justify-center">
              <div className="flex max-w-5xl flex-wrap items-center justify-center gap-x-10 gap-y-8 sm:gap-x-14">
                {section.logos.map((logo, index) => (
                  <div key={index} className="flex h-16 w-[128px] items-center justify-center sm:w-[150px]">
                    <img
                      src={logo.url}
                      alt={logo.alt}
                      loading="lazy"
                      decoding="async"
                      className="h-10 w-auto max-w-[140px] object-contain opacity-65 transition-opacity duration-200 hover:opacity-100 sm:h-11"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      case 'people':
        return (
          <div key={`people-${section.title}`} className="w-full py-16">
            <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-[#1e2128] sm:text-3xl">{section.title}</h2>
            <div className="mt-10 flex flex-wrap justify-center gap-x-20 gap-y-8">
              {section.people.map((person, index) => (
                <div key={index} className="w-[140px] flex flex-col items-center">
                  <div className="w-24 h-24 mb-4">
                    {person.username ? (
                      <UserAvatar
                        username={person.username}
                        width={96}
                        rounded="rounded-full"
                        border="border-4"
                        showProfilePopup
                      />
                    ) : (
                      <img
                        src={person.image_url}
                        alt={person.name}
                        className="w-full h-full rounded-full object-cover border-4 border-white nice-shadow"
                      />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-center text-gray-900">{person.name}</h3>
                  <p className="text-sm text-center text-gray-600 mt-1">{person.description}</p>
                </div>
              ))}
            </div>
          </div>
        )
      case 'featured-courses':
        if (!allCourses) {
          return (
            <div key={`featured-courses-${section.title}`} className="w-full py-16">
              <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-[#1e2128] sm:text-3xl">{section.title}</h2>
              <div className="mt-6 text-center py-6 text-gray-500">{t('courses.loading_courses')}</div>
            </div>
          )
        }

        const featuredCourses = allCourses.filter((course: any) =>
          section.courses.includes(course.course_uuid)
        )

        return (
          <div key={`featured-courses-${section.title}`} className="w-full py-16">
            <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-[#1e2128] sm:text-3xl">{section.title}</h2>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 w-full">
              {featuredCourses.map((course: any) => (
                <div key={course.course_uuid} className="w-full flex justify-center">
                  <CourseThumbnailLanding
                    course={course}
                    orgslug={orgslug}
                  />
                </div>
              ))}
              {featuredCourses.length === 0 && (
                <div className="col-span-full text-center py-6 text-gray-500">
                  {t('courses.no_featured_courses')}
                </div>
              )}
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="landing-custom mx-auto flex w-full max-w-[1180px] flex-col gap-10 px-3 sm:gap-14 sm:px-6">
      {landing.sections.map((section) => renderSection(section))}
    </div>
  )
}

export default LandingCustom
