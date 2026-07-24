# OpsGate — Roadmap produit  
## AI Security Gateway

**Version** : 1.1  
**Date** : 22 juillet 2026  
**Éditeur** : DailyOps.Tech  
**Statut** : Vision & packaging produit — **pas d’implémentation** dans ce document  
**Philosophie** : *Enable AI. Secure Data.*

---

## 0. Thèse centrale (v1.1)

> **La plupart des briques existent déjà.**  
> Ce qui manque n’est pas tant « encore des features », que **les raconter, les assembler et les exposer** comme un vrai **produit de sécurité**.

| Réalité technique (aujourd’hui) | Perception marché (souvent) |
|---------------------------------|-----------------------------|
| Extension + proxy + API + console multi-tenant | « Un filtre ChatGPT » |
| Shadow AI, risk, events, audit, policies | Features dispersées |
| Secure Rewrite, simulation, DLP fichiers | Outil technique pour admins |

**Roadmap marketing / produit =**  
1. **Exploiter** ce qui est là (surfaces, noms, dashboards, rapports).  
2. **Combler** seulement les vrais trous (allow/deny apps, classification, API LLM, entitlements fins).  
3. **Vendre la preuve** (Compliance & Audit, Governance Center), pas la regex.

---

## 1. Positionnement

### Définition

> **OpsGate** est une **AI Security Gateway** :  
> visibilité et contrôle des usages d’IA, protection des actifs numériques, gouvernance, conformité, traçabilité et intelligence de risque — pour que l’organisation **utilise l’IA sans perdre le contrôle de ses données**.

### Ce n’est pas / C’est

| Ce n’est pas | C’est |
|--------------|--------|
| « On filtre ChatGPT » | **Visibilité + contrôle** de l’utilisation de l’IA dans l’organisation |
| Un simple bloqueur | Un **produit de sécurité** (comme un gateway / CASB IA-first) |
| Une liste de features | Une **promesse de maîtrise** mesurable et auditables |

### Architecture narrative (5 offres commerciales)

Ces 5 lignes sont le **catalogue marketing**. Sous le capot, elles s’appuient sur le monorepo déjà construit.

```
1. AI Usage Control          →  Qui utilise quoi, sous quelle politique
2. AI Data Protection        →  Les actifs ne quittent pas l’entreprise via l’IA
3. AI Governance Center      →  Console de gouvernance pour dirigeants
4. AI Compliance & Audit     →  Preuve de maîtrise (rapports, incidents, évolution)
5. AI Security Intelligence  →  Tendances, risques, terrain OpsInsight
```

Les piliers techniques plus fins (Prompt Security, App Firewall, Identity, Risk Score) **servent** ces 5 offres ; ils ne remplacent pas le discours.

---

## 2. Les 5 piliers marketing (formulation renforcée)

### 1. AI Usage Control — Contrôle des usages IA

**Mauvaise formulation**  
« On filtre ChatGPT. »

**Bonne formulation**  
> *Nous donnons aux organisations une **visibilité et un contrôle** sur l’utilisation de l’intelligence artificielle.*

| Capacité | Contenu | Existant ? | Travail principal |
|----------|---------|------------|-------------------|
| Applications IA | Inventaire, allow / deny / observe | Shadow AI ●●○ | Politique d’apps **visible** + enforcement clair |
| Utilisateurs | Qui, depuis quels agents / appareils | Agents + events ●●● | Agrégats « usage par user » dans l’UI |
| Politiques d’accès | Profils, groupes, hosts | Policies ●●● | Renommer / regrouper en **Usage Control** |
| Règles d’utilisation | defaultAction, rewrite, schedule | ●●● | Packaging + presets métiers |

**Exemple commercial**  
> « 15 employés utilisent ChatGPT Free alors que l’entreprise n’a aucune politique IA. »

**Message** : ce n’est pas un filtre site par site — c’est le **contrôle d’accès aux usages IA**.

---

### 2. AI Data Protection — Protection des données

