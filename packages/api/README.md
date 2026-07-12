# `@opsgate/api` — Control Plane (PR5)

API OpsGate. Store **memory** (défaut) ou **Postgres** (`DATABASE_URL`).

## Run

```bash
# mémoire (quick)
pnpm api:dev

# Postgres
docker compose up -d
# PowerShell:
# $env:DATABASE_URL="postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"
pnpm api:dev
```

Default: `http://127.0.0.1:8787`

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Liveness |
| POST | `/v1/enroll` | — | Enroll agent with `org_code` |
| GET | `/v1/agents/me/config` | Bearer agent | Policy + **active** rules pack |
| POST | `/v1/events/batch` | Bearer agent | Ingest metadata events |
| GET | `/v1/org/summary` | Dev admin | Dashboard numbers |
| GET | `/v1/org/agents` | Dev admin | Agent list |
| GET | `/v1/org/events` | Dev admin | Recent events |
| GET | `/v1/org/policy` | Dev admin | Org + policy |
| PATCH | `/v1/org/policy` | Dev admin | Update policy |
| GET | `/v1/org/rules/packs` | Dev admin | List pack versions (PR2) |
| GET | `/v1/org/rules/packs/:ver` | Dev admin | Pack detail |
| POST | `/v1/org/rules/packs` | Dev admin | **Publish** pack |
| POST | `/v1/org/rules/packs/:ver/activate` | Dev admin | Activate / rollback |

**Demo org code:** `DEMO-OPSGATE`  
**Dev admin header:** `X-OpsGate-Dev-Admin: demo`

## Smoke test

```bash
pnpm api:smoke
```

## Docs

- [PR1-API.md](../../docs/architecture/PR1-API.md)
- [PR2-RULEPACK.md](../../docs/architecture/PR2-RULEPACK.md)

## Next (PR3+)

- Extension enroll UI + rules cache from API
- Postgres + ed25519
- Real admin auth (magic link)
- OpsGate Console UI
