# OpsGate — Runbook ops (v1.1)

## Stack

| Service | Port | Commande |
|---------|------|----------|
| API | 8787 | `pnpm api:dev` |
| Console | 5173 | `pnpm console:dev` |
| Postgres (opt.) | 5432 | `docker compose up -d` |
| Extension | — | `pnpm build` → load `build/chrome-mv3-prod` |

## Variables

```bash
PORT=8787
DATABASE_URL=postgres://opsgate:opsgate@127.0.0.1:5432/opsgate  # optionnel
```

## Santé

```bash
curl -s http://127.0.0.1:8787/health
# { ok, store: memory|postgres, version, features }
```

## Org démo

- Code : `DEMO-OPSGATE`
- Admin header : `X-OpsGate-Dev-Admin: demo`

## Publier des règles

1. Console → Rule packs → disable ids → Publish  
2. Ou API `POST /v1/org/rules/packs`  
3. Agents : sync auto 30 min ou **Synchroniser maintenant**

## Incidents

| Symptôme | Action |
|----------|--------|
| Extension « pack_verify_failed » | Vérifier API up ; clés ed25519 non corrompues ; restart API |
| Enroll 404 | Code org / API URL |
| Events vides en console | Agent enrollé + `eventReporting` + détection réelle |
| Store memory wipe | Normal sans Postgres — activer `DATABASE_URL` |

## Sauvegardes (Postgres)

```bash
docker exec opsgate-postgres pg_dump -U opsgate opsgate > backup.sql
```

## Sécurité

- Ne pas exposer l’API sans reverse-proxy TLS en prod  
- Ne pas committer `packages/api/keys/ed25519-private.pem`  
- Remplacer le header dev-admin par auth réelle (post-1.1)
