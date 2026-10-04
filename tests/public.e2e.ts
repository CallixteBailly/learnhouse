/**
 * Socle déterministe — routes publiques + redirects middleware + SEO.
 * Matrice docs/e2e-coverage.md §1 et §2.
 */
import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { BASE_URL } from './helpers';

describe('routes publiques', () => {

  test('la racine sert la landing de l org default (rewrite, URL inchangée)', async ({ app, browser }) => {
    await app.open('/');
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser).toHaveURL('/');
  });

  test('/home anonyme → porte d authentification (redirect /login)', async ({ app, browser }) => {
    await app.open('/home');
    // Le hub est auth-gaté : un visiteur est renvoyé vers le login.
    await expect(browser).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test('/Login casse mixte → 308 vers /login', async ({ app, browser }) => {
    await app.open('/Login');
    await expect(browser).toHaveURL('/login');
  });

  test('/enter/default redirige vers /orgs/default/', async ({ app, browser }) => {
    await app.open('/enter/default');
    await expect(browser).toHaveURL(/\/orgs\/default\/?$/);
  });

  test('/orgs/default/signup redirige vers /signup (re-pin org)', async ({ app, browser }) => {
    await app.open('/orgs/default/signup');
    await expect(browser).toHaveURL(/\/signup(\?|$)/);
  });

  test('/health renvoie le statut OK (rewrite /api/health)', async () => {
    const res = await fetch(new URL('/health', BASE_URL));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
  });

  test('une route inconnue affiche la page 404', async ({ app, screen }) => {
    await app.open('/this-route-does-not-exist');
    await expect(screen.getByText('404!')).toBeVisible({ timeout: 15_000 });
  });

  test('sitemap.xml et robots.txt répondent 200', async () => {
    const sitemap = await fetch(new URL('/sitemap.xml', BASE_URL));
    expect(sitemap.status).toBe(200);
    const robots = await fetch(new URL('/robots.txt', BASE_URL));
    expect(robots.status).toBe(200);
  });
});

describe('hub SaaS : 404 attendus en tenancy single locale', () => {
  // En tenancy single, /new & co retombent dans le catch-all → /orgs/default/new
  // → page not-found. Documenté dans la matrice (elles vivent en multi sur la prod).
  // /account EXISTE en version org-scopée : couvert comme route protégée.
  for (const path of ['/new', '/billing', '/organizations', '/subscriptions']) {
    test(`${path} → page 404`, async ({ app, screen }) => {
      await app.open(path);
      await expect(screen.getByText('404!')).toBeVisible({ timeout: 15_000 });
    });
  }

  test('/account anonyme → redirect /login (route protégée org-scopée)', async ({ app, browser }) => {
    await app.open('/account');
    await expect(browser).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
