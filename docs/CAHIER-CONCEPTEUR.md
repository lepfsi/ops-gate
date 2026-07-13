# OpsGate — Cahier de description (concepteur)

Document de conception pour l’équipe produit / design / architecture.  
Chaque fonctionnalité listée indique **ce qu’elle fait**, **où elle vit dans le code**, et les **dépendances** éventuelles.

> Dernière mise à jour : 2026-07 · stack V1 pilote (extension Plasmo MV3 + API Hono + console Vite + Postgres).

---

## 1. Vue d’ensemble

| Couche | Rôle | Emplacement |
|--------|------|-------------|
| Extension Chrome | DLP endpoint : scan texte/fichiers sur sites IA, enroll, sync policy | `src/` (Plasmo) |
| Engine règles | Détection regex/rules pack (email, secrets, IBAN…) | `packages/engine` |
| Control plane API | Orgs, agents, packs signés, events, admins, moving rules | `packages/api` |
| Console admin | UI ops (policy, agents, events, audit, moving rules) | `packages/console` |
| Postgres | Persistance durable (sinon memory-store en dev) | `packages/api/src/db/schema.sql` |

Flux principal :

```
Site IA (content script)
  → scan texte / fichier
  → règles engine (+ pack org si enrollé)
  → banner décision (mask / block / allow)
  → event local + optionnel POST /v1/events
API
  → Postgres
Console
  → admin lit events, change policy → pack / config epoch → agent poll
```

---

## 2. Extension — fonctionnalités

### 2.1 Content script sites IA

| | |
|--|--|
| **Description** | Intercepte saisie / upload sur domaines IA listés ; scanne avant envoi. |
| **Code** | `src/contents/ai-sites.ts` |
| **Config** | `matches` Plasmo + `manifest.host_permissions` dans `package.json` |
| **Settings** | `enabledHosts`, `scanUploads`, modes `local_only` / cloud |

### 2.2 Mode local_only vs cloud

| | |
|--|--|
| **Description** | Sans enroll : règles embarquées + hosts locaux. Avec enroll : pack signé + policy org. |
| **Code** | `src/lib/cloud.ts`, `src/background.ts`, `src/options.tsx` |
| **Types** | `src/types/index.ts` → `OpsGateSettings`, `DEFAULT_SETTINGS` |

### 2.3 Options (page réglages)

| | |
|--|--|
| **Description** | Enroll org / personal, unenroll, hosts surveillés, toggles scan fichiers. |
| **Code** | `src/options.tsx` |
| **Notes** | UI exclusive personal vs org ; label unenroll free si policy le permet. |

### 2.4 Scanner de fichiers

| | |
|--|--|
| **Description** | Catégorise et scanne uploads (texte, config, SQL, PDF/DOCX, images warn, média warn). |
| **Code** | `src/lib/file-scanner.ts` |
| **Extract PDF/DOCX** | `src/lib/office-extract.ts` (pdfjs-dist + mammoth) |
| **Engine** | `@opsgate/engine` → `detectSensitiveData` |

Catégories :

- `text` / `config` / `database` (.sql) → lecture texte
- `office` PDF/DOCX → extraction + détection
- autres Office → `office_warn` (confirm + log)
- `image` → skip/OCR V2
- `media` → warn confirm

### 2.5 Banner / décisions utilisateur

| | |
|--|--|
| **Description** | UI overlay mask / allow / block ; journal local. |
| **Code** | `src/lib/banner.ts`, `src/lib/storage.ts` |

### 2.6 Sync / revoke distant

| | |
|--|--|
| **Description** | Poll config (~2 min). 401/403 → `clearCloudState()` (revoke console sans mdp local). |
| **Code** | `src/lib/cloud.ts`, `src/background.ts` |

### 2.7 Brands / icônes

| | |
|--|--|
| **Description** | Icône produit gate+shield. |
| **Assets** | `assets/icon.png`, `assets/icons/*`, `packages/console/public/brand/` |

---

## 3. Engine — détection

| | |
|--|--|
| **Description** | Pack de règles de détection (IDs, sévérité, patterns). |
| **Code** | `packages/engine` |
| **Schéma pack** | `docs/architecture/RULEPACK-SCHEMA.md`, `docs/RULE-PACKS.md` |
| **API materialize** | `packages/api/src/rules-pack.ts` (checksum + signature ed25519) |

---

## 4. API control plane

### 4.1 Auth admin

| | |
|--|--|
| **Description** | Login email/mdp → token session 12 h. **Un seul login actif par compte admin** (`session_already_active` 409). Idle logout console 5 min. |
| **Code** | `packages/api/src/app.ts` `/v1/auth/login|logout|me` |
| **Store** | `createAdminSession` dans `memory-store.ts` / `pg-store.ts` |
| **Console** | idle `IDLE_MS` dans `packages/console/src/App.tsx` |

Multi-admin (comptes **différents**) : oui, en parallèle.  
Même compte : non — le 2ᵉ technicien attend déconnexion ou expiration.

### 4.2 Org / tenant

