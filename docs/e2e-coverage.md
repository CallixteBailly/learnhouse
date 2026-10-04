# Matrice de couverture E2E — LearnHouse (Ordria)

> Définition opérationnelle du « 100 % » : plus aucune ligne `todo` ci-dessous.
> Mettre à jour à chaque route/flux ajouté dans l'app.

**Cible** : stack locale `docker compose -f docker-compose.yml -f docker-compose.e2ecov.yml -p e2ecov up -d --build` → `http://localhost:3009` — image construite depuis CE repo (tenancy `single`, mode `oss`, org `default`, admin `admin@e2e-tests.com` / `Admin2026`, créé via `scripts/e2e/make_admin.py` — le boot compose ne peut pas créer l'admin car `admin@learnhouse.local` est rejeté par le validateur d'emails, TLD réservé).

**Comptes** : `admin` (owner org default + superadmin) et `student` (créé au setup de la suite avec consentements RGPD) — déclarés dans `e2e.config.ts` (`credentials`), valeurs dans `.env` (gitignoré).

**Langue** : les navigateurs de test sont en-US → l'UI rend en **anglais** (défaut i18n). La prod est FR via préférence utilisateur — les libellés des tests suivent donc la locale par défaut, déterministe.

**Conventions** : `S=` socle déterministe (`expect`/`screen`), `A=` test agent (GLM `glm-5.3-flash` via endpoint Z.AI coding). Les routes hub SaaS (`/new`, `/billing`, `/organizations`, `/subscriptions`) tombent au 404 du catch-all en tenancy `single` locale — couvertes comme 404 documentés (elles vivent en tenancy `multi` sur la prod central-LMS). `/account` et `/home` existent en version org-scopée/auth-gatée → couverts comme routes protégées.

**Dernier run complet cache froid : 53/53 verts** (socle + agents, `npx e2e run --no-cache`).

## 1. Routes publiques (visiteur)

| # | Route | État / flux | Viewport | Test | Statut |
|---|-------|-------------|----------|------|--------|
| 1 | `/` | landing org default rend (rewrite, URL inchangée) | desktop | tests/public.e2e.ts | ok |
| 2 | `/` | landing rend | mobile 390 | tests/mobile.e2e.ts | ok |
| 3 | `/home` | anonyme → redirect `/login` (hub auth-gaté) | desktop | tests/public.e2e.ts | ok |
| 4 | `/home` | loggé → carte org default visible | desktop | tests/dash.e2e.ts | ok |
| 5 | `/login` | formulaire rend (email, mot de passe, bouton Login) | desktop | tests/auth.e2e.ts | ok |
| 6 | `/login` | mauvais mot de passe → bannière « Incorrect Email or password » | desktop | tests/auth.e2e.ts | ok |
| 7 | `/login` | visiteur loggé → redirect `/home` | desktop | tests/auth.e2e.ts | ok |
| 8 | `/Login` (casse mixte) | 308 vers `/login` | desktop | tests/public.e2e.ts | ok |
| 9 | `/signup` | formulaire rend + flux complet via agent (cf. §6) | desktop | tests/journey.e2e.ts | ok |
| 10 | `/forgot` | formulaire rend | desktop | tests/auth.e2e.ts | ok |
| 11 | `/reset` | page rend (état sans token valide) | desktop | tests/auth.e2e.ts | ok |
| 12 | `/verify-email` | page rend (état sans token) | desktop | tests/auth.e2e.ts | ok |
| 13 | `/enter/default` | redirect 308 `/orgs/default/` + cookie `LH_org=default` | desktop | tests/public.e2e.ts | ok |
| 14 | `/orgs/default/signup` | redirect 307 `/signup` (re-pin org) | desktop | tests/public.e2e.ts | ok |
| 15 | `/health` | 200 JSON `{status: healthy}` (route Next via rewrite) | — | tests/public.e2e.ts | ok |
| 16 | `/does-not-exist` | page 404 « 404! » | desktop | tests/public.e2e.ts | ok |
| 17 | `/sitemap.xml` / `/robots.txt` | 200 | — | tests/public.e2e.ts | ok |

## 2. Hub SaaS (404 attendus en tenancy single locale)

| # | Route | État / flux | Test | Statut |
|---|-------|-------------|------|--------|
| 18 | `/new` | 404 not-found (catch-all → /orgs/default/new) | tests/public.e2e.ts | ok |
| 19 | `/billing` | 404 idem | tests/public.e2e.ts | ok |
| 20 | `/organizations` | 404 idem | tests/public.e2e.ts | ok |
| 21 | `/subscriptions` | 404 idem | tests/public.e2e.ts | ok |
| 22 | `/account` (racine) | anonyme → redirect `/login` (route protégée org-scopée) | tests/public.e2e.ts | ok |

## 3. Espace apprenant (`/orgs/default/...`, session student)

