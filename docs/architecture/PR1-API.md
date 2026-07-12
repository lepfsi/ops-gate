# PR1 — `@opsgate/api` skeleton (DONE)

**Date** : 11 juillet 2026  
**Statut** : **Exists**

## Package

`packages/api` — Hono + store mémoire + pack règles depuis `@opsgate/engine`.

## Endpoints

- `GET /health`
- `POST /v1/enroll` — org code `DEMO-OPSGATE`
- `GET /v1/agents/me/config` — Bearer + ETag / 304
- `POST /v1/events/batch` — metadata only
- Dev admin (`X-OpsGate-Dev-Admin: demo`) : summary, agents, events, policy

## Run

```bash
pnpm api:dev          # http://127.0.0.1:8787
pnpm api:smoke        # dans un second terminal
```

## Volontairement plus tard

- Postgres
- Signature ed25519 packs
- Auth admin réelle
- UI extension enroll

## Suite

**PR2** — publish RulePack + versioning org  
ou **PR3** — enroll UI dans l'extension
