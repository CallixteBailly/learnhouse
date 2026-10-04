/**
 * Socle déterministe — espace apprenant (/orgs/default/..., session student).
 * Un cours est seedé en beforeAll (API admin) puis supprimé en afterAll.
 * Matrice §3.
 */
import { test, describe, beforeAll, afterAll } from '@e2e-dev/web';
import { expect } from 'e2e';
import { seedCourse, deleteCourseApi, type SeededCourse } from './helpers';

describe('espace apprenant', { serial: true, session: 'student', tags: ['learner'] }, () => {
  let seeded: SeededCourse;

  beforeAll(async () => {
    seeded = await seedCourse(`E2E Coverage ${Date.now().toString(36)}`);
  });

  afterAll(async () => {
    if (seeded?.courseUuid) await deleteCourseApi(seeded.courseUuid);
  });

  test('landing org rend', async ({ app, browser }) => {
    await app.open('/orgs/default/');
    await expect(browser.locator('body')).toBeVisible();
  });

  test('catalogue : le cours seedé est listé', async ({ app, screen }) => {
    await app.open('/orgs/default/courses');
    await expect(screen.getByText(seeded.name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('catalogue : la recherche filtre (aucun résultat sur requête inconnue)', async ({ app, screen }) => {
    await app.open('/orgs/default/courses');
    // Exact : la page a AUSSI une recherche globale « Search courses, users,
    // folders… » — le sous-match serait ambigu (LOCATOR_AMBIGUOUS).
    const search = screen.getByPlaceholder('Search courses...');
    await search.waitFor({ state: 'visible', timeout: 15_000 });
    await search.fill('zzz-aucun-resultat-e2e');
    await expect(screen.getByText('No courses found', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('page cours seedée : nom + chapitre visibles', async ({ app, screen }) => {
    // Les URLs web strippent le préfixe course_ de l'uuid.
    const bare = seeded.courseUuid.replace(/^course_/, '');
    await app.open(`/orgs/default/course/${bare}`);
    await expect(screen.getByText(seeded.name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(screen.getByText('Chapitre 1', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('parcours (/trail) rend', async ({ app, browser }) => {
    await app.open('/orgs/default/trail');
    await expect(browser.locator('body')).toBeVisible();
    await expect(browser).not.toHaveURL(/404/);
  });

  test('vérification de certificat inconnu : page rend sans crash', async ({ app, browser }) => {
    await app.open('/orgs/default/certificates/00000000-0000-0000-0000-000000000000/verify');
    await expect(browser.locator('body')).toBeVisible();
  });

  test('profil public user rend', async ({ app, browser }) => {
    await app.open('/orgs/default/user/student_e2e');
    await expect(browser.locator('body')).toBeVisible();
  });

  test('recherche globale rend', async ({ app, browser }) => {
    await app.open('/orgs/default/search');
    await expect(browser.locator('body')).toBeVisible();
  });

  test('pages secondaires rendent (library, boards, communities, podcasts, playgrounds, copilot, store)', async ({ app, browser, screen }) => {
    for (const path of ['/library', '/boards', '/communities', '/podcasts', '/playgrounds', '/copilot', '/store']) {
      await app.open(`/orgs/default${path}`);
      await expect(browser.locator('body')).toBeVisible();
      // Ces pages ne doivent PAS retomber sur le 404 global.
      await expect(screen.getByText('404!')).toBeHidden();
    }
  });

  test('pages compte rendent (account, general, security, purchases)', async ({ app, browser, screen }) => {
    for (const path of ['/account', '/account/general', '/account/security', '/account/purchases']) {
      await app.open(`/orgs/default${path}`);
      await expect(browser.locator('body')).toBeVisible();
      await expect(screen.getByText('404!')).toBeHidden();
    }
  });
});
