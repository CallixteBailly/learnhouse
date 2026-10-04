/**
 * Socle déterministe — dashboard org (/orgs/default/dash/..., session admin).
 * Matrice §4. Un cours seedé couvre les sous-pages cours + l'éditeur.
 */
import { test, describe, beforeAll, afterAll } from '@e2e-dev/web';
import { expect } from 'e2e';
import { seedCourse, deleteCourseApi, type SeededCourse } from './helpers';

describe('dashboard org', { serial: true, session: 'admin', tags: ['dash'] }, () => {
  let seeded: SeededCourse;

  beforeAll(async () => {
    seeded = await seedCourse(`E2E Dash ${Date.now().toString(36)}`);
  });

  afterAll(async () => {
    if (seeded?.courseUuid) await deleteCourseApi(seeded.courseUuid);
  });

  test('/home loggé : hub avec la carte de l org default', { timeout: 30_000 }, async ({ app, screen }) => {
    await app.open('/home');
    await expect(screen.getByText('OrdIA', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('accueil dash rend', async ({ app, browser, screen }) => {
    await app.open('/orgs/default/dash');
    await expect(browser.locator('body')).toBeVisible();
    await expect(screen.getByText('404!')).toBeHidden();
  });

  test('liste cours : le cours seedé apparaît', async ({ app, screen }) => {
    await app.open('/orgs/default/dash/courses');
    await expect(screen.getByText(seeded.name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('onglet General du cours seedé rend', async ({ app, screen, browser }) => {
    // Les URLs web strippent le préfixe course_ de l'uuid.
    const bare = seeded.courseUuid.replace(/^course_/, '');
    await app.open(`/orgs/default/dash/courses/course/${bare}/general`);
    await expect(screen.getByText(seeded.name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(screen.getByText('404!')).toBeHidden();
  });

  test('onglet Content du cours seedé liste le chapitre', async ({ app, screen }) => {
    const bare = seeded.courseUuid.replace(/^course_/, '');
    await app.open(`/orgs/default/dash/courses/course/${bare}/content`);
    await expect(screen.getByText('Chapitre 1', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('éditeur d activité (URL sans préfixe org) rend', async ({ app, browser, screen }) => {
    const bareCourse = seeded.courseUuid.replace(/^course_/, '');
    const bareActivity = seeded.activities[0].uuid.replace(/^activity_/, '');
    await app.open(`/course/${bareCourse}/activity/${bareActivity}/edit`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(screen.getByText('404!')).toBeHidden();
  });

  test('pages dash secondaires rendent', async ({ app, browser, screen }) => {
    const paths = [
      '/dash/analytics',
      '/dash/assignments',
      '/dash/library',
      '/dash/boards',
      '/dash/communities',
      '/dash/playgrounds',
      '/dash/podcasts',
      '/dash/developers',
      '/dash/onboarding',
      '/dash/courses/migrate',
    ];
    for (const path of paths) {
      await app.open(`/orgs/default${path}`);
      await expect(browser.locator('body')).toBeVisible();
      await expect(screen.getByText('404!')).toBeHidden();
    }
  });

  test('réglages org : tous les onglets rendent', async ({ app, browser, screen }) => {
    const subpages = ['general', 'branding', 'landing', 'ai', 'usage', 'menu', 'other', 'danger-zone'];
    for (const sub of subpages) {
      await app.open(`/orgs/default/dash/org/settings/${sub}`);
      await expect(browser.locator('body')).toBeVisible();
      await expect(screen.getByText('404!')).toBeHidden();
    }
  });

  test('membres org (users settings) rendent', async ({ app, browser, screen }) => {
    await app.open('/orgs/default/dash/users/settings/members');
    await expect(browser.locator('body')).toBeVisible();
    await expect(screen.getByText('404!')).toBeHidden();
  });

  test('paiements : état sans Stripe rend', async ({ app, browser, screen }) => {
    for (const sub of ['offers', 'configuration']) {
      await app.open(`/orgs/default/dash/payments/${sub}`);
      await expect(browser.locator('body')).toBeVisible();
      await expect(screen.getByText('404!')).toBeHidden();
    }
  });
});
