import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { getServerAPIUrl } from '@services/config/config'

// Never statically cache the gate result: an ISR-cached 404 from a flaky
// instance/info fetch during revalidation would poison the whole hub route
// group with random 404s for the revalidate window.
export const dynamic = 'force-dynamic'

// Root org-management hub (create / upgrade / delete orgs, billing, account).
//
// The proxy already restricts these paths to `multi` tenancy. A self-hosted
// OSS instance that runs multi-tenant (multi_org_enabled — the Ordria
// deployment model) needs the full org lifecycle surface, so we only 404 when
// the backend DEFINITIVELY reports a single-tenant non-SaaS deployment. On a
// fetch error, non-ok response, or missing mode we render the children rather
// than caching a flaky 404.
async function getInstanceInfo(): Promise<{ mode: string | null; multi: boolean }> {
  try {
    const res = await fetch(`${getServerAPIUrl()}instance/info`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return { mode: null, multi: false }
    const info = await res.json()
    return {
      mode: typeof info?.mode === 'string' ? info.mode : null,
      multi: info?.tenancy === 'multi' || info?.multi_org_enabled === true,
    }
  } catch {
    return { mode: null, multi: false }
  }
}

export default async function HubLayout({ children }: { children: ReactNode }) {
  const { mode, multi } = await getInstanceInfo()
  // Multi-tenant instance (SaaS or self-hosted multi-org OSS) → full hub.
  if (multi) return <>{children}</>
  if (mode === 'oss' || mode === 'ee') notFound()
  return <>{children}</>
}
