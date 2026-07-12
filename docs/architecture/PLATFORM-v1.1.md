# OpsGate Platform — Architecture & Design v1.1

**Date** : 11 juillet 2026  
**Statut** : **VALIDÉ PRODUIT** (go build)  
**Validé le** : 11 juillet 2026  
**Auteur** : Steve + Grok  
**Périmètre** : vision post-MVP extension → console admin light, sync de règles, télémétrie opt-in, emplacement du proxy  

**Liens**  
- Spec MVP : *OpsGate - Spécification MVP v1.0* (Drive)  
- Code actuel : extension Plasmo `ops-gate` (journal local, règles embarquées)  
- Kit démo : `docs/demo/`  

### Décision produit (synthèse)

| Décision | Go produit |
|----------|------------|
| Construire la **console admin light** en v1.1 | **Oui** |
| **Sync RulePack** signé (plus de rebuild pour chaque règle) | **Oui** |
| **Events opt-in**, metadata-only (pas de prompt brut) | **Oui** |
| Mode **`local_only` par défaut** | **Oui** |
| **Proxy** en v1.2 (design now, build later) | **Oui** |
| Ne pas bloquer le pilote extension en attendant le cloud | **Oui** |

---

## 1. Résumé exécutif

Le MVP prouve la valeur **sur le poste** : détecter, alerter, masquer, journaliser **localement** sur ChatGPT / Claude / Gemini.

La plateforme v1.1 transforme OpsGate en produit **équipe** sans trahir le positionnement :

> **Utilisez l’IA librement. Protégez vos données automatiquement.**  
> **Privacy by design** : le mode local-only reste le défaut ; le cloud est un **opt-in de gouvernance**.

| Couche | Rôle | Priorité v1.1 |
|--------|------|----------------|
| **Agent** (extension, déjà livré) | Interception UI, détection, UX non bloquante | Maintenir |
| **Control plane** (console + API) | Politiques, règles, agrégation d’événements | **Build** |
| **Data plane avancé** (proxy local) | Filet hors UI / hors navigateur | **Design only** (build v1.2+) |

**Décision d’architecture** : construire d’abord **console + sync règles + events opt-in**. Le proxy réutilise le même moteur de règles et le même schéma d’events ; il ne remplace pas l’extension.

---

## 2. Problème & objectifs

### 2.1 Problèmes non résolus par l’extension seule

1. **Pas de vision manager** : les détections restent dans `chrome.storage.local` de chaque poste.  
2. **Règles figées au build** : enrichir Fortinet / Huawei / etc. impose une rebuild / redeploy extension.  
3. **Pas de politique d’organisation** : tout le monde a le même comportement “warn + choix utilisateur”.  
4. **Couverture fragile** : dépendance aux DOM des sites IA ; pas de filet si l’UI change ou si l’usage sort du navigateur.

### 2.2 Objectifs v1.1

- [ ] Un **admin** peut voir l’activité d’usage IA sensible (agrégée) sur son organisation.  
- [ ] Un **admin** peut publier un **pack de règles** consommé par les agents sans rebuild.  
- [ ] Un **utilisateur** peut rester en **local-only** (aucune donnée métier vers le cloud).  
- [ ] L’architecture **prépare le proxy** sans le coupler au critical path du pilote.  
- [ ] Time-to-value : déployable pour un pilote **10–50 sièges** en semaines, pas en trimestres.

### 2.3 Non-objectifs v1.1

- SSO enterprise complet (SAML/OIDC multi-IdP) — stub “magic link / email” suffit.  
- Blocage réseau forcé global (DLP inline enterprise).  
- Classification par LLM côté serveur.  
- Intégrations Slack / M365 / SIEM natives (webhooks basiques ok en P1).  
- Proxy production (cert pinning, installers signés multi-OS) — doc d’emboîtement seulement.

---

## 3. Personas & jobs-to-be-done