**Mauvaise formulation**  
« On détecte des regex de secrets. »

**Bonne formulation**  
> *Empêcher que les **actifs numériques** quittent l’entreprise via les assistants IA.*

| Famille d’actifs | Exemples | Base technique |
|------------------|----------|----------------|
| Données personnelles | nom, email, téléphone, clients | PII engine ●●● |
| Secrets techniques | API keys, tokens, mots de passe, SSH | Secrets engine ●●● |
| Documents / métier | contrats, Excel clients, code, financier | Fichiers + prompt ●●○ |

**Actions** (déjà dans le produit, à **mettre en avant** comme catalogue d’actions) :

- bloquer  
- anonymiser (Secure Rewrite)  
- demander confirmation  
- journaliser  

**Exemple commercial**  
Utilisateur : *« Analyse cet Excel de nos clients. »*  
OpsGate : 450 emails, 120 téléphones → **bloquer / anonymiser / confirmer / journaliser**.

**Message** : le cœur n’est pas « détecter une chaîne » — c’est **protéger le patrimoine numérique** face à l’IA.

---

### 3. AI Governance Center — Gouvernance

**C’est le levier où pousser le plus** (discours + assemblage UI).

Les dirigeants ne veulent pas comprendre les modèles. Ils veulent répondre à :

| Question | Surface produit cible |
|----------|----------------------|
| **Qui** utilise l’IA ? | Users / agents actifs |
| **Pour quoi faire ?** | Apps, volumes, top cas d’usage (à enrichir) |
| **Quels risques ?** | Risk org + top risques |
| **Quelles données exposées ?** | Catégories DLP, tentatives sensibles |
| **Quelle politique appliquée ?** | Policy / profils / allow list apps |

**Le dashboard devient une console de gouvernance**, pas un tableau de métriques techniques.

#### Écran cible (déjà largement alimentable par l’existant)

```
AI Governance Center
────────────────────
Applications IA utilisées .............. 27
Utilisateurs actifs .................... 143
Données sensibles bloquées ............. 356
Risque global .......................... Moyen

Top risques
  1. Upload documents confidentiels
  2. Code source exposé
  3. Utilisation d’IA non approuvée
```

**Travail principal** : **assembler et nommer** (summary, shadow, risk, events) en un **Centre de gouvernance** — pas reconstruire un data lake.

---

### 4. AI Compliance & Audit — Preuve de maîtrise

**Audience** : RSSI, DSI, directions, comités risques.

**Mauvaise formulation**  
« On a des logs. »

**Bonne formulation**  
> *Nous ne vendons pas un outil. Nous vendons de la **preuve de maîtrise** de l’usage de l’IA.*

#### Livrable phare — *AI Security Report*

```
AI Security Report — July 2026

Users monitored .................. 245
AI interactions analyzed ......... 18 542
Sensitive data attempts .......... 372
Blocked incidents ................ 41
Policy violations ................ 16
Risk evolution ................... ↓ 23 %
```

| Brique existante | Rôle dans le rapport |
|------------------|----------------------|
| Events / summary | interactions, sévérités |
| Décisions (block, rewrite, cancel) | incidents traités |
| Shadow unauthorized | violations d’usage |
| Risk scores | évolution du risque |
| Audit WORM + exports + SIEM | preuve & intégrité |
| Rapport sécu PDF (console) | **socle** à productiser en « AI Security Report » |

**Message** : le RSSI achète un **rapport qu’il peut montrer**, pas une console qu’il doit expliquer.

---

### 5. AI Security Intelligence — terrain **OpsInsight**

**Mauvaise formulation**  
« On a un risk score. »

**Bonne formulation**  
> *Comprendre dans le temps **où va le risque IA** de l’organisation — pour anticiper, pas seulement bloquer.*

