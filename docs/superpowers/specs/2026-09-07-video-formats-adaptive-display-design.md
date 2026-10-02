# Design — Support de tous les formats vidéo + affichage adaptatif (surtout mobile)

Date : 2026-09-07 · Branche : `feat/cloudflare-compatibility` · Validation : screenshots UI (demande explicite de l'utilisateur, qui a délégué le plan et les décisions)

## Problème

1. **Formats** : seuls MP4 et WebM sont acceptés (listes web `accept`, extensions/MIME serveur, magic bytes, portes `content_type` des activités vidéo). Une vidéo iPhone `.mov`, un `.mkv` ou `.avi` sont rejetés.
2. **Affichage** : tous les lecteurs sont dans un wrapper `aspect-video` (16:9 fixe) — une vidéo verticale 9:16 ou carrée 1:1 est letterboxée avec de grosses bandes noires, surtout pénible sur mobile. Seule l'activité vidéo a un `max-h-[60vh]` qui casse le ratio au lieu de l'adapter.

## Décision clé (l'insight)

LearnHouse possède **déjà un pipeline de transcodage HLS basé ffmpeg** (`hls_transcode.py` + `hls_jobs.py`) qui produit un flux H.264/AAC lisible par tous les navigateurs. Le pipeline accepte en entrée **tout ce que ffmpeg sait décoder** — la restriction à mp4/webm est purement artificielle (listes de validation). 

**Conséquence : on peut accepter tous les formats courants sans ajouter de transcodage spécifique** — le HLS devient le chemin universel, et la lecture progressive directe reste disponible pour les formats que les navigateurs savent lire nativement.

## Partie 1 — Formats acceptés

Liste finale (conteneurs) : **mp4, m4v, mov, webm, mkv, avi, wmv, flv, ogv, mpg/mpeg, 3gp**.

| Couche | Changement |
|---|---|
| API `file_validation.py` | extensions + MIME canoniques + `validate_video_content` étendu aux magic bytes de chaque conteneur (ftyp/atoms QuickTime, EBML matroska, RIFF/AVI, ASF, FLV, OggS, MPEG-PS, ftyp 3gp) + maps `EXT_TO_CANONICAL_MIME` / `MIME_TO_SAFE_EXT` |
| API `videoBlock.py` + `upload_files.py` | listes de formats étendues |
| API `activities/video.py` | portes `content_type` remplacées par une vérification extension **ou** MIME (les navigateurs envoient des MIME exotiques pour mkv/avi) |
| Web `lib/constants.ts`, `lib/file-validation.ts` | listes miroir + matching par extension (le MIME navigateur n'est pas fiable pour mkv/avi) |
| Web `VideoBlockComponent`, `VideoActivityModal`, `PasteFileHandler` | `accept` étendu, garde glisser-déposé par extension |

**Lecture progressive** (avant que le HLS soit prêt) : mp4, m4v, mov, webm, ogv passent directement dans le `<video>` ; pour les autres formats (mkv, avi, wmv, flv, mpeg, 3gp) le composant affiche un écran « conversion automatique en cours » avec polling du statut HLS (10 s) au lieu d'un lecteur en erreur.

`ensure_faststart` gérait déjà `.mov`/`.m4v` (remux lossless) — inchangé.

## Partie 2 — Affichage adaptatif au ratio

Nouveau composant **`AdaptiveVideoShell`** (`apps/web/components/Objects/Activities/Video/AdaptiveVideoShell.tsx`) :

- Ratio réel mesuré **depuis la vidéo** : `LearnHousePlayer` expose un callback `onDimensions(w, h)` branché sur `loadedmetadata` (video.js `videoWidth()/videoHeight()`), + **indice serveur** : `width`/`height` sonnés par ffprobe et persistés dans `hls` meta (bloc `content.hls` / activité `extra_metadata.hls`) lors du transcodage → zéro layout shift une fois HLS prêt.
- Tant que le ratio est inconnu : fallback 16:9 (comportement actuel, pas de régression).
- Calcul de boîte déterministe : `largeur = min(réglage taille 480/720/960, largeur dispo)` puis `hauteur = largeur / ratio`, plafonnée à `75vh` (hauteur de fenêtre suivie en direct → gère la rotation mobile). Si plafonné, la largeur est recalculée pour préserver le ratio → **plus aucun letterbox**.
- ResizeObserver sur le conteneur + écoute de la hauteur de fenêtre → responsive complet.
- Ratio clampé entre 0.25 et 4 pour éviter les boîtes dégénérées.

Appliqué à : bloc vidéo (vue apprenant, aperçu éditeur, modal agrandie) et activité vidéo hébergée. **YouTube reste en 16:9** (l'iframe gère elle-même son letterbox interne — on ne peut pas mesurer la vidéo).

**Sprites de survol** : la cellule était fixe à 160×90 (déformée en portrait). Désormais calculée d'après le ratio réel — 16:9 → 160×90 (inchangé), 1:1 → 90×90, 9:16 → 90×160 — avec letterbox interne par `pad` pour des cellules uniformes.

## Partie 3 — Plein écran (ajoutée le 2026-09-07, sur demande)

Constat : video.js masque sa barre de contrôle (`display:none`) tant que la vidéo n'a pas démarré (`.vjs-has-started`) — **aucun accès au plein écran avant la première lecture**, seul le gros bouton Play est visible.

1. **Barre visible avant lecture (au survol uniquement)** — override CSS dans `player-controls.css` : `.video-js.vjs-user-active:not(...) .vjs-control-bar { display:flex }` (style YouTube). La barre n'apparaît qu'interaction (survol souris / tap), et le fondu stock pendant la lecture reste inchangé. Les contrôles de temps (`.vjs-current-time/.vjs-duration/.vjs-remaining-time/.vjs-time-divider`) sont **masqués avant `vjs-has-started`** : video.js y rend un temps invalide (« -20:6 ») tant que la durée est inconnue.
2. **Bouton plein écran dédié sur le bloc vidéo** — nouveau bouton Maximize dans l'overlay (à côté d'Agrandir, vue apprenant + éditeur) : un clic = vrai plein écran navigateur. Il route via `FullscreenToggle.handleClick()` de video.js pour hériter des fallbacks plateforme (notamment iPhone → plein écran natif de la vidéo, l'API element-Fullscreen n'existant pas sur iOS Safari). Le player est exposé au parent via `onReady(player)`.
3. **Orientation mobile automatique** — au `fullscreenchange`, `screen.orientation.lock()` aligne l'écran sur l'orientation de la vidéo (paysage → landscape, portrait → portrait), avec `unlock` en sortie. Supporté par Chrome Android uniquement (en plein écran) ; iOS ignore silencieusement — best-effort cosmétique.
4. La modal « Agrandir » et l'activité vidéo gardent le bouton natif de la barre (désormais visible avant lecture aussi, au survol).
5. **Fallback fullwindow réparé** — le mode `fullwindow` de video.js (utilisé quand l'API Fullscreen manque : iframe sans `allow="fullscreen"`, iPhone) laissait le player dans son contexte d'empilement d'origine → **toute l'interface de la page restait par-dessus la « vidéo plein écran »**. Désormais : le player est **reparenté sur `<body>`** pendant le fullwindow (restauré à sa place à la sortie et avant dispose — le nœud étant créé imperativement, React ne le gère jamais) et `body.vjs-full-window .video-js.vjs-fullscreen { z-index: 2147483000 }` le place au-dessus de tout chrome de page.
6. **Overlay utilisable au tactile** — les chips Plein écran/Agrandir étaient `opacity-0 group-hover:opacity-100` : invisibles sur mobile (pas de hover). La classe `.lh-video-overlay` les rend toujours visibles sur écran tactile et hover-révélées sur pointeur (`@media (hover:hover)`).
7. **Parité YouTube (v2 bis, clarification user)** — le plein écran visé est l'expérience YouTube : video.js la fournit nativement (clic = play/pause, **double-clic = plein écran on/off**, barre visible à l'activité puis fondu 1 s après 2 s d'inactivité, `cursor:none` en plein écran inactif). Seul le raccourci **`f`** manquait → ajouté dans LearnHousePlayer (keydown document, actif si le player est survolé OU est celui en plein écran, ignoré si l'utilisateur tape dans un champ/éditeur). Preuves mesures headful : `3.controls(active)=display:flex opacity=1`, `4.controls(idle)=opacity≈0 pointerEvents=none cursor=none`, `5.dblclick exits=true`, `6/7.key f toggles=true`. Captures shot-15 (contrôles visibles en lecture) et shot-16 (contrôles fondus au repos — vidéo pure).

*Note tests (v2, après rejet utilisateur des premières captures)* : le navigateur MCP **headless** refuse `requestFullscreen` (« not granted ») — les premières captures 12-13 étaient des simulations fullwindow AVANT réparation du reparenting, ce qui montrait l'UI de la page par-dessus la vidéo (rejet légitime). Re-validation avec **Chromium headful** (`playwright-core` + Chrome for Testing en cache, clics réels = user activation) : shot-12 est un **vrai** `document.fullscreenElement` non-null, vidéo 1440×900 = viewport entier. En émulation iPhone, video.js passe par le fallback fullwindow (réparé) — vidéo plein cadre 390×844, zéro chrome de page. Mesures : `11.controlBarDisplay=flex`, `11.timeDisplay=none`, `12.fullscreenElement=vjs-fullscreen`, `13.overlayOpacity(touch)=1`, `14.overlayOpacity(hover)=1`.

## Points hors périmètre (recommandations)

- **Vimeo en source externe** : aujourd'hui possible via le bloc Embed générique (mode URL). Un sous-type dédié « Vimeo » comme YouTube serait du sucre — non inclus.
- **Conversion HEVC/ProRes** : si un .mov contient du HEVC, ffmpeg le transcode en H.264 via HLS → ça marche ; la lecture progressive brute peut échouer en attendant le HLS (écran de conversion le couvre).
- Taille max vidéo inchangée (5 Go serveur).

## Tests

- **Unitaires API** : magic bytes de chaque nouveau conteneur, cohérence des maps MIME↔extensions, `get_safe_filename`.
- **UI (validation utilisateur)** : Playwright sur stack locale — upload de vidéos 16:9 / 9:16 / 1:1 / 4:3 + un `.mov` iPhone et un `.mkv`, screenshots desktop (1440×900) et mobile (390×844), en vue apprenant et éditeur.