| Persona | Job principal | Critère de succès |
|---------|---------------|-------------------|
| **End user** (ops, dev, RH…) | Utiliser l’IA sans fuite accidentelle | Bandeau clair, peu de FP, choix conservé |
| **Team lead / IT manager** | Savoir si l’équipe expose des secrets | Dashboard simple, pas de surveillance “big brother” |
| **Security / compliance** (plus tard) | Politique & preuve | Export events, politique mask/block, audit |
| **OpsGate operator** (toi) | Opérer le service | Multi-tenant simple, logs, versioning règles |

### Principes UX plateforme

1. **Non bloquant par défaut** (aligné MVP).  
2. **Transparence** : l’utilisateur sait si son org envoie des métadonnées d’événements.  
3. **Moindre privilège data** : pas de contenu prompt en clair dans le cloud par défaut.  
4. **Rassurant, pas alarmiste** (ton produit existant).

---

## 4. Modes de déploiement & privacy

Trois modes **explicites** sur l’agent. Le mode est visible dans le popup et les options.

### 4.1 `local_only` (défaut MVP / individuel)

| | |
|--|--|
| Règles | Embarquées dans l’extension (+ override local optionnel) |
| Journal | `chrome.storage.local` uniquement |
| Réseau | Aucun appel OpsGate (sauf update extension store plus tard) |
| Console | Non utilisée |

### 4.2 `org_managed` (cible v1.1 pilote)

| | |
|--|--|
| Enrollement | Code d’organisation / lien d’invite |
| Règles | Pull pack signé depuis l’API (cache local) |
| Events | Opt-in **par org** + consentement user affiché une fois |
| Contenu | **Pas de prompt brut** par défaut — voir §6 |
| Console | Dashboard + politiques + règles |

### 4.3 `org_managed_strict` (v1.2 / enterprise)

| | |
|--|--|
| Politique | `mask_required` ou `block` possible |
| Events | Contenu redacted / hash plus riche |
| Proxy | Optionnel, même org |

### Matrice privacy (events cloud)

| Champ event | `local_only` | `org_managed` default | `strict` |
|-------------|--------------|------------------------|----------|
| Timestamp, org_id, agent_id | — | Oui | Oui |
| hostname site IA | — | Oui | Oui |
| rule_ids, severities, counts | — | Oui | Oui |
| decision user | — | Oui | Oui |
| **Extrait match (tronqué)** | — | Option org OFF par défaut | Option |
| **Prompt / fichier brut** | — | **Jamais** | Jamais (ou vault client plus tard) |
| user email | — | Pseudonyme / hash | Identité IdP |

**Règle d’or** : ce qui est assez sensible pour déclencher OpsGate ne doit **pas** être re-centralisé en clair “pour le dashboard”.

---

## 5. Architecture cible

```
┌─────────────────────────────────────────────────────────────────┐
│                        Poste utilisateur                         │
│  ┌──────────────────┐    ┌──────────────────┐                   │
│  │ Extension agent  │    │ Proxy local (v1.2)│                   │
│  │ - content script │    │ - TLS optional    │                   │
│  │ - detector       │◄──►│ - same rules eng. │                   │
│  │ - banner / mask  │    │ - AI domains only │                   │
│  └────────┬─────────┘    └────────┬─────────┘                   │
│           │  rules cache           │                             │
│           │  events (opt-in)       │                             │
└───────────┼────────────────────────┼─────────────────────────────┘
            │                        │
            ▼                        ▼
     ┌─────────────────────────────────────┐
     │         OpsGate Control Plane        │
     │  API Gateway + Auth + Multi-tenant   │
     │  ┌─────────┐ ┌──────────┐ ┌───────┐ │
     │  │ Rules   │ │ Events   │ │Policy │ │
     │  │ Service │ │ Ingest   │ │Engine │ │
     │  └────┬────┘ └────┬─────┘ └───┬───┘ │
     │       └───────────┴───────────┘     │
     │                 │                    │
     │           ┌─────▼─────┐              │
     │           │  Database │              │
     │           └───────────┘              │
     │  ┌──────────────────────────────┐   │
     │  │ Admin Console (Web SPA)      │   │
     │  └──────────────────────────────┘   │
     └─────────────────────────────────────┘
```

