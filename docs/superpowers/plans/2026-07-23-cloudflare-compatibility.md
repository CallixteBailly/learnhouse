# Cloudflare Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the LearnHouse frontend on Cloudflare Pages (edge global), with the backend accessible via a stable Cloudflare named tunnel, and media storage on Cloudflare R2.

**Architecture:** Frontend Next.js compiled via `@opennextjs/cloudflare` → Cloudflare Pages (edge). Backend Python (FastAPI + Postgres + Redis) stays on the Dokploy VPS but exposed via a **named Cloudflare Tunnel** (stable URL, SSL, DDoS protection). Media uploads (thumbnails, videos, PDFs) migrate to **Cloudflare R2** (S3-compatible, already partially implemented via `content_delivery.type=s3api`). Collab server (Hocuspocus) stays on the VPS via the same tunnel.

**Tech Stack:** `@opennextjs/cloudflare`, `wrangler`, Cloudflare Pages, Cloudflare Tunnel (named), Cloudflare R2, Next.js 16 standalone, FastAPI backend.

## Global Constraints

- **Frontend build must stay `output: 'standalone'`** for `@opennextjs/cloudflare` compatibility.
- **NEXT_IGNORE_TYPECHECK=1** must remain set in Dockerfile for backend builds (TS check disabled to avoid OOM on constrained servers).
- **Runtime config injection**: `apps/web/public/runtime-config.js` is loaded synchronously via `<script>` in `apps/web/app/layout.tsx`. On Pages, this file must be generated at build time from env vars.
- **API URL**: The frontend must reach the backend via an absolute URL. On Pages, `NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL` must point to the named tunnel URL (e.g. `https://api.ordria.app`).
- **No server-side filesystem**: Pages has no persistent filesystem. Any server-side file writes must go to R2 or be removed.
- **R2 bucket**: Must be created via `wrangler` before the first deploy. Bucket name: `learnhouse-content`.
- **Tunnel name**: `ordria` — creates a stable subdomain or routes to a custom domain.
- **Collab WebSocket**: `NEXT_PUBLIC_COLLAB_URL` must point to `wss://api.ordria.app/collab` (the tunnel handles WS upgrade).
- **Docker compose stays unchanged** for the backend-only deployment on Dokploy.
- **Branch**: `feat/cloudflare-compatibility`

---

## File Structure

### Files to create:
- `apps/web/wrangler.toml` — Cloudflare Pages config (build, routes, vars, R2 binding)
- `apps/web/.dev.vars` — Local dev secrets (gitignored)
- `apps/scripts/setup-cloudflare.sh` — One-shot setup script (tunnel + R2 + DNS)
- `apps/scripts/deploy-pages.sh` — Deploy frontend to Pages
- `apps/web/open-next.config.ts` — OpenNext adapter config

### Files to modify:
- `apps/web/next.config.js` — Ensure standalone output + runtime-config generation for Pages
- `apps/web/package.json` — Add `@opennextjs/cloudflare`, `wrangler` scripts
- `docker-compose.yml` — Add `TUNNEL_TOKEN` env var (replaces trycloudflare quick tunnel)
- `apps/api/src/core/events/database.py` — Already S3-aware, no changes needed
- `apps/web/services/config/config.ts` — Verify `isOnCustomDomain()` works with Pages domain

---

## Task 1: Install OpenNext + Wrangler for Cloudflare Pages

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/open-next.config.ts`
- Create: `apps/web/wrangler.toml`

**Interfaces:**
- Produces: `wrangler.toml` with correct `pages_build_output_dir`, `vars`, and R2 binding
- Produces: `open-next.config.ts` for the OpenNext adapter

- [ ] **Step 1: Install OpenNext + wrangler**

```bash
cd apps/web
bun add -d @opennextjs/cloudflare wrangler
```

- [ ] **Step 2: Create `open-next.config.ts`**

```ts
// apps/web/open-next.config.ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // No incremental cache on Pages — disable ISR caching
  incrementalCache: undefined,
  // Use Cloudflare KV for cache (optional, can be added later)
});
```

- [ ] **Step 3: Create `wrangler.toml`**

```toml
# apps/web/wrangler.toml
name = "ordria-learning"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".open-next/assets"

