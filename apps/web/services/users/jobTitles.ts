import { getAPIUrl } from '@services/config/config'
import { secureFetch } from '@services/utils/ts/requests'

export interface JobTitle {
  id: number
  label: string
  slug: string
  is_active: boolean
  sort_order: number
}

/**
 * Fetch the public list of job titles (GET /api/v1/job-titles/public).
 *
 * Called from the signup form (client-side useEffect), so this is a plain
 * async function — no 'use server' — matching the other client-consumed
 * services in this directory.
 *
 * Graceful degradation: any failure (network error, non-OK status, malformed
 * payload) resolves to [] so the signup form simply falls back to "Other".
 */
export async function getPublicJobTitles(): Promise<JobTitle[]> {
  try {
    const res = await secureFetch(`${getAPIUrl()}job-titles/public`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? (data as JobTitle[]) : []
  } catch {
    // Graceful degradation: signup form falls back to "Other" only.
    return []
  }
}
