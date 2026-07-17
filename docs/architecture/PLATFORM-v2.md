# OpsGate Platform — Vision & Design **V2**

**Date** : 12 juillet 2026 · **revu** : 17 juillet 2026  
**Statut** : **RÉFÉRENCE DESIGN** — implémentation majoritairement livrée (**V2 functional / pre-GA**)  
**Version code** : monorepo `1.2.x` (features V2 embarquées) · **GA marketing** : en attente pilote + stores  
**Synthèse avancement** : [`../STATUS-V2.md`](../STATUS-V2.md) · backlog [`../V2-BACKLOG.md`](../V2-BACKLOG.md) · cut [`../RELEASE-v2.md`](../RELEASE-v2.md)  
**Base** : V1 early-customer — [`../RELEASE-v1.md`](../RELEASE-v1.md)  
**Héritage design** : [`PLATFORM-v1.1.md`](./PLATFORM-v1.1.md) §10 (proxy), control plane, privacy  

> Ce document reste la **spécification de design** d’origine. Pour l’état **réel du code**, lire STATUS-V2 / V2-BACKLOG / CHANGELOG-TECHNIQUE §22 — ne pas traiter ce fichier comme « non implémenté ».

---

## 0. Positionnement

| | **V1 (maintenant)** | **V2 (ce document)** |
|--|---------------------|----------------------|
| Client type | Pilote technique 10–50 sièges | Équipes IT / sécurité 50–500+ |
| Auth admin | Email + mot de passe (+ OTP stub) | **SSO** + **MFA** |
| Data plane | Extension navigateur seule | Extension + **proxy local** (filet) |
| Multi-tenant | Mono-instance / org seed DEMO | **Prod multi-tenant** isolée |
| Distribution | Sideload `chrome-mv3-prod` | **Chrome Web Store** (+ Edge) |
| Hosting | Docker compose local / monolithe | API hébergée, secrets, SLA light |
| Strictness | `warn` / mask recommend | Option **`org_managed_strict`** (mask_force / block) |

**Phrase produit V2**

> Même promesse privacy-by-design ; gouvernance entreprise complète : identité, second facteur, filet hors-DOM, déploiement store, isolation locataire de production.

**Ce que V2 n’est pas**

- Appliance réseau d’entreprise (CASB full HTTPS)  
- DLP inline sur tout le trafic sortant  
- Session replay / lecture des conversations IA  
- Classification LLM côté serveur des prompts  

---

## 1. Objectifs & non-objectifs

### 1.1 Objectifs V2

1. **Proxy local** : filet quand le content-script casse ou que l’usage sort du DOM contrôlé.  
2. **SSO** : SAML 2.0 et/ou OIDC pour les admins console (et optionnellement users org).  
3. **MFA** : TOTP et/ou WebAuthn pour login console ; second facteur optionnel unenroll.  
4. **Multi-tenant prod** : isolation stricte `org_id`, quotas, rate limits, onboarding self-serve ou invite.  
5. **Chrome Web Store** (et Microsoft Edge Add-ons) : distribution publique / unlisted enterprise.  
6. **Ops / observabilité** :  
   - **Syslog / SIEM** (RFC 5424, CEF optionnel) vers Splunk, Elastic, QRadar, Sentinel  
   - **Métriques Prometheus** + dashboard **Grafana** (agents, blocks, events, seats)  
7. **Multi-navigateur** : Firefox MV3 (priorité) ; Safari en phase suivante. Chromium (Chrome/Edge/Brave/Opera) déjà couvert V1.  
8. **Ops** : backups, rotations de clés, runbooks incident.  

### 1.2 Non-objectifs V2 (reportés V2.x / V3)

| Item | Cible indicative |
|------|------------------|
| Proxy TUN / driver kernel | V2.1+ |
| LDAP/AD sync natif complet | V2.1 (champs déjà prévus V1) |
| Multi-région active-active | V3 / GA enterprise |
| Connecteurs SIEM packagés (app Splunk…) | V2.1 (syslog/CEF générique en V2) |
| Portal billing self-serve personnel | V2.1 (Stripe) |
| Mobile / clients natifs hors navigateur | V3 |

