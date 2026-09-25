// Interactive headful Chromium driver for the Stripe signup captcha.
// Usage: node server.mjs  → then drive it via curl on 127.0.0.1:9777
//   GET  /state                      → page url, button state, challenge frame info
//   GET  /shot?path=/abs.png&sel=CSS → screenshot (selector optional)
//   POST /cmd  {"action":"goto","url":"..."}
//   POST /cmd  {"action":"fill","email":"..","name":"..","password":".."}
//   POST /cmd  {"action":"click","text":"Create account"}
//   POST /cmd  {"action":"drag","from":[x,y],"to":[x,y]}
//   POST /cmd  {"action":"eval","js":"return location.href"}
import { createServer } from 'node:http';
import { chromium } from '/Users/anthonybailly/learnhouse/apps/e2e/node_modules/playwright-core/index.mjs';

const EXEC = '/Users/anthonybailly/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PROFILE = process.env.PROFILE_DIR || '/Users/anthonybailly/learnhouse/.tmp-stripe-browser/profile';
const PORT = 9777;

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: EXEC,
  headless: false,
  viewport: { width: 1380, height: 900 },
  locale: 'fr-FR',
  args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--lang=fr-FR'],
});
const page = ctx.pages()[0] || (await ctx.newPage());
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
  window.chrome = window.chrome || { runtime: {} };
});

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === 'GET' && u.pathname === '/state') {
      const state = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => (b.textContent || '').includes('Create account'));
        const cf = Array.from(document.querySelectorAll('iframe'))
          .find(f => (f.src || '').includes('frame=challenge'));
        return {
          url: location.href.slice(0, 140),
          btn: btn ? { disabled: btn.disabled, text: btn.textContent.trim() } : null,
          challenge: cf ? { w: cf.offsetWidth, h: cf.offsetHeight } : null,
          snippet: document.body.innerText.replace(/\s+/g, ' ').slice(0, 180),
        };
      });
      return json(res, 200, state);
    }
    if (req.method === 'GET' && u.pathname === '/shot') {
      const p = u.searchParams.get('path') || '/Users/anthonybailly/learnhouse/.tmp-stripe-browser/shot.png';
      const sel = u.searchParams.get('sel');
      if (sel) await page.locator(sel).first().screenshot({ path: p, scale: 'device', timeout: 12000 });
      else await page.screenshot({ path: p });
      return json(res, 200, { saved: p });
    }
    if (req.method === 'GET' && u.pathname === '/frame-text') {
      const ch = page.frames().find(f => f.url().includes('frame=challenge'));
      if (!ch) return json(res, 200, { text: null });
      const text = await ch.evaluate(() => document.body.innerText.slice(0, 300));
      return json(res, 200, { text });
    }
    if (req.method === 'POST' && u.pathname === '/cmd') {
      const body = await new Promise(ok => { let d = ''; req.on('data', c => d += c); req.on('end', () => ok(d)); });
      const cmd = JSON.parse(body || '{}');
      if (cmd.action === 'goto') { await page.goto(cmd.url, { waitUntil: 'domcontentloaded' }); return json(res, 200, { ok: true }); }
      if (cmd.action === 'fill') {
        const set = async (testId, value) => { const el = page.getByTestId(testId); await el.fill(value); };
        if (cmd.email) await set('register-email-input', cmd.email);
        if (cmd.name) await set('register-name-input', cmd.name);
        if (cmd.password) await set('register-password-input', cmd.password);
        return json(res, 200, { ok: true });
      }
      if (cmd.action === 'click') {
        const btn = page.getByRole('button', { name: cmd.text });
        await btn.click({ timeout: 8000 });
        return json(res, 200, { ok: true });
      }
      if (cmd.action === 'drag') {
        const [fx, fy] = cmd.from, [tx, ty] = cmd.to;
        await page.mouse.move(fx - 20, fy + 12);
        await page.waitForTimeout(180);
        await page.mouse.move(fx, fy, { steps: 5 });
        await page.waitForTimeout(150);
        await page.mouse.down();
        await page.waitForTimeout(120);
        const steps = 12;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const arc = Math.sin(t * Math.PI) * (cmd.arc ?? 12);
          await page.mouse.move(fx + (tx - fx) * t, fy + (ty - fy) * t - arc, { steps: 2 });
          await page.waitForTimeout(40);
        }
        await page.mouse.move(tx, ty, { steps: 3 });
        await page.waitForTimeout(180);
        await page.mouse.up();
        return json(res, 200, { ok: true, from: cmd.from, to: cmd.to });
      }
      if (cmd.action === 'eval') {
        const r = await page.evaluate(new Function(cmd.js));
        return json(res, 200, { result: r });
      }
      return json(res, 400, { error: 'unknown action' });
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 500, { error: String(e && e.message || e) });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`driver ready on http://127.0.0.1:${PORT}`));