# Environment variables (public — safe to expose)
[vars]
NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG = "False"
NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG = "default"
NEXT_PUBLIC_LEARNHOUSE_HTTPS = "True"
NEXT_PUBLIC_LEARNHOUSE_OSS = "true"

# R2 binding for media storage (if needed server-side)
[[r2_buckets]]
binding = "CONTENT_BUCKET"
bucket_name = "learnhouse-content"

# Secrets (set via: wrangler pages secret put <NAME>)
# NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL
# NEXT_PUBLIC_LEARNHOUSE_API_URL
# NEXT_PUBLIC_COLLAB_URL
# NEXTAUTH_SECRET
```

- [ ] **Step 4: Add deploy scripts to `package.json`**

Add these to the `"scripts"` section:

```json
{
  "scripts": {
    "deploy:pages": "opennextjs-cloudflare && wrangler pages deploy .open-next",
    "build:pages": "opennextjs-cloudflare",
    "dev:pages": "wrangler pages dev .open-next --port 3000"
  }
}
```

- [ ] **Step 5: Commit**

```bash
cd /Users/anthonybailly/learnhouse
git add apps/web/package.json apps/web/open-next.config.ts apps/web/wrangler.toml
git commit -m "feat(cloudflare): install OpenNext + wrangler for Pages deploy"
```

---

## Task 2: Adapt runtime-config for Pages build

**Files:**
- Modify: `apps/web/next.config.js` (lines 145-165 — the runtime config generation block)

**Interfaces:**
- Consumes: `NEXT_PUBLIC_LEARNHOUSE_*` env vars set at build time on Pages
- Produces: `public/runtime-config.js` generated during `next build` from env

- [ ] **Step 1: Update the runtime-config generation to work in production builds**

In `apps/web/next.config.js`, the block at lines 146-165 currently only runs in `NODE_ENV === 'development'`. Change it to also run during production builds (for Pages):

```js
// Generate runtime config — works for both dev and Pages production builds
if (process.env.NODE_ENV === 'development' || process.env.BUILD_FOR_PAGES === '1') {
  const fs = require('fs')
  const path = require('path')
  const runtimeConfig = {}

  Object.keys(process.env).forEach((key) => {
    if (key.startsWith('NEXT_PUBLIC_')) {
      runtimeConfig[key] = process.env[key]
    }
  })

  const publicDir = path.join(__dirname, 'public')
  if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true })

  fs.writeFileSync(
    path.join(publicDir, 'runtime-config.js'),
    `window.__RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig)};`,
    'utf-8'
  )
}
```

- [ ] **Step 2: Verify the build picks up env vars**

```bash
cd apps/web
BUILD_FOR_PAGES=1 \
NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL="https://api.ordria.app" \
NEXT_PUBLIC_LEARNHOUSE_API_URL="https://api.ordria.app/api/v1/" \
NEXT_PUBLIC_COLLAB_URL="wss://api.ordria.app/collab" \
bun run build

# Check the generated runtime-config.js
cat public/runtime-config.js
# Should contain the URLs above
```

Expected: `window.__RUNTIME_CONFIG__ = {"NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL":"https://api.ordria.app",...};`

- [ ] **Step 3: Commit**

```bash
cd /Users/anthonybailly/learnhouse
git add apps/web/next.config.js
git commit -m "feat(cloudflare): generate runtime-config.js for Pages production builds"
```

---

## Task 3: Create the setup script for Cloudflare tunnel + R2

**Files:**
- Create: `apps/scripts/setup-cloudflare.sh`

**Interfaces:**
- Produces: A named tunnel `ordria`, a R2 bucket `learnhouse-content`, DNS routes
- Produces: A `TUNNEL_TOKEN` env var to inject into docker-compose

- [ ] **Step 1: Create the setup script**

```bash
#!/usr/bin/env bash
# apps/scripts/setup-cloudflare.sh
# One-shot setup: creates a named tunnel, R2 bucket, and DNS routes.
#
# Prerequisites:
#   - cloudflared authenticated: `cloudflared login`
#   - wrangler authenticated: `wrangler login`
#   - A domain managed on Cloudflare (e.g. ordria.app)
#
# Usage: bash apps/scripts/setup-cloudflare.sh <domain> <server-ip>
# Example: bash apps/scripts/setup-cloudflare.sh ordria.app 72.62.179.53