---

## 2. Architecture cible V2

```
┌─────────────────── Poste utilisateur ───────────────────┐
│  ┌──────────────┐     ┌─────────────────────────────┐  │
│  │ Extension MV3│◄───►│ Proxy local OpsGate (opt.)  │  │
│  │ content + SW │     │ PAC / HTTP local, allowlist │  │
│  │ @opsgate/    │     │ même @opsgate/engine        │  │
│  │ engine       │     │ notif OS + deep link        │  │
│  └──────┬───────┘     └──────────────┬──────────────┘  │
│         │ rules cache + events        │                 │
└─────────┼─────────────────────────────┼─────────────────┘
          │                             │
          ▼                             ▼
     ┌────────────────────────────────────────────┐
     │         OpsGate Control Plane (multi-tenant)│
     │  API Gateway · Auth (SSO/MFA) · Rate limit  │
     │  Rules · Events · Policy · Licenses · Audit │
     │  Postgres (RLS / org_id) · Object storage   │
     │  Admin Console (SPA)                        │
     └────────────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
   IdP client (OIDC/SAML)    Chrome Web Store
```

### Principes inchangés (depuis V1)

1. **Un seul moteur** `@opsgate/engine` (extension + proxy + tests).  
2. **Offline-first detection** : API down ≠ pas de détection.  
3. **Metadata-only events** par défaut (pas de prompt brut).  
4. **RulePack signé** ed25519 ; agent refuse pack non signé en mode managé.  
5. **local_only** reste un mode supporté (privacy max, sans control plane).  

---

## 3. Epic V2-A — Proxy local

### 3.1 Problème

L’extension dépend des DOM des sites IA. Si l’UI change, si l’utilisateur colle hors zone interceptée, ou si un client desktop IA apparaît, le content-script ne voit plus le prompt.

### 3.2 Solution V2 (phase 1 — agent local)

| Choix | Décision V2.0 |
|-------|----------------|
| Forme | **Process utilisateur** Windows (priorité) + Mac |
| Interception | **Option A** : proxy HTTP(S) local + fichier **PAC** navigateur |
| Scope | **Allowlist** hostnames IA uniquement (même liste policy que l’extension) |
| Moteur | `@opsgate/engine` partagé |
| UX alerte | Notification OS + deep link vers Options extension |
| Enrollment | Même org / device token ou token proxy lié à l’agent extension |

**Hors V2.0** : TUN, MITM global, certificat d’entreprise imposé à tout le parc.

### 3.3 Flux

```
Navigateur → PAC → 127.0.0.1:PORT (OpsGate Proxy)
  → si host ∉ allowlist : tunnel transparent / direct
  → si host ∈ allowlist : inspecte corps texte pertinents (POST chat APIs)
  → détecte via engine → block/mask/warn selon policy effective
  → event metadata → API (même schéma DetectionEvent, source: "proxy")
```

### 3.4 Intégration control plane

- Agent proxy : `device_type: extension | proxy`  
- Console : colonne « Proxy enrollé », last_seen, version  
- Policy : `proxy_enabled`, `proxy_mode: observe | enforce`  
- Même `rules_pack_version` + `config_epoch`  

### 3.5 Risques & mitigations

| Risque | Mitigation |
|--------|------------|
| HTTPS inspection fragile | Limiter aux hosts connus ; pas de MITM global |
| Faux positifs perf | Seulement content-types texte / JSON chat |
| Contournement (autre navigateur) | Doc + MDM PAC ; proxy seul n’est pas un CASB |
| Confiance utilisateur | UX transparente ; même privacy events |

### 3.6 Critères done proxy V2.0

