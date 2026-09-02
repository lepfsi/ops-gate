# OpsGate — Roadmap technique (3 phases)

**Date** : 29 juillet 2026  
**Statut** : **Vision + plan d’implémentation** (pas un cut de code)  
**Compléments** :
- Analyse fichiers livrée : [`DEEP-ANALYSIS-STATUS.md`](./DEEP-ANALYSIS-STATUS.md) (T1–T5)
- Tunnel secrets : [`../OPSGATE_INTEGRATION.md`](../OPSGATE_INTEGRATION.md) (OpsVault ↔ OpsGate)
- Packaging produit : [`ROADMAP-AI-SECURITY-GATEWAY.md`](./ROADMAP-AI-SECURITY-GATEWAY.md)

**Philosophie** : *Enable AI. Secure Data.* — consolider le socle, puis ouvrir le **control plane agentique** avec OpsVault comme credential plane.

---

## 0. Architecture cible (duo DailyOps)

```text
┌─────────────────────────────────────────────────────────────────┐
│                     Control / Data plane OpsGate                  │
│  Extension · Proxy MITM · API · Console · Risk · Shadow · Chat   │
│                         (PEP + policy + audit)                   │
└───────────────────────────────┬─────────────────────────────────┘
                                │  tunnel d’intégration
                                │  (inject / leases / risk / NHI)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                          OpsVault                                 │
│     Credential plane : secrets machine, leases JIT, NHI, audit   │
│     Agents reçoivent des handles — jamais le clair dans le LLM   │
└─────────────────────────────────────────────────────────────────┘
```

| Composant | Rôle |
|-----------|------|
| **OpsGate** | PEP : score de risque, session, step-up, autorisation IA, Shadow, deep scan fichiers ; **injecte le material hors prompt** |
| **OpsVault** | Credential plane : secrets, leases, risk-policy vault, inventaire NHI |
| **Agent / utilisateur** | Handles / hints seulement dans le transcript LLM |

Contrat API détaillé : **[`docs/OPSGATE_INTEGRATION.md`](../OPSGATE_INTEGRATION.md)** (phases inject P1 → leases+risk P2 → NHI feed P3 côté vault).

---

## 1. État actuel (fort) — base livrée

Cartographie honnête de ce qui est **déjà en code** (V2 pre-GA + V3-P0 + deep analysis T1–T5) :

| Capacité | Maturité | Notes |
|----------|----------|--------|
| Proxy HTTPS allowlist providers IA + interception prompts / PII / secrets / configs | ●●● | MITM + soft-mask ; deep multipart T4 |
| Audits complets (events, WORM, exports) | ●●● | Metadata, pas contenu conversation |
| Attribution utilisateur ↔ IA | ●●● | Agents, events, risk users |
| Analyse documents uploadés (nom + contenu sensible) | ●●● | T1–T5 : PDF/Office/OCR/SQLite + mask OOXML |
| Autorisation par IA (hosts, policy, `ai_access` kill switch) | ●●○ | Allowlist + policy ; ouverture dynamique = Phase 1 |
| Score de risque organisation | ●●○ | Dashboard / gateway KPIs |
| Score de risque utilisateur (top risk users) | ●●● | `#/risk` + API |
| Seuil de blocage d’accès | ●●○ | Policy / risk ; lier plus finement = Phase 1 |
| Chat popup utilisateur ↔ admin | ●●○ | Inbox/support présent ; historique + actions = Phase 1 |
| Shadow AI (inventaire outils IA) | ●●● | `#/shadow` ; classification outil = Phase 1 |
| Tunnel OpsVault | ○○○→ | **Contrat écrit** ; implémentation = Phase 1→3 |

**Ce n’est pas encore** : control plane MCP runtime, identité d’agent distincte, discovery active posture, inject secrets natif en prod.

---

## 2. Phase 1 — Consolidation & ouverture contrôlée

**Objectif** : maximiser la valeur du socle et préparer le terrain agents + OpsVault.  
**Public** : PME / pilotes plus faciles à vendre.  
**Livrable** : version plus robuste, API interne propre, déploiement Docker simple.

### 2.1 Axes techniques prioritaires

