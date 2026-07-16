# OpsGate — Postgres Row Level Security multi-tenant (V2 P1)

## Objectif

Isolation **defense-in-depth** : même si une requête SQL omet le filtre `org_id`, Postgres refuse les lignes des autres tenants.

## Activation

| Env `OPSGATE_PG_RLS` | Comportement |
|----------------------|--------------|
| `on` (défaut) | Policies FORCE appliquées ; middleware lie Bearer → `app.current_org_id` ; paths publics en **bypass** service |
| `strict` | Sans contexte org / bypass explicite → **aucune** ligne tenant visible |
| `off` | Ne pas appliquer / ignorer injection RLS (dev urgence) |

Nécessite `DATABASE_URL` (store postgres). Memory store : N/A.

## Mécanisme

1. **Policies** (`packages/api/src/db/rls.sql`) sur :
   - `organizations` (id = tenant)
   - tables `org_id` : policies, agents, events, admins, sessions, packs, audit, …
   - `issued_licenses` : **bypass only** (table vendor globale)
2. **FORCE ROW LEVEL SECURITY** : le owner de table est aussi soumis aux policies.
3. **Session GUC** (transaction-local via `set_config(..., true)`) :
   - `app.current_org_id`
   - `app.rls_bypass` = `on` | `off`
4. **API** : middleware Hono + `AsyncLocalStorage` (`pg-rls.ts`)  
   - Token admin / agent → `withOrgRls(orgId)`  
   - login, enroll, OIDC, health, metrics → `withBypassRls()`  
5. **Pool** : chaque `query` / `connect` injecte le contexte courant.

## Paths en bypass service

- `/`, `/health`, `/metrics`
- `/v1/auth/login`, setup-info, password-reset, OIDC
- `/v1/enroll`

## Vérification

```sql
-- En SQL (superuser) : lister policies
SELECT tablename, policyname, qual
FROM pg_policies
WHERE policyname = 'opsgate_org_isolation';
```

```bash
# Health
curl -s http://127.0.0.1:8787/health | jq .pg_rls
# → { "mode": "on", "enabled": true }
```

Test isolation (strict) :

```bash
$env:OPSGATE_PG_RLS = "strict"
# API restart
# Requête agent org A ne peut pas lire events org B même avec SQL injecté côté app
```

## Limites

- Compte Postgres **superuser** contourne RLS (ne pas exposer ce rôle à l’app en prod).  
- Rôle app recommandé : non-superuser, owner des tables **avec FORCE** (déjà le cas).  
- `issued_licenses` n’est pas multi-tenant ligne-à-ligne (clé globale).  
- Memory store : isolation uniquement applicative.

## Fichiers

| Fichier | Rôle |
|---------|------|
| `packages/api/src/db/rls.sql` | ENABLE/FORCE + policies |
| `packages/api/src/pg-rls.ts` | ALS, modes, `queryWithRls` |
| `packages/api/src/pg-store.ts` | wrap pool + migrateRls |
| `packages/api/src/app.ts` | middleware Bearer → org |
