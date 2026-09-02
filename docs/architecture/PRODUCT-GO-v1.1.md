# Go produit - OpsGate Platform v1.1

**Date** : 11 juillet 2026  
**Décision** : **GO BUILD**  
**Document de référence** : [PLATFORM-v1.1.md](./PLATFORM-v1.1.md)

## Ce qui est approuvé

1. Construire **OpsGate Console** (admin light) + API control plane.  
2. **RulePack** versionné et signé, sync agent.  
3. **Events** opt-in, metadata-only, rétention 90j, hébergement **EU**.  
4. Modes : `local_only` (défaut) · `org_managed` · `org_managed_strict` (plus tard).  
5. **Proxy** : conception maintenant, implémentation **v1.2**.  
6. Monorepo TypeScript ; auth admin magic link ; agent = device token.  
7. Le pilote / démo **extension MVP** continue en parallèle (kit `docs/demo/`).

## Ce qui n’est pas approuvé pour v1.1

- Proxy production  
- SSO SAML/OIDC multi-IdP  
- Stockage de prompts / fichiers en clair  
- UI no-code règles  
- Blocage forcé par défaut  

## Livrables tech

| PR | Statut |
|----|--------|
| **PR0** `@opsgate/engine` | **DONE** — `packages/engine` |
| **PR1** API skeleton | **DONE** — `packages/api` |
| **PR2** RulePack publish | **DONE** — versioning + activate |
| **PR3** Agent enroll + sync | **DONE** — extension ↔ API |
| **PR4** Console web | **DONE** — Summary + packs |
| **PR5** Postgres store | **DONE** — + fallback memory |
| **PR6** v1.1 pilot release | **DONE** — ed25519 + docs + e2e |

**Cut produit : OpsGate v1.1.0 pilot-ready** - voir [RELEASE-v1.1.md](../RELEASE-v1.1.md).

## Signature produit

| Rôle | Décision |
|------|----------|
| Produit (Steve) | **GO** - 11/07/2026 |