| | |
|--|--|
| **Description** | Org code commercial = clé tenant ; licences sièges ; personal vs org. |
| **Doc** | `docs/ORG-CODE-AND-TENANT.md` |
| **Code** | enroll `/v1/agent/enroll`, seed DEMO / PERSONAL |

### 4.3 Agents

| | |
|--|--|
| **Description** | Inventaire, profil/groupe, bulk assign, revoke (events conservés). |
| **Code** | `app.ts` agents + bulk-assign ; stores `listAgents`, `bulkAssignAgents` |

### 4.4 Policy & profils

| | |
|--|--|
| **Description** | Policy org + profils départementaux (hosts, scan, event reporting, protect unenroll). |
| **Code** | policy/profile endpoints ; `HostPicker` console pour hosts IA |

### 4.5 Rule packs

| | |
|--|--|
| **Description** | Publish / active pack signé ; agents vérifient checksum. |
| **Code** | packs routes ; `rules-pack.ts` |

### 4.6 Events (télémétrie DLP)

| | |
|--|--|
| **Description** | Metadata-only (pas de contenu brut). Sources text/file/system. |
| **Code** | POST events agent ; list console `/v1/org/events` |
| **UI filtres** | `EventsView` — décision, sévérité, source, recherche label |

### 4.7 Audit admin (principal only)

| | |
|--|--|
| **Description** | Journal login/logout/policy/pack/revoke/moving… réservé `is_principal`. |
| **Code** | `appendAdminAudit`, `AuditView` |

### 4.8 Moving rules (affectation auto)

| | |
|--|--|
| **Description** | Style Kaspersky : conditions AND sur `device_label` / `host_name` → groupe (+ policy groupe). Priorité croissante (petit d’abord) ; ↑↓ pour réordonner. |
| **Code** | API `/v1/org/moving-rules` ; stores `applyMovingRules` ; UI `MovingRulesView` |
| **Schéma** | table `moving_rules` + `conditions_json` |

Ex. Direction : prio 10, label starts_with `DIR` → groupe Direction, même si label contient aussi un autre département.

### 4.9 Groupes / users

| | |
|--|--|
| **Description** | Groupes éditables (nom, description, profil lié). Users inventaire (LDAP V2). |
| **Code** | groups/users endpoints + People tab console |

---

## 5. Console — onglets

| Tab | Fonction | Composant principal |
|-----|----------|---------------------|
| Summary | KPIs agents/events/packs | `App.tsx` loadTab summary |
| Policy | Policy + profils + HostPicker | Policy section |
| People | Admins, users, groups | People |
| Packs | Publish / activate | Packs |
| Agents | Liste, bulk assign, revoke | Agents |
| Events | Logs + filtres | `EventsView` |
| Audit | Journal principal | `AuditView` |
| Moving | Règles d’affectation | `MovingRulesView` |

API client : `packages/console/src/api.ts`  
Styles DailyOps : `packages/console/src/styles.css` (`#2BD9C5` / `#0A1128`)

### 5.1 HostPicker

| | |
|--|--|
| **Description** | Chips presets + domaines custom « + Add AI » visibles et retirables. |
| **Code** | `HostPicker` dans `App.tsx` |

---

## 6. Données & schéma

Fichier source : `packages/api/src/db/schema.sql`  
Migrations soft : `PgStore.migrate()` alters IF NOT EXISTS.

Tables clés : `organizations`, `policies`, `policy_profiles`, `org_admins`, `admin_sessions`, `agents`, `rule_packs`, `detection_events`, `admin_audit_events`, `moving_rules`, `user_groups`, `org_users`.

---

## 7. Sécurité (résumé concepteur)

- Events : metadata only (privacy) — `docs/PRIVACY.md`
- Packs : signature ed25519 + checksum
- Unenroll protégé par mdp admin (sauf free label policy / revoke remote)
- Session admin unique par compte
- Idle logout console 5 min
- Mot de passe principal seed démo à changer

---

## 8. Roadmap / hors V1 (notes)

Voir `docs/V2-BACKLOG.md` et `docs/architecture/PLATFORM-v2.md` :

- Langue UI (system properties)
- Extension force-install / non-désactivable (MDM)
- OCR images, full Office (xlsx/pptx)
- LDAP / SSO / MFA
- Proxy inline, multi-tenant SaaS store

---

## 9. Guides ops

| Doc | Contenu |
|-----|---------|
| `docs/GUIDE-STACK-LOCALE.md` | Docker / API / console / extension locale |
| `docs/RUNBOOK-OPS.md` | Ops |
| `docs/VALIDATION.md` | Checklist validation |
| `docs/ROADMAP-TESTERS.md` | Retours testeurs |
| `docs/RULE-PACKS.md` | Packs pour non-dev |

---

## 10. Glossaire rapide

| Terme | Sens |
|-------|------|
| Org code | Identifiant tenant commercial |
| Device label | Identifiant inventaire agent (pas le site web) |
| Pack | Ensemble de règles de détection versionné/signé |
| Config epoch | Compteur forçant resync agents |
| Moving rule | Auto-affectation agent → groupe |
| Principal | Admin super-utilisateur (audit + gestion admins) |
| local_only | Extension sans control plane org |