| Axe | Description | Ancrage code / doc |
|-----|-------------|-------------------|
| **Proxy flexible** | Nouveaux endpoints / hosts **sans recoder** la liste blanche en dur (config dynamique, packs hosts, hot-reload) | `packages/proxy` allowlist + sync policy |
| **Moteur détection** | Précision PII/secrets ↑, faux positifs ↓ (validators, packs, tests FP) | `@opsgate/engine` |
| **Shadow AI enrichi** | Classifier outils : **LLM vs outil métier vs MCP naissant** ; **score de risque par outil** | Shadow API + console |
| **Risk user ↔ actions** | Corrélations automatiques (ex. document sensible + IA non autorisée → hausse score) | Risk formula + events `file` / shadow |
| **Chat admin** | Historique, catégories de demandes, réponses **avec actions** (débloquer, modifier policy) | Inbox console + API agents |
| **API interne propre** | Modules tiers (OpsVault, connectors) interrogent : scores, autorisations, inventaire Shadow | REST versionné sous `/v1/internal` ou `/v1/gateway/*` |
| **Déploiement** | Image Docker + `docker-compose` simple + mode reverse-proxy (Nginx/Traefik) | `docker-compose.yml`, docs DEPLOIEMENT |
| **OpsVault tunnel P1** | Client inject **handle-only** + injector material (contrat § Phase 1) | [`OPSGATE_INTEGRATION.md`](../OPSGATE_INTEGRATION.md) |

### 2.2 OpsVault — Phase 1 (inject basique)

Implémenter côté OpsGate le **client** du contrat :

- Config : `OPS_VAULT_BASE_URL`, `OPS_VAULT_INJECTOR_TOKEN`, `OPS_VAULT_INJECT_KEY` (optionnel)
- `POST {vault}/v1/inject` en `mode=handle` (agent) vs `mode=material` (injector OpsGate uniquement)
- Ne **jamais** placer le material dans le prompt / transcript LLM
- Journal OpsGate : `requestId`, decision, **sans** secret en clair

### 2.3 Critères de sortie Phase 1

- [ ] Allowlist / hosts configurables sans rebuild proxy  
- [ ] Pack détection + suite tests FP documentée  
- [ ] Shadow : type d’outil + risk score outil exposés API + UI  
- [ ] Au moins une règle « risk user auto-bump » branchée sur events réels  
- [ ] Chat admin : historique + 1 action « débloquer agent » depuis la conversation  
- [ ] API lecture scores / shadow / authz documentée (OpenAPI ou markdown)  
- [ ] `docker compose up` lab documenté (API + console + Postgres)  
- [ ] Smoke inject OpsVault handle + material (lab)

---

## 3. Phase 2 — Contrôle runtime agentique

**Objectif** : le proxy / control plane gère **agents** et **MCP**, pas seulement les chatbots web.  
**Livrable** : protection des **premiers agents** (au-delà de l’extension SPA).

> Ceci **remplace le statut « V3-G purement remisé sans horizon »** par un **plan Phase 2** conditionné à la fin de Phase 1.  
> L’ancien libellé *AI Agent Protection* / *AI Agent Guard* est **ici** le cœur de la Phase 2.

### 3.1 Axes techniques prioritaires

| Axe | Description |
|-----|-------------|
| **Support MCP** | Inspection tool calls, validation arguments, allow/deny tools |
| **Session / identité agent** | Distinguer **humain** vs **agent qui agit pour un humain** (`user_id` + `agent_id`) |
| **Politiques contextuelles** | Score user × type outil × sensibilité document × historique ; règles du type « score > X et outil = write → bloquer » |
| **Corrélation multi-requêtes** | Séquences suspectes sur plusieurs appels |
| **Mode agent-aware** | Détection trafic frameworks agentiques |
| **Shadow AI + MCP** | Serveurs MCP découverts via le trafic |
| **Logs enrichis** | Chaque event : `user_id`, `agent_id?`, `tool_name`, `risk_score_at_time` |
| **OpsVault P2** | Leases JIT + `riskScore` OpsGate + step-up + session binding (`X-OpsGate-Session`) |

### 3.2 OpsVault — Phase 2 (leases + risk)

Suivre le contrat P2 :

```text
Agent action "stripe.charge"
  → OpsGate calcule riskScore + sessionId
  → POST /v1/inject mode=handle { secretId, action, riskScore, sessionId, … }
  → handle seulement vers l’agent / le LLM
  → OpsGate POST /v1/leases/{handle}/material (injector)
  → injecte material hors prompt (proxy / connector)
  → revoke / maxUses
```

Décisions vault (`deny` / `step_up` / `reduce_ttl` / `allow`) pilotées par le **score OpsGate**.

### 3.3 Critères de sortie Phase 2

- [ ] Au moins un chemin MCP (ou mock protocol-compatible) inspecté en lab  
- [ ] Events portent `agent_id` + `tool_name` + risk at time  
- [ ] Policy contextuelle documentée + 3 règles d’exemple en force  
- [ ] Lease OpsVault avec risk + session binding en smoke e2e  
- [ ] Shadow liste au moins un « MCP » / tool runtime en inventaire  