- [ ] Installer Windows (MSI ou exe signé dev) + PAC one-click doc  
- [ ] 1–2 hosts IA (ex. chatgpt.com) en mode observe  
- [ ] Events `source=proxy` dans console  
- [ ] Partage pack signé avec extension  
- [ ] Doc threat model proxy  

### 3.7 Sous-phases

| Phase | Livrable |
|-------|----------|
| **V2-A0** | Design détaillé TLS / PAC + spike technique |
| **V2-A1** | Prototype local un host, logs only |
| **V2-A2** | Engine + events API + enrollment |
| **V2-A3** | Installer + console status + policy flags |

---

## 4. Epic V2-B — SSO (SAML / OIDC)

### 4.1 Problème

Login email/mdp seul ne passe pas les revues sécu entreprise ; pas de lifecycle RH (joiners/leavers).

### 4.2 Périmètre V2.0

| Acteur | Auth V2 |
|--------|---------|
| **Admin console** | **OIDC** (priorité) + **SAML 2.0** |
| **Agent extension** | Inchangé : **device token** (enroll code / invite) |
| **End user** | Pas de login IdP obligatoire dans l’extension V2.0 |

### 4.3 Flux admin (OIDC)

```
Console → /auth/login → redirect IdP (Entra ID, Okta, Google Workspace…)
  → callback code → session OpsGate (Bearer / cookie httpOnly)
  → map claims : email, groups?, role
  → JIT provision OrgAdmin (permissions par mapping groupe)
```

### 4.4 Modèle de données (ajouts)

```
Organization
  + sso_enabled
  + oidc_issuer, oidc_client_id, oidc_client_secret_ref
  + saml_entity_id, saml_metadata_url, saml_cert
  + sso_enforce: optional | required  # required = plus de login password

OrgAdmin
  + auth_provider: local | oidc | saml
  + external_subject  # sub / NameID
```

Secrets IdP : **vault / env / secret manager**, jamais en clair dans le repo.

### 4.5 Mapping rôles

| Claim / groupe IdP | Permission OpsGate |
|--------------------|--------------------|
| `opsgate-admins` | principal-like ou `manage_*` |
| `opsgate-operators` | `console_access` + `manage_policies` |
| `opsgate-viewers` | `console_access` read-only (nouveau rôle V2) |

### 4.6 Critères done SSO

- [ ] Au moins **un** IdP certifié (recommandé : **Microsoft Entra ID** OIDC)  
- [ ] SAML metadata import basique  
- [ ] Mode `sso_enforce`  
- [ ] Audit log login SSO  
- [ ] Fallback break-glass local (1 compte principal offline, documenté)  

---

## 5. Epic V2-C — MFA

### 5.1 Problème

Un mdp admin volé = console + force-sync + unenroll agents.

### 5.2 Périmètre V2.0

| Surface | MFA |
|---------|-----|
| Login console (local password) | **TOTP** (app authenticator) obligatoire si org l’exige |
| Login console (SSO) | Délégué à l’IdP (MFA IdP) ; option step-up OpsGate |
| Unenroll endpoint (extension) | Option policy : mdp admin **+** code TOTP admin (phase 2) |
| Vendor recovery | Reste secret long ; **pas** de MFA (break-glass) |

### 5.3 Flux TOTP login local

```
POST /auth/login { email, password }
  → si mfa_required et pas de mfa_token :
       401 { error: "mfa_required", mfa_token: "..." }
  → POST /auth/mfa/verify { mfa_token, code }
  → session complète
```

Enrollment MFA :

- Console → Security → « Activer TOTP » → QR + backup codes (10)  
- Backup codes one-time, stockés hashés  

### 5.4 WebAuthn (V2.0 nice-to-have / V2.1)

- Passkeys pour admins power users  
- Complément ou alternative TOTP  

### 5.5 Critères done MFA

- [ ] TOTP enroll + verify + disable (avec mdp)  
- [ ] Backup codes  
- [ ] Policy org `mfa_required_for_admins`  
- [ ] Rate limit sur `/auth/mfa/verify`  
- [ ] OTP email reset **réel** (SMTP) — remplace le stub V1  

