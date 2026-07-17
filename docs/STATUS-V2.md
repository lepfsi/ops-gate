# OpsGate V2 — Statut produit (synthèse)

**Date** : 17 juillet 2026  
**Version code** : 1.2.x monorepo · **maturité** : **V2 functional / pre-GA**  
**Éditeur** : DailyOps.Tech  

---

## En une phrase

OpsGate dispose aujourd’hui d’une **plateforme entreprise opérationnelle** : extension multi-fichiers + OCR, proxy Windows, control plane multi-tenant (SSO/MFA/passkeys/MSP), audit WORM, exports et docs de déploiement client.  
Il reste surtout la **publication store** réelle, le **billing Stripe GA** et quelques durcissements IdP.

---

## Matrice de maturité

| Domaine | Avancement | Preuve / où |
|---------|------------|-------------|
| DLP extension (prompt/fichier) | **GA V1+** | `src/`, engine |
| Scan PDF/DOCX/PPTX/XLSX | **Livré** | `office-extract.ts`, `zip-min.ts` |
| OCR bitmap | **Livré** | `ocr-bitmap.ts` (Tesseract), policy `scanImages` |
| Proxy MITM multi-IA | **Livré** | `packages/proxy`, MSI |
| API + Postgres + RLS | **Livré** | `DATABASE_URL`, `OPSGATE_PG_RLS` |
| Console MMC | **Livré** | widgets, deep-links, inbox, MSP |
| MFA TOTP + multi-tenant | **Livré** | switch org + code 6 chiffres |
| Session concurrente / read-only | **Livré** | `session-challenge.ts` |
| Passkeys (Hello / empreinte) | **Livré** | UI + WebAuthn PG |
| OIDC / SAML | **Livré** | prod-harden partiel SAML |
| LDAP/AD | **Livré** | cron optionnel |
| SIEM + Prometheus | **Livré** | Monitoring + `/metrics` |
| Audit WORM | **Livré** | chaîne SHA-256 |
| Backup config + DB script | **Livré** | `/org/backup`, `backup-db.ps1` |
| Notif multi-canal | **Livré** | email, Telegram, Slack, webhook |
| Export logs planifié | **Livré** | cron + run-now |
| Import CSV agents | **Livré** | Agents → Import CSV |
| Moving rules OR/permanent | **Livré** | |
| Package CWS/AMO/MDM | **Livré (artefacts + runbook)** | `pnpm store:all` · soumission compte = ops |
| Safari App Store | **Prep livrée** | `pnpm store:safari` + convert Xcode ; ship Apple = ops |
| Billing Stripe portal | **Livré** | Checkout + Customer Portal UI + webhook sièges |
| Soft-delete org GDPR | **Livré** | export DSAR, soft-delete, restore, hard purge cron |

Légende : **Livré** = dans le monorepo et utilisable · **Fondations** = API/config sans parcours produit complet · **Build only** = artefact sans distribution officielle.

---

## Parcours client typique (couvert)

1. Installer control plane (Postgres + API + console) — [`DEPLOIEMENT-CLIENT.md`](./DEPLOIEMENT-CLIENT.md)  
2. Admin : mdp, MFA, policy, licence  
3. Déployer extension (sideload pilote ou MDM)  
4. Enroll postes → events en console  
5. (Option) Proxy MSI  
6. SMTP, alertes, exports, backups  

---

## Ce qui n’est **pas** encore « V2 GA marketing »

| Sujet | Pourquoi |
|-------|----------|
| Listing CWS/AMO **live** (review acceptée) | Compte éditeur + soumission (artefacts monorepo prêts) |
| Safari public App Store | Mac + Apple Developer (prep monorepo prête) |
| Stripe live (clés prod + webhook Dashboard) | Config ops, pas code monorepo |
| SAML tous IdP en prod | C14N exclusive améliorée ; valider par IdP client |
| OCR fr offline embarqué | eng+fra si navigateur fr (télécharge pack Tesseract) |
| HA multi-région | Hors scope actuel |

---

## Indicateurs de « done » pour annoncer V2.0 GA

- [x] Proxy prod + extension multi-fichiers  
- [x] SSO + MFA production-usable  
- [x] Multi-tenant isolé (RLS) + MSP  
- [x] Audit immuable + backup documenté  
- [x] Doc déploiement client + guides PDF  
- [x] Portal personnel Stripe (UI + checkout + portal + webhook sièges)  
- [x] Soft-delete org GDPR (export + grace + hard purge)  
- [x] Kit packaging multi-store (`pnpm store:all` + PUBLICATION-STORES)  
- [ ] Au moins un canal store (CWS unlisted **publié** en review)  
- [ ] Pilote client réel validé (checklist DEPLOIEMENT §11)  
- [ ] Clés Stripe **prod** + webhook Dashboard branché (ou process licence vendor)  

---

## Documents à lire selon le rôle

| Rôle | Document |
|------|----------|
| Intégrateur / install | [`DEPLOIEMENT-CLIENT.md`](./DEPLOIEMENT-CLIENT.md) (+ PDF) |
| Publication stores | [`PUBLICATION-STORES.md`](./PUBLICATION-STORES.md) |
| Admin console | [`GUIDE-UTILISATEUR-V2.md`](./GUIDE-UTILISATEUR-V2.md) (+ PDF) |
| DSI / RSSI | [`DECIDEURS-V2-FR.md`](./DECIDEURS-V2-FR.md) (+ PDF) |
| Dev / maintainer | [`CHANGELOG-TECHNIQUE.md`](./CHANGELOG-TECHNIQUE.md), [`V2-BACKLOG.md`](./V2-BACKLOG.md) |
| Capacités techniques | [`architecture/BACKEND-V2-CATALOG.md`](./architecture/BACKEND-V2-CATALOG.md) |

---

*OpsGate · STATUS-V2 · DailyOps.Tech · 17 juillet 2026*
