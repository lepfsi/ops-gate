# OpsGate **V1** — Early Customer Ready

**Date** : 12 juillet 2026  
**Version cut** : **1.2.0**  
**Statut** : en cours (post pilote v1.1.0)

## Qu’est-ce que la V1 ?

Le pilote **v1.1.0** prouve la stack (extension + API + console + packs signés).  
La **V1 produit** rend OpsGate **opérable pour un premier client** (10–50 sièges) :

> Un admin IT déploie le control plane, gère policy / agents / licences, reçoit des events metadata-only, et **survit à un redémarrage API/Postgres** — sans SSO, sans proxy, sans Chrome Web Store public.

## Inclus V1

| Capacité | Epic |
|----------|------|
| Postgres **complet** (admins, sessions, profils, groups, users, licences) | V1-E1 |
| Secrets via env + fail-fast production | V1-E2 |
| Deploy docker compose (API + Postgres) + runbook | V1-E2 |
| Sites IA élargis (Copilot, Perplexity, …) + règles enrichies | V1-E3 |
| Polish console (sièges restants, force-sync, états licence) | V1-E4 |
| Tests verts + checklist go | V1-E5 |

## Hors V1 (reporté)

| Item | Cible |
|------|--------|
| Proxy local | v1.x / v1.2 |
| SSO SAML/OIDC | post-V1 |
| Portal personnel cloud / billing | post-V1 |
| LDAP/AD | post-V1 |
| Chrome Web Store public | post-V1 |
| MFA TOTP / WebAuthn | post-V1 |
| Multi-région / HA | GA enterprise |
| Block forcé par défaut | org_managed_strict plus tard |

## Critères go / no-go

- [x] Schema Postgres V1 complet (admins, sessions, profils, groups, users, licences)
- [x] Aucun secret de production par défaut accepté si `NODE_ENV=production`
- [x] Parcours smoke : login → enroll → event → publish pack → agent sync
- [x] ≥ 6 hosts IA injectés (8 : ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, AI Studio, Bing chat)
- [x] `pnpm test` · `pnpm api:smoke` · `pnpm e2e` verts (memory)
- [x] Runbook + RELEASE-v1 documentés
- [x] Validation Postgres restart (`pnpm api:validate-pg` — admins + sessions + epoch survivants)

## Lancer

```bash
docker compose up -d
# DATABASE_URL=postgres://opsgate:opsgate@127.0.0.1:5432/opsgate
pnpm api:dev
pnpm console:dev
pnpm build
```

Org démo : **`DEMO-OPSGATE`** · Admin setup : `OPSGATE_SETUP_EMAIL` / `OPSGATE_SETUP_PASSWORD`

## Relation aux docs antérieures

- Pilote : [`RELEASE-v1.1.md`](./RELEASE-v1.1.md)
- Architecture : [`architecture/PLATFORM-v1.1.md`](./architecture/PLATFORM-v1.1.md)
- Control plane : [`architecture/CONTROL-PLANE.md`](./architecture/CONTROL-PLANE.md)