---

## 6. Epic V2-D — Multi-tenant production

### 6.1 Problème

V1 est une instance mono-tenant « DEMO + PERSONAL » opérationnelle en pilote. La prod multi-clients exige isolation, quotas, onboarding et durcissement.

### 6.2 Isolation

| Couche | Mesure V2 |
|--------|-----------|
| Données | **Toutes** les queries scopées `org_id` + tests authz automatisés |
| Postgres | Option **RLS** (Row Level Security) par `org_id` |
| Secrets | KMS / secret manager ; clés signing **par org** ou global OpsGate + org packs |
| Réseau | TLS obligatoire ; pas d’header dev-admin en prod |
| Quotas | Events/jour, agents max, packs size (déjà 512 KB) |

### 6.3 Onboarding org

```
Self-serve (option A)          Invite (option B)
─────────────────────          ──────────────────
Signup email/SSO               OpsGate crée org
  → create Organization          → envoie invite admin
  → org_code généré              → même flux
  → plan free/trial
  → seats
```

### 6.4 Multi-tenancy features

| Feature | V2.0 |
|---------|------|
| N orgs sur une instance | Oui |
| Org code unique | Oui |
| Limites sièges licence | Oui (déjà V1, endurcir) |
| Rate limit `/events/batch` par org | Oui |
| Soft-delete org + purge GDPR | Oui (export + delete) |
| Custom domain console | V2.1 |
| Résidence données EU flag | Oui (doc + région déploiement) |

### 6.5 Hosting de référence

| Composant | Proposition V2 |
|-----------|----------------|
| API | Containers (Fly / Railway / Azure Container Apps / ECS) |
| DB | Postgres managé (RDS, Neon, Azure PG) multi-AZ |
| Console | CDN / static (Vercel, Cloudflare Pages) |
| Secrets | Doppler / AWS SM / Azure Key Vault |
| Observabilité | OpenTelemetry + logs structurés + uptime |

### 6.6 Critères done multi-tenant

- [ ] Suite de tests **cross-tenant** (org A ne voit jamais org B)  
- [ ] Onboarding 2 orgs sur une instance staging  
- [ ] Rate limits + quotas documentés  
- [ ] Backup / restore runbook  
- [ ] `NODE_ENV=production` checklist automatisée  

---

## 7. Epic V2-E — Chrome Web Store (+ Edge)

### 7.1 Problème

Le sideload `chrome-mv3-prod` freine le déploiement flotte et la confiance utilisateurs.

### 7.2 Périmètre V2.0

| Canal | Priorité |
|-------|----------|
| **Chrome Web Store** | P0 — public ou **unlisted** enterprise |
| **Edge Add-ons** | P1 — même build MV3 |
| Firefox | Hors V2 (APIs différentes) |

### 7.3 Préparation store (checklist)

1. **Privacy policy** publique (URL) — alignée [`PRIVACY.md`](../PRIVACY.md)  
2. **Permissions minimales** : justifier `storage`, `alarms`, host_permissions IA  
3. **Capture d’écran** + description FR/EN  
4. **Single purpose** : DLP prompts IA (pas de tracking pub)  
5. **Remote code** : interdit — packs de règles = data JSON signée, pas d’eval  
6. **Compte publisher** + vérification identité  
7. Process de **review** : build reproductible, version semver  

### 7.4 Enterprise distribution

| Mode | Usage |
|------|--------|
| Store public | SMB / self-serve |
| Store unlisted | Lien fourni aux clients |
| Force-install MDM | Google Admin / Intune + policy extension ID |
| Update | Store auto-update (plus de rebuild manuel poste) |

### 7.5 Impact technique

- `host_permissions` élargies (V1) → justification review  
- API base URL : configurable (Options) **ou** default prod `https://api.opsgate…`  
- Pas de `http://127.0.0.1` en build store (dev only via mode dev)  
- Feature flag `update_channel: store | sideload`  

