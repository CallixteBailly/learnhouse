'use client'

import React from 'react'
import { cn } from '@/lib/utils'

interface AdaptiveVideoShellProps {
  /**
   * Intrinsic aspect ratio of the video (width / height), when known —
   * measured client-side by the player (loadedmetadata) or seeded from the
   * server's HLS metadata. While unknown, the shell falls back to 16:9 so
   * there is never an unbounded/collapsed box.
   */
  aspectRatio?: number | null
  /** Max shell width in px (block size setting: 480/720/960). Undefined = full width. */
  maxWidth?: number
  /** Max shell height as a fraction of the viewport height. Default 75. */
  maxHeightVh?: number
  /** Extra classes on the sized box (rounding, ring…). */
  className?: string
  children: React.ReactNode
}

const DEFAULT_RATIO = 16 / 9
// Clamp degenerate ratios (a 200×2000 sliver must not produce a 10k px box).
const MIN_RATIO = 0.25
const MAX_RATIO = 4

/**
 * Sizes a video box to the video's REAL aspect ratio instead of a fixed 16:9.
 *
 * Width comes first (bounded by the block's size setting and the available
 * column width); if the resulting height would exceed maxHeightVh (portrait
 * videos on mobile especially), the box is height-capped and the width is
 * recomputed to preserve the ratio — so there is never letterboxing, and a
 * 9:16 short never becomes a full-page column.
 *
 * Responsive by construction: a ResizeObserver tracks the available width and
 * the viewport height is re-read on window resize (covers device rotation).
 */
export default function AdaptiveVideoShell({
  aspectRatio,
  maxWidth,
  maxHeightVh = 75,
  className,
  children,
}: AdaptiveVideoShellProps) {
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const [availWidth, setAvailWidth] = React.useState<number | null>(null)
  const [viewportHeight, setViewportHeight] = React.useState<number>(() =>
    typeof window !== 'undefined' ? window.innerHeight : 0
  )

  React.useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      // Border-box width of the observed wrapper (the full content column).
      const w = entries[0]?.contentRect?.width
      if (w && w > 0) setAvailWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const ratio =
    aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0
      ? Math.min(Math.max(aspectRatio, MIN_RATIO), MAX_RATIO)
      : DEFAULT_RATIO

  // Deterministic box: width first, then cap the height and recompute width.
  const maxW = Math.min(maxWidth ?? Number.POSITIVE_INFINITY, availWidth ?? Number.POSITIVE_INFINITY)
  const maxH = ((viewportHeight || 720) * maxHeightVh) / 100
  let width: number = maxW
  let height: number = width / ratio
  if (height > maxH) {
    height = maxH
    width = height * ratio
  }

  // Before the first width measurement, use CSS-only sizing (aspect-ratio from
  // a definite width) so SSR/first paint keeps the previous 16:9 behaviour.
  const style: React.CSSProperties =
    availWidth === null
      ? { width: maxWidth ? `min(100%, ${maxWidth}px)` : '100%', aspectRatio: String(ratio) }
      : { width, height }

  return (
    <div ref={wrapperRef} className="w-full flex justify-center">
      <div style={style} className={cn('relative overflow-hidden bg-black rounded-lg', className)}>
        {children}
      </div>
    </div>
  )
}
