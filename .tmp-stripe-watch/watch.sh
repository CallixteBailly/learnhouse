#!/bin/bash
# Stripe auto-completion watcher — waits for a FRESH sk_test key, then wires it up.
# Reads secrets ONLY from the Stripe CLI store at runtime; never writes or logs key literals.
# Status file: .tmp-stripe-watch/status.log (secrets redacted)

DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/status.log"
CFG_STRIPE="$HOME/.config/stripe/config.toml"
API_DIR="/Users/anthonybailly/learnhouse/apps/cloudflare-api"
DEAD_ACCT="acct_1RQZco"
: > "$LOG"
log() { echo "[$(date +%H:%M:%S)] $*" >> "$LOG"; }

log "watcher started — waiting for fresh Stripe key (config: $CFG_STRIPE / wrangler secret)"

for i in $(seq 1 360); do   # up to 3h, poll every 30s
  # ── Path A: fresh key in Stripe CLI config (any project section, not the dead account) ──
  KEY=""
  while IFS= read -r line; do
    candidate="${line#*'}"; candidate="${candidate%'}"
    if [ -n "$candidate" ] && [ "$candidate" != "${candidate%%BGZO}" ]; then continue; fi
    # validate against the Stripe API before use
    code=$(curl -s -o "$DIR/.acct.json" -w "%{http_code}" --max-time 10 \
      -H "Authorization: Bearer $candidate" https://api.stripe.com/v1/account)
    if [ "$code" = "200" ]; then KEY="$candidate"; log "fresh key found in CLI config (validated 200)"; break; fi
  done < <(grep -E "^test_mode_api_key" "$CFG_STRIPE" 2>/dev/null)

  if [ -n "$KEY" ]; then
    log "STEP1 pushing STRIPE_SECRET_KEY to worker"
    printf '%s' "$KEY" | (cd "$API_DIR" && npx wrangler secret put STRIPE_SECRET_KEY >/dev/null 2>&1) \
      && log "STEP1 ok" || log "STEP1 FAILED (wrangler secret put)"

    log "STEP2 creating webhook endpoint"
    rm -f "$DIR/.wh.json"
    STRIPE_API_KEY="$KEY" npx stripe post /v1/webhook_endpoints \
      -d "url=https://learn.ordria.fr/api/v1/payments/stripe/webhook" \
      -d "enabled_events[]=checkout.session.completed" \
      -d "enabled_events[]=checkout.session.async_payment_succeeded" \
      -d "enabled_events[]=checkout.session.async_payment_failed" \
      -d "enabled_events[]=customer.subscription.deleted" \
      -d "enabled_events[]=customer.subscription.canceled" > "$DIR/.wh.json" 2>>"$LOG"
    WHSEC=$(python3 -c "import json;print(json.load(open('$DIR/.wh.json')).get('secret',''))" 2>/dev/null)
    if [ -n "$WHSEC" ]; then
      printf '%s' "$WHSEC" | (cd "$API_DIR" && npx wrangler secret put STRIPE_WEBHOOK_SECRET >/dev/null 2>&1) \
        && log "STEP2 ok (webhook + STRIPE_WEBHOOK_SECRET)" || log "STEP2 secret put FAILED"
    else
      log "STEP2 FAILED (no secret in response — endpoint may already exist: check .wh.json)"
    fi
    rm -f "$DIR/.wh.json"

    log "STEP3 container rollout"
    APP_ID=$(cd "$API_DIR" && npx wrangler containers list 2>/dev/null | grep -oE 'ordria-learning-api[a-z-]*' | head -1)
    [ -n "$APP_ID" ] && (cd "$API_DIR" && echo y | npx wrangler containers delete "$APP_ID" >/dev/null 2>&1; log "STEP3 deleted $APP_ID")
    (cd "$API_DIR" && npx wrangler deploy >>"$LOG" 2>&1) && log "STEP3 deploy ok — waiting for health" || log "STEP3 deploy FAILED (retry maybe needed)"

    for h in $(seq 1 40); do
      sleep 20
      H=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 https://learn.ordria.fr/api/v1/health)
      [ "$H" = "200" ] && { log "STEP3 health 200 — ALL DONE, backend ready"; exit 0; }
    done
    log "STEP3 health never turned 200 — check manually"; exit 1
  fi

  # ── Path B: user already pushed the secret himself (can't read it back — webhook needs config key too) ──
  if (cd "$API_DIR" && npx wrangler secret list 2>/dev/null | grep -q '"name": "STRIPE_SECRET_KEY"'); then
    log "STRIPE_SECRET_KEY present in worker but no fresh key in CLI config — webhook step needs the key; stopping for manual check"
    exit 2
  fi

  sleep 30
done
log "timeout 3h — no key arrived"; exit 3
