# Tinybird Analytics — État et maintenance

## Statut : ✅ opérationnel (déployé le 2026-09-05)

- **Workspace** : `learnhouse_prod` (GCP europe-west3 / Francfort) — https://cloud.tinybird.co/gcp/europe-west3/learnhouse_prod
- **Compte** : anthony@ordria.fr (mot de passe dans Bitwarden)
- **API host** : `https://api.tinybird.co` (région EU partagée)
- **Datasource** : `events` — déploiement #1, définition dans `apps/cloudflare-api/tinybird/datasources/events.datasource`
- **Tokens** : `learnhouse_ingest` (APPEND sur `events`) et `learnhouse_read` (READ sur `events`)
- **Secrets Worker** (`ordria-learning-api`) : `LEARNHOUSE_TINYBIRD_API_URL`, `LEARNHOUSE_TINYBIRD_INGEST_TOKEN`, `LEARNHOUSE_TINYBIRD_READ_TOKEN` — transmis au conteneur via `FORWARD_TO_CONTAINER` dans `src/worker.ts`

## Comment ça marche

1. L'API envoie chaque événement (`page_view`, `course_view`, `course_enrolled`, …) en JSON sur `POST /v0/events?name=events` avec le token ingest (`src/services/analytics/analytics.py`).
2. Le dashboard `/dash/analytics` exécute des requêtes SQL ClickHouse sur `POST /v0/sql` avec le token read (`src/routers/analytics.py` + `src/services/analytics/queries.py`), avec cache Redis.
3. Les onglets **Overview** et **Advanced** sont tous les deux disponibles en auto-hébergé (voir `EE_ONLY_FEATURES` dans `src/core/deployment_mode.py`).

## Schéma de la datasource `events`

| Colonne | Type | Rempli par |
|---|---|---|
| `timestamp` | DateTime | `datetime.now(UTC)` au format `YYYY-MM-DD HH:MM:SS` |
| `event_name` | String | nom de l'événement (liste blanche `ALLOWED_FRONTEND_EVENTS`) |
| `org_id` | Int32 | organisation |
| `user_id` | Int32 | `0` = anonyme (les requêtes filtrent `user_id != 0`) |
| `session_id` | String | session navigateur |
| `properties` | String | JSON sérialisé (`course_uuid`, `country_code`, `device_type`, `referrer_domain`, …) |
| `source` | String | `api` / `frontend` |
| `ip` | String | IP client (peut être vide) |

Tri : `(org_id, timestamp)`. Partition : `toYYYYMM(timestamp)`.

## Modifier le schéma ou les tokens

Le CLI Tinybird Forward est requis (l'API REST ne crée pas de datasources) :

```bash
cd apps/cloudflare-api/tinybird
# Le token admin du workspace se récupère dans l'UI Tinybird → Tokens → "workspace admin token"
uvx --from tinybird tb --token "$TB_ADMIN_TOKEN" --host https://api.tinybird.co --cloud deploy --wait
```

Un changement de schéma incompatible exige une migration Tinybird (voir la doc Forward « Evolve data sources »).

## Rotation des tokens

1. Dans l'UI Tinybird → Tokens → régénérer `learnhouse_ingest` / `learnhouse_read`.
2. Mettre à jour les secrets Worker :
   ```bash
   cd apps/cloudflare-api
   echo '<nouveau_ingest>' | npx wrangler secret put LEARNHOUSE_TINYBIRD_INGEST_TOKEN
   echo '<nouveau_read>'   | npx wrangler secret put LEARNHOUSE_TINYBIRD_READ_TOKEN
   ```
3. Le conteneur relit ses variables au prochain démarrage (il redémarre après 5 min sans trafic, ou lors d'un `wrangler deploy`).

## Vérifier rapidement

```bash
# Lecture (remplacer par le token read)
curl -s -X POST https://api.tinybird.co/v0/sql \
  -H "Authorization: Bearer $READ_TOKEN" \
  --data "SELECT event_name, count() FROM events GROUP BY event_name FORMAT JSON"
```

Côté app : `GET https://learn.ordria.fr/api/v1/analytics/status` (connecté) doit renvoyer `{"configured": true}`.
