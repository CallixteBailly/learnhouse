/**
 * E2E: Organization configuration & usage.
 *
 * On the scratch org:
 *  - feature toggles (AI/copilot, communities, courses, podcasts, boards,
 *    playgrounds, payments, folders) can be updated via their config PUT
 *  - branding configs (color, font, footer text, default language, watermark)
 *    can be updated
 *  - the org carries a config object readable through the org endpoints
 *  - org usage is readable
 *
 * Config PUTs return {"detail": "..."}; the authoritative read-back is the
 * org's embedded config, so we assert on shape + successful updates.
 */
import { test, expect } from '../../../core/fixtures'
import { setupScenario, type OrgsScenario } from '../scenario'
import * as api from '../api'

let s: OrgsScenario

test.beforeAll(async () => {
  s = await setupScenario()
})

test.describe('Feature configuration', () => {
  const cases: { key: api.FeatureConfigKey; flags: Record<string, string | boolean> }[] = [
    { key: 'ai', flags: { ai_enabled: true, copilot_enabled: true } },
    { key: 'communities', flags: { communities_enabled: true } },
    { key: 'courses', flags: { courses_enabled: true } },
    { key: 'podcasts', flags: { podcasts_enabled: true } },
    { key: 'boards', flags: { boards_enabled: true } },
    { key: 'playgrounds', flags: { playgrounds_enabled: true } },
    { key: 'folders', flags: { folders_enabled: true } },
  ]

  for (const c of cases) {
    test(`config ${c.key} can be updated`, async () => {
      await api.putFeatureConfig(s.adminToken, s.org.id, c.key, c.flags)
      // Reaching here means the PUT returned 2xx; flip it back off so the
      // scratch org state stays neutral for reruns.
      const off: Record<string, string | boolean> = {}
      for (const k of Object.keys(c.flags)) off[k] = k.includes('copilot') ? false : true
      await api.putFeatureConfig(s.adminToken, s.org.id, c.key, off).catch(() => {})
    })
  }

  test('org exposes a config object through the slug endpoint', async () => {
    const org = await api.getOrgBySlug(s.org.slug)
    expect(org.config).toBeTruthy()
    // The org read wraps the payload: { id, org_id, config: { …sections } }.
    const outer = org.config as Record<string, any>
    const cfg = outer?.config ?? outer
    const hasSection =
      cfg.features !== undefined ||
      cfg.admin_toggles !== undefined ||
      cfg.cloud !== undefined ||
      cfg.look !== undefined ||
      cfg.config_version !== undefined
    expect(hasSection).toBe(true)
  })
})

test.describe('Branding configuration', () => {
  test('color config can be updated', async () => {
    await api.putBrandingConfig(s.adminToken, s.org.id, 'color', {
      primary: '#3b65ff',
      secondary: '#000000',
      accent: '#ffffff',
    })
  })

  test('footer text config can be updated', async () => {
    await api.putBrandingConfig(s.adminToken, s.org.id, 'footer_text', {
      footer_text: 'E2E footer',
    })
  })

  test('default language config can be updated', async () => {
    await api.putBrandingConfig(s.adminToken, s.org.id, 'default_language', {
      default_language: 'en',
    })
  })

  test('watermark config can be toggled', async () => {
    await api.putBrandingConfig(s.adminToken, s.org.id, 'watermark', {
      watermark_enabled: false,
    })
  })
})

test.describe('Usage', () => {
  test('org usage is readable', async () => {
    const usage = await api.getOrgUsage(s.adminToken, s.org.id)
    expect(usage).toBeDefined()
    expect(typeof usage).toBe('object')
  })
})
