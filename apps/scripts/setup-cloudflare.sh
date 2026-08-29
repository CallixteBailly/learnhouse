#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-cloudflare.sh — v2 (migration COMPLÈTE, sans VPS)
#
# One-shot Cloudflare infrastructure setup:
#   1. R2 bucket `learnhouse-content` (media storage, S3 API)
#   2. Zone check for the production domain
#   3. Prints the exact secrets to configure on both Workers
#
# NO tunnel, NO VPS — the backend runs on a Cloudflare Container.
#
# Prerequisites:
#   - wrangler authenticated: `wrangler login`
#   - The production domain (e.g. ordria.app) added as a zone in the same
#     Cloudflare account
#   - A managed Postgres with pgvector (Neon recommended, free tier works):
#     create it at https://neon.tech and keep the connection string
#
# Usage: bash apps/scripts/setup-cloudflare.sh [domain]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DOMAIN="${1:-ordria.app}"
BUCKET_NAME="learnhouse-content"

echo "=== 0. Account info ==="
wrangler whoami || { echo "Run 'wrangler login' first"; exit 1; }

echo ""
echo "=== 1. Create R2 bucket (media storage) ==="
wrangler r2 bucket create "$BUCKET_NAME" 2>/dev/null || echo "Bucket '$BUCKET_NAME' already exists"
echo "R2 bucket: $BUCKET_NAME"

echo ""
echo "=== 2. R2 API credentials (S3-compatible) ==="
echo "Create ONE token with 'Object Read & Write' scoped to $BUCKET_NAME:"
echo "  https://dash.cloudflare.com/?to=/:account/r2/api-tokens"
echo "It gives you: Access Key ID, Secret Access Key, and the S3 endpoint"
echo "(https://<account-id>.r2.cloudflarestorage.com). Keep them for step 4."

echo ""
echo "=== 3. Zone check: $DOMAIN ==="
if wrangler whoami 2>/dev/null | grep -q "$DOMAIN"; then
    echo "Zone $DOMAIN looks present in this account."
else
    echo "NOTE: could not confirm zone $DOMAIN via wrangler — verify in the"
    echo "dashboard that $DOMAIN is added to this account (Websites → Add a domain)."
fi

echo ""
echo "=== 4. Configure secrets on the API Worker (container) ==="
cat <<'EOF'
cd apps/cloudflare-api
wrangler secret put LEARNHOUSE_SQL_CONNECTION_STRING   # postgresql://… (Neon, ?sslmode=require)
wrangler secret put LEARNHOUSE_AUTH_JWT_SECRET_KEY      # e.g. openssl rand -base64 32
wrangler secret put NEXTAUTH_SECRET                     # e.g. openssl rand -base64 32
wrangler secret put COLLAB_INTERNAL_KEY                 # e.g. openssl rand -base64 32
wrangler secret put LEARNHOUSE_AI_API_KEY               # z.ai / OpenAI-compatible key
wrangler secret put AWS_ENDPOINT_URL_S3                 # https://<account-id>.r2.cloudflarestorage.com
wrangler secret put AWS_ACCESS_KEY_ID                   # R2 token access key
wrangler secret put AWS_SECRET_ACCESS_KEY               # R2 token secret
wrangler secret put LEARNHOUSE_INITIAL_ADMIN_EMAIL
wrangler secret put LEARNHOUSE_INITIAL_ADMIN_PASSWORD

cd ../web
wrangler secret put NEXTAUTH_SECRET                     # SAME value as the API worker
EOF

echo ""
echo "=== 5. Zone routes (single-domain, same-origin cookies) ==="
cat <<EOF
Uncomment the "routes" blocks in both wrangler configs, then deploy:
  API worker  (apps/cloudflare-api/wrangler.jsonc):
    → ${DOMAIN}/api/v1*, ${DOMAIN}/content*, ${DOMAIN}/collab*
  Frontend    (apps/web/wrangler.jsonc):
    → ${DOMAIN}/*
Cloudflare routes match the most specific pattern, exactly like the old
nginx single-origin setup — no CORS, cookies just work.
EOF

echo ""
echo "=== DONE — next step ==="
echo "  bash apps/scripts/deploy-cloudflare.sh $DOMAIN"
