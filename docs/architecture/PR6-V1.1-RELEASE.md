# PR6 — v1.1 pilot release polish (DONE)

**Date** : 11 juillet 2026  
**Statut** : **Exists** — cut **OpsGate v1.1.0 pilot-ready**

## Est-ce la dernière étape v1.1 ?

| Question | Réponse |
|----------|---------|
| Dernière étape pour un **pilote interne / démo client tech** ? | **Oui** |
| Dernière étape pour un **GA enterprise** ? | **Non** (SSO, proxy, store, hardening prod) |

PR6 ferme le scope **v1.1 pilot** défini dans la plateforme : agent + control plane + console + store + signatures + docs ops.

## Livrables PR6

1. **ed25519** — signature des RulePacks à la publication ; vérif agent au sync  
2. `GET /v1/crypto/public-key`  
3. Docs : `RELEASE-v1.1.md`, `PRIVACY.md`, `RUNBOOK-OPS.md`  
4. Tests : event schema forbid + `pnpm e2e`  
5. Bump version **1.1.0**

## Hors PR6 (backlog post-1.1)

- Auth admin réelle  
- Proxy  
- Store public  
- Multi-org UI  

## Commandes

```bash
pnpm test
pnpm api:smoke
pnpm e2e
pnpm build && pnpm console:build
```
