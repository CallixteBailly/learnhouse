## Refonte LearnHouse vers design system Ordria

**Décisions confirmées :**
- Palette OKLCH d'Ordria (Bleu Nuit #101C3F, Cyan Éclat #1FC8E6, Blanc Cassé #F8FAFD, etc.) en fond clair
- Garder le côté 3D ludique Duolingo (`duo-btn-*`, `box-shadow: 0 4px 0`)
- Logo monogramme "O concentrique + point cyan" d'Ordria
- Nom affiché : **Ordria Learning**
- Unifier aussi les tokens shadcn (HSL) avec la palette Ordria
- URLs externes → ordria.fr
- Portée : essentielle + pages clés (home, landing)

---

### Phase A — Migration des tokens (globals.css) — *impact massif, risque faible*

Les composants consomment `var(--ordria-*)` (231 usages) et `var(--primary)`/`var(--accent)` shadcn (300 usages). En changeant **uniquement les valeurs dans `:root`**, les changements se propagent partout.

**Fichier : `apps/web/styles/globals.css` lignes 526-619**

1. **Tokens shadcn HSL** (lignes 526-549) — convertir depuis la palette OKLCH Ordria :
   - `--background` : `230 35% 99%` (Blanc Cassé #F8FAFD)
   - `--foreground` : `228 56% 14%` (Bleu Nuit #101C3F — déjà bon ✓)
   - `--primary` : `187 81% 49%` (Cyan Éclat — déjà bon ✓)
   - `--accent` : passer de `199 89% 55%` (bleu soutenu) → **`187 81% 49%`** (aligner sur cyan)
   - `--ring`, `--chart-1` : aligner sur cyan
   - `--secondary`, `--muted` : teinter légèrement en `brume` (#EAF0FF) pour cohérence

2. **Tokens `--ordria-*`** (lignes 581-595) — passer du HEX à **OKLCH** (moderniser) :
   ```
   --ordria-background:     oklch(0.985 0.004 264);  /* Blanc Cassé */
   --ordria-surface:        oklch(0.96 0.012 264);   /* Bleu Brume */
   --ordria-foreground:     oklch(0.23 0.06 264);    /* Bleu Nuit */
   --ordria-muted:          oklch(0.52 0.02 265);    /* Ardoise clair */
   --ordria-border:         oklch(0.85 0.015 264);
   --ordria-accent:         oklch(0.80 0.13 213);    /* Cyan Éclat #1FC8E6 */
   --ordria-accent-secondary: oklch(0.55 0.20 263);  /* Azur vif (ombre 3D) */
   --ordria-accent-bg:      oklch(0.92 0.08 213);    /* Cyan soft */
   --ordria-accent-border:  oklch(0.80 0.13 213 / 0.4);
   --ordria-success:        oklch(0.62 0.15 150);    /* vert, WCAG AA */
   --ordria-warning:        oklch(0.75 0.14 75);
   --ordria-error:          oklch(0.60 0.18 25);
   ```
   + Ajouter `--ordria-azur: oklch(0.40 0.17 265)` (bleu signature pour hover/links)
   + Définir enfin `--ordria-font-display` et `--ordria-font-body` (utilisés mais non définis — bug)

3. **Ombres 3D en dur** (lignes 600-605) — garder la hauteur `0 4px 0` mais utiliser les tokens :
   - `#e5e5e5` → `var(--ordria-border)` (cohérence)
   - `#a63a36` → couleur dérivée de `--ordria-error` (OKLCH darken)
   - `#6b21a8` → supprimer (jamais utilisé)

4. **Couleurs en dur dans les `.tsx`** — remplacer :
   - `course.tsx:617` `#1e7a4d` → `color-mix(in oklch, var(--ordria-success), black 20%)`
   - `course.tsx:713` `#8a6420` → `color-mix(in oklch, var(--ordria-warning), black 25%)`
   - `CourseEndView.tsx:429` confetti → référencer les tokens

### Phase B — Composant `<Logo>` unifié

**Créer : `apps/web/components/Objects/Brand/Logo.tsx`** (nouveau)

Portage du composant `Logo.astro` d'Ordria en React/Next.js, avec :
- SVG monogramme "O" : 2 cercles concentriques + point cyan en haut-droite (point qui pulse subtilement)
- Props : `variant: 'mark' | 'lockup'`, `size: 'sm' | 'md' | 'lg' | 'xl' | number`, `tone: 'light' | 'dark'`, `animated?: boolean`, `href?: string`, `showText?: boolean`, `className?: string`
- Texte "Ordria Learning" en Sora 700, letter-spacing -0.03em
- Accessibilité : `aria-label="Ordria Learning — accueil"`, `<span class="sr-only">`
- `prefers-reduced-motion` supporté

### Phase C — Remplacement du logo + URLs + metadata

**Créer un asset SVG** `apps/web/public/ordria-o.svg` (monogramme seul, pour favicons/preview)

**Remplacer dans ~15 emplacements clés** (liste priorisée par visibilité) :

| Priorité | Fichiers | Action |
|---|---|---|
| 🔴 Haute | `OrgMenu.tsx:553-568` (`LearnHouseLogo`) + `:162-167` (header public) | `<Logo variant="lockup" size="md" />` |
| 🔴 Haute | `AuthBrandingPanel.tsx:148-159, 192-199, 206` + `AuthMobileHeader.tsx:70-83` | `<Logo variant="lockup" size="lg" />` + fallback texte `'Ordria Learning'` |
| 🔴 Haute | `DashLeftMenu.tsx:263-267` + `DashMobileMenu.tsx:106-110, 202` | `<Logo variant="lockup" size="sm" tone="dark" />` |
| 🔴 Haute | `home.tsx:91-97, 230-236` (org picker) | `<Logo />` + "Powered by Ordria Learning" |
| 🟡 Moyenne | `AdminLeftMenu.tsx:43`, `Editor.tsx:684`, `PlaygroundEditor.tsx:60` | `<Logo variant="mark" />` (supprimer les duplications) |
| 🟡 Moyenne | `not-found.tsx:11-16`, `EmbedActivityClient.tsx:170, 268` | `<Logo variant="lockup" size="xl" />` |
| 🟢 Basse | `Watermark.tsx`, `BoardTopBar.tsx`, `BoardToolbar.tsx`, `CommandPalette.tsx`, `WelcomeModal.tsx`, `(hub)/new/page.tsx:972` | `<Logo variant="mark" />` |

**URLs externes → ordria.fr** :
- `learnhouse.io` / `www.learnhouse.io` → `ordria.fr`
- `docs.learnhouse.app` → `ordria.fr/docs` (ou lien à confirmer)
- `discord.gg/learnhouse` → laisser ou remplacer selon ton Discord
- `support@learnhouse.io` → email à confirmer (je laisse si tu n'as pas précisé)
- `RESERVED_SLUGS = ['learnhouse', ...]` → ajouter `'ordria'`

**Metadata** :
- `app/admin/layout.tsx:7-8` : `'LearnHouse Admin'` → `'Ordria Learning — Admin'`
- `app/orgs/[orgslug]/dash/layout.tsx:5-6` : déjà `'OrdIA Learning'` → `'Ordria Learning'`
- `app/auth/*/page.tsx` : aligner tous les fallbacks sur `'Ordria Learning'`
- Ajouter `app/icon.tsx` (favicon Next.js conventionnel) qui rend le monogramme O
- Ajouter `app/opengraph-image.tsx` (image sociale avec monogramme + "Ordria Learning")

### Phase D — Patterns Ordria dans globals.css

Ajouter (en plus des `duo-*` existants qu'on garde) les classes utilitaires du design system Ordria :
- `.container-ordria` (max-width 80rem + gutters responsive)
- `.kicker` (eyebrow : Sora uppercase 0.75rem + trait cyan)
- `.btn-primary-ordria` (flat cyan, hover translateY -2px + glow shadow) — **distinct de `.duo-btn-success`** (3D), pour les pages marketing
- `.btn-ghost-dark` (outline sur fond sombre)
- `.card-ordria` (border full, hover border cyan + translateY -3px)
- `.mesh-hero` (gradient multi-radial pour hero)
- `.text-gradient-ordria` (dégradé Blanc→Cyan pour un accent)
- `.section` (padding vertical fluide `clamp(4.5rem, 3rem + 6vw, 8rem)`)
- Animations `data-reveal` (stagger), `prefers-reduced-motion`

### Phase E — Refonte des pages clés (home + landing)

**`app/home/home.tsx`** (sélecteur d'org, première page vue par l'utilisateur connecté) :
- Header avec logo lockup
- Hero simple : `<h1>` Sora + sous-texte + CTA `.btn-primary-ordria`
- Cards organisations en `.card-ordria` (au lieu de `duo-card-hover` 3D)
- Footer "Powered by Ordria Learning"

**`components/Landings/LandingClassic.tsx`** (page publique d'une org) :
- Section hero avec `.mesh-hero` (gradient immersif) + `.kicker` + wordmark animé
- Cards cours en `.card-ordria`
- Conserver la barre de progression `duo-progress-*`

### Phase F — Vérifications

- `python3 -c "import json; json.load(open('apps/web/locales/fr.json'))"` (valider JSON)
- `pnpm exec tsc --noEmit` dans `apps/web` (vérifier types)
- `pnpm build` ou du moins `pnpm dev` pour vérifier visuellement
- Git diff stat final

---

## Ce qu'on NE touche PAS
- Variables d'environnement (`NEXT_PUBLIC_LEARNHOUSE_*`) — casserait la config déploiement
- Identifiants techniques internes (`'learnhouse_auth_sync'`, `'learnhouse-scorm-styles'`, etc.)
- Noms de composants TypeScript (`LearnHouseEmail`, `LearnHousePlayer`) — visibilité interne uniquement
- Le fond Bleu Nuit sur les pages pédagogiques (cours, activité) — on garde Blanc Cassé clair comme demandé

## Risques & mitigations
- **Risque visuel** (couleurs qui claquent moins) : je teste les valeurs OKLCH→HEX avant de pousser, et je garde les hex des PDFs Ordria comme référence absolue.
- **Logo SVG mal rendu** : je porte le SVG exact du `Logo.astro` (déjà validé en prod sur ordria.pages.dev).
- **Casse d'un fallback org logo** : je préserve la logique "si l'org a un logo custom, l'afficher ; sinon fallback sur `<Logo>` Ordria".
- **Build qui échoue** : le `tsc --noEmit` + `pnpm build` en fin de chantier garantit zéro régression compile.

## Périmètre temporel
C'est un chantier conséquent (~25-30 fichiers modifiés). Je procède par phases indépendantes et commitables :
1. **Phase A** (tokens) — peut être validée visuellement seule
2. **Phase B+C** (logo + remplacement) — dépend de A
3. **Phase D+E** (patterns + pages) — dépend de A

Si tu veux, je peux faire A+B+C dans ce commit puis D+E dans un commit suivant. Sinon, tout d'un coup.