### 7.6 Critères done store

- [ ] Listing soumis + **approuvé** (ou unlisted live)  
- [ ] Install test sur machine clean  
- [ ] Update path validé (v → v+1)  
- [ ] Doc IT : force-install + enroll code  

---

## 8. Epic V2-F — Compléments produit (inclus ou adjacents)

| Item | Slot V2 | Notes |
|------|---------|--------|
| `org_managed_strict` (mask_force / block) | V2.0 | Policy + UX bandeau plus strict |
| Webhooks events high severity | V2.0 | Slack / generic HTTPS |
| Export CSV events | V2.0 | Console |
| SMTP réel (OTP, invites) | V2.0 | Remplace stub |
| LDAP/AD sync | V2.1 | Champs V1 déjà prêts |
| Portal personnel billing | V2.1 | Stripe |
| UI no-code règles | V2.1 | Éditeur assisté + validate |
| Audit log admin immuable | V2.0 | Table `admin_audit_events` |

---

## 9. Plan d’implémentation (PR / phases)

Ordre recommandé (dépendances + valeur) :

```
V2-0  Foundation multi-tenant + hardening prod     (prérequis)
  ↓
V2-E  Chrome Web Store prep + submit               (distribution)
  ↓
V2-B  SSO OIDC (+ SAML)                            (achat enterprise)
  ↓
V2-C  MFA TOTP + SMTP                              (sécurité console)
  ↓
V2-A  Proxy local (prototype → installer)          (data plane)
  ↓
V2-F  Strict mode + webhooks + CSV + audit         (polish GA)
```

### Estimation grossière (indicatif)

| Epic | Effort |
|------|--------|
| V2-0 Multi-tenant prod + ops | 2–3 semaines |
| V2-E Store | 1–2 semaines (+ délai review Google) |
| V2-B SSO | 2–3 semaines |
| V2-C MFA + SMTP | 1–2 semaines |
| V2-A Proxy | 4–8 semaines (selon TLS) |
| V2-F Compléments | 1–2 semaines |
| **Total V2 GA** | **~3–5 mois** calendaire selon charge |

### Découpage PR (suggestion)

| PR | Livrable |
|----|----------|
| **PR-V2-0** | RLS / tests cross-tenant, rate limits, audit log, remove dev bypass prod |
| **PR-V2-1** | Store build pipeline + privacy URL + listing assets |
| **PR-V2-2** | OIDC login console + JIT admin |
| **PR-V2-3** | SAML + sso_enforce |
| **PR-V2-4** | TOTP MFA + backup codes + SMTP |
| **PR-V2-5** | Proxy spike + engine shared path |
| **PR-V2-6** | Proxy enroll + events + console |
| **PR-V2-7** | Installer Windows + PAC helper |
| **PR-V2-8** | org_managed_strict + webhooks + CSV |
| **PR-V2-9** | Release 2.0.0 docs + migration guide V1→V2 |

---

## 10. Sécurité & privacy V2

### 10.1 Threat model (ajouts vs V1)

| Menace | Contrôle V2 |
|--------|-------------|
| Credential stuffing admin | MFA + rate limit + SSO |
| Token agent volé | Révocation, rotation, short-lived option future |
| Faux pack de règles | Signature ed25519 (déjà V1) |
| Fuite cross-tenant | RLS + tests + review queries |
| Proxy abuse (MITM user) | Allowlist only ; consent org ; pas de full tunnel |
| Compte publisher store compromis | 2FA Google ; releases signées |

### 10.2 Privacy

- Inchangé : **pas de prompt brut** en cloud par défaut  
- Proxy : mêmes règles metadata ; pas de full body storage  
- Store : privacy policy + data safety form Chrome  
- GDPR : export org + delete org (V2-D)  

---

## 11. Migration V1 → V2