### 5.1 Principes techniques

1. **Un seul moteur de règles** (JSON schema commun) partagé agent / proxy / tests.  
2. **L’agent reste autonome** si le cloud est down : dernière policy + règles en cache.  
3. **Offline-first detection** : jamais “pas de détection parce que l’API est lente”.  
4. **Schéma d’events versionné** (`event_schema_version`).  
5. **Multi-tenant par `org_id`** dès le premier commit backend.

### 5.2 Stack recommandée (pragmatique)

| Composant | Proposition | Alternative |
|-----------|-------------|-------------|
| API | TypeScript (Hono / Fastify) sur Node 20+ | Go si perf ingest critique |
| DB | PostgreSQL | SQLite ok pour mono-tenant dev |
| Auth admin | Magic link + session | Clerk / Auth.js |
| Auth agent | Device token (enrolment) | mTLS plus tard |
| Console | Next.js ou Vite React | — |
| Hosting | Fly.io / Railway / Azure Container Apps | Vercel (console) + API séparée |
| Files règles | Object storage + version immuable | Table `rule_packs` + blob |

Alignement avec l’écosystème actuel : **TypeScript end-to-end** (extension déjà TS).

---

## 6. Modèle de données

### 6.1 Entités principales

```
Organization
  id, name, slug
  mode_default: local_only | org_managed | org_managed_strict
  event_payload_policy: metadata_only | metadata_plus_redacted_match
  created_at

User (admin console)
  id, org_id, email, role: owner | admin | viewer

Agent (extension instance)
  id, org_id
  device_label?, enrolled_at
  agent_token_hash
  app_version, last_seen_at
  mode_override?

RulePack
  id, org_id? (null = global OpsGate)
  version (semver ou monotonic int)
  checksum_sha256
  signature (ed25519)
  rules_json (array DetectionRule)
  published_at, published_by
  notes

Policy
  id, org_id
  version
  default_action: warn | mask_recommend | mask_force | block  # force/block = v1.2
  enabled_hosts[]
  scan_uploads: bool
  event_reporting: bool
  rules_pack_id / rules_pack_version
  updated_at

DetectionEvent
  id, org_id, agent_id
  ts
  source: prompt | file
  hostname
  decision: mask_send | send_anyway | cancel
  detection_count
  highest_severity
  rule_ids[]
  types[]            # noms de règles
  file_names[]?      # optionnel, basenames only
  redacted_matches[]? # si policy l’autorise, max N, tronqués
  schema_version
```

### 6.2 Alignement avec le code actuel

Types extension (`src/types`) à faire évoluer sans casser le MVP :

```ts
// Aujourd'hui
OpsGateSettings { enabled, enabledHosts, scanUploads }
JournalEntry { ..., source, fileNames }

// v1.1 additions (agent)
OpsGateSettings {
  ...
  mode: "local_only" | "org_managed" | "org_managed_strict"
  orgId?: string
  agentId?: string
  rulesPackVersion?: string
  eventReporting: boolean  // effective = org policy && user consent
  lastRulesSyncAt?: number
}
```

Le `JournalEntry` local **reste** ; un sous-ensemble peut être copié vers `DetectionEvent` si reporting actif.

### 6.3 Schéma de règle (inchangé conceptuellement)

```json
{
  "id": "fortinet-config",
  "name": "Config Fortinet / FortiGate",
  "category": "general | infra",
  "severity": "low | medium | high",
  "patterns": ["..."],
  "keywords": ["..."],
  "action_default": "warn | mask | block",
  "description": "..."
}
```

**Évolution v1.1** : champ optionnel `min_engine_version` pour ignorer les règles non supportées par un vieux agent.

