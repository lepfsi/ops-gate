# Backlog V2 — état d’avancement

**Mis à jour** : 17 juillet 2026  
**Jalon** : **V2 functional / pre-GA** — la majeure partie des epics V2.0 est **dans le code** ; restent surtout publications stores réelles, C14N SAML stricte, portal billing GA, multilingue OCR.

Document de synthèse produit : [`STATUS-V2.md`](./STATUS-V2.md)  
Traces techniques : [`CHANGELOG-TECHNIQUE.md`](./CHANGELOG-TECHNIQUE.md)  
Design d’origine : [`architecture/PLATFORM-v2.md`](./architecture/PLATFORM-v2.md)

---

## Où on en est

| Couche | État |
|--------|------|
| **Extension** | Chrome/Edge/Firefox/Safari build · scan PDF/DOCX/PPTX/XLSX · OCR bitmap · inbox user→admin · enroll org |
| **Proxy** | MITM multi-IA, soft-block, MSI + Node portable, PAC |
| **API + Postgres** | Multi-tenant, RLS, MFA, SSO, SAML, WebAuthn PG, WORM audit, exports, backups |
| **Console** | MSP, passkeys, session challenge, notif multi-canal, deep-links, import CSV agents |
| **Docs** | Guides user/décideurs, **déploiement client**, FAQ, catalogue backend |
| **Reste GA** | Comptes CWS/AMO/App Store réels · SAML C14N exclusive · Stripe portal GA · OCR fr pack |

---

## Epics V2.0 — tableau de bord

| Epic | Statut | Commentaire |
|------|--------|-------------|
| **V2-A Proxy** | ✅ | Prod Windows MSI, enforce/observe, soft-mask |
| **V2-B SSO** | ✅ | OIDC PKCE + JWKS + JIT + sso_enforce · SAML SP (sig en prod) |
| **V2-C MFA** | ✅ | TOTP + QR · multi-tenant forcé · passkeys UI + PG · challenge session |
| **V2-D Multi-tenant** | ✅ | RLS, quotas, rate-limit, MSP portfolio, MFA switch |
| **V2-E Store / MDM** | ✅ packaging | Artefacts + policies ; **publication compte store = client/ops** |
| **V2-F Compléments** | ✅ / ◐ | Audit WORM, CSV, webhooks notif, exports planifiés · billing Stripe = fondations |

---

## Backlog priorisé (détail)

### P0 — Observabilité & data plane

| Item | Statut | Notes |
|------|--------|--------|
| SIEM / Syslog | ✅ | UDP/TCP, RFC5424 + CEF, console Monitoring |
| Métriques + Grafana | ✅ | `GET /metrics`, dashboard `docs/grafana/` |
| Proxy prod | ✅ | MSI, Node portable, PAC/GPO, soft-mask |

### P1 — Identité & multi-tenant

| Item | Statut | Notes |
|------|--------|--------|
| MFA TOTP | ✅ | Setup QR, enable/disable, login |
| MFA multi-tenant forcé | ✅ | Code 6 chiffres à chaque bascule d’org |
| Session concurrente | ✅ | Accept/refuse 10 s · lecture seule |
| OIDC + JWKS + JIT + enforce | ✅ | |
| SAML SP | ✅ | Metadata, ACS · signature IdP en prod |
| WebAuthn / passkeys | ✅ | UI console + login · persistance Postgres |
| Multi-tenant RLS / quotas / rate-limit | ✅ | Redis optionnel |
| Console MSP multi-org | ✅ | Portfolio `#/msp` |

### P2 — Distribution & annuaire

| Item | Statut | Notes |
|------|--------|--------|
| Chrome Web Store package + MDM | ✅ | Reste : compte publisher réel |
| Firefox AMO package + policies | ✅ | Reste : soumission AMO |
| Safari MV3 build | ✅ | Reste : App Store Apple |
| LDAP / AD + cron | ✅ | Test/sync console · prune/map profil = optionnel |

### P3 — Fichiers, agents, billing, polish

| Item | Statut | Notes |
|------|--------|--------|
| Parser PDF + DOCX | ✅ | V1.x |
| Parser PPTX + XLSX | ✅ | OOXML ZIP |
| OCR images | ✅ | Tesseract.js eng · SVG texte · max 4 Mo |
| Bulk export agents | ✅ | CSV/JSON |
| Bulk **import** CSV agents | ✅ | `POST /org/agents/import-csv` |
| Moving rules AND | ✅ | V1.x multi-cond |
| Moving rules **OR / permanent** | ✅ | |
| Audit WORM + rétention légale | ✅ | |
| Backup config + `pg_dump` script | ✅ | |
| Notifications email + Telegram/Slack/webhook | ✅ | |
| Export logs planifié + run-now | ✅ | |
| Inbox user → admin | ✅ | |
| Deep-links console | ✅ | |
| Portal personnel / billing Stripe | ✅ | Checkout + Customer Portal UI + webhook sièges (`billing-stripe.ts`) |
| Vendor desk polish | ✅ | Stats, recherche |

---

## Suite recommandée (post-current)

1. **Publication** CWS / AMO / Apple (comptes et process métier)  
2. **SAML** tests IdP clients réels (C14N exclusive améliorée dans le code)  
3. ~~Stripe webhook + portal~~ → **livré** (reste : clés prod Dashboard)  
4. **OCR** pack `fra` embarqué offline (aujourd’hui eng+fra si locale fr, download runtime)  
5. **OIDC/SAML state** multi-instance (Redis)  
6. ~~Soft-delete org GDPR full~~ → **livré** (`gdpr-org.ts`, doc `architecture/GDPR-SOFT-DELETE.md`)  

---

## Liens

- [`STATUS-V2.md`](./STATUS-V2.md) — synthèse une page  
- [`DEPLOIEMENT-CLIENT.md`](./DEPLOIEMENT-CLIENT.md) — install chez le client  
- [`CHANGELOG-TECHNIQUE.md`](./CHANGELOG-TECHNIQUE.md)  
- [`architecture/BACKEND-V2-CATALOG.md`](./architecture/BACKEND-V2-CATALOG.md)  
- Guides PDF : `GUIDE-UTILISATEUR-V2*.pdf`, `DECIDEURS-V2-*.pdf`, `DEPLOIEMENT-CLIENT*.pdf`  
