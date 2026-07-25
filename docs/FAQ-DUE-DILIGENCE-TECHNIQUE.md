# OpsGate — FAQ due diligence technique

**Public** : ingénieur sécurité, RSSI technique, architecte, développeur senior, consultant DLP/CASB  
**Version produit** : 1.2.x · V2 pre-GA + V3-P0  
**Usage** : questions qu’un pair exigeant peut poser pour juger **qualité**, **maîtrise du domaine**, **alignement standards** — avec réponses argumentées.

> Ce document n’est **pas** marketing. Les réponses s’appuient sur l’architecture réelle (extension MV3, `@opsgate/engine`, API Hono, Postgres RLS, proxy MITM, Secure Rewrite, Risk/Shadow).  
> Synthèse produit : [`STATUS-V2.md`](./STATUS-V2.md) · gap : [`STATUS-GAP-V1-V3.md`](./STATUS-GAP-V1-V3.md) · privacy : [`PRIVACY.md`](./PRIVACY.md)  
> **English (RFP)** : [`FAQ-DUE-DILIGENCE-TECHNIQUE-EN.md`](./FAQ-DUE-DILIGENCE-TECHNIQUE-EN.md)  
> **Deck 10 questions** : [`FAQ-DUE-DILIGENCE-10Q.pptx`](./FAQ-DUE-DILIGENCE-10Q.pptx) · rebuild : `node scripts/build-faq-due-diligence-pptx.mjs`

---

## A. Positionnement & modèle de menace

### A1. « Pourquoi un DLP navigateur plutôt qu’un CASB / SSE / DLP réseau ? »

**Réponse attendue (dense)**  
Les fuites vers l’IA générative passent surtout par le **DOM** (prompt collé, upload) et parfois par des chemins que le proxy ne voit pas (apps non MITM-ables, WebSocket, clients hors proxy). Un CASB réseau est excellent pour le contrôle de session SaaS et le TLS inspect, mais :

1. **Latence et coût** de MITM total sur tout le trafic vs allowlist IA ciblée.  
2. **Faux sentiment de couverture** : l’utilisateur peut coller un secret dans ChatGPT en HTTPS même si le proxy rate un host ou un client.  
3. **UX** : bloquer le site entier est souvent inacceptable ; OpsGate intercepte **l’action d’envoi** et propose mask / Secure Rewrite / cancel / send_anyway journalisé.

OpsGate se positionne en **filet métier** *AI-specific* : extension (DOM) + **option** proxy local multi-IA. Ce n’est pas un remplacement CASB ; c’est un **contrôle d’usage IA** complémentaire (souvent plus rapide à piloter pour un RSSI).

### A2. « Quel est votre modèle de menace explicite ? »

| Acteur / scénario | Couverture OpsGate | Limite honnête |
|-------------------|--------------------|----------------|
| Employé négligent qui colle un secret dans ChatGPT | Banner, mask, Secure Rewrite, policy block | Contournement volontaire hors navigateur |
| Employé qui joint un PDF/DOCX sensible | Scan Office + OCR images (si policy) | Archives chiffrées, formats obscurs |
| Shadow AI (outil non autorisé) | Inventaire hostname + statut auth/unauth | Dépend des events / hosts scannés |
| Admin malveillant console | Audit WORM, MFA multi-tenant, RLS | Admin principal a pouvoir large (normal) |
| Attaquant avec poste déjà compromis | Hors scope anti-malware | Endpoint security tierce |
| Fuite via API backend métier (pas UI IA) | Hors scope | **AI Agent Protection** = V3-G **remisé** ([`roadmap-v3/DEEP-ANALYSIS-STATUS.md`](./roadmap-v3/DEEP-ANALYSIS-STATUS.md) §4) |

**Principes** : *defense in depth* (DOM + proxy optionnel) · *least data to cloud* (metadata events) · *admin-driven policy* · *user can still work* (rewrite > block pur).

### A3. « En quoi n’êtes-vous pas un keylogger / spyware RH ? »

- Scan **à l’instant d’envoi** (ou upload), pas d’enregistrement continu de frappe.  
- Content script **limité aux hosts IA** déclarés (policy `enabled_hosts`).  
- Events cloud : **schéma contraint** — pas de champ `prompt` / `content` ; API rejette les payloads interdits ([`EVENT-SCHEMA.md`](./architecture/EVENT-SCHEMA.md)).  
- Mode `local_only` : **zéro** télémétrie org.  
- Privacy policy publique : [`PRIVACY.md`](./PRIVACY.md).

