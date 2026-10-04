/**
 * Flux mutant cours — piloté par l'agent GLM, vérifié par l'API (read-back).
 * Matrice §4 lignes 74-75, 77. Session admin.
 */
import { test, describe, afterAll } from '@e2e-dev/web';
import { expect } from 'e2e';
import { apiReq, apiLogin } from './helpers';

describe('course CRUD (agent)', { serial: true, session: 'admin', tags: ['agent', 'courses'] }, () => {
  const name = `Agent Course ${Date.now().toString(36)}`;
  const renamed = `${name} v2`;
  let courseUuid = '';

  afterAll(async () => {
    // Nettoyage best-effort même si un step échoue.
    if (courseUuid) {
      try {
        const token = await apiLogin(
          process.env.E2E_USER_ADMIN_USERNAME ?? 'admin@e2e-tests.com',
          process.env.E2E_USER_ADMIN_PASSWORD ?? 'Admin2026',
        );
        await apiReq('DELETE', `/courses/${courseUuid}`, token);
      } catch { /* déjà supprimé ou jamais créé */ }
    }
  });

  test('créer un cours depuis le dashboard', { timeout: 240_000 }, async ({ app, agent }) => {
    await app.open('/orgs/default/dash/courses');
    await agent.act(
      'crée un nouveau cours nommé {name} avec la description "Cours créé par le test agent", ' +
      'en utilisant le bouton de création de cours du dashboard',
      { params: { name } },
    );
    // Read-back API : le cours existe côté serveur.
    const token = await apiLogin(
      process.env.E2E_USER_ADMIN_USERNAME ?? 'admin@e2e-tests.com',
      process.env.E2E_USER_ADMIN_PASSWORD ?? 'Admin2026',
    );
    const results = await apiReq<any[]>(
      'GET',
      `/courses/org_slug/default/search?query=${encodeURIComponent(name)}`,
      token,
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    courseUuid = results[0].course_uuid ?? results[0].uuid ?? courseUuid;
  });

  test('renommer le cours (onglet Général, déterministe)', { timeout: 240_000 }, async ({ app, screen }) => {
    test.skip(!courseUuid, 'cours non créé');
    const bare = courseUuid.replace(/^course_/, '');
    await app.open(`/orgs/default/dash/courses/course/${bare}/general`);
    // Valeur exacte → screen (règle du skill), pas d'agent.
    await screen.getByRole('textbox', 'Name').fill(renamed);
    // Le bouton d'état affiche « Saved » (enabled mais no-op) tant que le
    // formulaire est propre : attendre le libellé sale exact (« Save »),
    // cliquer, puis attendre le retour à « Saved » (sauvegarde effectuée).
    // Le bouton sale affiche « Save Unsaved changes » (badge inclus dans le
    // nom accessible) ; l'état propre affiche « Saved ». Distinguer par regex.
    const save = screen.getByRole('button', { name: /^Save(?!d)/ });
    await expect(save).toBeVisible({ timeout: 20_000 });
    await save.tap();
    await expect(screen.getByRole('button', { name: /^Saved$/ })).toBeVisible({ timeout: 30_000 });
    // Read-back API.
    const token = await apiLogin(
      process.env.E2E_USER_ADMIN_USERNAME ?? 'admin@e2e-tests.com',
      process.env.E2E_USER_ADMIN_PASSWORD ?? 'Admin2026',
    );
    const course = await apiReq<any>('GET', `/courses/${courseUuid}`, token);
    expect(String(course.name)).toContain('v2');
  });

  test('supprimer le cours (menu de la liste)', { timeout: 300_000 }, async ({ app, agent }) => {
    test.skip(!courseUuid, 'cours non créé');
    // La suppression vit dans le menu « Course actions » de la liste des cours
    // (l'onglet Général n'a pas de zone de danger) — l'agent cible par NOM.
    await app.open('/orgs/default/dash/courses');
    await agent.act(
      'dans la liste des cours, trouve la carte du cours nommé {name}, ouvre son menu ' +
      'd actions (bouton « Course actions » ou équivalent) et clique « Delete Course », ' +
      'puis confirme la suppression dans la boîte de dialogue si une confirmation apparaît',
      { params: { name: renamed }, timeout: 240_000 },
    );
    const token = await apiLogin(
      process.env.E2E_USER_ADMIN_USERNAME ?? 'admin@e2e-tests.com',
      process.env.E2E_USER_ADMIN_PASSWORD ?? 'Admin2026',
    );
    let gone = false;
    try {
      await apiReq('GET', `/courses/${courseUuid}`, token);
    } catch (e) {
      gone = /-> 40[45]/.test((e as Error).message);
    }
    expect(gone).toBe(true);
    courseUuid = '';
  });
});
