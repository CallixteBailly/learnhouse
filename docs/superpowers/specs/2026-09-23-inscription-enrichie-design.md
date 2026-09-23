# Design — Inscription enrichie (Phase 1 du projet Ordria)

**Date** : 2026-09-23
**Statut** : validé (délégation explicite de l'utilisateur — recommandations retenues)
**Brique** : Phase 1 / 5 du schéma Ordria (LMS central + marketplace)
**Repo** : branche `feat/cloudflare-compatibility`, déploiement Cloudflare (learn.ordria.fr)

---

## 1. Contexte et objectif

Le schéma cible Ordria exige qu'à l'inscription l'apprenant fournisse : nom, prénom,
**métier**, **téléphone** (facultatif) et un **consentement RGPD** tracé. Le formulaire
actuel de LearnHouse ne collecte que prénom / nom / email / mot de passe.

Cette brique ne fait que **collecter et stocker proprement**. Elle alimente les
recommandations par métier (Phase 3) et le fichier apprenants d'Ordria. Elle ne couvre
pas : paiements (Phase 2), recommandations (Phase 3), tableau de bord consolidé (Phase 4).

**État du code pertinent (vérifié 2026-09-23)** :
- `apps/api/src/db/users.py` — `UserBase` contient déjà `profile`, `details`,
  `extra_metadata` (colonnes JSON/JSONB). `UserCreate` hérite de `UserBase`, donc
  l'API accepte déjà ces payloads sans changement de schéma. `UserReadPublic`
  exclut `extra_metadata` (les consentements ne fuiteront pas publiquement).
- `apps/api/src/services/users/users.py` — trois chemins de création :
  `create_user` (:52, inscription ouverte dans une org, rôle membre `role_id=4`),
  `create_user_with_invite` (:195), `create_user_without_org` (:265).
- `apps/api/src/routers/users.py` — routes `POST /users/v1/users/{org_id}` (:165),
  invitation (:201), sans org (:254), `PUT /users/v1/users/{user_id}` (:360).
- Frontend : `apps/web/components/Auth/AuthModule.tsx` (formulaire), pages profil
  dans `apps/web/components/Objects/Account/`.

## 2. Décisions verrouillées

| Sujet | Décision |
|---|---|
| Saisie du métier | Liste déroulante **administrable par le superadmin Ordria, globale à la plateforme** + option « Autre » avec champ « Précisez votre métier » **obligatoire** quand « Autre » est choisi, texte libre ≤ 100 caractères (décision spec-owner 2026-09-23 : cohérent avec la validation serveur `other` non vide) |
| Métier obligatoire | **Oui** à l'inscription |
| Téléphone | **Optionnel**, validation format simple (type E.164 souple), éditable depuis le profil |
| Consentement | **Deux cases obligatoires** : conditions générales (ordria.fr/cgv) et politique de confidentialité (ordria.fr/mentions-legales) |
| Preuve RGPD | Consentements **horodatés** : date ISO serveur + version du texte + référence utilisateur |
| Comptes existants | **Bannière douce non bloquante** « Complétez votre profil » (jusqu'à métier renseigné) |
| Stockage | **Approche A** : `profile` et `extra_metadata` du User existants ; **aucune migration de la table `user`** |
| Liste des métiers | Nouvelle table `job_title`, pré-remplie (~20 métiers du digital) |

## 3. Architecture

### 3.1 Base de données

Nouvelle table `job_title` :

```
id            PK
label         VARCHAR(100), unique      # "Community Manager"
slug          VARCHAR(100), unique, index # "community_manager"
is_active     BOOLEAN default true       # désactivation plutôt que suppression (intégrité des profils)
sort_order    INT default 0
creation_date / update_date VARCHAR (convention LearnHouse)
```

- Migration Alembic : création de la table + seed d'environ 20 métiers.
- **Aucune modification de la table `user`.**

### 3.2 Stockage sur l'utilisateur

- `profile["job"]` :
  - cas liste : `{"title_id": 3, "slug": "community_manager", "label": "Community Manager", "other": null}`
  - cas « Autre » : `{"title_id": null, "slug": "other", "other": "Architecte 3D"}`
  - on stocke label+slug par dénormalisation volontaire : si un métier est renommé
    ou désactivé plus tard, les profils existants restent lisibles et les
    recommandations (Phase 3) pourront mapper sur `slug`.
- `profile["phone"]` : chaîne type `"+33612345678"` (nettoyée des espaces).
- `extra_metadata["consents"]` :
  ```json
  {
    "terms":  { "accepted": true, "accepted_at": "2026-09-23T14:05:00+00:00", "version": "2026-09" },
    "privacy": { "accepted": true, "accepted_at": "2026-09-23T14:05:00+00:00", "version": "2026-09" }
  }
  ```
  `extra_metadata` est exclu de `UserReadPublic` : les consentements ne sont visibles
  que de l'utilisateur lui-même et des admins.

La **version** du texte accepté est une constante de configuration (`CONSENT_TEXT_VERSION = "2026-09"`) à incrémenter manuellement si les textes légaux changent — les nouveaux consentements porteront la nouvelle version.

### 3.3 API (apps/api)

- **Nouveau router `job_titles`** (préfixe conforme à la convention des routers du
  projet, ex. `/job-titles/v1/...`, à figer dans le plan d'implémentation) :
  - `GET .../public` — liste des métiers actifs triés par `sort_order` puis
    `label`. Sans authentification (nécessaire au formulaire public d'inscription).
    Données non sensibles (libellés de métiers).
  - Routes admin superadmin : `POST /admin/job-titles`, `PUT /admin/job-titles/{id}`,
    `DELETE` logique (`is_active=false`). RBAC superadmin existant.
- **Validation à la création** — dans `create_user`, `create_user_with_invite` et
  `create_user_without_org` (factoring dans un helper commun `validate_signup_profile`) :
  - `job` requis : soit `title_id` existant **et actif**, soit `other` non vide
    (≤ 100 caractères). Refus `400` sinon.
  - `phone` optionnel ; si présent, regex souple `^\+?[0-9 .()-]{6,20}$` après trim.
  - `consents.terms` et `consents.privacy` doivent être `true` → refus `400` sinon.
  - Le serveur **réécrit** les horodatages (jamais confiance au client) et normalise
    `job` (label/slug résolus depuis `title_id`).
- **Mise à jour profil** (`update_user`) : accepte `profile.job` (mêmes validations,
  sans consents) et `profile.phone`. Les consentements ne sont pas modifiables par
  cette route (piste d'audit RGPD séparée si besoin ultérieur — hors périmètre).
- **Fiche membre admin org** : `UserRead` inclut déjà `profile` → le métier et le
  téléphone deviennent visibles pour l'admin de l'org sans développement API
  supplémentaire ; seul l'affichage frontend est à ajouter.

### 3.4 Frontend (apps/web)

- **Formulaire d'inscription** (`AuthModule.tsx`) :
  - champ « Votre métier » : `<select>` alimenté par `GET /public/job-titles`,
    option « Autre » en dernière position → révèle un champ texte « Précisez » ;
  - champ « Téléphone (optionnel) » ;
  - deux cases à cocher obligatoires avec liens hypertexte vers ordria.fr/cgv et
    ordria.fr/mentions-legales (liens globaux Ordria, conformes au branding actuel) ;
  - bouton désactivé tant que métier + 2 cases non renseignés ; messages d'erreur
    champ par champ en cas de refus serveur.
  - **Dégradation gracieuse** : si l'endpoint métiers est indisponible, le select
    n'affiche que « Autre » — l'inscription n'est jamais bloquée.
- **i18n** : nouvelles clés ajoutées aux 22 fichiers `locales/*.json` (fr/en rédigées,
  autres = valeur française par défaut via `defaultValue` i18next ; traduction
  fine ultérieure non bloquante).
- **Page profil** : sections « Métier » (même select) et « Téléphone », edition via
  le `PUT` existant.
- **Bannière douce** : composant léger dans le layout authentifié ; visible si la
  session utilisateur n'a pas `profile.job` ; lien vers la page profil ; fermable
  par session (rappel au rechargement suivant) ; jamais bloquante.
- **Dashboard superadmin** : page « Métiers » (liste + ajout + renommage +
  désactivation) dans l'admin global.

### 3.5 Flux nominal

1. Visiteur arrive sur l'espace Protech (inscription ouverte) → formulaire enrichi.
2. `POST /users/v1/users/{org_id}` avec `profile.job`, `profile.phone?`,
   `extra_metadata.consents` (booléens).
3. Serveur valide (helper commun), réécrit horodatages + normalisation, crée le
   compte + membership org (rôle membre) — comportement existant inchangé.
4. Analytics existant `USER_SIGNED_UP` enrichi de `job_slug` dans les properties
   (utile Phase 3/4).
5. Connexion d'un ancien compte sans métier → bannière douce.

## 4. Gestion d'erreurs

| Cas | Comportement |
|---|---|
| Métier absent / `title_id` inconnu ou inactif / `other` vide | `400` avec code `INVALID_JOB`, message champ identifié |
| Une des deux cases absente | `400` code `CONSENT_REQUIRED` |
| Téléphone malformé | `400` code `INVALID_PHONE` |
| Endpoint métiers down (côté web) | select réduit à « Autre », inscription possible |

## 5. Tests

**Automatiques (pytest, apps/api)** :
- `POST` inscription : sans job → 400 ; `title_id` inactif → 400 ; consents absents → 400 ;
  phone invalide → 400 ; happy path liste → 201, `profile.job` normalisé,
  `extra_metadata.consents` horodaté serveur ; happy path « Autre » → 201.
- Invitation et sans-org : mêmes validations actives.
- `GET .../public` des métiers : actifs seuls, tri correct, sans auth.
- Admin : CRUD protégé superadmin (non-superadmin → 403).
- `update_user` : job/phone éditables, consents intouchables par cette route.

**Manuels (navigateur)** : inscription complète desktop + mobile, bannière ancien
compte, CRUD métiers admin, affichage fiche membre.

## 6. Risques et mitigations

- **i18n 22 locales** : clés avec `defaultValue` français → aucun blocage.
- **Endpoint public sans auth** : libellés de métiers non sensibles ; rate-limit
  standard de l'instance s'applique.
- **Métiers désactivés vs inscrits existants** : `slug` dénormalisé dans le profil →
  lecture toujours possible.
- **Ne pas casser l'existant** : validations ajoutées uniquement sur les chemins
  d'inscription ; les créations OAuth (Google) passent par `is_oauth=True` → le
  métier leur sera demandé via la bannière douce (parité de collecte garantie).

## 7. Hors périmètre (rappels)

Recommandations par métier (Phase 3), paiements Stripe (Phase 2), tableau de bord
consolidé opérateur (Phase 4), modification des textes légaux eux-mêmes, export RGPD
des consentements (peut être ajouté plus tard comme simple lecture admin).
