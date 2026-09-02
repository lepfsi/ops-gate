# OpsGate — Idées & specs V3 (roadmap produit)

**Dossier** : hors Grafana (observabilité) — ici = **vision produit / features différenciantes**.  
**Origine** : commit `V3 Roadmap` (17/07/2026), initialement déposé par erreur dans `docs/grafana/`.  
**Statut** : specs + **P0 A/B/C livrés** · **deep analysis T1–T5 livré** · **roadmap technique 3 phases + OpsVault** · cut [`../RELEASE-v3.md`](../RELEASE-v3.md) · backlog [`../V3-BACKLOG.md`](../V3-BACKLOG.md).

---

## Contenu

| Fichier | Type | Sujet |
|---------|------|--------|
| [`VISION-PRODUIT-ROADMAP-STRATEGIQUE-v1.md`](./VISION-PRODUIT-ROADMAP-STRATEGIQUE-v1.md) | Vision | Positionnement « AI Security Platform », piliers, roadmap 4 phases |
| [`ROADMAP-PRODUIT-CLAIRE-v1.md`](./ROADMAP-PRODUIT-CLAIRE-v1.md) | Roadmap | Priorités P0–P2 actionnables, ce qu’on ne fait pas |
| [`ROADMAP-AI-SECURITY-GATEWAY.md`](./ROADMAP-AI-SECURITY-GATEWAY.md) | Packaging | 5 piliers marketing Gateway (Usage, Data, Governance, Compliance, Intel) |
| [`ROADMAP-TECHNIQUE-OPSGATE.md`](./ROADMAP-TECHNIQUE-OPSGATE.md) | **Roadmap tech 3 phases** | Consolidation → runtime agentique/MCP → posture + **tunnel OpsVault** |
| [`../OPSGATE_INTEGRATION.md`](../OPSGATE_INTEGRATION.md) | Contrat API | OpsVault ↔ OpsGate (inject, leases, NHI) |
| [`DEEP-ANALYSIS-STATUS.md`](./DEEP-ANALYSIS-STATUS.md) | Statut technique | **T1–T5** fichiers/proxy ; remises techniques ; agent = Phase 2–3 |
| [`Recommandations.md`](./Recommandations.md) | Brief impl. | UX Rewrite + bascule scan proxy (statut T1–T5 à jour) |
| [`SHADOW-AI-RISK-SCORE.md`](./SHADOW-AI-RISK-SCORE.md) | Feature spec | Shadow AI Discovery + Risk Score **utilisateur** (API, tables, formule) |
| [`SHADOW-AI-RISK-SCORE-WIREFRAMES.md`](./SHADOW-AI-RISK-SCORE-WIREFRAMES.md) | UI | Wireframes console (dashboard Risk, détail, Shadow AI) |
| [`FEATURE-SPEC-RISK-SCORE-SIMULATION-v1.md`](./FEATURE-SPEC-RISK-SCORE-SIMULATION-v1.md) | Feature spec | Risk Score **par prompt** + Simulation Mode (extension) |
| [`FEATURE-SPEC-SECURE-REWRITE-v1.md`](./FEATURE-SPEC-SECURE-REWRITE-v1.md) | Feature spec | Secure Rewrite (anonymisation intelligente 1 clic) |
| [`20260717_shadow_ai_risk_score.sql`](./20260717_shadow_ai_risk_score.sql) | Migration draft | Tables `user_risk_scores`, `org_ai_tools` + colonnes events |

Grafana (métriques Prometheus) reste dans [`../grafana/`](../grafana/).

---

## Relation avec le monorepo actuel (V2 functional / pre-GA)

| Déjà livré (V2) | Couvert par ces docs V3 | Gap |
|-----------------|-------------------------|-----|
| Extension + moteur détection + mask basique | Prompt Protection partiel | Secure Rewrite = evolution du mask |
| Events metadata, console, dashboard widgets | Analytics basiques | Risk Score user / Shadow AI UI |
| Policy par profils / groupes | Policy Engine partiel | Trust Score modèles, classification |
| Proxy MITM, SSO/MFA, multi-tenant, WORM, stores kit | AI Gateway / enterprise | — hors scope de ces specs |
| OCR, Office, SQLite, MITM deep, mask OOXML (T1–T5) | File Protection **solide** (proxy + extension) | AI Agent Protection, PDF redact natif, Access/MDB — voir [`DEEP-ANALYSIS-STATUS.md`](./DEEP-ANALYSIS-STATUS.md) |

**En bref** : ces docs ne contredisent pas la V2 — elles **cadrent la différenciation produit** au-delà du DLP « detect + mask ».

---

## Pertinence (synthèse d’analyse)

Voir le commentaire d’analyse dans le commit de déplacement / réponse produit.  
Priorité d’impact commercial estimée :

1. **Secure Rewrite** — différenciateur démo fort, s’appuie sur le mask existant  
2. **Risk Score prompt + Simulation** — UX extension, effort moteur limité  
3. **Shadow AI + Risk Score utilisateur** — argument RSSI, tables + jobs + console  
4. Vision / roadmap claire — boussole, pas code  

**Attention schema** : le SQL draft utilise `UUID` pour `org_id` / `agent_id` ; le monorepo utilise des **TEXT** (`organizations.id`, `agents.id`) et `received_at` (pas `created_at`). À adapter avant merge dans `schema.sql`.

---

## Liens utiles

- **Backlog V3 (priorités + gate)** : [`../V3-BACKLOG.md`](../V3-BACKLOG.md)  
- Statut V2 pre-GA : [`../STATUS-V2.md`](../STATUS-V2.md)  
- Backlog V2 (reste ops) : [`../V2-BACKLOG.md`](../V2-BACKLOG.md)  
- Design historique : [`../architecture/PLATFORM-v2.md`](../architecture/PLATFORM-v2.md)  
