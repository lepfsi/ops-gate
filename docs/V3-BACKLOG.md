# Backlog V3 — différenciation produit

**Mis à jour** : 18 juillet 2026  
**Statut** : **V3-P0 livré en code** (A/B/C) · polish + V3-D/E/F/G ouverts · pre-GA V2 **toujours** le chemin commercial  
**Principe** : *Enable AI. Secure Data.* — peu de features **fortes**, pas de dispersion  
**Cut** : [`RELEASE-v3.md`](./RELEASE-v3.md) · **gap** : [`STATUS-GAP-V1-V3.md`](./STATUS-GAP-V1-V3.md)

> **Commercial / GA** : terminer le pre-GA V2 (stores ou MDM, pilote, Stripe prod).  
> **Produit** : P0 V3 est utilisable en démo ; ne pas bloquer les démos dessus.  
> Synthèse : [`STATUS-V2.md`](./STATUS-V2.md) · reste V2 : [`V2-BACKLOG.md`](./V2-BACKLOG.md)

**Specs sources** : [`roadmap-v3/`](./roadmap-v3/)  
**Vision** : [`roadmap-v3/VISION-PRODUIT-ROADMAP-STRATEGIQUE-v1.md`](./roadmap-v3/VISION-PRODUIT-ROADMAP-STRATEGIQUE-v1.md)  
**Roadmap narrative** : [`roadmap-v3/ROADMAP-PRODUIT-CLAIRE-v1.md`](./roadmap-v3/ROADMAP-PRODUIT-CLAIRE-v1.md)

---

## 0. Porte d’entrée (gate pre-GA → V3)

| Condition | Pourquoi |
|-----------|----------|
| [ ] Au moins un canal store (CWS unlisted en review ou process MDM documenté chez client) | Distribution réelle |
| [ ] Pilote client checklist `DEPLOIEMENT-CLIENT` §11 | Feedback terrain avant features UX lourdes |
| [ ] Process licence (vendor **ou** Stripe prod + webhook) | Monétisation stable |
| [ ] Accord produit sur l’ordre P0 V3 ci-dessous | Éviter de re-prioriser en cours de route |

Tant que la gate n’est pas ouverte : **pas de PR feature V3** sur `main` (sauf spikes isolés / docs).

---

## 1. Positionnement V3 (rappel)

| V2 (plateforme entreprise) | V3 (différenciation) |
|----------------------------|----------------------|
| Gateway extension + proxy, SSO, multi-tenant, audit, stores | **Secure Rewrite**, scores de risque, Shadow AI, simulation |
| « DLP léger pour l’IA » opérationnel | **AI Security Platform** mémorable en démo |

Socle déjà présent à réutiliser :

- `@opsgate/engine` (detections, mask basique)  
- Banner / décisions extension  
- Events metadata + console  
- `detection_events` (hostname, decision, severities…)  

---

## 2. Epics V3 — tableau de bord

| Epic | Priorité | Effort estimé | Spec | Statut |
|------|----------|---------------|------|--------|
| **V3-A Secure Rewrite** | P0 | Moyen | [`FEATURE-SPEC-SECURE-REWRITE-v1.md`](./roadmap-v3/FEATURE-SPEC-SECURE-REWRITE-v1.md) | ✅ **livré** (17–18/07) |
| **V3-B Risk Score prompt + Simulation** | P0 | Faible–moyen | [`FEATURE-SPEC-RISK-SCORE-SIMULATION-v1.md`](./roadmap-v3/FEATURE-SPEC-RISK-SCORE-SIMULATION-v1.md) | ✅ **livré** (17–18/07) |
| **V3-C Shadow AI + Risk Score utilisateur** | P0 | Moyen–élevé | [`SHADOW-AI-RISK-SCORE.md`](./roadmap-v3/SHADOW-AI-RISK-SCORE.md) + [wireframes](./roadmap-v3/SHADOW-AI-RISK-SCORE-WIREFRAMES.md) | ✅ **livré** (17–18/07) |
| **V3-D Dashboard Risk / Analytics** | P1 | Moyen | Wireframes § dashboard | ⬜ |
| **V3-E AI Trust Score (par modèle)** | P1 | Moyen | Vision § Trust Score | ⬜ |
| **V3-F Classification intelligente** | P2 | Élevé | Vision Phase 4 | ⬜ |
| **V3-G AI Agent Guard** | P2 | Élevé | Vision Phase 4 | ⬜ |

---

## 3. Ordre d’implémentation recommandé (quand gate ouverte)

```
1. V3-A Secure Rewrite          → wow démo + adoption user
2. V3-B Score prompt + Simulation → complète le parcours rewrite
3. V3-C Shadow AI + Risk user     → pitch RSSI / console
4. V3-D polish dashboard Risk
5. V3-E / F / G                     → plus tard
```

**Parcours UX cible** :

> Détection → **Simulation** (si score élevé) → **Secure Rewrite** → envoi sécurisé  
> En parallèle (console) : inventaire Shadow AI + score comportemental utilisateur

Alternative acceptable si besoin commercial RSSI d’abord : **V3-C avant V3-A** (plus de surface backend).

---

## 4. Détail epics P0

### V3-A — Secure Rewrite

