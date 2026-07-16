# Backlog V2 — ne pas oublier

Mis à jour : 16 juillet 2026

## Où on en est (jalon)

**V1.x / pré-V2 terrain** : proxy MITM multi-IA + soft-block, rapports PDF, docs DSI, maintenance agents, logs proxy toggle.  
**Prochaine brique V2 recommandée** : **observabilité entreprise (Syslog/SIEM + Prometheus/Grafana)** — c’est le levier DSI le plus immédiat après le data-plane proxy.

Voir le journal détaillé : [`CHANGELOG-TECHNIQUE.md`](./CHANGELOG-TECHNIQUE.md).

## Confirmé pour V2 (priorisé)

| Prio | Item | Notes |
|------|------|--------|
| **P0 ✅** | **SIEM / Syslog** | **Livré** : UDP/TCP, RFC 5424 + CEF, config org console Monitoring. Voir `siem.ts` + `docs/grafana/README.md`. |
| **P0 ✅** | **Métriques + Grafana** | **Livré** : `GET /metrics`, counters + gauges multi-org, dashboard `docs/grafana/opsgate-dashboard.json`. |
| **P1 ✅ partiel** | **Proxy prod** | **Livré** : service/tâche Windows, PAC/GPO, soft-mask **on-wire** (rewrite body) + local 422. Reste : MSI packagé, HTTP/2 stream-aware. |
| **P1 ✅** | **SSO + MFA** | **Livré** : MFA TOTP + OIDC Authorization Code+PKCE (`/auth/oidc/start|callback`, mapping email→admin, bouton console). Reste optionnel : JIT, JWKS, WebAuthn, SAML, `sso_enforce`. |
| **P1 ✅ partiel** | **Multi-tenant prod** | **Livré** : rate limit login, quota events/jour. Reste : Redis multi-instance, RLS, quotas étendus. |
| **P2** | **Multi-navigateur** | Chromium OK. **Firefox** MV3 puis Safari. |
| **P2** | **Chrome Web Store** + force-install MDM | Distribution + ExtensionInstallForcelist |
| **P2** | **LDAP / AD sync** | Champs prêts ; sync groupes → policy |
| **P3** | **Parser PPT/XLS** | PDF+DOCX déjà V1.x |
| **P3** | **OCR images** | `scanImages` réservé |
| **P3** | **Portal personnel / billing** | Stripe V2.1 |
| **P3** | **Bulk CSV import agents** | Export agents déjà livré |
| **P3** | **Moving rules OR / permanent** | AND multi-cond déjà V1.x |

## Déjà livré (V1.x) — y compris lots récents

- Code org = tenant + licences org  
- Moving rules multi-conditions AND + priorité + re-apply  
- Bulk multi-select agents → groupe/profil · **export agents CSV/JSON**  
- Groupes éditables + description  
- Audit principal-only + détail policy  
- Events filtres (décision / sévérité / source / recherche)  
- Idle logout 5 min + session unique admin  
- HostPicker multi-IA + pack règles élargi  
- PDF/DOCX parse (mammoth + pdfjs)  
- **Proxy P0–P3** : MITM multi-IA, enroll, soft-block par requête, PAC, silent start  
- **Maintenance agents** (congé / panne / remote)  
- **Logs proxy** on/off · FP credit-card / JWT  
- **Rapport sécurité PDF** (semaine / plage / 90 j) — Settings → Rapports  
- **Docs DSI + Guide PDF** brandés DailyOps (BrandMark login)  
- Cahier concepteur · charte navy/teal  

## Liens

- **[`CHANGELOG-TECHNIQUE.md`](./CHANGELOG-TECHNIQUE.md)** — traces « comment c’est fait »  
- [`CAHIER-CONCEPTEUR.md`](./CAHIER-CONCEPTEUR.md)  
- [`ORG-CODE-AND-TENANT.md`](./ORG-CODE-AND-TENANT.md)  
- [`ROADMAP-TESTERS.md`](./ROADMAP-TESTERS.md)  
- [`architecture/PLATFORM-v2.md`](./architecture/PLATFORM-v2.md)  
- [`RULE-PACKS.md`](./RULE-PACKS.md)  
- [`DSI-FILTRAGE-DONNEES-SENSIBLES.md`](./DSI-FILTRAGE-DONNEES-SENSIBLES.md)  
- Guides : `GUIDE-UTILISATEUR.md` · `architecture/PROXY-RUNBOOK.md`  


