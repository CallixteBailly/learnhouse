#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# OrdIA API — Cloudflare Container deploy runbook, executable.
#
# WHY THIS EXISTS (2026-10-01): "small change = 20 min of waiting". The old
# habit was `containers delete` + `wrangler deploy` (the only path that
# GUARANTEED a fresh image) — but deleting the application triggers the
# platform's slow instance re-acquisition (cloudflare/containers#257: delays
# grow with every destroy/start cycle; observed 7 min → 22 min across three
# cycles in one evening). Meanwhile `wrangler deploy` alone was distrusted
# because "Deploy success" does NOT mean the rollout finished (docs:
# developers.cloudflare.com/containers/configuration/rollouts/).
#
# THE FIX: never delete for code changes. A Modified deploy rebuilds the
# image when the build context changed and rolls it out GRADUALLY — the old
# instance keeps serving (no downtime) while the new one boots. With
# max_instances≥2 the default plan is [10,100]; `--containers-rollout=
# immediate` collapses it to a single 100% step (still graceful: SIGTERM →
# drain → SIGKILL after 15 min max; our nginx exits immediately on SIGTERM).
# This script deploys AND verifies (live instance image digest + health),
# so "deployed" is proven, not assumed.
#
# Usage (from anywhere — the script cd's to apps/cloudflare-api):
#   ./scripts/deploy.sh            # api: build image if needed + IMMEDIATE
#                                  #      rollout + verify (zero-downtime)
#   ./scripts/deploy.sh api        # same as above
#   ./scripts/deploy.sh gradual    # api with default gradual rollout [10,100]
#   ./scripts/deploy.sh worker     # worker.ts only (tsc + deploy with
#                                  #      --containers-rollout=none — never
#                                  #      touches the running container)
#   ./scripts/deploy.sh status     # app state + live instances + health
#   ./scripts/deploy.sh recreate   # LAST RESORT: delete + create (stuck
#                                  #      rollout only!). Pays the #257
#                                  # acquisition tax — minutes to tens of
#                                  #      minutes. Asks twice unless --yes.
#
# Env overrides:
#   CF_API_TOKEN   explicit API token (default: wrangler's OAuth token)
#   BASE_URL       health base (default https://learn.ordria.fr)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR/.."

BASE_URL="${BASE_URL:-https://learn.ordria.fr}"
APP_NAME="ordria-learning-api-learnhouseapicontainer"
WORKER_NAME="ordria-learning-api"
MODE="${1:-api}"

# ── Cloudflare API plumbing ──────────────────────────────────────────────────
# Refresh the OAuth token FIRST: the token in the wrangler config expires
# hourly and is only rewritten by wrangler itself — a stale token makes the
# API calls below 401 with empty bodies (crashed the script once mid-deploy
# window). Any wrangler command refreshes it as a side effect.
npx wrangler whoami > /dev/null 2>&1 || true

CF_TOKEN="${CF_API_TOKEN:-}"
if [ -z "$CF_TOKEN" ]; then
    CF_TOKEN=$(sed -n 's/^oauth_token = "\(.*\)"/\1/p' \
        "$HOME/Library/Preferences/.wrangler/config/default.toml" 2>/dev/null || true)
fi
[ -n "$CF_TOKEN" ] || { echo "✗ no CF token (set CF_API_TOKEN or log in with wrangler)"; exit 1; }