C’est un argument de **gouvernance DLP**, pas de surveillance comportementale RH.

---

## B. Architecture & confiance technique

### B1. « Où s’exécute la détection ? Le secret quitte-t-il le poste ? »

| Plan | Rôle | Secret brut |
|------|------|-------------|
| Extension content script | Intercept prompt/file, engine, banner | Reste local |
| `@opsgate/engine` | Regex + validators (Luhn, IBAN mod-97) | Local |
| Service worker | Sync policy/pack, file events | Token agent, metadata |
| API | Policy, packs signés, events | Metadata (+ preview redactée optionnelle) |
| Proxy MITM (option) | Scan body HTTPS sur allowlist | Local poste ; soft-block/observe |

Par défaut policy org : **`metadata_only`** — rule_ids, decision, hostname, severity, counts.  
Option `metadata_plus_redacted_match` : previews **tronquées** (max 5, ~24 car.), jamais le prompt.

### B2. « Comment le pack de règles est-il authentifié ? »

- Pack publié côté control plane : **checksum** JSON + signature **ed25519**.  
- Agent récupère la **clé publique** SPKI et vérifie avant d’appliquer (`pack_verify_failed` sinon).  
- Empêche un MITM réseau ou un serveur corrompu d’injecter des règles arbitraires sans clé privée éditeur/org.

### B3. « Multi-tenant : comment isolez-vous les orgs ? »

- Postgres + **RLS** (`app.current_org_id` / bypass contrôlé).  
- Tokens agent **scopés org** ; console session admin liée org.  
- MSP : même email admin multi-org, **MFA obligatoire** à chaque bascule de tenant.  
- Soft-delete GDPR org (export, grace, hard purge).

Ce qu’un auditeur vérifie : pas de `SELECT` cross-org sans bypass système, pas de token agent réutilisable entre tenants.

### B4. « Extension Manifest V3 : comment gérez-vous la mort du service worker ? »

Réalité MV3 : le SW est **éphémère**. OpsGate :

- File d’events locale + retry (`flushEventQueue`).  
- `sendMessageWithRetry` / fire-and-forget conscient sur batch.  
- Dettes connues documentées (fiabilisation continue) — un expert **apprécie l’honnêteté** plus qu’un « on ne perd jamais un event ».

### B5. « Pourquoi monorepo packages engine/api/console/proxy ? »

- **Une seule source de vérité** pour la détection (`@opsgate/engine`) : extension = proxy = tests.  
- Évite le classique « le proxy mask autrement que l’extension ».  
- Tests de non-régression règles (`pnpm test:rules`) partagés.

---

## C. Détection, FPs, qualité du moteur

### C1. « Ce n’est que du regex ? C’est faible. »

Oui **et** non :

- **Base** : patterns compilés par règle (secrets, configs réseau, PII…).  
- **Validators** : Luhn (cartes), **IBAN mod-97**, filtres placeholders (`password=password`, emails example.com).  
- **Gates keywords** sélectifs (configs infra) pour limiter le bruit.  
- **IBAN** : checksum obligatoire ; patterns collés **et** espacés ; plus de keyword « IBAN » obligatoire (évite les misses).  
- **Phone vs IBAN** : sous-séquences d’IBAN valide non classées téléphone.  
- **V3 Secure Rewrite** : remplacements structurés (IP, secrets, hosts) avec **mapping cohérent** dans le document.

Ce n’est **pas** un modèle ML de classification de documents. C’est du **DLP règles + hygiene anti-FP**, transparent et auditables — standard industrie pour le DLP léger. ML/classification multi-niveaux = roadmap V3-F (complexité légale).

### C2. « Comment réduisez-vous les faux positifs sur les cartes / JWT / sessions ? »

- Cartes : Luhn + exclusion numéros de test connus.  
- JWT : contexte Authorization / cookie / access_token souvent **ignoré** (session navigateur ≠ coller un secret dans un prompt).  
- Passwords : placeholders et `***` filtrés.  
- Emails : domaines de démo exclus.

