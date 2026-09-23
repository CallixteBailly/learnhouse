// Regenerates public/runtime-config.js from the wrangler.jsonc vars so a dev
// leftover (localhost URLs written by `next dev`) can never ship to production
// again. Run automatically before deploy:worker (npm pre-script).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(root, 'wrangler.jsonc'), 'utf8')
// Strip full-line // comments only — values contain https:// URLs that a
// naive //.*$ strip would mangle.
const stripped = raw.replace(/^\s*\/\/.*$/gm, '')
const vars = JSON.parse(stripped)?.vars ?? {}
if (!vars.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL) {
  throw new Error('wrangler.jsonc has no NEXT_PUBLIC vars — refusing to write an empty runtime config')
}
const config = Object.fromEntries(Object.entries(vars).filter(([k]) => k.startsWith('NEXT_PUBLIC_')))
const publicDir = join(root, 'public')
mkdirSync(publicDir, { recursive: true })
writeFileSync(join(publicDir, 'runtime-config.js'), `window.__RUNTIME_CONFIG__ = ${JSON.stringify(config)};\n`, 'utf8')
console.log(`runtime-config.js written with ${Object.keys(config).length} public vars`)