| Capacité | Description | Existant | Suite |
|----------|-------------|----------|--------|
| Tendances | Risque / volume / apps sur 7–30–90 j | Risk + summary ●●○ | Séries claires dans Governance / Report |
| Utilisateurs à risque | Top scores, causes | Risk users ●●● | Exposer dans Governance Center |
| Applications émergentes | Nouveaux outils Shadow | Shadow ●●○ | Alerting « nouvelle app détectée » |
| Historique long | Mémoire organisationnelle | Events + rétention ●●● | Agrégats analytics |
| **OpsInsight** | Couche intelligence / insights proactifs | ○○○ (nom de terrain) | Phase ultérieure : insights, recommandations, peut-être ML léger |

**OpsInsight** n’est pas un 6ᵉ produit concurrent d’OpsGate : c’est la **marque de la couche intelligence** (roadmap longue) posée sur les données déjà collectées par la Gateway.

---

## 3. Cartographie : piliers marketing × maturité × nature du travail

Légende maturité : **●●●** solide · **●●○** partiel · **●○○** amorcé  

| Offre marketing | Maturité sous-jacente | Nature du travail prioritaire |
|-----------------|----------------------|-------------------------------|
| **1. AI Usage Control** | ●●○ | **Packaging + policy apps** (allow/deny) + surfaces UI |
| **2. AI Data Protection** | ●●● | **Fiabilité** (scan/rewrite) + **classification** + discours actifs |
| **3. AI Governance Center** | ●●○ | **Assemblage dashboard** décideur (peu de backend neuf) |
| **4. AI Compliance & Audit** | ●●● | **Productiser le rapport** mensuel / board pack |
| **5. AI Security Intelligence** | ●●○ | Exposer tendances ; **réserver OpsInsight** comme horizon |

### Travail « construire » vs « exploiter »

| Exploiter (marketing + UX + packaging) | Construire (vrais gaps) |
|----------------------------------------|-------------------------|
| Renommer / regrouper console en Usage / Governance / Compliance | Allow/deny list d’applications IA appliquée |
| AI Security Report à partir d’events + risk + shadow | Classification PII / secrets / métier dans l’UI |
| Narratif « actifs numériques » autour du DLP existant | Entitlements IA fins (persona → droits) |
| Top risques en langage métier | Couverture API LLM / agents (App Firewall) |
| Presets policy « entreprise / admin publique » | OpsInsight (insights proactifs) |

---

## 4. Roadmap par phases (recalibrée « exploitation d’abord »)

### Phase A — *Product packaging* (4–8 semaines) — **P0**

**Objectif** : le marché et le pilote **reconnaissent** une AI Security Gateway.

| Action | Offre | Note |
|--------|-------|------|
| Message unique site / pitch / console | — | « AI Security Gateway · Enable AI. Secure Data. » |
| Onglet / hub **Governance Center** (agrégat UI) | 3 | Brancher summary + shadow + risk existants |
| **AI Security Report** (mensuel / à la demande) | 4 | Évolution du rapport sécu déjà là |
| Cataloguer les actions DLP (block / rewrite / confirm / log) | 2 | Copy + presets |
| Usage Control : exposer hosts/apps + Shadow comme « apps » | 1 | Moins de jargon technique |

**Critère de sortie**  
Un décideur lit le rapport ou le Governance Center et dit : *« On maîtrise l’usage de l’IA. »*

---

### Phase B — *Contrôle d’accès IA* (2–3 mois) — **P0/P1**

**Objectif** : Usage Control **opérationnel** (pas seulement visible).

| Action | Offre |
|--------|-------|
| Politique d’applications : allow / deny / observe | 1 |
| Alertes « app non approuvée » / « ChatGPT Free » | 1 + 5 |
| Règles d’utilisation par groupe (profils déjà là → entitlements simples) | 1 + Identity |

---

### Phase C — *Data Protection « métier »* (parallèle B) — **P1**

| Action | Offre |
|--------|-------|
| Classification des détections (PII / secrets / métier) | 2 |
| Top risques Governance alimentés par ces classes | 3 |
| Fiabilité fichiers & rewrite (qualité perçue = qualité produit) | 2 |