---

## 7. APIs (contrat v1.1)

Base : `https://api.opsgate.example/v1`  
Auth agent : `Authorization: Bearer <agent_token>`  
Auth admin : session cookie / Bearer user token  

### 7.1 Enrolment agent

```
POST /v1/enroll
Body: { org_code, device_label?, app_version }
→ { agent_id, agent_token, org_id, mode, policy_etag }
```

### 7.2 Pull configuration

```
GET /v1/agents/me/config
Headers: If-None-Match: <etag>
→ 200 {
  policy: Policy,
  rules_pack: { version, checksum, rules: DetectionRule[] },
  etag
}
→ 304 Not Modified
```

**Fréquence agent** : au démarrage + toutes les 15–60 min + bouton “Synchroniser” dans options.

### 7.3 Ingest events

```
POST /v1/events/batch
Body: { events: DetectionEventInput[] }  // max 50
→ { accepted: n, rejected: [] }
```

Contraintes :
- Drop silencieux côté agent si offline (queue locale cap 200).  
- Rate limit par org.  
- Validation stricte : rejeter tout champ `prompt_text` / `file_content`.

### 7.4 Admin

```
GET  /v1/org/summary          # counts 7j, top rules, top hosts
GET  /v1/org/events?from&to&cursor
GET  /v1/org/agents
GET  /v1/org/policy
PUT  /v1/org/policy
GET  /v1/org/rules/packs
POST /v1/org/rules/packs      # publish (clone global + edits)
POST /v1/org/invites
```

---

## 8. Console admin — MVP écrans

### 8.1 Écrans P0

1. **Login** (magic link)  
2. **Home / Summary**  
   - Détections 7 / 30 jours  
   - Taux “Masquer” vs “Envoyer quand même” vs “Annuler”  
   - Top 5 `rule_id`  
   - Agents actifs  
3. **Events** (liste filtrable, pas de prompt brut)  
4. **Policy**  
   - Mode org  
   - Event reporting on/off  
   - Hosts surveillés  
   - Scan uploads  
5. **Rules**  
   - Version pack active  
   - Diff basique vs pack OpsGate global  
   - Publier nouvelle version (JSON editor + validate)  
6. **Agents**  
   - Liste last_seen, version extension  

### 8.2 Écrans P1

- Export CSV events  
- Webhook “nouvelle détection high”  
- Invite users (admin/viewer)  
- Page “Privacy” explicative pour les end users (lien depuis l’extension)

### 8.3 Ce que la console n’est pas (v1.1)

- Session replay  
- Lecture des conversations IA  
- Remote kill switch agressif sans UX (si besoin : “disable org agents” soft)

---

## 9. Flux séquence clés

### 9.1 Enrolment + first sync

```
User entre org_code dans Options
  → POST /enroll
  → stocke agent_token (chrome.storage.local, non exporté)
  → GET /config
  → remplace rules cache + policy
  → popup affiche "Org: Acme · géré · règles v12"
```

### 9.2 Détection avec reporting

```
Content script détecte → banner → user decision
  → append journal local (toujours)
  → si eventReporting: enqueue DetectionEvent (metadata)
  → background flush batch ≤ 10s ou 20 events
```

### 9.3 Cloud down

```
Detection path: 100% local (rules cache)
Config pull: retry backoff, keep last good
Event flush: queue until cap, then drop oldest + metric
```

---

## 10. Emplacement du proxy (v1.2 design)

### 10.1 Rôle

Filet de sécurité quand :
- l’UI IA change et casse le content script ;  
- l’utilisateur utilise un client hors navigateur (phase plus tardive) ;  
- l’org exige une interception indépendante du DOM.

### 10.2 Forme recommandée (premier proxy)

**Agent local** (pas un appliance réseau d’abord) :

- Process utilisateur Windows/Mac  
- Intercepte **uniquement** hostnames allowlist (chatgpt.com, claude.ai, …)  
- Option A : proxy HTTP local + config navigateur PAC  
- Option B (plus tard) : driver / TUN — hors scope  

