#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Container entrypoint — OrdIA Learning API (Cloudflare Container + Render)
#
# Boots, in order:
#   1. local Redis (cache + token revocation — ephemeral by design)
#   2. optional wait for the external Postgres (Neon) if configured
#   3. background: DB migrations + initial admin (idempotent, best-effort)
#   4. Hocuspocus collab server (:4000)
#   5. FastAPI backend (:9000)
#   6. [Render all-in-one image only] Next.js frontend (:3000)
#   7. nginx in the FOREGROUND on the exposed port — MUST start quickly:
#      platforms (Cloudflare Containers) expect the port to answer within a
#      short startup window, so migrations run in the background instead of
#      blocking the boot.
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

# ── 3. Migrations + initial admin — BACKGROUND (must not block the port) ──
# Direct venv binaries — `uv run` fails on some hosts (Render) resolving the
# interpreter symlink, and skips a layer of boot-time checks.
(
    cd /app/api
    sleep 1
    if /app/api/.venv/bin/python cli.py install --short > /tmp/api-logs/install.log 2>&1; then
        echo "[start] DB install/migrations OK"
    else
        echo "[start] WARN: cli.py install failed — continuing"
        echo "[start] ---- install.log (last 40 lines) ----"
        tail -n 40 /tmp/api-logs/install.log || true
        echo "[start] ---- end install.log ----"
    fi
) > /tmp/api-logs/install-stdout.log 2>&1 &

# ── 4. Collab server ──
cd /app/collab
NODE_OPTIONS="--max-old-space-size=128" nohup node dist/index.js > /tmp/api-logs/collab.log 2>&1 &
echo "[start] Collab server starting on :4000"

# ── 5. FastAPI backend (supervised) ──
# Bind loopback: nginx (the only exposed port) proxies everything.
# CWD must be /app/api — uvicorn imports the "app" module from it.
# SUPERVISOR: uvicorn treats DB unavailability at startup as fatal
# (2026-09-23 outage: Neon quota exceeded → "Application startup failed.
# Exiting." → nginx 502 forever). Restart every 15s so the API self-heals
# the moment the database accepts connections again.
# PYTHONUNBUFFERED=1: startup tracebacks must survive a kill (no block
# buffering) — this is what made the crash finally diagnosable.
cd /app/api
echo "[start] launching uvicorn at $(date -u '+%H:%M:%S')" > /tmp/api-logs/api.log
(
    while true; do
        PYTHONUNBUFFERED=1 /app/api/.venv/bin/uvicorn app:app \
            --host 127.0.0.1 --port 9000 --timeout-keep-alive 600 \
            >> /tmp/api-logs/api.log 2>&1
        echo "[supervisor] uvicorn exited (code $?) at $(date -u '+%H:%M:%S') — retry in 15s" >> /tmp/api-logs/api.log
        sleep 15
    done
) &
echo "[start] FastAPI starting on :9000 (supervised)"

# ── 5b. Health watchdog ──
# The supervisor above only reacts to uvicorn EXITING. The observed failure
# mode (2026-09-26, 3 crashes in one night) is a HANG: DB pool connections
# stuck on silently-dead links → every DB route (incl. /health, which pings
# the DB) stops answering while the process stays alive. This watchdog probes
# /health every 60 s and, after 3 consecutive failures (≥3 min, so boot and
# brief Neon cold starts never trigger it), kills uvicorn — the supervisor
# above then relaunches it with a fresh pool. Self-healing in ~3 min instead
# of a manual container recreation (+2 min of downtime).
(
    fail=0
    sleep 90   # grace: migrations + boot must settle first
    while true; do
        if curl -sf -m 20 http://127.0.0.1:9000/api/v1/health > /dev/null 2>&1; then
            fail=0
        else
            fail=$((fail + 1))
            echo "[watchdog] health FAIL $fail/3 at $(date -u '+%H:%M:%S')" >> /tmp/api-logs/watchdog.log
            if [ "$fail" -ge 3 ]; then
                echo "[watchdog] 3 consecutive failures — restarting uvicorn at $(date -u '+%H:%M:%S')" >> /tmp/api-logs/watchdog.log
                pkill -f "uvicorn app:app" 2>/dev/null
                fail=0
            fi
        fi
        sleep 60
    done
) &
echo "[start] Health watchdog armed (60s probe, 3 strikes → restart)"

# ── 6. Frontend — ONLY on the Render all-in-one image (Cloudflare serves
# the frontend from a Worker; /app/web does not exist there). ──
if [ -d /app/web ]; then
    # PORT must be forced: Render exports PORT for its own routing (10000).
    # Heap cap keeps the whole stack within the free tier's 512 MB.
    cd /app/web
    PORT=3000 HOSTNAME=127.0.0.1 NODE_OPTIONS="--max-old-space-size=192" \
        nohup node server-wrapper.js > /tmp/api-logs/web.log 2>&1 &
    echo "[start] Frontend (Next.js) starting on :3000"
else
    echo "[start] No bundled frontend (Cloudflare mode) — nginx proxies / to FastAPI"
fi

# ── 7. nginx — foreground, main process ──
# Render routes web traffic to $PORT (their platform convention); other hosts
# (Cloudflare Container, local Docker) don't set it and keep the default 8080.
# nginx logs to /tmp files (no /dev/std* on CF's runtime) — a background
# tailer streams nginx + all service logs to the container stdout for
# observability.
touch /tmp/nginx-error.log /tmp/nginx-access.log
( sleep 2; exec tail -n +1 -F /tmp/nginx-error.log /tmp/nginx-access.log \
    /tmp/api-logs/api.log /tmp/api-logs/watchdog.log /tmp/api-logs/collab.log \
    /tmp/api-logs/install-stdout.log /tmp/api-logs/web.log 2>/dev/null ) &
LISTEN_PORT="${PORT:-8080}"
sed "s/8080/${LISTEN_PORT}/g" /etc/nginx/nginx-api.conf > /tmp/nginx-api.conf
if [ ! -d /app/web ]; then
    # Cloudflare image (no bundled frontend): the platform port-probe and any
    # stray "/" request must hit FastAPI, not the dead :3000 upstream.
    sed -i 's/127\.0\.0\.1:3000/127.0.0.1:9000/' /tmp/nginx-api.conf
fi
echo "[start] All services launched — nginx on :${LISTEN_PORT}"
exec nginx -c /tmp/nginx-api.conf -g 'daemon off;'
