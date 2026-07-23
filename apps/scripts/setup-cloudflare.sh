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
# API subdomain -> tunnel
cloudflared tunnel route dns "$TUNNEL_NAME" "api.${DOMAIN}" 2>/dev/null || echo "DNS api.${DOMAIN} already routed"
echo "DNS: api.${DOMAIN} -> tunnel ${TUNNEL_NAME}"

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
  echo "Could not generate token. Run: cloudflared tunnel token $TUNNEL_NAME"
fi

echo ""
echo "=== DONE ==="
echo "API URL:  https://api.${DOMAIN}"
echo "R2 bucket: $BUCKET_NAME"
echo "Next steps:"
echo "  1. Update docker-compose.yml cloudflared to use TUNNEL_TOKEN"
echo "  2. Deploy frontend: cd apps/web && bun run deploy:pages"