---

### Phase D — *Intelligence & OpsInsight* (M6+) — **P2**

| Action | Offre |
|--------|-------|
| Tendances risque org, apps émergentes, users à risque | 5 |
| Recommandations automatiques (« renforcez policy sur… ») | 5 → **OpsInsight** |
| Optionnel : modèles / scoring avancé | OpsInsight |

---

### Phase E — *AI App Firewall* (M9–18) — **P3**

Contrôle des canaux au-delà du navigateur (API LLM, agents internes).  
Différenciation long terme — **après** que le discours Gateway + Governance soit installé.

---

## 5. Architecture produit (vue marketing)

```
┌────────────────────────────────────────────────────────────┐
│              AI GOVERNANCE CENTER                          │
│     Qui · Quoi · Risques · Données · Politique             │
└───────────────────────────┬────────────────────────────────┘
                            │
┌───────────────────────────┼────────────────────────────────┐
│  AI USAGE CONTROL         │  AI DATA PROTECTION            │
│  Apps · Users · Policies  │  Actifs · Actions · Rewrite    │
└─────────────┬─────────────┴──────────────┬─────────────────┘
              │                            │
              └────────────┬───────────────┘
                           ▼
              ┌────────────────────────────┐
              │ AI COMPLIANCE & AUDIT      │
              │ Preuve · Reports · SIEM    │
              └────────────┬───────────────┘
                           ▼
              ┌────────────────────────────┐
              │ AI SECURITY INTELLIGENCE   │
              │ Tendances · Risk ·         │
              │ [OpsInsight — horizon]     │
              └────────────────────────────┘
```

---

## 6. North Star & KPI (alignés discours)

### North Star

> **Preuve de maîtrise de l’IA** :  
> part des interactions IA **analysées**, des tentatives sensibles **traitées**, et baisse mesurable du risque — **sans tuer l’adoption**.

### KPI par offre

| Offre | KPI « on vend ça » |
|-------|---------------------|
| Usage Control | % apps non approuvées, users sur Shadow |
| Data Protection | Tentatives sensibles, % rewrite/block vs envoi brut |
| Governance Center | Temps pour répondre aux 5 questions dirigeant |
| Compliance & Audit | Rapport mensuel généré / partagé, violations |
| Security Intelligence | Évolution risk ↓, users à haut risque, apps émergentes |

---

## 7. Pitch en 30 secondes

**OpsGate — AI Security Gateway**

1. **Usage Control** — Qui utilise quelle IA, sous quelle règle.  
2. **Data Protection** — Les actifs ne partent pas dans les assistants.  
3. **Governance Center** — Une console pour diriger, pas pour bricoler.  
4. **Compliance & Audit** — La preuve de maîtrise, chaque mois.  
5. **Security Intelligence** — Le risque dans le temps — puis **OpsInsight**.

*Enable AI. Secure Data.*

---

## 8. Décisions ouvertes (produit / go-to-market)

1. **Nom d’offre** : un seul produit OpsGate à 5 piliers, ou SKUs (Gateway / Governance / Insight) ?  
2. **Rapport** : gratuit dans la licence, ou levier premium « Compliance Pack » ?  
3. **OpsInsight** : marque séparée ou module dans la console ?  
4. **Persona d’entrée** : RSSI (preuve) vs DSI (usage) — lequel mène le pitch ?  

---

## 9. Liens

| Document | Rôle |
|----------|------|
| [`STATUS-V2.md`](../STATUS-V2.md) | Ce qui est **déjà livré** techniquement |
| [`ROADMAP-PRODUIT-CLAIRE-v1.md`](./ROADMAP-PRODUIT-CLAIRE-v1.md) | Features V3 courtes |
| **Ce document v1.1** | Discours **AI Security Gateway** + exploitation d’abord |

---

*DailyOps.Tech · OpsGate · Roadmap AI Security Gateway v1.1 · Juillet 2026*  
*Document de direction produit — aucune implémentation associée.*
