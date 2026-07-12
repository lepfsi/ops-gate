# PR5 — Postgres durable store (DONE)

**Date** : 11 juillet 2026  
**Statut** : **Exists**  
**Depends** : PR1–PR2 store contract

## Objectif

Remplacer le store purement mémoire par **Postgres** en production locale, tout en gardant le **fallback mémoire** pour dev rapide.

## Comportement

| `DATABASE_URL` | Store |
|----------------|--------|
| non défini | `memory` (seed DEMO à chaque restart) |
| défini | `postgres` (schema auto-migrate + seed si vide) |

`GET /health` expose `store: "memory" | "postgres"`.

## Fichiers

```
packages/api/src/
  store-types.ts     # interface OpsGateStore
  memory-store.ts
  pg-store.ts
  store.ts           # initStore() factory
  db/schema.sql
docker-compose.yml
.env.example
```

## Run Postgres

```bash
docker compose up -d

# Windows PowerShell
$env:DATABASE_URL="postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"
pnpm api:dev
```

Sans Docker :

```bash
pnpm api:dev   # memory fallback
```

## Vérif

```bash
pnpm api:smoke
# health → store memory ou postgres
```

Données persistées si Postgres : agents, packs, events survivent au restart API.

## Volontairement plus tard

- Migrations versionnées (node-pg-migrate / drizzle)
- Connection pool tuning
- Multi-org seed
- Backups / rétention 90j job

## Suite chrono

**PR6** — polish E2E démo (script unique) **ou** signature ed25519 packs  
**ou** deploy notes EU.