set -euo pipefail

DOMAIN="${1:?Usage: $0 <domain> <server-ip>}"
SERVER_IP="${2:?Usage: $0 <domain> <server-ip>}"
TUNNEL_NAME="ordria"
BUCKET_NAME="learnhouse-content"

echo "=== 1. Create named tunnel ==="
cloudflared tunnel create "$TUNNEL_NAME" 2>/dev/null || echo "Tunnel already exists"
TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
TUNNEL_UUID_FILE="$HOME/.cloudflared/${TUNNEL_ID}.json"
echo "Tunnel ID: $TUNNEL_ID"

echo ""
echo "=== 2. Create DNS routes ==="
# API subdomain → tunnel
cloudflared tunnel route dns "$TUNNEL_NAME" "api.${DOMAIN}" 2>/dev/null || echo "DNS api.${DOMAIN} already routed"
echo "DNS: api.${DOMAIN} → tunnel ${TUNNEL_NAME}"

echo ""
echo "=== 3. Create R2 bucket ==="
wrangler r2 bucket create "$BUCKET_NAME" 2>/dev/null || echo "Bucket already exists"
echo "R2 bucket: $BUCKET_NAME"

echo ""
echo "=== 4. Generate tunnel config ==="
cat > /tmp/cloudflared-tunnel.yml << EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${TUNNEL_UUID_FILE}

ingress:
  - hostname: api.${DOMAIN}
    service: http://${SERVER_IP}:80
  - service: http_status:404
EOF

echo "Tunnel config written to /tmp/cloudflared-tunnel.yml"
echo ""
echo "=== 5. Get tunnel token for docker-compose ==="
TOKEN=$(cloudflared tunnel token "$TUNNEL_NAME" 2>/dev/null || echo "ERROR")
if [ "$TOKEN" != "ERROR" ]; then
  echo "TUNNEL_TOKEN=$TOKEN"
  echo ""
  echo "Add this to your docker-compose.yml cloudflared service:"
  echo '  cloudflared:'
  echo '    image: cloudflare/cloudflared:latest'
  echo '    command: tunnel run'
  echo '    environment:'
  echo "      - TUNNEL_TOKEN=${TOKEN}"
else
  echo "⚠ Could not generate token. Run: cloudflared tunnel token $TUNNEL_NAME"
fi

echo ""
echo "=== DONE ==="
echo "API URL:  https://api.${DOMAIN}"
echo "R2 bucket: $BUCKET_NAME"
echo "Next steps:"
echo "  1. Update docker-compose.yml cloudflared to use TUNNEL_TOKEN"
echo "  2. Deploy frontend: cd apps/web && bun run deploy:pages"
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x apps/scripts/setup-cloudflare.sh
git add apps/scripts/setup-cloudflare.sh
git commit -m "feat(cloudflare): add one-shot setup script for tunnel + R2 + DNS"
```

---

## Task 4: Create the Pages deploy script

**Files:**
- Create: `apps/scripts/deploy-pages.sh`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL`, `NEXT_PUBLIC_LEARNHOUSE_API_URL`, `NEXT_PUBLIC_COLLAB_URL` env vars
- Produces: A deployed Cloudflare Pages site

- [ ] **Step 1: Create the deploy script**

