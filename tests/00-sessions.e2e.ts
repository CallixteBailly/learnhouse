/**
 * Sessions partagées : UN login UI par compte et par run (l'API limite à
 * 30 logins / 5 min / IP). Les autres tests déclarent { session: 'admin' } ou
 * { session: 'student' }.
 */
import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';
import { ensureStudent, dismissOnboarding } from './helpers';

/** Connexion déterministe via le vrai formulaire (labels fr de l'app). */
async function uiLogin(
  app: import('@e2e-dev/web').App,
  browser: import('@e2e-dev/web').Browser,
  screen: import('e2e').Screen,
  email: string,
  password: ReturnType<typeof credentials.user>['password'],
) {
  await app.open('/login');
  await dismissOnboarding(browser);
  // Les inputs n'ont ni placeholder ni label htmlFor fiable — ciblage par type.
  await browser.locator("input[type='email']").fill(email);
  await browser.locator("input[type='password']").fill(password);
  await screen.getByRole('button', 'Login').tap();
  // Le succès quitte /login (atterrit sur la landing org ou /home).
  await expect(browser).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

test.setup('authenticate as admin', { sessions: ['admin'] }, async ({ app, browser, screen, session }) => {
  const admin = credentials.user('admin');
  await uiLogin(app, browser, screen, admin.username, admin.password);
  await session.save('admin');
});

test.setup('authenticate as student', { sessions: ['student'] }, async ({ app, browser, screen, session }) => {
  // L'étudiant de test est créé via l'API admin si nécessaire (idempotent).
  await ensureStudent();
  const student = credentials.user('student');
  await uiLogin(app, browser, screen, student.username, student.password);
  await session.save('student');
});
