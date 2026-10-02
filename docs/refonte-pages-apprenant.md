# Refonte pages apprenant (cours + activité) — plan d'implémentation

**Date** : 2026-09-26 · **Branche** : `feat/cloudflare-compatibility`
**Sources design** : wireframes OpenDesign `ordria-academy-b920` — `wireframe-refonte-cours-v1.html` (desktop) et `wireframe-refonte-cours-v2.html` (mobile first 375 px + état commencé).

## 1. Périmètre

**IN (modifié)** — pages apprenant uniquement :
- `apps/web/app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/course.tsx`
- `apps/web/app/orgs/[orgslug]/(withmenu)/course/[courseuuid]/activity/[activityid]/activity.tsx`
- Nouveaux composants apprenant : `apps/web/components/Pages/Courses/CourseHeroProgress.tsx`, `CoursePlanAccordion.tsx`

**OUT (interdit de modifier)** — le backoffice reste tel quel :
- tout `apps/web/app/orgs/[orgslug]/dash/**` (gestion cours, analytics, admin)
- l'éditeur d'activité (`activity/[activityid]/edit`) et les composants d'édition
- l'API (`apps/api`), les emails, les webhooks
- Phase ultérieure (hors périmètre aujourd'hui) : vitrine académie publique et dashboard « Mon apprentissage » (wireframes v1/v2 déjà produits)

## 2. Design

Tokens existants `--ordria-*` de `apps/web/styles/globals.css` (accent `#3b65ff`, fond `#f7f9f9`, texte `#1d1d1b`, boutons ombre dure `0 4px 0`). Aucune nouvelle couleur, aucune nouvelle dépendance.

## 3. Modèle d'état « formation commencée » (unique pour les 2 pages)

Calculé côté client depuis `useTrail` (cache partagé existant) :
- `completedActivities` = steps `complete` du run du cours ; `progressPercent` = completed / total
- activité courante = `props.current_activity` (next_activity du run) sinon première activité non terminée
- Sémantique des segments (wireframe v2) : rempli = terminé · contour/liseré bleu = courant · neutre = à venir ; gap élargi = frontière de chapitre (déjà géré par `ActivityIndicators`)

**Prérequis vérifié** : `add_activity_to_trail` (apps/api `src/services/trail/trail.py`) crée le `TrailRun` s'il n'existe pas → un CTA lien vers la première activité est sûr pour « Commencer », l'inscription se fait à la première complétion. Le bouton explicite de `CoursesActions` (startCourse/leave/offres) est conservé à l'identique.

## 4. Changements — page cours

1. **Hero desktop 7/5** (wireframe D1/M1) : gauche = titre, description (`course.description`), chips tags (`course.tags`, CSV), carte progression ; droite = couverture (toggle image/vidéo conservé) + carte `CoursesActions` dessous (offres payantes, contributeur, quitter).
2. **`CourseHeroProgress.tsx`** : anneau de progression %, « X/Y activités », chip « Activité en cours : … », CTA primaire `Reprendre · <activité>` (lien vers l'activité courante) ou `Commencer` (lien vers la 1re activité, `guardLink` → /signup si déconnecté), secondaire « Revoir le plan » (ancre `#plan-du-cours`).
3. **Strip stats 5 blocs** : chapitres · activités · terminées · quiz · certificat (desktop 5 col, mobile 2 col). Remplace la carte latérale « Informations du cours ».
4. **`CoursePlanAccordion.tsx`** remplace la timeline verticale (cercles ▶/✓/🔒) : chapitres en accordéon (courant ouvert par défaut), rangées activités avec état, badge type, pill d'action (Revoir/Reprendre/Ouvrir), ligne certificat en fin (cadenas → lien /activity/end).
5. **Mobile (M1)** : couverture pleine largeur (existant), carte progression avec CTA pleine largeur, tags défilables, stats 2×2, accordéon compact, barre collante `CourseActionsMobile` conservée.

**Conservés à l'identique** : breadcrumbs, `CourseShare`, `CoursesActions` (logique start/leave/offres/contributeur inchangée), auteurs (version compacte), section communauté, learnings, `ActivityIndicators` (bloc masqué existant), JSON-LD SEO, analytics (`CourseViewed`), `guardLink`, prefetch au survol, états loading/error.

## 5. Changements — page activité

6. **Bande de progression mobile** : retirer le wrapper `hidden md:block` autour de `ActivityIndicators` → sa variante mobile compacte (sélecteur de chapitre + X/Y + barre) s'affiche sous la barre collante existante (wireframe M2).
7. **Barre basse mobile** : indicateur de position « N/M » (position courante / total) entre Précédent et Suivant.

**Conservés à l'identique** : focus mode, AI ask, dropdown chapitre, partage, quiz/devoirs, `CourseEndView` (fin de cours + certificat), `FixedActivitySecondaryBar`, bouton contribute/éditer pour contributeurs, breadcrumbs, carte « À retenir », verrous `is_locked`/`paid_access`.

## 6. i18n

Nouvelles chaînes via le motif `t('cle', 'fallback français')` déjà utilisé dans le code — aucun fichier de locale modifié (22 locales).

## 7. Vérification

1. `npx tsc --noEmit` avec `--ignoreDeprecations` (piège TS5101 connu).
2. `npm run dev` (apps/web) pointé en lecture sur l'API prod via `NEXT_PUBLIC_*`, connexion, captures 1440 px + 375 px des deux pages, états non commencé / commencé — aucune écriture (pas de clic Commencer/marquer).
3. `git diff --name-only` ne doit contenir **aucun** fichier sous `dash/`, `manage/`, `apps/api`, `activity/*/edit`, `ee/`.
4. Contrôle DOM : titres/états présents, zéro débordement horizontal à 375 px.