Trade-off assumé : **recall vs precision**. On préfère un peu moins de hits douteux que de bloquer la prod à chaque JWT de session ChatGPT.

### C3. « Qui gouverne les règles ? Versioning ? »

- Pack org versionné (`1.0.x`), publish / activate / rollback console.  
- Disable de règles par id (nouveau pack).  
- Engine embarqué vs pack cloud : l’agent enrollé **privilégie le pack org**.  
- Process ops : republish pack après fix engine (ex. IBAN) — script `republish-engine-pack.mjs`.

### C4. « OCR / fichiers : surface d’attaque ? »

- OCR **Tesseract.js** local (pas d’upload image vers un cloud éditeur).  
- Policy `file_scan` org **et** profils (images, Office, configs, DBs, media_warn).  
- Formats legacy binaires : souvent confirm-only (pas de parse deep faux).  
- Surface : dépendance WASM/JS dans l’extension — revue CSP, pas d’eval libre ; risque principal = **perf** et **FPs OCR**, pas exfiltration serveur OpsGate.

---

## D. Contrôle d’accès, identité, admin

### D1. « MFA, SSO, passkeys — niveau entreprise ? »

| Mécanisme | Statut | Note expert |
|-----------|--------|-------------|
| MFA TOTP | Livré | Forcé multi-tenant switch |
| Passkeys / WebAuthn | Livré | Hello / empreinte console |
| OIDC | Livré | JWKS, JIT user |
| SAML SP | Livré | Valider IdP par client (C14N) |
| LDAP/AD sync | Livré | Cron optionnel |
| Session challenge | Livré | Concurrent / read-only |

Pas de « on a MFA » marketing : bascule MSP **exige** code 6 chiffres à chaque tenant — bon signal anti-latéralisation admin.

### D2. « Comment un admin sort d’un poste locké ? »

- Unenroll protégé : hash admins + password unenroll.  
- **Vendor recovery** uniquement si offline ≥ seuil (défaut 2 h) + pool one-time.  
- Empêche un attaquant avec le poste **online** d’utiliser un break-glass vendor.

### D3. « RBAC console : granularité ? »

Permissions console (`console_access`, `manage_policies`, etc.) + rôles admin.  
Pas un ABAC fin type Okta + SCIM complet partout — **pragmatique mid-market**. LDAP/groups + moving rules pour affectation agents.

---

## E. Journalisation, preuve, conformité

### E1. « Les logs sont-ils opposables / immuables ? »

- **Audit admin WORM** : chaîne SHA-256 (prev_hash / entry_hash), append-only, intégrité vérifiable en console.  
- **Detection events** : rétention configurable (défaut ~90 j), pas le même régime légal que l’audit admin (rétention légale audit séparée, min 90 j).  
- Export CSV/JSON, SIEM syslog/CEF, Prometheus `/metrics`.

Ce n’est pas un WORM hardware tape ; c’est un **sceau applicatif** anti-altération soft — standard SaaS mid-market.

### E2. « RGPD / DPIA : arguments ? »

- Minimisation : pas de prompt en clair dans le cloud par défaut.  
- Local-first.  
- Soft-delete org + export DSAR.  
- Finalité : sécurité du SI, pas profilage marketing.  
- Rétention paramétrable.  
- Sous-traitance : le **client héberge** souvent le control plane (on-prem / VPC) → contrôle du lieu de traitement.

DPIA : le client reste **responsable de traitement** ; OpsGate outil / sous-traitant selon contrat hébergement.

### E3. « Secure Rewrite : le mapping est-il déterministe ? Fuite par collusion ? »

- Mapping **cohérent dans un même document** (même host → même pseudonyme).  
- Ne garantit pas l’anonymat cryptographique face à un adversaire qui croise des sources externes.  
- Objectif : **rendre le prompt utile sans coller le secret réel** (réduction de risque opérationnelle), pas k-anonymity formel.

Un expert sérieux accepte ce cadre s’il est **dit explicitement**.

---

## F. Proxy MITM

### F1. « MITM local : vous êtes plus dangereux que le risque, non ? »

MITM **local** sur le poste utilisateur, CA **entreprise** installée (GPO), allowlist **IA** :

