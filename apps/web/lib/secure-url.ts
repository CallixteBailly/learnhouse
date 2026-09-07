// Guard for operator-configured server-to-server URLs (backend API).
// Rule: http/https only, hostname required, private/reserved hosts rejected —
// except the documented local dev default. Applied before any server-side
// fetch so a misconfigured env var can never turn into an SSRF pivot.

const DEV_DEFAULT = 'http://localhost:1338'
const DEV_DEFAULT_ALT = 'http://localhost'

const PRIVATE_OR_RESERVED =
  /^(0\.0\.0\.0|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/

export function safeBackendUrl(raw: string): string {
  const url = raw.replace(/\/+$/, '')
  if (url === DEV_DEFAULT || url === DEV_DEFAULT_ALT) return url

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid backend URL (malformed)')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Invalid backend URL protocol: ${parsed.protocol}`)
  }

  const host = parsed.hostname.toLowerCase()
  if (!host || PRIVATE_OR_RESERVED.test(host) || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error(`Private or reserved backend host rejected: ${host}`)
  }

  return url
}