| Item | Notes | Done |
|------|--------|------|
| `secureRewrite()` dans `@opsgate/engine` | Règles IP, secrets, hostnames, PII… | [x] |
| Mapping cohérent dans un même document | Même host → même pseudonyme | [x] |
| Bouton bandeau **Secure Rewrite & envoyer** | Action principale (mask simple en secondaire) | [x] |
| Modal côte à côte (preview) | Original \| sécurisé + scores + édition | [x] |
| Décision event `secure_rewrite` | Journal + API `masked=true` | [x] |
| Scores risque original / restant | Calculés + log console | [x] |
| Fichiers texte | `buildMaskedFileList(..., secure_rewrite)` | [x] |
| Tests smoke | `node --import tsx scripts/test-secure-rewrite.mjs` | [x] |

**Critères de succès** (spec) : adoption rewrite > 40 % sur medium/high ; gen < 400 ms médiane.

### V3-B — Risk Score par prompt + Simulation Mode

| Item | Notes | Done |
|------|--------|------|
| `calculatePromptRiskScore(detections)` | 0–100, factors, recommendation | [x] |
| Affichage score dans banner | Barre + niveau + reco | [x] |
| Simulation Mode (liste fuites + impact) | Auto si score ≥ 40 ; bouton manuel | [x] |
| Lien CTA → Secure Rewrite | Depuis simulation | [x] |
| Journalisation `prompt_risk_score` dans events API | Types/log console — **API meta optionnelle suite** | [ ] |

**Critères** : baisse « send_anyway » high ; clarté score en test user.

### V3-C — Shadow AI Discovery + Risk Score utilisateur

| Item | Notes | Done |
|------|--------|------|
| Migration PG `org_ai_tools` + `user_risk_scores` | TEXT ids, soft ALTER migrate | [x] |
| Formule V1 scores agent | `risk-shadow.ts` on-the-fly events | [x] |
| API risk + shadow-ai | summary / users / detail / patch / recalculate | [x] |
| UI console `#/risk` + `#/shadow` | KPI, liste, détail, inventaire tools | [x] |
| Persist cache scores (job) | Calcul live suffit pour V1 | [ ] optional |
| Alertes score > seuil + Grafana | Suite V3-D | [ ] |

**Critères** : org consulte Risk ≥ 1×/semaine en pilote ; outils shadow découverts.

---

## 5. P1 / P2 (plus tard)

| Epic | Description courte | Hors scope immédiat |
|------|--------------------|---------------------|
| **V3-D** | KPIs Risk, tendances, export, alertes score > seuil + Grafana | — |
| **V3-E** AI Trust Score | Score de confiance par modèle (ChatGPT vs Claude…) | Besoin data usage longue durée |
| **V3-F** Classification | Public / Internal / Confidential / Restricted (hybride règles+IA) | Complexe, légal |
| **V3-G** AI Agent Guard | Agents autonomes / outils API hors navigateur | Trop tôt |

### Explicitement **pas** V3 early

- Explosion du nombre de règles de détection sans UX  
- Refonte architecture monorepo  
- HA multi-région (infra client)  
- Portal personnel déjà en V2 (Stripe) — ne pas re-spécifier  

---

## 6. Dettes techniques à traiter **au démarrage** V3-C

Le fichier [`roadmap-v3/20260717_shadow_ai_risk_score.sql`](./roadmap-v3/20260717_shadow_ai_risk_score.sql) est un **brouillon** :

| Draft | Réalité monorepo |
|-------|------------------|
| `org_id` / `agent_id` UUID | **TEXT** (`organizations.id`, `agents.id`) |
| `created_at` sur events | **`received_at`** |
| Colonnes `decision` / severity « à ajouter » | Souvent **déjà présentes** — vérifier avant ALTER |
| RLS `app.current_org_id` uuid | Aligner sur le pattern `OPSGATE_PG_RLS` existant |

Checklist kickoff V3-C :

1. [ ] Diff vs `packages/api/src/db/schema.sql`  
2. [ ] Réécrire migration + soft ALTER  
3. [ ] Memory-store parity pour dev sans PG  
4. [ ] Endpoints + i18n console FR/EN  

---

## 7. Découpage PR suggéré (quand on démarre)

| PR | Contenu | Dépend |
|----|---------|--------|
| V3-A1 | Engine `secureRewrite` + tests | — |
| V3-A2 | Modal extension + events | A1 |
| V3-B1 | `calculatePromptRiskScore` + UI score | — (// A possible) |
| V3-B2 | Simulation Mode + lien rewrite | B1, idéalement A2 |
| V3-C1 | Schema + store methods | — |
| V3-C2 | API risk + shadow-ai | C1 |
| V3-C3 | Console Risk + Shadow AI | C2 |

---

## 8. Liens

| Doc | Rôle |
|-----|------|
| [`STATUS-V2.md`](./STATUS-V2.md) | Où en est le pre-GA |
| [`V2-BACKLOG.md`](./V2-BACKLOG.md) | Reste V2 (stores, pilote, Stripe prod…) |
| [`roadmap-v3/README.md`](./roadmap-v3/README.md) | Index des specs V3 |
| [`PUBLICATION-STORES.md`](./PUBLICATION-STORES.md) | Kit stores (gate pre-GA) |
| [`DEPLOIEMENT-CLIENT.md`](./DEPLOIEMENT-CLIENT.md) | Checklist pilote |

---

## 9. Journal

| Date | Événement |
|------|-----------|
| 17/07/2026 | Specs V3 déposées (commit Roadmap) puis déplacées sous `docs/roadmap-v3/` |
| 17/07/2026 | **Ce backlog** créé ; implémentation V3 initialement gelée |
| 17–18/07/2026 | **P0 A/B/C livrés** en monorepo ; UX banner/MSP/Risk ; i18n agents ; RELEASE-v3 + STATUS-GAP |

---

*OpsGate · V3-BACKLOG · DailyOps.Tech · ne pas démarrer sans gate §0*