ACCOUNT=$(python3 -c '
import json, re, sys
raw = open("wrangler.jsonc").read()
raw = re.sub(r"^\s*//.*$", "", raw, flags=re.M)   # line comments
raw = re.sub(r",(\s*[}\]])", r"\1", raw)          # trailing commas (JSONC)
print(json.loads(raw)["account_id"])')
[ -n "$ACCOUNT" ] || { echo "✗ could not read account_id from wrangler.jsonc"; exit 1; }

cf() { curl -sf -H "Authorization: Bearer $CF_TOKEN" "$@"; }

app_id() {
    cf "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/containers/applications" \
        | python3 -c '
import json, sys
apps = json.load(sys.stdin).get("result", [])
for a in apps:
    if a.get("name") == "'"$APP_NAME"'":
        print(a["id"]); break'
}

instances_json() {
    local id
    id=$(app_id); [ -n "$id" ] || { echo "{}"; return; }
    cf "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/containers/applications/$id/instances" \
        | python3 -c '
import json, sys
d = json.load(sys.stdin).get("result", {})
out = []
for i in d.get("instances", []):
    img = i.get("image", "")
    out.append({
        "state": (i.get("status") or {}).get("state"),
        "digest": img.split("sha256:")[-1][:12] if "sha256:" in img else "?",
        "updated": (i.get("status") or {}).get("updated_at", ""),
    })
print(json.dumps(out))'
}

show_instances() {
    instances_json | python3 -c '
import json, sys
insts = json.load(sys.stdin)
if not insts: print("  (no instances)")
for i in insts:
    print("  %-14s image sha256:%s  (%s)" % (i["state"], i["digest"], i["updated"][:19]))'
}

probe() { curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/api/v1/$1"; }

# ── Modes ────────────────────────────────────────────────────────────────────
case "$MODE" in
status)
    echo "── App: $APP_NAME"
    OLD=$(instances_json)
    echo "── Instances:"; show_instances
    echo "── Liveness  /health: $(probe health)"
    echo "── Readiness /ready:  $(probe health/ready)"
    ;;

worker)
    echo "── Building worker (tsc)…"
    npx tsc
    [ -f dist/worker.js ] || { echo "✗ dist/worker.js missing after tsc"; exit 1; }
    echo "── Deploying worker ONLY (container untouched: --containers-rollout=none)…"
    npx wrangler deploy --containers-rollout=none
    echo "── Liveness /health: $(probe health) (expect 200)"
    echo "✓ worker deployed. Container image NOT rolled out — run 'api' mode for that."
    ;;

api | gradual)
    ROLLOUT_FLAG="--containers-rollout=immediate"
    [ "$MODE" = "gradual" ] && ROLLOUT_FLAG=""
    echo "── Before:"; OLD=$(instances_json); echo "$OLD" | python3 -m json.tool >/dev/null; show_instances

    echo "── Deploying ($MODE) at $(date -u +%H:%M:%SZ)…"
    npx wrangler deploy $ROLLOUT_FLAG

    echo "── Waiting for the rollout to COMPLETE (deploy success ≠ rollout finished)…"
    for i in $(seq 1 60); do   # up to 10 min
        sleep 10
        NEW=$(instances_json)
        CHANGED=$(python3 -c '
import json, sys
old = {i["digest"] for i in json.loads(sys.argv[1])}
new = json.loads(sys.argv[2])
live = [i for i in new if i["state"] in ("running", "active", "provisioning", "inactive")]
print("yes" if new and all(i["digest"] not in old for i in live) else "no")' "$OLD" "$NEW" 2>/dev/null || echo no)
        LIVENESS=$(probe health)
        echo "  [$((i*10))s] image-changed=$CHANGED liveness=$LIVENESS"
        if [ "$CHANGED" = "yes" ] && [ "$LIVENESS" = "200" ]; then
            echo "── Instances now:"; show_instances
            echo "── Waiting for DB readiness (/ready)…"
            for j in $(seq 1 18); do   # up to 3 min (Neon cold start + boot)
                sleep 10
                R=$(probe health/ready)
                [ "$R" = "200" ] && { echo "  readiness=200"; break; }
                echo "  readiness=$R"
            done
            echo "✓ rollout verified: new image live, API answering."
            exit 0
        fi
    done
    echo "✗ rollout NOT confirmed after 10 min. Diagnose:"
    echo "    ./scripts/deploy.sh status          # instance digests/states"
    echo "    npx wrangler tail $WORKER_NAME --format json   # DO errors"
    echo "    If truly stuck (rare): retry 'api' once, THEN consider 'recreate'."
    exit 1
    ;;

recreate)
    echo "⚠️  recreate = delete + create. LAST RESORT ONLY (stuck rollout)."
    echo "   Pays the #257 acquisition tax: minutes to tens of minutes of 503."
    if [ "${2:-}" != "--yes" ]; then
        read -r -p "Type 'recreate' to confirm: " ANSWER
        [ "$ANSWER" = "recreate" ] || { echo "aborted"; exit 1; }
    fi
    ID=$(app_id); [ -n "$ID" ] || { echo "✗ app not found"; exit 1; }
    echo "── Deleting $ID…"
    echo "y" | npx wrangler containers delete "$ID"
    echo "── Deploying (fresh build)…"
    npx wrangler deploy
    echo "── Now poll: ./scripts/deploy.sh status  (patience — #257)."
    echo "   The keep-warm cron (*/4 min) keeps retrying acquisition; do NOT"
    echo "   re-delete: every cycle makes the platform slower to respond."
    ;;

*)
    echo "usage: $0 [api|gradual|worker|status|recreate [--yes]]"
    exit 64
    ;;
esac