---

## 4. Phase 3 — Control plane complet + Posture

**Objectif** : positionnement **Agent Security Gateway + Posture**, avec OpsVault natif.

### 4.1 Axes techniques prioritaires

| Axe | Description |
|-----|-------------|
| **Discovery active** | Pas seulement passif via trafic (scan / connecteurs / enrollment agents) |
| **Posture scoring** | Global org + par agent + par outil |
| **Politiques intent-based** | L’agent a le droit de faire X mais pas Y |
| **OpsVault natif** | Demande de secret → validation + injection contrôlée (flux produit, pas seulement lab) |
| **Dashboards avancés** | Top risk agents, évolution scores, tendances Shadow AI |
| **Hybrid + multi-tenant** | Cloud + on-prem ; MSP déjà partiellement là — durcir le modèle |

### 4.2 OpsVault — Phase 3 (NHI feed)

Côté vault (déjà spécifié) : inventaire NHI, permissions, `GET /v1/nhi/policy-export`.

**OpsGate** :

- Charge périodiquement `opsvault-nhi-policy-v1`
- **Pré-filtre** tool calls / inject **avant** d’appeler `/v1/inject`
- Surface console : findings NHI + posture liée aux grants secrets

### 4.3 Critères de sortie Phase 3

- [ ] Policy export NHI consommée par OpsGate (cache + hot reload)  
- [ ] Dashboard posture (org / agent / outil)  
- [ ] Au moins une politique intent-based en demo scriptée  
- [ ] Mode hybrid documenté (what runs where)  
- [ ] Pack conformité audit (export joint OpsGate + OpsVault)  

---

## 5. Mapping avec le backlog existant

| Ancien libellé | Nouveau placement |
|----------------|-------------------|
| V3-P0 Rewrite / Risk / Shadow | **État actuel** ✅ |
| Deep analysis T1–T5 | **État actuel** ✅ — maintenance dans DEEP-ANALYSIS-STATUS |
| V3-D Dashboard Risk analytics | **Phase 1–3** (enrichissement progressif) |
| V3-E Trust Score modèles | **Phase 3** posture (proche) |
| V3-F Classification | **Phase 1** Shadow types (léger) + **Phase 3** intent (riche) |
| **V3-G AI Agent Protection** | **Phase 2** (runtime) + **Phase 3** (posture) — **plus un « jamais »** |
| PDF redact / Access MDB / OCR MITM | Toujours **remises techniques** (hors chemin critique des 3 phases) |

---

## 6. Ordre d’exécution recommandé

```text
Maintenant
  └─ Phase 1 consolidation
       ├─ proxy flexible + détection FP
       ├─ Shadow classification + risk outil
       ├─ risk user ↔ actions
       ├─ chat admin actions
       ├─ API interne
       ├─ Docker compose / reverse-proxy
       └─ OpsVault inject P1 (tunnel)

Ensuite (gate Phase 1 OK)
  └─ Phase 2 runtime agentique + MCP + OpsVault leases P2

Puis
  └─ Phase 3 posture + NHI policy-export + dashboards
```

**Règle** : ne pas démarrer le runtime MCP (Phase 2) tant que l’API interne + Shadow typé + inject handle P1 ne sont pas stables.

---

## 7. Hors scope immédiat (rappel)

- SPIFFE full mesh, dual control vault (voir OPSGATE_INTEGRATION hors scope)  
- Remplacement CASB / endpoint DLP universel  
- Stocker le contenu des prompts dans le control plane  
- Implémenter OpsVault **dans** ce monorepo (OpsVault reste un produit séparé ; OpsGate = client PEP)

---

## 8. Liens

| Doc | Usage |
|-----|--------|
| [`../OPSGATE_INTEGRATION.md`](../OPSGATE_INTEGRATION.md) | Contrat tunnel OpsVault (inject, leases, NHI) |
| [`DEEP-ANALYSIS-STATUS.md`](./DEEP-ANALYSIS-STATUS.md) | Fichiers / OCR / MITM / mask OOXML |
| [`../V3-BACKLOG.md`](../V3-BACKLOG.md) | Epics V3 |
| [`../STATUS-GAP-V1-V3.md`](../STATUS-GAP-V1-V3.md) | Gap pre-GA |
| [`ROADMAP-AI-SECURITY-GATEWAY.md`](./ROADMAP-AI-SECURITY-GATEWAY.md) | Discours 5 piliers |