| Zone | Migration |
|------|-----------|
| Postgres schema | Migrations versionnées (Flyway / node migrate) |
| Admins locaux | Restent ; SSO optionnel puis `sso_enforce` |
| Agents enrollés | Tokens inchangés ; re-sync policy |
| Extension sideload | Coexistence avec store ID (doc migration flotte) |
| Packs signés | Même clé ou rotation documentée + re-sign |

**Compat** : un agent V1 doit pouvoir parler à une API V2 (versioning `/v1` conservé ; extensions de champs backward-compatible).

---

## 12. Critères go / no-go **V2.0 GA**

- [ ] ≥ 2 orgs isolées en staging multi-tenant  
- [ ] SSO OIDC avec un IdP réel (Entra ou Okta)  
- [ ] MFA TOTP activable et forçable par org  
- [ ] Extension **disponible** via Chrome Web Store (public ou unlisted)  
- [ ] Proxy local : au moins un host IA en observe + events  
- [ ] Aucun secret par défaut accepté en production  
- [ ] Tests cross-tenant + e2e auth verts  
- [ ] Runbook incident + backup/restore prouvés  
- [ ] Doc privacy + admin + IT deploy à jour  

---

## 13. Métriques succès V2

| Métrique | Cible indicative |
|----------|------------------|
| Time-to-enroll (store install → protected) | < 15 min |
| Couverture détection (extension ∪ proxy) | +X % vs extension seule (mesurer en pilote) |
| % admins en SSO | > 80 % des orgs enterprise |
| Incidents cross-tenant | 0 |
| Review store reject rate | < 2 itérations majeures |

---

## 14. Décisions ouvertes (à trancher avant build)

1. **Proxy** : Windows-only en 2.0 ou Windows+Mac dès le jour 1 ?  
2. **SSO** : OIDC-only d’abord (plus simple) ou OIDC+SAML simultanés ?  
3. **Store** : public vs unlisted pour les 6 premiers mois ?  
4. **Hosting** : OpsGate SaaS multi-tenant vs image « on-prem soft » Docker encore supportée ?  
5. **Signing keys** : une clé globale OpsGate vs clé par org cliente ?  
6. **Strict mode** : dans 2.0 ou 2.1 après retour terrain V1 ?  

*Defaults recommandés si pas de réponse : Windows-first proxy, OIDC d’abord, store unlisted, SaaS + compose encore supporté, clé globale packs + rotation, strict mode dans 2.0 soft-launch.*

---

## 15. Documents liés

| Doc | Rôle |
|-----|------|
| [`../RELEASE-v1.md`](../RELEASE-v1.md) | Cut V1 early-customer |
| [`../GUIDE-STACK-LOCALE.md`](../GUIDE-STACK-LOCALE.md) | Stack locale Docker / extension |
| [`PLATFORM-v1.1.md`](./PLATFORM-v1.1.md) | Design validé plateforme + proxy sketch |
| [`CONTROL-PLANE.md`](./CONTROL-PLANE.md) | Force-sync, admins, licences |
| [`ENDPOINT-LOCK.md`](./ENDPOINT-LOCK.md) | Verrou endpoint / unenroll |
| [`../PRIVACY.md`](../PRIVACY.md) | Privacy end-user |
| [`../RUNBOOK-OPS.md`](../RUNBOOK-OPS.md) | Ops V1 |

---

## 16. Historique

| Date | Événement |
|------|-----------|
| 11/07/2026 | Proxy design only (PLATFORM v1.1 §10) |
| 12/07/2026 | V1 early-customer (Postgres full, hosts, validate-pg) |
| 12/07/2026 | **Ce document** — draft V2 (proxy, MFA, SSO, multi-tenant, store) |
| 16–17/07/2026 | Implémentation majeure epics A–F + OCR/PPTX + docs déploiement |
| 17/07/2026 | Statut produit **functional / pre-GA** — voir STATUS-V2 |

---

*Statut 17/07/2026 : design validé par l’implémentation terrain. Reste GA marketing = publication store, pilote client, polish billing/SAML (STATUS-V2).*
