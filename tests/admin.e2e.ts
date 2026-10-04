/**
 * Socle déterministe — console superadmin (/admin, session admin plateforme).
 * Matrice §5.
 */
import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('superadmin', { tags: ['admin'] }, () => {

  test('sans session, /admin atterrit sur la porte de login', async ({ app, browser }) => {
    await app.open('/admin');
    await expect(browser).toHaveURL(/\/admin\/login/, { timeout: 15_000 });
  });

  test('la page /admin/login rend', async ({ app, screen }) => {
    await app.open('/admin/login');
    await expect(screen.getByRole('textbox').first()).toBeVisible();
  });

  test('dashboard superadmin rend (session admin)', { session: 'admin' }, async ({ app, browser, screen }) => {
    await app.open('/admin');
    await expect(browser.locator('body')).toBeVisible({ timeout: 20_000 });
    await expect(browser).not.toHaveURL(/\/admin\/login/);
    await expect(screen.getByText('404!')).toBeHidden();
  });

  test('pages superadmin rendent (analytics, organizations, users, developers, job-titles)', { session: 'admin' }, async ({ app, browser, screen }) => {
    const paths = ['/admin/analytics', '/admin/organizations', '/admin/users', '/admin/developers', '/admin/job-titles'];
    for (const path of paths) {
      await app.open(path);
      await expect(browser.locator('body')).toBeVisible();
      await expect(screen.getByText('404!')).toBeHidden();
    }
  });

  test('détail d une organisation rend', { session: 'admin' }, async ({ app, browser, screen }) => {
    await app.open('/admin/organizations/1');
    await expect(browser.locator('body')).toBeVisible({ timeout: 20_000 });
    await expect(screen.getByText('404!')).toBeHidden();
  });
});