```bash
#!/usr/bin/env bash
# apps/scripts/deploy-pages.sh
# Builds and deploys the frontend to Cloudflare Pages.
#
# Prerequisites:
#   - wrangler authenticated
#   - Env vars set: NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL, etc.
#
# Usage: bash apps/scripts/deploy-pages.sh <api-domain>
# Example: bash apps/scripts/deploy-pages.sh api.ordria.app

set -euo pipefail

API_DOMAIN="${1:?Usage: $0 <api-domain>}"

export BUILD_FOR_PAGES=1
export NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL="https://${API_DOMAIN}"
export NEXT_PUBLIC_LEARNHOUSE_API_URL="https://${API_DOMAIN}/api/v1/"
export NEXT_PUBLIC_COLLAB_URL="wss://${API_DOMAIN}/collab"
export NEXT_PUBLIC_LEARNHOUSE_DOMAIN="${API_DOMAIN}"
export NEXT_PUBLIC_LEARNHOUSE_HTTPS="True"
export NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG="False"
export NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG="default"
export NEXT_PUBLIC_LEARNHOUSE_OSS="true"
export NEXT_IGNORE_TYPECHECK=1
export NEXT_IGNORE_LINT=1

echo "=== Building for Cloudflare Pages ==="
cd apps/web

# Build Next.js
bun run build

# Build OpenNext for Cloudflare
npx opennextjs-cloudflare

echo "=== Deploying to Cloudflare Pages ==="
npx wrangler pages deploy .open-next --project-name ordria-learning

echo "=== DONE ==="
echo "Frontend deployed to Cloudflare Pages"
echo "API backend at: https://${API_DOMAIN}"
```

- [ ] **Step 2: Commit**

```bash
chmod +x apps/scripts/deploy-pages.sh
git add apps/scripts/deploy-pages.sh
git commit -m "feat(cloudflare): add Pages deploy script with env injection"
```

---

## Task 5: Update docker-compose for named tunnel

**Files:**
- Modify: `docker-compose.yml` (cloudflared service, lines 62-69)

**Interfaces:**
- Consumes: `TUNNEL_TOKEN` env var (generated by setup-cloudflare.sh)
- Produces: Stable tunnel URL instead of random trycloudflare URL

- [ ] **Step 1: Replace the cloudflared quick tunnel with named tunnel**

Replace the `cloudflared` service block:

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: learnhouse-cloudflared
    restart: unless-stopped
    environment:
      - TUNNEL_TOKEN=${TUNNEL_TOKEN}
    command: tunnel run
    depends_on:
      learnhouse-app:
        condition: service_started
```

- [ ] **Step 2: Add LEARNHOUSE_CONTENT_DELIVERY_TYPE=s3api for R2 storage**

In the `learnhouse-app` environment section, add (if R2 is configured):

```yaml
      - LEARNHOUSE_CONTENT_DELIVERY_TYPE=s3api
      - AWS_ENDPOINT_URL_S3=${R2_ENDPOINT:-}
      - AWS_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID:-}
      - AWS_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY:-}
      - AWS_STORAGE_BUCKET_NAME=learnhouse-content
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(cloudflare): switch cloudflared to named tunnel + R2 storage config"
```

---

## Task 6: Create documentation for the Cloudflare deployment

**Files:**
- Create: `docs/CLOUDFLARE-DEPLOY.md`

- [ ] **Step 1: Write the deployment guide**

```markdown
# Cloudflare Deployment Guide

## Architecture

```
Users → Cloudflare Pages (frontend, edge global)
         ↓ API calls (https)
    Cloudflare Named Tunnel (SSL, DDoS)
         ↓
    Dokploy VPS
    ├── Backend Python (FastAPI, port 9000)
    ├── Next.js SSR (port 8000, optional — for SSR)
    ├── Postgres + pgvector (port 5432)
    ├── Redis (port 6379)
    └── Collab WebSocket (port 4000)

Media uploads → Cloudflare R2 (S3-compatible)
```

## Prerequisites

