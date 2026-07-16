# OpsGate — Multi-tenant : rate limits & quotas (V2 P1)

## Isolation

- Toute donnée est scopée `org_id` (events, agents, admins, packs).  
- Sessions admin liées à un `orgId`.  
- Métriques Prometheus labelisées `org_id` / `org_code`.

## Backend rate-limit / quotas

| Mode | Condition | Comportement |
|------|-----------|--------------|
| **Mémoire** | défaut | Compteurs process-local |
| **Redis** | `OPSGATE_REDIS_URL` ou `REDIS_URL` | Compteurs partagés multi-instance ; fallback mémoire si Redis down |

```bash
# Exemple
OPSGATE_REDIS_URL=redis://127.0.0.1:6379/0
```

Client RESP minimal sans dépendance npm : `packages/api/src/redis.ts`.  
Health : `GET /health` → `rate_limit_backend`, `redis: { enabled, connected, url_redacted }`.

## Rate limits (env)

| Env | Défaut | Effet |
|-----|--------|--------|
| `OPSGATE_RATE_LOGIN_PER_MIN` | 30 | Login + OIDC start / IP / minute |
| `OPSGATE_RATE_EVENTS_PER_MIN` | 0 (off) | `POST /v1/events/batch` / org / minute |

Réponse : `429 rate_limited` + `retry_after_sec`.

## Quotas org (`monitoring.quotas`)

Config console **Paramètres → Monitoring** ou JSON org :

```json
{
  "quotas": {
    "maxEventsPerDay": 50000,
    "maxEventsPerMinute": 2000,
    "maxAgents": 500
  }
}
```

| Champ | Effet | HTTP |
|-------|--------|------|
| `maxEventsPerDay` | Events acceptés / jour UTC | 429 `quota_exceeded` |
| `maxEventsPerMinute` | Burst events / minute | 429 `quota_exceeded_minute` |
| `maxAgents` | Agents actifs (list) ; re-enroll même fingerprint OK | 429 `quota_agents_exceeded` |

`0` = illimité (défaut).

## Licences sièges

Toujours en place (licence key / seats) — orthogonal aux `maxAgents` soft quota admin.

## Postgres RLS

Voir **[`POSTGRES-RLS.md`](./POSTGRES-RLS.md)** — FORCE ROW LEVEL SECURITY + `app.current_org_id` / bypass service.

`OPSGATE_PG_RLS=on|strict|off` (défaut `on` si store=postgres).

## Suite multi-tenant

- Isolation chiffrement secrets par org  
- Quotas storage / retention events  
- Rôle Postgres non-superuser dédié (hardening ops)  
