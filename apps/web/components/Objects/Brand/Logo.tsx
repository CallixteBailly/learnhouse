'use client'

import Link from 'next/link'
import React from 'react'

/**
 * Logo Ordria — charte « Rendu Ordria » (sept. 2026)
 * Icône : cadre déconstruit (6 rectangles arrondis) — « mettre de l'ordre ».
 * Wordmark : ORDRIA en Expose (typo de logo de la charte).
 * Baseline : « Mettre de l'ordre, simplement ».
 *
 * Variantes :
 *   - variant="mark"    → symbole seul (bleu charte #3b65ff)
 *   - variant="lockup"  → symbole + wordmark « ORDRIA » (+ suffixe optionnel)
 *
 * Tons :
 *   - tone="dark"  → wordmark noir #1d1d1b (fond clair, défaut)
 *   - tone="light" → wordmark blanc cassé #f7f9f9 (fond sombre)
 *
 * Les lockups vectoriels officiels (12 variantes) sont servis depuis
 * /brands/ordria/ pour les usages hors composant (emails, print…).
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
  /** Suffixe optionnel après « ORDRIA » (rendu en Satoshi, plus discret) */
  suffix?: string
  /** Accessibilité — si non fourni, utilise « Ordria Learning » */
  ariaLabel?: string
  /** Style inline (ex: filter pour header sticky) */
  style?: React.CSSProperties
}

const SIZE_MAP: Record<'sm' | 'md' | 'lg' | 'xl', number> = {
  sm: 20,
  md: 26,
  lg: 36,
  xl: 56,
}

function resolveSize(size: LogoSize): number {
  if (typeof size === 'number') return size
  return SIZE_MAP[size]
}

/** Ratio largeur/hauteur du symbole officiel (viewBox 254.28 × 214.38) */
const MARK_ASPECT = 254.28 / 214.38

/**
 * Le symbole — géométrie exacte du logo livré (Fichier 6, monochrome),
 * colorée en bleu charte via var(--ordria-accent) = #3b65ff.
 */
const LogoMark = React.memo(function LogoMark({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 254.28 214.38"
      fill="var(--ordria-accent, #3b65ff)"
      role="img"
      aria-hidden="true"
      style={{
        display: 'block',
        flexShrink: 0,
        width: `${size * MARK_ASPECT}px`,
        height: `${size}px`,
        minWidth: `${18 * MARK_ASPECT}px`,
        minHeight: '18px',
      }}
    >
      <rect x="0" y="77.82" width="55.25" height="136.56" rx=".85" ry=".85" />
      <rect x="199.03" y="0" width="55.25" height="136.56" rx=".85" ry=".85" />
      <rect x="29.29" y="157.46" width="55.25" height="58.58" rx=".85" ry=".85" transform="translate(-129.83 243.67) rotate(-90)" />
      <rect x="169.66" y="-1.59" width="55.25" height="58.43" rx=".85" ry=".85" transform="translate(169.66 224.92) rotate(-90)" />
      <rect x="153.9" y="114" width="55.25" height="145.51" rx=".85" ry=".85" transform="translate(-5.22 368.28) rotate(-90)" />
      <rect x="45.13" y="-45.13" width="55.25" height="145.51" rx=".85" ry=".85" transform="translate(45.13 100.38) rotate(-90)" />
    </svg>
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
  suffix,
  ariaLabel,
  style,
}: LogoProps): React.ReactNode {
  void animated // l'icône charte est statique — prop conservée pour compat
  const markSize = resolveSize(size)
  const textColor = tone === 'light' ? '#f7f9f9' : 'var(--ordria-foreground, #1d1d1b)'
  const label = ariaLabel || 'Ordria Learning'

  const content = (
    <span
      className={`ordria-logo-wordmark ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${markSize * 0.3}px`,
        lineHeight: 1,
        textDecoration: 'none',
        ...style,
      }}
      aria-label={label}
    >
      <LogoMark size={markSize} />
      {variant === 'lockup' && showText && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: `${markSize * 0.18}px`,
            fontFamily: 'var(--font-expose, var(--ordria-font-display, sans-serif))',
            fontWeight: 700,
            letterSpacing: '0.04em',
            fontSize: `${markSize * 0.62}px`,
            color: textColor,
          }}
        >
          <span style={{ textTransform: 'uppercase' }}>Ordria</span>
          {suffix && (
            <span
              style={{
                fontFamily: 'var(--font-default, sans-serif)',
                fontWeight: 500,
                textTransform: 'none',
                letterSpacing: '0.01em',
                fontSize: `${markSize * 0.5}px`,
                color: tone === 'light' ? 'rgba(247, 249, 249, 0.72)' : 'var(--ordria-muted, #6b7280)',
              }}
            >
              {suffix}
            </span>
          )}
        </span>
      )}
      <span className="sr-only">{label}</span>
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
