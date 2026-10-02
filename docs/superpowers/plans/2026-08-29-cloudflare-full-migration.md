# Migration COMPLÈTE vers Cloudflare — Plan v2

> Suite de `2026-07-23-cloudflare-compatibility.md` (v1 : frontend Pages + tunnel VPS).
> La v1 garde le backend sur un VPS Dokploy. La v2 exige demandée par l'utilisateur :
> **toutes les fonctionnalités tournent sur Cloudflare**, plus de VPS.

## Architecture cible

```
                    ┌──────────────── Cloudflare ────────────────┐
ordria.app/*  ────► │ Frontend Worker (OpenNext, edge, SSR)      │
ordria.app/api/v1*  │                                           │
ordria.app/content* ├─► API Container Worker ──► Container       │
ordria.app/collab*  │   (zone Routes)            ├ FastAPI:9000 │
                    │                            ├ collab:4000  │
                    │                            ├ redis:6379   │
                    │                            └ nginx:8080   │
                    │  R2 learnhouse-content (s3api)             │
                    └────────────────┬───────────────────────────┘
                                     │ TCP sortant
                              Neon Postgres (+pgvector, externe)
```

- **Un seul domaine** (`ordria.app`) : les Cloudflare Workers **Routes** dirigent
  `/api/v1*`, `/content*`, `/collab*` vers le Worker du container, le reste vers le
  Worker frontend. Same-origin → les appels `credentials: 'include'` du frontend
  fonctionnent sans CORS (nginx faisait la même chose en local).
- **Postgres** : ne peut pas tourner sur Cloudflare → Neon (free tier, pgvector OK).
- **Redis** : dans le container (cache/révocation tokens — perte acceptable au restart).
- **ffmpeg** (HLS) : s'installe dans l'image du container (VM Linux complète).
- **Le VPS Dokploy et le tunnel cloudflared disparaissent** ; docker-compose reste
  uniquement pour le dev local.

## Pourquoi ce design

- `credentials: 'include'` dans `apps/web/services/auth/sso.ts` etc. → split-domain
  (api.ordria.app) imposerait CORS + cookies cross-site. Routes same-origin = zéro
  changement frontend.
- `getServerAPIUrl()` (SSR Worker) → URL absolue `https://ordria.app/api/v1/` →
  repasse par la zone route → container. Roundtrip edge CF acceptable.
- Un seul container (API + collab + redis + nginx) : state collab en mémoire, redis
  local, `max_instances = 1` pour la cohérence.
- Frontend sur **Workers** (recommandé par OpenNext 1.x, Pages est legacy).

## Tâches

### Tâche 1 — Frontend sur Workers + vérification build
- `apps/web/wrangler.toml` → `apps/web/wrangler.jsonc` (Workers : `main`, `assets`,
  `vars`, compat date 2025-09-01, flags `nodejs_compat` + `global_fetch_strictly_public`).
- Scripts package.json : `build:worker` = `opennextjs-cloudflare build`,
  `deploy` = build + `wrangler deploy`, `preview` = `wrangler dev`.
- **Vérifier réellement** `bun run build` (BUILD_FOR_PAGES=1) puis
  `opennextjs-cloudflare build` — corriger ce qui casse.

### Tâche 2 — Container API (`apps/cloudflare-api/`)
- `Dockerfile` : python:3.14-slim + node (collab) + redis-server + nginx + ffmpeg ;
  contexte = racine du repo (accède à `apps/api`, `apps/collab`).
- `nginx-api.conf` : `/ping` → 200 ; `/collab` → 4000 (WS) ; tout le reste → 9000.
- `start.sh` : redis-server + migrations/init admin (`cli.py install --short` non
  bloquant) + uvicorn + collab + nginx (foreground).
- `src/worker.ts` : classe `Container` (`defaultPort 8080`, `sleepAfter 5m`,
  envVars non-secrets) + secrets Worker injectés au constructeur ; fetch → container.
- `wrangler.jsonc` : `[[containers]]` image=./Dockerfile, instance_type basic,
  max_instances 1 ; binding DO + migration `new_sqlite_classes`.
- `package.json` (deps `@cloudflare/containers`, `wrangler`, `typescript`).

### Tâche 3 — Vérifier `docker build` du container API en local

### Tâche 4 — Scripts v2
- `apps/scripts/setup-cloudflare.sh` : R2 bucket + enregistrement DNS de la zone
  (A/AAAA ordria.app → Workers routes) — plus de tunnel.
- `apps/scripts/deploy-cloudflare.sh` : deploy frontend + API (2 × wrangler),
  secrets documentés (`wrangler secret put` …).

### Tâche 5 — docker-compose devient dev-only (comments, pas de tunnel requis)

### Tâche 6 — Rewrite `docs/CLOUDFLARE-DEPLOY.md` (archi v2, Neon, R2 token,
secrets, routes, cold starts, coût)

## Secrets (Worker API container)
`LEARNHOUSE_SQL_CONNECTION_STRING` (Neon), `LEARNHOUSE_AUTH_JWT_SECRET_KEY`,
`NEXTAUTH_SECRET`, `COLLAB_INTERNAL_KEY`, `LEARNHOUSE_AI_API_KEY`,
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_ENDPOINT_URL_S3` (R2).

## Risques
- Build OpenNext frontend inédit → peut révéler des incompat (image sharp, etc.).
- Cold start container (image ~1-2 GB, Python + uv) : dizaines de secondes après
  sleep → `sleepAfter` réglable, instance toujours-on possible (coût).
- Neon free tier : suffit pour dev, autoscaling payant ensuite.