1. A domain managed on Cloudflare DNS (e.g. ordria.app)
2. A Dokploy VPS running the backend (docker-compose)
3. `cloudflared` CLI installed locally
4. `wrangler` CLI installed locally

## Step 1: Setup Cloudflare infrastructure

```bash
# Authenticate
cloudflared login
wrangler login

# Run the setup script
bash apps/scripts/setup-cloudflare.sh ordria.app 72.62.179.53
```

This creates:
- A named tunnel `ordria` with stable URL `api.ordria.app`
- A R2 bucket `learnhouse-content`
- DNS routes

## Step 2: Update docker-compose on the VPS

Edit `docker-compose.yml` on your Dokploy server:
- Set `TUNNEL_TOKEN` (from step 1 output)
- Set R2 credentials (from Cloudflare dashboard → R2 → Manage API tokens)
- Set `LEARNHOUSE_CONTENT_DELIVERY_TYPE=s3api`

```bash
# On the VPS
export TUNNEL_TOKEN=<token-from-step-1>
export R2_ACCESS_KEY_ID=<your-r2-key>
export R2_SECRET_ACCESS_KEY=<your-r2-secret>
export R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com

docker compose up -d
```

## Step 3: Deploy frontend to Pages

```bash
# From your local machine
bash apps/scripts/deploy-pages.sh api.ordria.app
```

This:
- Builds Next.js with the correct API URL
- Compiles via OpenNext for Cloudflare
- Deploys to Cloudflare Pages

## Step 4: Configure custom domain on Pages

In Cloudflare Dashboard → Pages → ordria-learning → Custom domains:
- Add `app.ordria.app` (or your preferred domain)
- Cloudflare auto-provisions SSL

## Environment variables reference

| Variable | Where | Value |
|---|---|---|
| `TUNNEL_TOKEN` | docker-compose (VPS) | From `cloudflared tunnel token ordria` |
| `R2_ACCESS_KEY_ID` | docker-compose (VPS) | From R2 dashboard |
| `R2_SECRET_ACCESS_KEY` | docker-compose (VPS) | From R2 dashboard |
| `R2_ENDPOINT` | docker-compose (VPS) | `https://<id>.r2.cloudflarestorage.com` |
| `NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL` | Pages build | `https://api.ordria.app` |
| `NEXT_PUBLIC_LEARNHOUSE_API_URL` | Pages build | `https://api.ordria.app/api/v1/` |
| `NEXT_PUBLIC_COLLAB_URL` | Pages build | `wss://api.ordria.app/collab` |

## Limitations

- **Backend stays on VPS**: Python + Postgres + Redis cannot run on Workers (C extensions, TCP pools, long-lived connections).
- **Collab server**: WebSocket server stays on VPS via tunnel.
- **HLS transcoding**: ffmpeg cannot run on Workers — stays on VPS or migrate to Cloudflare Stream.
```

- [ ] **Step 2: Commit**

```bash
git add docs/CLOUDFLARE-DEPLOY.md
git commit -m "docs(cloudflare): deployment guide for Pages + Tunnel + R2"
```

---

## Self-Review

### Spec coverage

- ✅ Frontend on Cloudflare Pages → Task 1 (OpenNext), Task 2 (runtime-config), Task 4 (deploy script)
- ✅ Stable backend URL → Task 3 (named tunnel setup), Task 5 (docker-compose update)
- ✅ Media storage on R2 → Task 3 (R2 bucket), Task 5 (s3api env vars)
- ✅ Documentation → Task 6

### Placeholder scan

- ✅ No TBD/TODO — all scripts contain real commands
- ✅ All code blocks are complete implementations
- ✅ Environment variables are exact, not placeholders

### Type consistency

- ✅ `BUILD_FOR_PAGES` used consistently in next.config.js and deploy script
- ✅ `TUNNEL_TOKEN` used consistently in setup script and docker-compose
- ✅ R2 bucket name `learnhouse-content` consistent across wrangler.toml, setup script, docker-compose
