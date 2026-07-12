# OpsGate — Runbook ops (V1 / 1.2)

## Stack

| Service | Port | Commande |
|---------|------|----------|
| API | 8787 | `pnpm api:dev` |
| Console | 5173 | `pnpm console:dev` |
| Postgres (recommandé V1) | 5432 | `docker compose up -d` |
| Extension | — | `pnpm build` → load `build/chrome-mv3-prod` |

## Variables

Voir `.env.example` :

```bash
PORT=8787
DATABASE_URL=postgres://opsgate:opsgate@127.0.0.1:5432/opsgate
OPSGATE_SETUP_EMAIL=admin@demo.local
OPSGATE_SETUP_PASSWORD=0000          # dev only — ≥8 chars en production
OPSGATE_VENDOR_RECOVERY=…            # obligatoire en production
OPSGATE_PERSONAL_LICENSE_KEYS=OPS-PERSONAL-DEMO-2026,OPS-HOME-TRIAL
# OPSGATE_ALLOW_DEV_ADMIN=1          # bypass legacy header (désactivé par défaut)
```

**Production** (`NODE_ENV=production`) : l’API refuse de démarrer sans `DATABASE_URL`, `OPSGATE_SETUP_PASSWORD` et `OPSGATE_VENDOR_RECOVERY` non faibles.

## Santé

```bash
curl -s http://127.0.0.1:8787/health
# { ok, store: memory|postgres, version, features }
```

## Org démo

- Code enroll : `DEMO-OPSGATE`
- Console login : `OPSGATE_SETUP_EMAIL` / `OPSGATE_SETUP_PASSWORD` (défaut `admin@demo.local` / `0000`)
- Personnel : org `PERSONAL` + clé `OPS-PERSONAL-DEMO-2026` (Options extension)

## Publier des règles

1. Console → Packs → disable ids → Publish  
2. Ou API `POST /v1/org/rules/packs` (Bearer session admin)  
3. Agents : poll ~2 min ou **Forcer la synchronisation**

## Postgres V1

Tables durables : organizations, policies, policy_profiles, org_admins, admin_sessions, org_users, user_groups, agents, rule_packs, detection_events, password_reset_challenges.

Restart API **conserve** admins, sessions, profils, licences et events.

### Valider un restart (go client)

```bash
docker compose up -d
# DATABASE_URL=postgres://opsgate:opsgate@127.0.0.1:5432/opsgate
pnpm api:validate-pg
# → PASS: Postgres control plane survives API restart
```

## Incidents

| Symptôme | Action |
|----------|--------|
| Extension « pack_verify_failed » | API up ; clés ed25519 ; restart API |
| Enroll 404 | Code org / API URL |
| Events vides | Agent enrollé + `eventReporting` + détection réelle |
| Login 401 | Email/mdp setup ; seed principal |
| Store memory wipe | Normal sans Postgres — activer `DATABASE_URL` |

## Sauvegardes (Postgres)

```bash
docker exec opsgate-postgres pg_dump -U opsgate opsgate > backup.sql
```

## Sécurité

- Ne pas exposer l’API sans reverse-proxy TLS en prod  
- Ne pas committer de clés signing de production  
- Changer le mdp setup immédiatement (`mustChangePassword`)  
- Header `X-OpsGate-Dev-Admin` uniquement si `OPSGATE_ALLOW_DEV_ADMIN=1`
