# OpsGate — Multi-tenant : rate limits & quotas (V2 P1)

## Isolation

- Toute donnée est scopée `org_id` (events, agents, admins, packs).  
- Sessions admin liées à un `orgId`.  
- Métriques Prometheus labelisées `org_id` / `org_code`.

## Rate limit login

| Env | Défaut | Effet |
|-----|--------|--------|
| `OPSGATE_RATE_LOGIN_PER_MIN` | 30 | Max tentatives login / IP / minute |

Réponse : `429 rate_limited` + `retry_after_sec`.

Implémentation : mémoire process (`rate-limit.ts`). Multi-instance → Redis (roadmap).

## Quota events / jour (par org)

Config dans **monitoring.quotas** (JSON org) :

```json
{
  "quotas": {
    "maxEventsPerDay": 50000
  }
}
```

- `0` = illimité (défaut).  
- Compteur **UTC day**, process local.  
- Dépassé → `POST /v1/events/batch` renvoie **429** `quota_exceeded`.

Console : champ optionnel **Paramètres → Monitoring** (quota).

## Suite multi-tenant prod

- Rate limit API globale (events/config) par org  
- Quotas sièges déjà via licences  
- RLS Postgres strict  
- Isolation réseau / keys de chiffrement par org  
