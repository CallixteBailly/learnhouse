#syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Cloudflare Container image — OrdIA Learning API
#
# Runs the FULL backend stack in ONE container instance (max_instances=1):
#   nginx :8080  — single exposed port (Container defaultPort), routes to:
#     /ping   → 200 (Container class readiness check)
#     /collab → Hocuspocus collab server :4000 (WebSocket)
#     /*      → FastAPI backend :9000 (API + content delivery)
#   redis :6379  — local, ephemeral (cache + token revocation)
#
# Build context is the REPOSITORY ROOT (see image_build_context in
# wrangler.jsonc) — paths below are relative to the repo root.
# ─────────────────────────────────────────────────────────────────────────────

# ───────────────────────────────────────────────
# Stage 1: Collab server build
# ───────────────────────────────────────────────
FROM oven/bun:1-alpine AS collab-builder
WORKDIR /app

COPY apps/collab/package.json apps/collab/bun.lock* ./
RUN bun install --frozen-lockfile

COPY apps/collab/tsconfig.json ./
COPY apps/collab/src/ ./src/

RUN bun run build

# ───────────────────────────────────────────────
# Stage 2: Runtime image
# ───────────────────────────────────────────────
FROM python:3.14-slim-bookworm AS runner

# nginx (front door) + curl (healthchecks) + netcat (DB wait) +
# redis-server (local cache) + ffmpeg (HLS transcoding) + node (collab).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        nginx curl netcat-openbsd ca-certificates redis-server ffmpeg gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get purge -y gnupg \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /root/.npm

# ── Backend: Python deps (cached layer, then source) ──
WORKDIR /app/api
COPY apps/api/uv.lock apps/api/pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip uv \
    && uv sync --no-dev
COPY apps/api ./

# ── Collab: compiled JS + production deps ──
WORKDIR /app/collab
COPY --from=collab-builder /app/dist ./dist
COPY apps/collab/package.json apps/collab/bun.lock* ./
RUN curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/local/bin/bun && rm -rf /root/.bun \
    && bun install --production

# ── Configs ──
COPY apps/cloudflare-api/nginx-api.conf /etc/nginx/nginx-api.conf
COPY apps/cloudflare-api/start-api.sh /app/start-api.sh
RUN chmod +x /app/start-api.sh \
    && mkdir -p /tmp/nginx /tmp/nginx_cb /tmp/api-logs \
    && chown -R www-data:www-data /tmp/nginx /tmp/nginx_cb

# ── Non-root user (Cloudflare Containers run without root capabilities) ──
RUN useradd --create-home --uid 1001 appuser \
    && chown -R appuser:appuser /app
USER appuser
ENV HOME=/home/appuser

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    LEARNHOUSE_PORT=9000 \
    COLLAB_PORT=4000 \
    HOSTNAME=0.0.0.0 \
    LEARNHOUSE_OSS=true \
    LEARNHOUSE_REDIS_CONNECTION_STRING=redis://127.0.0.1:6379/0 \
    LEARNHOUSE_REDIS_URL=redis://127.0.0.1:6379

EXPOSE 8080

CMD ["/app/start-api.sh"]
