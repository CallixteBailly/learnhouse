'use client'

import Link from 'next/link'
import React from 'react'

/**
 * Logo Ordria Learning — monogramme « O concentrique + point cyan »
 * Charte : 2 cercles concentriques Bleu Nuit (alignement, harmonie)
 * + accent Cyan Éclat en haut-droite (le conseil qui fait grandir).
 * Porté depuis src/components/Logo.astro du marketing Ordria.
 *
 * Variantes :
 *   - variant="mark"    → juste le monogramme O (favicon, header compact)
 *   - variant="lockup"  → monogramme + texte "Ordria Learning"
 *
 * Tons :
 *   - tone="light"  → texte blanc (sur fond Bleu Nuit / sombre)
 *   - tone="dark"   → texte Bleu Nuit (sur fond clair, défaut)
 */

type LogoSize = 'sm' | 'md' | 'lg' | 'xl' | number

export interface LogoProps {
  variant?: 'mark' | 'lockup'
  size?: LogoSize
  tone?: 'light' | 'dark'
  animated?: boolean
  href?: string
  showText?: boolean
  className?: string
  /** Suffixe après "Ordria" — défaut "Learning" */
  suffix?: string
  /** Accessibilité — si non fourni, utilise le suffixe */
  ariaLabel?: string
  /** Style inline (ex: filter pour header sticky) */
  style?: React.CSSProperties
}

const SIZE_MAP: Record<'sm' | 'md' | 'lg' | 'xl', { mark: string; text: string }> = {
  sm: { mark: '18px', text: '0.95rem' },
  md: { mark: '24px', text: '1.15rem' },
  lg: { mark: '34px', text: '1.5rem' },
  xl: { mark: '56px', text: '2.25rem' },
}

function resolveSize(size: LogoSize): { mark: string; text: string } {
  if (typeof size === 'number') return { mark: `${size}px`, text: `${size * 0.85}px` }
  return SIZE_MAP[size]
}

/**
 * Le monogramme « O » — SVG inline pour pouvoir hériter de `currentColor`
 * et animer le point cyan.
 */
const LogoMark = React.memo(function LogoMark({
  size,
  animated = false,
}: {
  size: string
  animated?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'relative',
        display: 'block',
        flexShrink: 0,
        width: size,
        height: size,
        minWidth: '18px',
        minHeight: '18px',
        overflow: 'visible',
        contain: 'layout style',
      }}
    >
      <svg
        viewBox="0 0 40 40"
        fill="none"
        role="img"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          display: 'block',
        }}
      >
        {/* Anneau extérieur — Bleu Nuit (currentColor) */}
        <circle cx="20" cy="20" r="17" stroke="currentColor" strokeWidth="3.4" fill="none" />
        {/* Anneau intérieur concentrique — plus fin */}
        <circle cx="20" cy="20" r="9.5" stroke="currentColor" strokeWidth="2.4" fill="none" />
        {/* Accent progression — Cyan Éclat, haut-droite */}
        <circle
          className={animated ? 'ordria-logo-progress' : undefined}
          cx="31.5"
          cy="8.5"
          r="2.8"
          fill="var(--ordria-accent)"
          style={
            animated
              ? { transformOrigin: '31.5px 8.5px', animation: 'ordria-logo-pulse 3.6s ease-in-out infinite' }
              : undefined
          }
        />
      </svg>
    </span>
  )
})

export default function Logo({
  variant = 'lockup',
  size = 'md',
  tone = 'dark',
  animated = false,
  href,
  showText = true,
  className = '',
  suffix = 'Learning',
  ariaLabel,
  style,
}: LogoProps): React.ReactNode {
  const { mark: markSize, text: textSize } = resolveSize(size)
  const text = suffix ? `Ordria ${suffix}` : 'Ordria'
  const colorClass = tone === 'light' ? 'text-white' : 'text-[var(--ordria-foreground)]'
  const label = ariaLabel || text

  const content = (
    <span
      className={`ordria-logo-wordmark ${colorClass} ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.42em',
        fontFamily: 'var(--ordria-font-display, Sora, system-ui, sans-serif)',
        fontWeight: 700,
        letterSpacing: '-0.03em',
        lineHeight: 1,
        fontSize: textSize,
        textDecoration: 'none',
        ...style,
      }}
      aria-label={label}
    >
      <LogoMark size={markSize} animated={animated} />
      {variant === 'lockup' && showText && (
        <>
          <span className="sr-only">{label}</span>
          <span
            aria-hidden="true"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25em' }}
          >
            <span>Ordria</span>
            {suffix && (
              <span
                style={{
                  fontWeight: 500,
                  color: tone === 'light' ? 'oklch(0.86 0.015 264)' : 'var(--ordria-muted)',
                  letterSpacing: '-0.02em',
                }}
              >
                {suffix}
              </span>
            )}
          </span>
        </>
      )}
      {variant === 'mark' && <span className="sr-only">{label}</span>}
    </span>
  )

  if (href) {
    return (
      <Link href={href} aria-label={label} className="inline-flex no-underline">
        {content}
      </Link>
    )
  }

  return content
}

/**
 * Styles globaux à injecter une fois — animation du point cyan.
 * À appeler dans le layout racine, OU via le <style> ci-dessous.
 */
export const LogoStyles = () => (
  <style>{`
    @keyframes ordria-logo-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.72; transform: scale(0.88); }
    }
    @media (prefers-reduced-motion: reduce) {
      .ordria-logo-progress {
        animation: none !important;
      }
    }
  `}</style>
)