- Pas un MITM opérateur télécom opaque.  
- Soft-block **par requête** (pas bannissement du site).  
- Mode observe vs enforce.  
- Headers auth / JWT session souvent exclus pour ne pas casser le site.

Risques à documenter en runbook : confiance CA, scope hosts, perf, certificats pinés (peu d’IA pinent).

### F2. « Extension vs proxy : qui gagne ? »

| | Extension | Proxy |
|--|-----------|-------|
| Couverture | DOM UX, rewrite, fichiers | HTTPS body multi-IA |
| Contournement | Client hors liste hosts | App sans proxy / DOH edge |
| UX | Banner riche | Soft-block/observe plus brut |

**Complementaires**. Policy org aligne hosts. Events `source=prompt|file|proxy`.

---

## G. V3 produit (Risk, Shadow, Rewrite)

### G1. « Risk Score : c’est du scoring sérieux ou du vanity metric ? »

Formule **explicite** sur events (sévérités, send_anyway, mask/rewrite, shadow unauth, récurrence).  
Tendance = comparaison **période N vs N-1** (seuil ±5 pts).  
Pas de black-box ML.  
Limite : dépend de la **qualité et volume d’events** ; agents silencieux = score bas (pas « safe », **peu d’activité**).

### G2. « Shadow AI : inventaire ou blocking ? »

Inventaire + statut authorized/unauthorized/unknown (admin).  
Blocking d’un host Shadow = via **policy hosts / proxy**, pas magie DNS.  
Utile pour **découverte** RSSI, pas pour remplacer CASB app control.

### G3. « Adoption Secure Rewrite : comment la mesurez-vous ? »

Décision event `secure_rewrite` vs `mask_send` / `send_anyway`.  
Dashboard : part rewrite.  
Rapport PDF §6 AI Security.  
KPI cible produit : adoption rewrite sur medium/high (spec V3).

---

## H. Sécurité applicative (dev / AppSec)

### H1. « OWASP / surface API ? »

- Auth agent Bearer + hash token.  
- Auth console session + MFA.  
- Validation schéma events (champs interdits).  
- Rate limits (memory/redis).  
- RLS Postgres.  
- Signing packs.  
- Pas d’exposition password SMTP/LDAP en GET.

À pousser pour un audit formel : pen-test externe, SAST CI, dependency scanning (à formaliser en pre-GA).

### H2. « Supply chain extension ? »

- Build Plasmo, artefacts store documentés.  
- Dépendances npm (pdfjs, tesseract, mammoth) — surface connue.  
- CSP extension, pas de remote code arbitraire pour les règles (JSON patterns).  
- Clés ed25519 packs hors repo prod.

### H3. « Secrets dans le repo / lab ? »

Lab : codes démo, `ALLOW_DEV_UNSIGNED`, headers dev admin.  
Prod : `DATABASE_URL`, clés signing, SMTP, Stripe — **env**, pas commit.  
Doc recovery concepteur séparée (interne).

---

## I. Opérations, HA, résilience

### I1. « HA multi-région ? »

**Hors scope** actuel (documenté). Déploiement client mono-région typique : Postgres + API + console derrière reverse-proxy TLS.  
Backup config + script DB + **backup auto 7/14/30 j**.  
Pas de claim « 99.99 multi-AZ global » — honnêteté = crédibilité.

**HA mono-région implémentable** : API multi-instances (stateless + Postgres) derrière LB ; DB managed/replica ; crons sur un worker.  
Détail : [`architecture/DEPLOY-PROD-HA.md`](./architecture/DEPLOY-PROD-HA.md).

### I2. « Que se passe-t-il si l’API est down ? »

- Agent : dernière policy + pack en cache (`managedLockActive`).  
- Détection locale continue.  
- Events en file locale.  
- Recovery vendor offline si lock et seuil temps.

### I3. « Combien d’events / agents avant que ça casse ? »

Quotas org configurables.  
Summary / risk : requêtes potentiellement lourdes (listEvents borné, optimisations MSP snapshot sans full summary).  
Scale mid-market validée en lab ; **pas** encore de benchmark public 10k agents — à ne pas inventer en démo.

---

## J. Comparaison standards & maturité

### J1. « Êtes-vous certifiés ISO 27001 / SOC2 ? »

