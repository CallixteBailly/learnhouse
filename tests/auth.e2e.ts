/**
 * Socle déterministe — formulaire de login : rendu, erreur, redirect loggé.
 * Matrice §1 lignes 4-6.
 */
import { test, describe } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';
import { dismissOnboarding } from './helpers';

describe('login', () => {

  test('le formulaire rend (email, mot de passe, bouton Login)', async ({ app, browser, screen }) => {
    await app.open('/login');
    await dismissOnboarding(browser);
    await expect(browser.locator("input[type='email']")).toBeVisible();
    await expect(browser.locator("input[type='password']")).toBeVisible();
    await expect(screen.getByRole('button', 'Login')).toBeVisible();
  });

  test('mauvais mot de passe → bannière d erreur inline', async ({ app, browser, screen }) => {
    const admin = credentials.user('admin');
    await app.open('/login');
    await dismissOnboarding(browser);
    await browser.locator("input[type='email']").fill(admin.username);
    await browser.locator("input[type='password']").fill('WrongPassword!9');
    await screen.getByRole('button', 'Login').tap();
    await expect(screen.getByText('Incorrect Email or password')).toBeVisible({ timeout: 15_000 });
  });

  test('visiteur déjà loggé sur /login → renvoyé vers /home', { session: 'admin' }, async ({ app, browser }) => {
    await app.open('/login');
    await expect(browser).toHaveURL(/\/home/, { timeout: 15_000 });
  });
});