### 10.3 Partage avec l’extension

| Élément | Partagé |
|---------|---------|
| `rules.json` / RulePack | Oui (même checksum) |
| Moteur regex / masker | Package npm `@opsgate/engine` extrait du repo |
| Schéma events | Oui |
| Banner UX | Extension ; proxy → notification OS + deep link |

### 10.4 Ce que le proxy ne doit pas faire en v1

- Intercepter tout le HTTPS de l’entreprise  
- Stocker full body de toutes les requêtes  
- Remplacer l’extension pour le go-to-market  

### 10.5 Décision produit

| Phase | Proxy |
|-------|--------|
| v1.1 | **Spec only** (ce document §10) |
| v1.2 | Prototype local + 1 site IA |
| v1.3 | Installer signé + console “proxy enrolled” |

---

## 11. Sécurité

1. **Tokens agent** : hash at rest (API), rotation possible, revoke par agent.  
2. **Rule packs signés** : l’agent vérifie signature ed25519 (clé publique embarquée). Refuse pack non signé en `org_managed`.  
3. **HTTPS only** pour l’API.  
4. **Pas de secret client dans le repo** ; env vars backend.  
5. **Isolation multi-tenant** : toutes les queries scoppées `org_id` (tests d’authz obligatoires).  
6. **Admin actions** audit log (`who`, `what`, `when`).  
7. **Threat model court** :  
   - Attaquant vole `agent_token` → peut envoyer de faux events (pas lire les prompts des autres).  
   - Attaquant publie faux pack → signature empêche.  
   - Extension compromise → hors scope (endpoint security).

---

## 12. Roadmap d’implémentation

### PR plan (ordre suggéré)

| PR | Livrable | Dépendances |
|----|----------|-------------|
| **PR0** | Extraire `@opsgate/engine` (detector, rules schema, masker) + tests | **DONE** |
| **PR1** | Backend skeleton : org, enroll, config pull, health | **DONE** |
| **PR2** | Rule packs global + publish + signature (dev-unsigned) | **DONE** |
| **PR3** | Agent : modes, enroll UI, rules cache, sync | **DONE** |
| **PR4** | Console web Summary + packs | **DONE** |
| **PR5** | Postgres (store durable) | **DONE** |
| **PR6** | Polish E2E / sig packs / release 1.1 | **DONE** — pilot-ready |
| **PR4** | Events ingest + queue agent | PR1, PR3 |
| **PR5** | Console Summary + Events + Policy | PR1, PR4 |
| **PR6** | Console Rules editor + agents list | PR2, PR5 |
| **PR7** | Hardening : rate limits, etags, docs ops | PR6 |
| **PR8** (v1.2) | Proxy prototype + same engine | PR0, PR2 |

### Estimation grossière

| Lot | Effort indicatif |
|-----|------------------|
| PR0–PR2 | 1–2 semaines |
| PR3–PR4 | 1–2 semaines |
| PR5–PR6 | 1–2 semaines |
| PR7 | 3–5 jours |
| **Total v1.1 usable pilote** | **~4–7 semaines** selon dispo |

### Critères de done v1.1

- [ ] Org de démo avec 5 agents enrollés  
- [ ] Pack de règles vN publié → agents sync < 1 h (ou manuel)  
- [ ] Dashboard affiche decisions des 7 derniers jours  
- [ ] Mode `local_only` toujours fonctionnel sans API  
- [ ] Aucun prompt brut en base (test automatisé de schéma)  
- [ ] Doc privacy end-user + runbook ops

---

## 13. Métriques produit (plateforme)

| Métrique | Pourquoi |
|----------|----------|
| % décisions `mask_send` | Adoption du comportement sûr |
| Events / agent / semaine | Engagement réel |
| Top rules triggered | Roadmap règles & contenu DailyOps |
| Agents never_seen > 7j | Déploiement / friction |
| Sync failures | Fiabilité control plane |
| Time-to-publish rule | Valeur “ops rules without rebuild” |

