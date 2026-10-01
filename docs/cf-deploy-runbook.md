# Runbook déploiement — Cloudflare Container (API OrdIA)

> Branche `perf/cloudflare-containers-optimization` — document de référence.
> Le script exécutable : `apps/cloudflare-api/scripts/deploy.sh`.

## Le problème (2026-10-01) : « une petite modif = 20 minutes d'attente »

Trois causes cumulées :

1. **`containers delete` + `wrangler deploy`** était devenu le réflexe « garanti »
   pour qu'une modification de code serve réellement. Mais chaque suppression
   d'application déclenche la ré-acquisition d'instance par la plateforme, et
   cette acquisition ralentit à CHAQUE cycle destroy/start (bug plateforme
   documenté : cloudflare/containers **#257** et **#259**). Observé : 7 min →
   ~10 min → **22 min** en trois cycles le même soir.
2. **« Deploy success » ≠ rollout terminé** (docs officielles : le succès
   signifie seulement que le rollout a *commencé*). Vérifier trop tôt →
   « l'ancien code sert encore » → conclusion erronée « il faut delete » →
   on paie le point 1.
3. Aucune vérification du **digest d'image réellement servi** par l'instance
   vivante — on jugeait sur des suppositions.

## La règle (vérifiée sur les docs Cloudflare)

- `wrangler deploy` reconstruit l'image quand le contexte de build change et
  déclenche un **rollout** de l'application existante. L'instance ANCIENNE
  continue de servir pendant que la nouvelle démarre → **zéro downtime**.
- Avec `max_instances ≥ 2`, le plan par défaut est **gradual [10 %, 100 %]**.
  `--containers-rollout=immediate` le réduit à une seule étape 100 % (toujours
  gracieux : SIGTERM → drain (≤ 15 min) → SIGKILL ; notre nginx exit
  immédiatement au SIGTERM).
- Séquence de remplacement d'une instance : SIGTERM → drain → nouvelle
  instance sur l'image cible. Durée non bornée par la plateforme ; chez nous :
  build ~1-2 min (couches Docker cachées) + rollout ~2-3 min.
- **`containers delete` n'est JAMAIS nécessaire pour du code.** Uniquement si
  le rollout est prouvé bloqué (rare) → `./scripts/deploy.sh recreate`.

## Utilisation

```bash
cd apps/cloudflare-api

./scripts/deploy.sh            # code API : build + rollout IMMEDIAT + vérif
./scripts/deploy.sh gradual    # idem en rollout gradual [10,100]
./scripts/deploy.sh worker     # worker.ts seulement (rollout=none, conteneur intact)
./scripts/deploy.sh status     # état app + instances (digest) + santé
./scripts/deploy.sh recreate --yes   # DERNIER RECOURS (taxe #257 : minutes→dizaines de min)
```

Le mode `api` **vérifie** le rollout : il compare le digest d'image de(s)
instance(s) avant/après et attend `/health` (liveness) 200 puis `/ready`
(readiness DB) 200. « Déployé » = prouvé, pas supposé.

## Santé : liveness vs readiness (nouveau sur cette branche)

| Route                | DB ? | Signification                                    | Utilisé par            |
| -------------------- | ---- | ------------------------------------------------ | ---------------------- |
| `GET /health`        | non  | le processus répond (event loop vivant)          | monitoring, rollouts   |
| `GET /health/ready`  | oui  | la base répond → le service peut servir          | watchdog interne       |
| `GET /ping` (nginx)  | non  | le port conteneur répond                         | classe Container (CF)  |

Pourquoi : une Neon endormie ne doit pas faire échouer la liveness — sinon la
plateforme/rollout tue un conteneur sain (leçon du crash-loop 2026-10-01).
Le watchdog de `start-api.sh` sonde `/health/ready` (3 échecs/60 s → restart
uvicorn, pool neuf).

## Checklist incident « API down après deploy »

1. `./scripts/deploy.sh status` — l'instance est-elle `running` ? quel digest ?
2. Si `running` + /health 503 : rollout en cours — **ne rien faire**, l'ancienne
   instance sert (max_instances=3).
3. Si « no instances » / 503 prolongé : `npx wrangler tail ordria-learning-api
   --format json` → chercher `no container instance` (acquisition #257) →
   **attendre**, le cron keep-warm (*/4 min) réessaie sans arrêt. Chaque
   delete relance le compteur à zéro et aggrave le délai.
4. Rollout prouvé bloqué (>15 min sans changement de digest) : relancer
   `./scripts/deploy.sh` (immediate) UNE fois, puis seulement `recreate`.

## Références

- Rollouts : developers.cloudflare.com/containers/configuration/rollouts/
- Configuration (instance types, sleep_after) :
  developers.cloudflare.com/containers/configuration/
- Bug acquisition lente : github.com/cloudflare/containers/issues/257 et #259

## État de la connexion Neon (déjà en place, vérifié sur cette branche)

- DSN via le **pooler** Neon (détection auto dans `database.py` : pool client
  5+10, recycle 30 min) — sinon pool 20+10, recycle 5 min.
- `command_timeout=30` + `timeout=15` (asyncpg) : une requête sur une connexion
  morte en silence (autosuspend Neon) est tuée au bout de 30 s au lieu de
  bloquer un slot du pool pour toujours (crash du 2026-09-26).
- `pool_pre_ping` + `pool_recycle` partout ; statements non-nommés
  (compatibilité pooler).
- Nouveau : `application_name=learnhouse-api` → les connexions sont étiquetées
  dans la console Neon (diagnostic des tempêtes de connexions).
