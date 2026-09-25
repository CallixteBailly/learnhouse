# Stripe — Procédure d'activation (runbook 5 minutes)

Le backend paiements est **déjà déployé en prod** (34 routes `/api/v1/payments/*`,
7 tables, Checkout + webhook + attribution automatique des accès).
Il ne manque que **la clé API Stripe** — la création du compte exige de résoudre un
captcha dans un vrai navigateur (hCaptcha bloque l'automatisation), d'où cette
manip manuelle une seule fois.

## 0. Prérequis (déjà installés sur ce Mac)

- CLI Stripe : `npm i -g @stripe/cli` *(déjà fait)*
- Wrangler : présent dans `apps/cloudflare-api` *(déjà fait)*

## 1. Créer le compte sandbox Stripe (~2 min)

Dans ton terminal :

```bash
stripe sandbox create --email anthony@ordria.fr --full-name "Anthony Bailly"
```

- Si le CLI ouvre ton navigateur : résous le captcha, le compte se crée et **la clé
  `sk_test_...` est écrite automatiquement** dans `~/.config/stripe/config.toml`.
- Si le proof-of-work passe tout seul, c'est encore plus rapide.

En cas de pépin, plan B manuel :

1. Ouvrir https://dashboard.stripe.com/register
2. Créer le compte : `anthony@ordria.fr` / `Kq9-vZx7!mRt4Wp2Nz` / France
3. Puis `stripe login` dans le terminal (l'appareil s'approuve depuis le navigateur).

Récupérer la clé ensuite :

```bash
stripe whoami                      # vérifie que la session marche
grep test_mode_api_key ~/.config/stripe/config.toml   # affiche la sk_test_...
```

## 2. Pousser les secrets dans le worker Cloudflare

```bash
cd apps/cloudflare-api
npx wrangler secret put STRIPE_SECRET_KEY     # coller la sk_test_... puis Entrée
```

Créer le webhook (le signing secret est dans la réponse, champ `secret`) :

```bash
npx stripe post /v1/webhook_endpoints \
  -d "url=https://learn.ordria.fr/api/v1/payments/stripe/webhook" \
  -d "enabled_events[]=checkout.session.completed" \
  -d "enabled_events[]=checkout.session.async_payment_succeeded" \
  -d "enabled_events[]=checkout.session.async_payment_failed" \
  -d "enabled_events[]=customer.subscription.deleted" \
  -d "enabled_events[]=customer.subscription.canceled"

npx wrangler secret put STRIPE_WEBHOOK_SECRET # coller la whsec_... puis Entrée
```

## 3. Redémarrer le conteneur (les secrets exigent un rollout)

```bash
APP_ID=$(npx wrangler containers list | grep -oE 'ordria-learning-api[a-z-]*' | head -1)
echo y | npx wrangler containers delete "$APP_ID"
npx wrangler deploy
```

⚠️ ~2 à 8 minutes de 502/503 ensuite, c'est normal.
Santé : https://learn.ordria.fr/api/v1/health

## 4. Activer dans le dashboard LearnHouse

1. Dashboard PROTECH → **Payments** → *Connect Stripe*
   (c'est le compte **plateforme Ordria** qui encaisse — pas de Connect par client en v1)
2. Créer un **groupe** (ex. « Formation Soudure ») + y rattacher un cours
3. Créer une **offre** (ex. 49 € one-time) avec ce groupe
4. Le store https://learn.ordria.fr/protech/store affiche l'offre

## 5. Test de bout en bout (mode test)

- Acheter l'offre avec la carte **4242 4242 4242 4242**, n'importe quelle date future, CVC 123
- Vérifier : l'apprenant devient membre de l'org + du groupe → accès au cours immédiat
- Dashboard → Payments → Customers/Overview reflète le paiement

## Plus tard : encaisser de l'argent réel

1. Activer le compte Stripe réel (KYC, IBAN) dans le dashboard Stripe
2. Basculer `STRIPE_SECRET_KEY` vers la clé live `sk_live_...` (+ recréer le webhook
   en mode live pour un nouveau `whsec_...`)
3. Rollout conteneur (étape 3) — c'est tout, rien à changer côté code.

## Architecture (déjà en prod)

- `apps/api/src/db/payments.py` — 7 tables (config, groupes, offres, inscriptions…)
- `apps/api/src/services/payments/` — `stripe_provider.py` (SDK Stripe 15.x,
  `StripeClient`), `payments.py` (offres, checkout, **fulfillment webhook** →
  membership org + groupe = accès aux cours, idempotent)
- `apps/api/src/routers/payments/` — 34 routes, parité avec l'UI web existante
- Worker CF : transmet `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` au conteneur
- Tant que la clé est absente : activation → 503 propre « Stripe non configuré »,
  le reste de la plateforme est intact.