**Non revendiqué** comme produit certifié à ce stade (pre-GA).  
Contrôles *alignés* : minimisation données, accès MFA, audit trail, séparation tenants, rétention.  
Chemin crédible post-GA : SOC2 Type I sur le control plane hébergé (si SaaS), ou support client on-prem (responsabilité partagée).

### J2. « Mapping NIST CSF / CIS ? »

| Fonction | OpsGate |
|----------|---------|
| Identify | Shadow AI inventaire, top rules, risk users |
| Protect | Policy mask/block/rewrite, file scan, proxy enforce |
| Detect | Engine + events + SIEM |
| Respond | Inbox user→admin, force-sync, unenroll, reports PDF |
| Recover | Backup, restore GDPR soft-delete window |

### J3. « Pourquoi vous plutôt qu’un DLP endpoint lourd (Symantec, Forcepoint) ? »

- Time-to-value IA en **jours**, pas mois.  
- UX **non-hostile** (rewrite).  
- Spécialisation **prompts/uploads IA** + infra configs.  
- On-prem possible.  
Contre : couverture DLP « tout canal » (USB, print, email) **non** — ne pas sur-vendre.

---

## K. Questions piège — réponses courtes

| Question piège | Réponse |
|----------------|---------|
| « Vous voyez tous les prompts ? » | Non, metadata par défaut. |
| « 100 % des fuites IA ? » | Non ; hors navigateur / hors hosts = trou. |
| « Zéro faux positif ? » | Non ; validators + policy ; trade-off documenté. |
| « Remplace notre CASB ? » | Non ; complémentaire. |
| « IA qui comprend le contexte document ? » | Pas encore ; règles + rewrite déterministe. |
| « GA store ? » | Artefacts prêts ; listing live = ops (pre-GA). |
| « Preuve mathématique d’anonymat rewrite ? » | Non ; réduction de risque opérationnelle. |
| « Open source engine ? » | Monorepo privé client ; architecture documentée. |

---

## L. Checklist « l’interlocuteur maîtrise le domaine »

Un bon interlocuteur OpsGate doit pouvoir **sans slide** :

1. Dessiner extension ↔ engine ↔ API ↔ Postgres RLS ↔ proxy.  
2. Expliquer **metadata_only** vs redacted match.  
3. Différencier mask, Secure Rewrite, block, send_anyway.  
4. Expliquer **signature ed25519** des packs.  
5. Dire pourquoi MFA à chaque switch MSP.  
6. Expliquer tendance risk (±5 pts, période glissante).  
7. Avouer les **limites** (endpoint compromis, hors navigateur, pre-GA stores).  
8. Citer docs : STATUS, DEPLOIEMENT, EVENT-SCHEMA, PRIVACY, RELEASE-v3.

---

## M. Questions à poser **au client** (renversement d’expertise)

1. Quels outils IA sont **autorisés** aujourd’hui (liste) ?  
2. Proxy d’entreprise existant ? Inspection TLS déjà en place ?  
3. Chrome force-install MDM ou sideload pilote ?  
4. Hébergement control plane : **chez vous** ou SaaS éditeur ?  
5. Exigence légale : **zéro** metadata cloud possible (→ local_only / on-prem strict) ?  
6. KPI succès pilote : baisse send_anyway high ? adoption rewrite ? shadow découvert ?

---

## N. Références monorepo (pour l’auditeur technique)

| Sujet | Où |
|-------|-----|
| Schéma events | `docs/architecture/EVENT-SCHEMA.md` |
| Privacy | `docs/PRIVACY.md` |
| Engine / IBAN / rewrite | `packages/engine/` |
| API security report V3 | `packages/api/src/security-report.ts` |
| Risk / Shadow | `packages/api/src/risk-shadow.ts` |
| Pack signing | `packages/api/src/signing.ts` |
| RLS | `packages/api/src/db/rls.sql` |
| Extension banner / i18n | `src/lib/banner.ts`, `i18n-agent.ts` |
| Déploiement client | `docs/DEPLOIEMENT-CLIENT.md` |
| Gap GA | `docs/STATUS-GAP-V1-V3.md` |

---

*OpsGate · FAQ due diligence technique · DailyOps.Tech · 18 juillet 2026*  
*À utiliser en discovery technique, RFP, ou échauffement avant démo RSSI.*
