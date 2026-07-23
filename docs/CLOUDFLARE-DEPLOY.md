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
3. `cloudflared` CLI installed locally: `brew install cloudflared`
4. `wrangler` CLI installed locally: `npm i -g wrangler`

## Step 1: Setup Cloudflare infrastructure

```bash
# Authenticate
cloudflared login
wrangler login

# Run the setup script (creates tunnel + R2 bucket + DNS)
bash apps/scripts/setup-cloudflare.sh ordria.app 72.62.179.53
```

This creates:
- A named tunnel `ordria` with stable URL `api.ordria.app`
- A R2 bucket `learnhouse-content`
- DNS routes

Save the `TUNNEL_TOKEN` from the output.

## Step 2: Update docker-compose on the VPS

Edit `docker-compose.yml` on your Dokploy server (or set env vars in Dokploy UI):

```bash
# Required env vars on the VPS
export TUNNEL_TOKEN=<token-from-step-1>

# Optional: R2 storage (if you want media on Cloudflare R2 instead of local disk)
export CONTENT_DELIVERY_TYPE=s3api
export R2_ACCESS_KEY_ID=<your-r2-key>
export R2_SECRET_ACCESS_KEY=<your-r2-secret>
export R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com

docker compose up -d
```

Get R2 credentials: Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API token with Object Read & Write.

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
| `CONTENT_DELIVERY_TYPE` | docker-compose (VPS) | `filesystem` (default) or `s3api` (R2) |
| `R2_ACCESS_KEY_ID` | docker-compose (VPS) | From R2 dashboard |
| `R2_SECRET_ACCESS_KEY` | docker-compose (VPS) | From R2 dashboard |
| `R2_ENDPOINT` | docker-compose (VPS) | `https://<id>.r2.cloudflarestorage.com` |
| `NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL` | Pages build | `https://api.ordria.app` |
| `NEXT_PUBLIC_LEARNHOUSE_API_URL` | Pages build | `https://api.ordria.app/api/v1/` |
| `NEXT_PUBLIC_COLLAB_URL` | Pages build | `wss://api.ordria.app/collab` |

## Switching between quick tunnel and named tunnel

The `docker-compose.yml` supports both modes:

- **Quick tunnel** (dev, random URL): comment out `command: tunnel run` and `environment: TUNNEL_TOKEN`, uncomment `command: tunnel --no-autoupdate --url http://learnhouse-app:80`
- **Named tunnel** (prod, stable URL): set `TUNNEL_TOKEN` env var and keep the default config

## Limitations

- **Backend stays on VPS**: Python + Postgres + Redis cannot run on Cloudflare Workers (C extensions, TCP pools, long-lived connections).
- **Collab server**: WebSocket server stays on VPS via tunnel.
- **HLS transcoding**: ffmpeg cannot run on Workers — stays on VPS or migrate to Cloudflare Stream.
- **SSR**: If you need server-side rendering on the frontend, Pages supports it via `@opennextjs/cloudflare` but with edge runtime limitations (no Node.js native modules).
