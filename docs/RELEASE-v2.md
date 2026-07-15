# OpsGate **V2** — Early Enterprise (draft)

**Date** : 12 juillet 2026  
**Version cible** : **2.0.0**  
**Statut** : **Draft design** — pas encore en build  
**Document maître** : [`architecture/PLATFORM-v2.md`](./architecture/PLATFORM-v2.md)

## En une phrase

Après stabilisation terrain de la **V1** (extension + control plane + Postgres), la **V2** ajoute la couche **entreprise** : proxy local, SSO, MFA, multi-tenant production, distribution Chrome Web Store.

## Périmètre V2.0

| Epic | Contenu |
|------|---------|
| **V2-A Proxy** | Agent local + PAC, allowlist IA, même engine, events `source=proxy` — **P0 spike livré** (`packages/proxy`, `PROXY-P0.md`) |
| **V2-B SSO** | OIDC (priorité) + SAML, JIT admins, `sso_enforce` |
| **V2-C MFA** | TOTP + backup codes ; SMTP réel ; WebAuthn optionnel |
| **V2-D Multi-tenant** | Isolation org, quotas, rate limits, onboarding, backups |
| **V2-E Store** | Chrome Web Store (+ Edge), privacy listing, MDM force-install |
| **V2-F Compléments** | Strict mode, webhooks, CSV, audit admin |

## Hors V2.0

Proxy TUN, multi-région HA, LDAP natif complet, billing personnel Stripe, Firefox — voir PLATFORM-v2.

## Prérequis (pendant tes tests V1)

- [ ] Retours terrain V1 (bugs, FP, UX enroll)  
- [ ] Décisions ouvertes §14 de PLATFORM-v2 tranchées  
- [ ] Go build produit signé  

## Estimation

~**3–5 mois** calendaire selon charge (détail dans PLATFORM-v2 §9).

## Lien V1

V1 reste supportée : [`RELEASE-v1.md`](./RELEASE-v1.md) · stack locale [`GUIDE-STACK-LOCALE.md`](./GUIDE-STACK-LOCALE.md).
