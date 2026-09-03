#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Cloudflare Container entrypoint — OrdIA Learning API
#
# Boots, in order:
#   1. local Redis (cache + token revocation — ephemeral by design)
#   2. wait for the external Postgres (Neon) if a connection string is set
#   3. DB migrations + initial admin bootstrap (idempotent, best-effort)
#   4. Hocuspocus collab server (:4000)
#   5. FastAPI backend (:9000)
#   6. nginx in the FOREGROUND on :8080 (container main process, handles
#      SIGTERM for clean shutdowns)
# ─────────────────────────────────────────────────────────────────────────────
set -e

mkdir -p /tmp/nginx /tmp/nginx_cb /tmp/api-logs

echo "[start] Booting OrdIA Learning API container…"

# ── 1. Local Redis ──
redis-server \
    --daemonize yes \
    --port 6379 \
    --bind 127.0.0.1 \
    --save '' \
    --appendonly no \
    --dir /tmp
echo "[start] Redis up on 127.0.0.1:6379"

# ── 2. Wait for external Postgres (Neon) ──
if [ -n "$LEARNHOUSE_SQL_CONNECTION_STRING" ]; then
    DB_HOST=$(echo "$LEARNHOUSE_SQL_CONNECTION_STRING" | sed -n 's/.*@\([^:]*\):\([0-9]*\)\/.*/\1/p')
    DB_PORT=$(echo "$LEARNHOUSE_SQL_CONNECTION_STRING" | sed -n 's/.*@\([^:]*\):\([0-9]*\)\/.*/\2/p')
    DB_PORT=${DB_PORT:-5432}
    if [ -n "$DB_HOST" ]; then
        echo "[start] Waiting for Postgres at ${DB_HOST}:${DB_PORT}…"
        i=0
        until nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null || [ $i -ge 45 ]; do
            sleep 2
            i=$((i + 1))
        done
        if nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
            echo "[start] Postgres reachable."
        else
            echo "[start] WARN: Postgres not reachable after 90s — continuing anyway."
        fi
    fi
else
    echo "[start] WARN: LEARNHOUSE_SQL_CONNECTION_STRING not set — the API will fail DB calls."
fi

# ── 3. Migrations + initial admin (idempotent) ──
cd /app/api
if uv run python cli.py install --short > /tmp/api-logs/install.log 2>&1; then
    echo "[start] DB install/migrations OK"
else
    echo "[start] WARN: cli.py install failed — continuing"
    # Surface the real error in container stdout (visible in Render logs)
    echo "[start] ---- install.log (last 40 lines) ----"
    tail -n 40 /tmp/api-logs/install.log || true
    echo "[start] ---- end install.log ----"
fi

# ── 4. Collab server ──
cd /app/collab
nohup node dist/index.js > /tmp/api-logs/collab.log 2>&1 &
echo "[start] Collab server starting on :4000"

# ── 5. FastAPI backend ──
cd /app/api
# Bind loopback: nginx (8080, the only exposed port) proxies everything.
nohup uv run uvicorn app:app --host 127.0.0.1 --port 9000 --timeout-keep-alive 600 > /tmp/api-logs/api.log 2>&1 &
echo "[start] FastAPI starting on :9000"

# ── 6. nginx — foreground, main process ──
echo "[start] All services launched — nginx on :8080"
exec nginx -c /etc/nginx/nginx-api.conf -g 'daemon off;'
