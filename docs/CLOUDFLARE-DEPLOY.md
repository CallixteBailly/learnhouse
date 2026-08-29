# Cloudflare Deployment Guide — v2 (migration COMPLÈTE, sans VPS)

> **v2** : toutes les fonctionnalités tournent sur Cloudflare. Le VPS Dokploy
> et le tunnel cloudflared ne sont plus nécessaires en production.

## Architecture

```
                      ┌────────────────── Cloudflare ──────────────────┐
                      │                                                │
 ordria.app/*  ───────►  Frontend Worker « ordria-learning »           │
 (tout le reste)       │  (OpenNext : SSR edge, NextAuth, middleware)  │
                      │                                                │
 ordria.app/api/v1*   ┌►  API Worker « ordria-learning-api »           │
 ordria.app/content*  │   (zone Routes — même domaine, zéro CORS)      │
 ordria.app/collab*   │        │                                       │
                      │        ▼                                       │
                      │   Cloudflare Container (instance unique)       │
                      │   ├─ nginx :8080  (port exposé)                │
                      │   ├─ FastAPI :9000   (API + contenu)           │
                      │   ├─ collab :4000    (WebSocket Hocuspocus)    │
                      │   ├─ redis :6379    (local, éphémère)          │
                      │   └─ ffmpeg         (transcodage HLS)          │
                      │                                                │
                      │   R2 « learnhouse-content » (médias, S3 API)   │
                      └───────────────────┬────────────────────────────┘
                                          │ TCP sortant
                                   Neon Postgres (+pgvector, externe)

 docker-compose.yml → stack de DEV LOCAL uniquement
```

**Pourquoi ce découpage**

| Composant | Service Cloudflare | Contrainte technique |
|---|---|---|
| Frontend Next.js | **Worker** (OpenNext) | edge global, toujours chaud, gratuit à l'usage modéré |
| API Python FastAPI | **Container** | Python/ffmpeg ne tournent pas sur Workers ; le Container est une VM Linux complète |
| Collab WebSocket | **Container** | état en mémoire → instance unique (`max_instances: 1`) |
| Redis | **dans le Container** | cache + révocation de tokens ; perte au restart = acceptable |
| Postgres | **Neon** (externe) | Postgres ne peut pas tourner sur Cloudflare ; Neon supporte pgvector |
| Médias | **R2** | déjà implémenté côté API via `content_delivery.type=s3api` |

**Same-origin** : les routes de zone dirigent `/api/v1*`, `/content*`,
`/collab*` vers le Worker API et tout le reste vers le Worker frontend —
exactement ce que faisait nginx en local. Les appels `credentials: 'include'`
du frontend fonctionnent sans aucune configuration CORS.

## Prérequis