---

## 14. Risques & mitigations

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Perception “surveillance” | Rejet users | Metadata-only, transparence UI, local_only default |
| UI IA casse l’agent | Perte couverture | Pack règles ne suffit pas → proxy v1.2 ; monitoring erreurs CS |
| Scope creep SSO/RBAC | Délai | Magic link + 3 rôles max |
| Faux positifs centralisés | Bruit dashboard | Filtres severity, sampling, feedback “FP” plus tard |
| Coût infra | Marge | Postgres single, batch events, rétention 90j |

---

## 15. Décisions produit figées (go du 11/07/2026)

| # | Sujet | Décision validée |
|---|--------|------------------|
| 1 | **Hébergement** | **EU-only** (RGPD / confiance PME) |
| 2 | **Pricing (modèle data)** | Compteur **sièges agent** actifs 30 jours (le tarif exact viendra plus tard ; le schéma suit `org` + `agent`) |
| 3 | **Règles custom client** | **JSON + validation** en v1.1 ; UI no-code = P2 |
| 4 | **Identité end-user** | **Device-only** + label libre en v1.1 (pas d’email obligatoire sur l’agent) |
| 5 | **Nom commercial** | **OpsGate Console** |
| 6 | **Repo** | **Monorepo** `ops-gate` : packages `extension` / `engine` / `api` / `console` (migration progressive) |
| 7 | **Langage** | **TypeScript** end-to-end |
| 8 | **Auth admin v1.1** | Magic link + rôles `owner` \| `admin` \| `viewer` |
| 9 | **Auth agent** | Device token à l’enrolment |
| 10 | **Rétention events** | **90 jours** par défaut |

Toute dérogation = révision doc **v1.1.1** + nouveau go produit.

---

## 16. Prochaines étapes concrètes (post go produit)

### Immédiat (ordre d’exécution)

| # | Action | Owner | Statut |
|---|--------|-------|--------|
| 1 | Ce document marqué **VALIDÉ PRODUIT** | Produit | **Fait** |
| 2 | **PR0** — extraire `@opsgate/engine` (`detector`, `rules-engine`, `masker`, schema rules) + tests | Tech | À lancer |
| 3 | Squelette monorepo (`packages/engine`, garder extension fonctionnelle) | Tech | Après PR0 |
| 4 | **PR1** — API : health, org, enroll, config pull | Tech | Après monorepo |
| 5 | Wireframe 1 page **Summary** console | Produit / Tech | Parallèle PR1 |
| 6 | Pilote extension + kit démo **en parallèle** (ne pas bloquer) | Produit | Continu |

### Critères de lancement pilote cloud (plus tard)

- [ ] 5 agents enrollés sur org démo  
- [ ] RulePack publié → sync agent  
- [ ] Dashboard 7 jours  
- [ ] Zéro prompt brut en base (test CI)  
- [ ] `local_only` toujours OK offline  

---

## 17. Synthèse

| Question | Réponse (go produit) |
|----------|----------------------|
| Console admin ? | **Oui — cœur v1.1 — OpsGate Console** |
| Proxy ? | **Oui — v1.2**, même engine/events |
| Cloud obligatoire ? | **Non** — `local_only` par défaut |
| Données en clair au cloud ? | **Non par défaut** (metadata-only) |
| Rebuild extension pour chaque règle ? | **Non** — RulePack signé |
| Hébergement ? | **EU** |
| Identité agent ? | **Device token + label** |

Ce document est le **contrat d’architecture validé** pour passer d’un garde-fou individuel à une plateforme d’équipe, sans sacrifier la promesse privacy du MVP.

---

*Révision courante : **v1.1 VALIDÉ PRODUIT** (11 juillet 2026). Prochaine révision : v1.1.1 uniquement si amendement produit.*