| # | Route | État / flux | Viewport | Test | Statut |
|---|-------|-------------|----------|------|--------|
| 23 | `/orgs/default/` | landing org rend | desktop | tests/learner.e2e.ts | ok |
| 24 | `/orgs/default/courses` | catalogue : le cours seedé est listé | desktop | tests/learner.e2e.ts | ok |
| 25 | `/orgs/default/courses` | recherche : « No courses found » sur requête inconnue | desktop | tests/learner.e2e.ts | ok |
| 26 | `/orgs/default/courses` | catalogue rend | mobile 390 | tests/mobile.e2e.ts | ok |
| 27 | `/orgs/default/library` | bibliothèque rend | desktop | tests/learner.e2e.ts | ok |
| 28 | `/orgs/default/trail` | parcours apprenant rend | desktop | tests/learner.e2e.ts | ok |
| 29 | `/orgs/default/course/{uuid}` | page cours seedée : nom + chapitre (uuid SANS préfixe `course_`) | desktop | tests/learner.e2e.ts | ok |
| 30 | `/orgs/default/course/{uuid}` | page cours rend (titre attaché — hero mobile le masque) | mobile 390 | tests/mobile.e2e.ts | ok |
| 31 | `/orgs/default/course/{uuid}/activity/{id}` | activité : complétion via agent | desktop | tests/journey.e2e.ts | ok |
| 32 | `/orgs/default/course/{uuid}/activity/{id}` | activité rend | mobile 390 | tests/mobile.e2e.ts | ok |
| 33 | `/orgs/default/certificates/{uuid}/verify` | vérification : état uuid inconnu, sans crash | desktop | tests/learner.e2e.ts | ok |
| 34 | `/orgs/default/user/student_e2e` | profil public user rend | desktop | tests/learner.e2e.ts | ok |
| 35 | `/orgs/default/search` | recherche globale rend | desktop | tests/learner.e2e.ts | ok |
| 36 | `/orgs/default/store` | boutique : état sans offres | desktop | tests/learner.e2e.ts | ok |
| 37 | `/orgs/default/communities` | état vide | desktop | tests/learner.e2e.ts | ok |
| 38 | `/orgs/default/podcasts` | état vide | desktop | tests/learner.e2e.ts | ok |
| 39 | `/orgs/default/playgrounds` | état vide | desktop | tests/learner.e2e.ts | ok |
| 40 | `/orgs/default/copilot` | page rend | desktop | tests/learner.e2e.ts | ok |
| 41 | `/orgs/default/boards` | état vide | desktop | tests/learner.e2e.ts | ok |
| 42 | `/orgs/default/account` (+ general/security/purchases) | pages compte rendent | desktop | tests/learner.e2e.ts | ok |

## 4. Dashboard org (`/orgs/default/dash/...`, session admin)

Onglets réels d'un cours : `general, content, access, contributors, seo, certification, analytics` (pas de `chapters`/`settings` — le contenu vit sous `content`, la suppression dans le menu de la liste).

| # | Route | État / flux | Test | Statut |
|---|-------|-------------|------|--------|
| 43 | `/orgs/default/dash` | accueil dash rend | tests/dash.e2e.ts | ok |
| 44 | `/orgs/default/dash/courses` | le cours seedé apparaît | tests/dash.e2e.ts | ok |
| 45 | `/dash/courses/course/{uuid}/general` | métadonnées du cours seedé | tests/dash.e2e.ts | ok |
| 46 | `/dash/courses/course/{uuid}/content` | chapitre seedé listé | tests/dash.e2e.ts | ok |
| 47 | `/dash/courses/migrate` | page migration rend | tests/dash.e2e.ts | ok |
| 48 | `/dash/analytics` | analytics rend | tests/dash.e2e.ts | ok |
| 49 | `/dash/assignments` | état vide | tests/dash.e2e.ts | ok |
| 50 | `/dash/library` | rend | tests/dash.e2e.ts | ok |
| 51 | `/dash/boards` / `communities` / `playgrounds` / `podcasts` / `developers` / `onboarding` | rendent (états vides) | tests/dash.e2e.ts | ok |
| 52 | `/dash/org/settings/{general,branding,landing,ai,usage,menu,other,danger-zone}` | tous les onglets rendent | tests/dash.e2e.ts | ok |
| 53 | `/dash/users/settings/members` | membres org rendent | tests/dash.e2e.ts | ok |
| 54 | `/dash/payments/{offers,configuration}` | état sans Stripe | tests/dash.e2e.ts | ok |
| 55 | `/course/{uuid}/activity/{uuid}/edit` | éditeur activité (URL sans préfixe org) | tests/dash.e2e.ts | ok |

## 5. Superadmin (`/admin`, session admin plateforme)

