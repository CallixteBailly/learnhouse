# Product

## Register

**Brand** (marketing surface). La landing principale d'une org Ordria Learning est une page de marque : elle communique l'identité de l'organisation de formation et donne envie de consommer les cours. Le design EST le produit sur cette surface.

## Users & Purpose

**Utilisateurs** : apprenants(curieux, professionnels en reconversion, étudiants) qui arrivent sur une page d'org Ordria Learning pour découvrir les formations disponibles.

**Contexte d'usage** : principalement mobile et desktop, en session courte (découverte, évaluation rapide de la valeur, décision de s'inscrire).

**Job-to-be-done** : "Trouver une formation qui me parle, juger sa qualité en 10 secondes, et démarrer."

**Émotion cible** : confiance, énergie, désir de progression. Pas d'austérité scolaire, pas de froideur corporate. Un mix entre un studio créatif et une chaîne tech YouTube premium.

## Brand personality

**Studio · Pédagogique · Premium-ludique.**

Références pertinentes (ce qui colle) :
- **MKBHD / Marques Brownlee** (tech YouTuber) : hero vidéo cinématique, photography high-contrast, typographie display heavy, mise en scène 16:9.
- **Lex Fridman / Andrew Huberman** : long-form companion, opinionated, "read along".
- **Linear** (app) : exécution typographique impeccable, contrastes assumés.

Anti-références (ce qu'on ne veut PAS) :
- LMS classique froid (Moodle, Canvas).
- SaaS beige/cream générique.
- Landing pages AI monoculture (eyebrows partout, cards identiques).
- Éditorial magazine (Fraunces italic + drop caps) — mauvais registre pour du contenu tech.

## Accessibility & inclusion

- Contraste WCAG AA minimum (≥4.5:1 body, ≥3:1 large).
- `prefers-reduced-motion` obligatoire pour toutes les animations.
- Textes alternatifs descriptifs sur toutes les images.
- Navigation clavier fonctionnelle sur tous les filtres/interactive elements.

## Strategic design principles

1. **Le cours est une vidéo.** La thumbnail du cours doit être traitée comme une thumbnail YouTube — haute résolution, overlay dégradé, durée visible, play button au hover.
2. **Opinionated, pas neutre.** Les sections ont une voix : "Recommandations", "Vus récemment", "Nouveautés" — comme un créateur qui oriente son audience.
3. **Couleur = signal.** Sur fond blanc cassé clair, l'accent cyan d'Ordria signale l'action, le rouge signale le "signal/important" (nouveautés, live), le jaune néon pour les "picks" / recommendations.
4. **Motion justifiée.** Hover-to-preview (muted video), slide-shuffle au filtre, sticky-companion pour les reviews longues. Jamais de fade-in générique sur chaque section.
5. **Typography committed.** Display heavy (Sora 700+) pour les titres, body grotesque (Inter) pour la lecture. Pas de temps de faiblesse typographique.

## Stack

- Next.js 16 + Turbopack
- Tailwind CSS + globals.css (tokens `--ordria-*` en OKLCH + shadcn HSL)
- react-i18next
- TanStack Query (`useCourses`, `useTrail`)
- Composants existants : `Logo` (Brand), `CourseThumbnail`, patterns `.duo-*` et `.container-ordria`, `.card-ordria`, `.kicker-ordria`, `.mesh-hero-ordria` définis dans `globals.css`.
