# Backlog V2 — ne pas oublier

Mis à jour : 17 juillet 2026

## Lots livrés (17/07) — suite backlog console

| Item | Statut |
|------|--------|
| **Console MSP multi-org** | Portfolio `#/msp` : KPI cross-tenants, ouverture avec MFA |
| **Audit WORM / rétention légale** | Chaîne SHA-256, vérif intégrité, rétention légale (min 90 j) |
| **Rotation secrets** | Dual-key `*_PREVIOUS` vendor + doc `SECRET-ROTATION.md` |
| **SAML/WebAuthn prod** | Signature SAML exigée en prod ; passkeys Postgres |
| **Polish VendorDesk** | Stats, recherche licences |

## Où on en est (jalon)

**V1.x / pré-V2 terrain** : proxy MITM multi-IA + soft-block, rapports PDF, docs DSI, maintenance agents, logs proxy toggle.  
**Jalon actuel** : P0–P2 larges (Safari build, WebAuthn, SAML SP, LDAP cron, docs V2).  
**Suite** : publication stores réelles, WebAuthn persisté Postgres, SAML C14N strict.

Voir le journal détaillé : [`CHANGELOG-TECHNIQUE.md`](./CHANGELOG-TECHNIQUE.md).

## Confirmé pour V2 (priorisé)

| Prio | Item | Notes |
|------|------|--------|
| **P0 ✅** | **SIEM / Syslog** | **Livré** : UDP/TCP, RFC 5424 + CEF, config org console Monitoring. Voir `siem.ts` + `docs/grafana/README.md`. |
| **P0 ✅** | **Métriques + Grafana** | **Livré** : `GET /metrics`, counters + gauges multi-org, dashboard `docs/grafana/opsgate-dashboard.json`. |
| **P1 ✅** | **Proxy prod** | **Livré** : service/tâche, PAC/GPO, soft-mask on-wire, MSI + **Node portable**, HTTP/2 stream-aware. |
| **P1 ✅** | **SSO + MFA** | **Livré** : MFA TOTP + OIDC PKCE + **JWKS**, **JIT**, **sso_enforce**. Optionnel : WebAuthn, SAML, claims→rôles. |
| **P1 ✅** | **Multi-tenant prod** | **Livré** : rate-limit, quotas étendus, Redis optionnel, **RLS Postgres** (`OPSGATE_PG_RLS`, FORCE policies). Optionnel : secrets/org, rôle PG non-superuser. |
| **P2 ✅ partiel** | **Multi-navigateur** | Chrome + Firefox + **Safari MV3 build** (`pnpm build:safari`). Reste : App Store Apple, comptes store réels. |
| **P2 ✅** | **Chrome Web Store** + force-install MDM | **Livré** : `pnpm store:chrome`, ZIP CWS, GPO/Intune/Edge reg, self-host update.xml. Reste : publication compte dev réelle. |
| **P2 ✅** | **LDAP / AD sync** | **Livré** : ldapts, `/org/ldap/test|sync`, console Settings, memberOf → groups. Optionnel : cron, prune, mapping auto profil. |
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


