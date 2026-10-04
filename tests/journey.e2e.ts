/**
 * Parcours apprenant + inscription — pilotés par l'agent GLM.
 * Matrice §6 lignes 73 et 76.
 */
import { test, describe, beforeAll, afterAll } from '@e2e-dev/web';
import { expect } from 'e2e';
import { seedCourse, deleteCourseApi, type SeededCourse } from './helpers';

describe('parcours apprenant (agent)', { serial: true, session: 'student', tags: ['agent', 'learner'] }, () => {
  let seeded: SeededCourse;

  beforeAll(async () => {
    seeded = await seedCourse(`E2E Journey ${Date.now().toString(36)}`);
  });

  afterAll(async () => {
    if (seeded?.courseUuid) await deleteCourseApi(seeded.courseUuid);
  });

  test("ouvrir le cours et terminer son activité", { timeout: 300_000 }, async ({ app, agent, screen }) => {
    await app.open('/orgs/default/courses');
    await agent.act(
      'ouvre le cours nommé {name}, démarre son activité, puis marque-la comme terminée',
      { params: { name: seeded.name } },
    );
    await agent.assert(
      'la page montre que l activité / le cours est terminé ou en progression (pas à l état vierge)',
    );
    await expect(screen.getByText('404!')).toBeHidden();
  });
});

describe('inscription (agent)', { tags: ['agent', 'auth'] }, () => {
  test("s'inscrire avec un nouveau compte", { timeout: 300_000 }, async ({ app, agent, browser }) => {
    const email = `signup-${Date.now().toString(36)}@e2e-tests.com`;
    await app.open('/signup');
    await agent.act(
      "crée un compte avec l'email {email}, le mot de passe Signup!E2e24, le prénom Test et le nom Signup. " +
      'Remplis aussi les champs optionnels (métier, téléphone) si le formulaire le demande, accepte la politique ' +
      'de confidentialité si une case est requise, puis valide.',
      { params: { email }, timeout: 240_000 },
    );
    await agent.assert(
      "l'inscription a abouti : un message de succès (« Your account was successfully created » " +
      "ou équivalent) est affiché, OU l'utilisateur est connecté (page d'accueil/hub), OU un message " +
      "demande de vérifier sa boîte mail — et aucune erreur de validation n'est visible"
    );
  });
});
