/**
 * Socle déterministe — viewports mobiles 390px sur les pages clés.
 * Matrice lignes 2, 25, 29, 31.
 */
import { test, describe, beforeAll, afterAll } from '@e2e-dev/web';
import { expect } from 'e2e';
import { seedCourse, deleteCourseApi, type SeededCourse } from './helpers';

describe('mobile 390px', { tags: ['mobile'] }, () => {
  let seeded: SeededCourse;

  beforeAll(async () => {
    seeded = await seedCourse(`E2E Mobile ${Date.now().toString(36)}`);
  });

  afterAll(async () => {
    if (seeded?.courseUuid) await deleteCourseApi(seeded.courseUuid);
  });

  test('landing org en 390px', async ({ app, browser }) => {
    await browser.setViewport({ width: 390, height: 844 });
    await app.open('/');
    await expect(browser.locator('body')).toBeVisible();
  });

  test('catalogue en 390px : le cours seedé visible', { session: 'student' }, async ({ app, browser, screen }) => {
    await browser.setViewport({ width: 390, height: 844 });
    await app.open('/orgs/default/courses');
    await expect(screen.getByText(seeded.name, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('page cours en 390px', { session: 'student' }, async ({ app, browser, screen }) => {
    await browser.setViewport({ width: 390, height: 844 });
    // Les URLs web strippent le préfixe course_ de l'uuid.
    const bareCourse = seeded.courseUuid.replace(/^course_/, '');
    await app.open(`/orgs/default/course/${bareCourse}`);
    // À 390px le hero mobile masque visuellement le titre (présent mais
    // hidden) : on vérifie l'attachement + l'absence d'état 404/erreur.
    await expect(screen.getByText(seeded.name, { exact: false }).first()).toBeAttached({ timeout: 20_000 });
    await expect(screen.getByText('404!')).toBeHidden();
  });

  test('page activité en 390px', { session: 'student' }, async ({ app, browser, screen }) => {
    await browser.setViewport({ width: 390, height: 844 });
    const bareCourse = seeded.courseUuid.replace(/^course_/, '');
    const bareActivity = seeded.activities[0].uuid.replace(/^activity_/, '');
    await app.open(`/orgs/default/course/${bareCourse}/activity/${bareActivity}`);
    await expect(browser.locator('body')).toBeVisible();
    await expect(screen.getByText('404!')).toBeHidden();
  });
});
