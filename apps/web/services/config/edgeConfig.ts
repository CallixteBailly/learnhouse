/**
 * Edge-safe configuration subset — used by `middleware.ts` (Edge runtime).
 *
 * IMPORTANT: the middleware must NOT import `./config` — that module reads
 * runtime-config.json through fs/path/process.cwd, and Turbopack fails the
 * Edge bundle on any statically visible Node API. This module only reads
 * build-time-inlined `process.env.NEXT_PUBLIC_*` values, which is exactly
 * what the middleware needs (it runs before any runtime config exists).
 */

/** Mirrors getAPIUrl() from ./config for the server/Edge context (no window). */
export const getEdgeAPIUrl = (): string => {
  const explicitApiUrl = process.env.NEXT_PUBLIC_LEARNHOUSE_API_URL
  if (explicitApiUrl) return explicitApiUrl

  const backendUrl = (process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL || 'http://localhost/').replace(/\/+$/, '')
  return `${backendUrl}/api/v1/`
}
