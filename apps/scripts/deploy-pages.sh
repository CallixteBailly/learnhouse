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