| # | Route | État / flux | Test | Statut |
|---|-------|-------------|------|--------|
| 56 | `/admin` sans session → `/admin/login` | gate login | tests/admin.e2e.ts | ok |
| 57 | `/admin/login` | formulaire rend | tests/admin.e2e.ts | ok |
| 58 | `/admin` loggé | dashboard rend | tests/admin.e2e.ts | ok |
| 59 | `/admin/analytics` + `/admin/developers` + `/admin/job-titles` | rendent | tests/admin.e2e.ts | ok |
| 60 | `/admin/organizations` + `/admin/organizations/1` | liste + détail org | tests/admin.e2e.ts | ok |
| 61 | `/admin/users` | liste users plateforme | tests/admin.e2e.ts | ok |

## 6. Flux mutants & parcours (agent GLM)

| # | Flux | Étapes | Test | Statut |
|---|------|--------|------|--------|
| 62 | Auth | login admin happy path (formulaire réel) | tests/00-sessions.e2e.ts (S, session) | ok |
| 63 | Auth | login student (compte créé par l'API AVEC consentements RGPD) | tests/00-sessions.e2e.ts (S) | ok |
| 64 | Inscription | signup complet (métier/tél/RGPD) → « successfully created » | tests/journey.e2e.ts (A) | ok |
| 65 | Cours | create via UI dashboard (agent) + read-back API | tests/course-crud.e2e.ts (A+S) | ok |
| 66 | Cours | rename via onglet Général (déterministe : champ Name + Save/Saved) + read-back | tests/course-crud.e2e.ts (S) | ok |
| 67 | Cours | delete via menu « Course actions » de la liste (agent) + read-back 404 | tests/course-crud.e2e.ts (A+S) | ok |
| 68 | Parcours | ouvrir le cours seedé → terminer l'activité → état complété | tests/journey.e2e.ts (A) | ok |

## Checklist d'acceptation (phase 4 du SKILL.md) — validée le 2026-10-04

- [x] Toutes les routes du routeur ont une ligne ci-dessus, statut `ok` (53/53 tests verts cache froid)
- [x] Formulaires : happy path + 1 erreur (login erreur inline ✓ ; signup complet via agent ✓)
- [x] Routes protégées : visiteur → gate (`/home`, `/account`, `/admin`, dash via sessions)
- [x] Listes : empty states (recherche catalogue « No courses found », boards/playgrounds/podcasts/communities vides)
- [x] Actions mutantes : create + edit + delete (cours, avec read-back API)
- [x] Pages clés desktop + mobile 390 (landing, catalogue, cours, activité)
- [x] `npx e2e list` : 53 tests / 10 fichiers, zéro erreur de collecte
- [x] Re-run `--no-cache` vert (24 appels modèle, `glm-5.3-flash`)
- [x] Couche unitaire générée, gaps listés ci-dessous

## Couche unitaire — état au 2026-10-04

**API (pytest, SQLite in-memory)** : `uv run pytest src/tests --cov` → **4139 passed / 32 failed / 23 skipped, couverture 94 %** (25 765 stmts, 1 592 manquants ; seuil repo `fail_under=25`). Gaps connus :

- `src/tests/services/test_org_invites_service.py` **casse la collecte** (importe `_get_redis`, supprimé au rewrite PostgreSQL v4 des invitations) — exclu du run, à réécrire (dette du rewrite v4).
- 32 échecs pré-existants, drift tests/code : `test_auth_router` (9), `test_auth_third_party` (5), `test_emails_service` (3), `test_instance_router` (3), `test_org_users_service` (2), `test_core_events` (2), boards/playgrounds/marketing (1 chacun) + autres.

**Web (bun test)** : 25 pass / 1 fail / 1 error — `tests/catalog-pagination.test.mjs` importe `components/Objects/Catalog/catalogPagination.ts` qui n'existe plus (composant déplacé/renommé). Dette pré-existante à réparer.

## Dettes produit découvertes par cette couverture (fix inclus dans ce changeset)

1. `bun install --frozen-lockfile` cassé en Docker (bun 1.4 drift) → image épinglée `oven/bun:1.3.14-alpine`.
2. Standalone Turbopack Next 16 emboîté sous `app/` → normalisation dans le Dockerfile.
3. Serveur standalone mort au boot : Sentry/OTel `require-in-the-middle-<hash>` introuvable → gate DSN dans `instrumentation.ts` + fallback de résolution des externals hachés dans `server-wrapper.js`.
4. `NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL=http://localhost/` (compose) : serveur OK (nginx interne :80) mais navigateur KO → nginx écoute aussi :3009 dans le conteneur, URL publique alignée sur le port hôte.
5. Compose local : `LEARNHOUSE_INITIAL_ADMIN_EMAIL=admin@learnhouse.local` **impossible à créer** (TLD `.local` rejeté par le validateur) → toute stack neuve du compose n'a aucun compte. Contourné par `scripts/e2e/make_admin.py` (admin@e2e-tests.com) ; le compose de base reste à corriger.
