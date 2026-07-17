# OpsGate **V2** — Early Enterprise

**Date** : 17 juillet 2026  
**Version code monorepo** : **1.2.x** (features V2 embarquées)  
**Statut** : **Functional / pre-GA** — plus un draft design : la majorité du périmètre V2.0 est **implémentée**  
**Synthèse** : [`STATUS-V2.md`](./STATUS-V2.md)  
**Backlog vivant** : [`V2-BACKLOG.md`](./V2-BACKLOG.md)  
**Design d’origine** : [`architecture/PLATFORM-v2.md`](./architecture/PLATFORM-v2.md)

## En une phrase

Après la V1 (extension + control plane + Postgres), la **V2** ajoute la couche **entreprise** : proxy local production, SSO/MFA/passkeys, multi-tenant/MSP, distribution store/MDM, audit WORM, exports, scan fichiers étendu et OCR — **dans le code actuel**.

## Périmètre V2.0 — état

| Epic | Contenu | Statut 17/07 |
|------|---------|--------------|
| **V2-A Proxy** | Agent local + PAC, allowlist IA, events `source=proxy`, MSI | ✅ **Livré** |
| **V2-B SSO** | OIDC (JWKS, JIT, enforce) + SAML SP | ✅ **Livré** (C14N strict = suite) |
| **V2-C MFA** | TOTP + multi-tenant + session challenge + WebAuthn UI/PG | ✅ **Livré** |
| **V2-D Multi-tenant** | Isolation org, quotas, rate limits, MSP, backups | ✅ **Livré** |
| **V2-E Store** | Package CWS/AMO + MDM policies | ✅ **Artefacts** · publication compte = ops |
| **V2-F Compléments** | Audit WORM, CSV import, notif webhooks, exports, inbox, **Stripe portal** | ✅ **Livré** |

## Compléments livrés hors plan initial (valeur terrain)

- Inbox user → admin (Kaspersky-style)  
- Notifications Telegram / Slack / webhook  
- Export logs planifié + **run-now**  
- Scan **PPTX/XLSX** + **OCR bitmap** (Tesseract)  
- Moving rules **OR** + **permanent**  
- Guide **déploiement client** (MD + PDF FR/EN)  
- Passkeys console (Windows Hello / empreinte)

## Hors V2.0 GA (reste ou V2.1)

| Sujet | Notes |
|-------|--------|
| Publication CWS / AMO / App Store | Process éditeur, pas seulement code |
| Clés Stripe **production** + webhook Dashboard | Code portal livré (checkout/portal/webhook) |
| Validation SAML IdP clients | C14N exclusive améliorée dans le code |
| HA multi-région / multi-AZ | Infra client |
| OCR pack français **offline** embarqué | eng+fra si locale fr (download runtime Tesseract) |

## Prérequis pour annoncer « V2.0 GA »

- [x] Code epics A–F majoritairement livrés  
- [x] Docs user / décideurs / déploiement  
- [ ] Au moins un pilote client avec checklist DEPLOIEMENT validée  
- [ ] Un canal de distribution store ou MDM documenté chez un client  
- [ ] Secrets prod + backups prouvés  

## Estimation restante (ops / polish)

~**2–6 semaines** calendaires selon publication store et pilotes (plus le temps review Google/Mozilla).

## Lien V1

V1 reste le socle supporté : [`RELEASE-v1.md`](./RELEASE-v1.md) · stack locale [`GUIDE-STACK-LOCALE.md`](./GUIDE-STACK-LOCALE.md) · déploiement client [`DEPLOIEMENT-CLIENT.md`](./DEPLOIEMENT-CLIENT.md).
