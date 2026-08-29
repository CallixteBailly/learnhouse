#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-cloudflare.sh — v2 (migration COMPLÈTE)
#
# Deploys BOTH Cloudflare components:
#   1. Frontend Worker  (apps/web — OpenNext, edge SSR + middleware)
#   2. API Container    (apps/cloudflare-api — FastAPI + collab + Redis,
#                        Docker image built & pushed by wrangler)
#
# Prerequisites:
#   - wrangler authenticated (`wrangler login`)
#   - Docker running (for the API container image build)
#   - Secrets configured (see apps/scripts/setup-cloudflare.sh)
#
# Usage: bash apps/scripts/deploy-cloudflare.sh [domain]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$BASH_SOURCE")/../.." && pwd)"
DOMAIN="${1:-ordria.app}"

echo "════════════════════════════════════════════════════════"
echo " 1/2 — Frontend Worker (OpenNext) → ordria-learning"
echo "════════════════════════════════════════════════════════"

cd "$ROOT/apps/web"
export BUILD_FOR_PAGES=1
export NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL="https://${DOMAIN}"
export NEXT_PUBLIC_LEARNHOUSE_API_URL="https://${DOMAIN}/api/v1/"
export NEXT_PUBLIC_COLLAB_URL="wss://${DOMAIN}/collab"
export NEXT_PUBLIC_LEARNHOUSE_DOMAIN="${DOMAIN}"
export NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN="${DOMAIN}"      # apex zone (cookie domain)
export NEXT_PUBLIC_LEARNHOUSE_HTTPS=True
export NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG=False
export NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG=default
export NEXT_PUBLIC_LEARNHOUSE_OSS=true
export NEXT_TELEMETRY_DISABLED=1
export NEXT_IGNORE_TYPECHECK=1
export NEXT_IGNORE_LINT=1

bunx opennextjs-cloudflare build
bunx wrangler deploy

echo ""
echo "════════════════════════════════════════════════════════"
echo " 2/2 — API Container (FastAPI + collab) → ordria-learning-api"
echo "════════════════════════════════════════════════════════"

cd "$ROOT/apps/cloudflare-api"
bun install --frozen-lockfile 2>/dev/null || bun install
bun run build
bunx wrangler deploy

echo ""
echo "════════════════════════════════════════════════════════"
echo " DONE"
echo "════════════════════════════════════════════════════════"
echo " Frontend : https://${DOMAIN}           (ordria-learning worker)"
echo " API      : https://${DOMAIN}/api/v1/   (ordria-learning-api container)"
echo " Collab   : wss://${DOMAIN}/collab"
echo ""
echo " First API request wakes the container (cold start ~30-60s)."
echo " Logs: cd apps/cloudflare-api && wrangler tail"