1. Un compte Cloudflare avec le domaine **ordria.app** en zone (DNS géré)
2. `wrangler login` (authentifié)
3. Docker démarré (build de l'image du Container)
4. Une base **Neon** Postgres avec pgvector — https://neon.tech (free tier OK)
   - Créez le projet, activez l'extension `vector`, gardez l'URL de connexion
     (`postgresql://…?sslmode=require`)

## Étape 1 — Setup infrastructure

```bash
bash apps/scripts/setup-cloudflare.sh ordria.app
```

Crée le bucket R2 `learnhouse-content` et affiche la liste exacte des secrets
à configurer. Créez un token R2 « Object Read & Write » sur ce bucket.

## Étape 2 — Secrets

```bash
cd apps/cloudflare-api
wrangler secret put LEARNHOUSE_SQL_CONNECTION_STRING   # URL Neon
wrangler secret put LEARNHOUSE_AUTH_JWT_SECRET_KEY      # openssl rand -base64 32
wrangler secret put NEXTAUTH_SECRET                     # openssl rand -base64 32
wrangler secret put COLLAB_INTERNAL_KEY                 # openssl rand -base64 32
wrangler secret put LEARNHOUSE_AI_API_KEY               # clé z.ai
wrangler secret put AWS_ENDPOINT_URL_S3                 # https://<account-id>.r2.cloudflarestorage.com
wrangler secret put AWS_ACCESS_KEY_ID                   # token R2
wrangler secret put AWS_SECRET_ACCESS_KEY
wrangler secret put LEARNHOUSE_INITIAL_ADMIN_EMAIL
wrangler secret put LEARNHOUSE_INITIAL_ADMIN_PASSWORD

cd ../web
wrangler secret put NEXTAUTH_SECRET                     # MÊME valeur que l'API
```

## Étape 3 — Routes de zone (une seule fois)

Décommentez les blocs `routes` dans `apps/web/wrangler.jsonc` et
`apps/cloudflare-api/wrangler.jsonc` :

```jsonc
// apps/web/wrangler.jsonc (frontend — le moins spécifique)
"routes": [{ "pattern": "ordria.app/*", "zone_name": "ordria.app" }]

// apps/cloudflare-api/wrangler.jsonc (API — plus spécifiques, prioritaires)
"routes": [
  { "pattern": "ordria.app/api/v1*", "zone_name": "ordria.app" },
  { "pattern": "ordria.app/content*", "zone_name": "ordria.app" },
  { "pattern": "ordria.app/collab*",  "zone_name": "ordria.app" }
]
```

Cloudflare route automatiquement vers le pattern le plus spécifique.

## Étape 4 — Déployer

```bash
bash apps/scripts/deploy-cloudflare.sh ordria.app
```

Le script :
1. Build le frontend (env `NEXT_PUBLIC_*` injectés) et déploie le Worker
2. Compile le Worker API, build l'image Docker et déploie le Container
   (l'image est poussée automatiquement dans le registre Cloudflare)

## Étape 5 — Vérifier

```bash
# Frontend
curl -s https://ordria.app/health

# API (réveille le Container si endormi — cold start 30-60 s)
curl -s https://ordria.app/api/v1/health

# Logs du Worker API (container)
cd apps/cloudflare-api && wrangler tail
```

L'admin initial est créé au démarrage du Container par `cli.py install`
(email/mot de passe des secrets).

## Variables d'environnement — référence

| Variable | Où | Valeur |
|---|---|---|
| `LEARNHOUSE_SQL_CONNECTION_STRING` | secret API Worker | URL Neon (+`?sslmode=require`) |
| `LEARNHOUSE_AUTH_JWT_SECRET_KEY` | secret API Worker | base64 aléatoire |
| `NEXTAUTH_SECRET` | secret **les deux** Workers | base64 aléatoire, identique |
| `COLLAB_INTERNAL_KEY` | secret API Worker | base64 aléatoire |
| `LEARNHOUSE_AI_API_KEY` | secret API Worker | clé z.ai |
| `AWS_ENDPOINT_URL_S3` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | secrets API Worker | token R2 |
| `LEARNHOUSE_INITIAL_ADMIN_EMAIL` / `_PASSWORD` | secrets API Worker | compte admin initial |
| `NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL` | var frontend Worker + build | `https://ordria.app` |
| `NEXT_PUBLIC_LEARNHOUSE_API_URL` | var frontend Worker + build | `https://ordria.app/api/v1/` |
| `NEXT_PUBLIC_COLLAB_URL` | var frontend Worker + build | `wss://ordria.app/collab` |

## Limites & coûts

- **Cold starts** : le Container s'endort après 5 min d'inactivité
  (`sleepAfter`) ; la requête suivante attend ~30-60 s (pull image + Python).
  Pour un serveur toujours chaud : augmentez `sleepAfter` (ex. `"1h"`) ou
  surchargez `onActivityExpired()` dans `src/worker.ts` — au prix d'un
  compute facturé 24/7 (instance `basic` ≈ quelques dizaines de $/mois).
- **Redis éphémère** : les caches et la liste de révocation de tokens sont
  perdus à chaque redémarrage du Container (les tokens révoqués redeviennent
  valides jusqu'à leur expiration naturelle — trade-off assumé).
- **Images next/image** : servies non optimisées par défaut. Pour optimiser :
  ajoutez le binding `IMAGES` (Cloudflare Images, ~$5/mo) dans
  `apps/web/wrangler.jsonc` et retirez `unoptimized` du build.
- **Postgres** : externe (Neon). Le free tier suffit pour le dev ;
  l'autoscaling Neon est payant au-delà.
- **Uploads volumineux** (SCORM) : passent par le Worker → Container, des
  timeouts longs sont configurés (nginx 3600 s / lecture Worker).

## Développement local

La stack complète reste disponible via docker-compose (dev uniquement) :

```bash
docker compose up -d            # app + postgres + redis
docker compose --profile tunnel up -d   # + tunnel cloudflared optionnel
```

Le Worker frontend en local : `cd apps/web && bun run preview:worker`
(après `bun run build:worker`).
