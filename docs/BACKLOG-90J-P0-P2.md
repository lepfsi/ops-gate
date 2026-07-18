# OpsGate — Backlog 90 jours (P0–P2)

**Date** : 18 juillet 2026  
**Base** : V2 pre-GA + V3-P0 livré  
**Objectif** : tickets **actionnables** par composant, importables GitHub / Linear  
**Réf.** : [`STATUS-GAP-V1-V3.md`](./STATUS-GAP-V1-V3.md) · [`V3-BACKLOG.md`](./V3-BACKLOG.md)

### Labels recommandés

| Label | Usage |
|-------|--------|
| `P0` / `P1` / `P2` | Priorité |
| `component:extension` | `src/`, content script, SW |
| `component:api` | `packages/api` |
| `component:console` | `packages/console` |
| `component:proxy` | `packages/proxy` |
| `component:engine` | `packages/engine` |
| `component:docs` | `docs/`, scripts PDF |
| `component:ops` | Stores, Stripe, infra, pilote |
| `type:bug` / `type:feature` / `type:chore` / `type:security` | Nature |

### Colonnes Linear / GitHub Projects

`Backlog` → `Ready` → `In progress` → `Review` → `Done`

---

## Sprint map (90 j)

| Phase | Semaines | Focus |
|-------|----------|--------|
| **A — Ship** | 1–4 | Distribution + pilote + licence |
| **B — Preuve** | 5–8 | Events fiables + analytics + alertes |
| **C — Scale soft** | 9–12 | Risk V3-D + proxy health + RBAC |

---

# P0 — Bloquant vente / GA

### OPS-001 · Canal distribution Chrome (unlisted ou MDM)
| | |
|--|--|
| **Prio** | P0 |
| **Composant** | `ops` · `docs` |
| **Type** | chore |
| **Description** | Publier l’extension en **CWS unlisted** *ou* livrer un runbook MDM force-install validé chez un client pilote. Artefacts déjà via `pnpm store:chrome`. |
| **Acceptation** | [ ] Package CWS validé (`pnpm store:chrome` + `ext:validate`) [ ] Listing créé / en review **ou** reg + policy JSON MDM testés sur 1 poste client [ ] Doc `PUBLICATION-STORES` / `CHROME-WEB-STORE-MDM` à jour avec captures |
| **Estimation** | M |

---

### OPS-002 · Pilote client (checklist DEPLOIEMENT §11)
| | |
|--|--|
| **Prio** | P0 |
| **Composant** | `ops` · `docs` |
| **Type** | chore |
| **Description** | Exécuter un pilote réel : control plane + enroll + 5–20 postes + 2 semaines d’events. Remplir checklist §11 de `DEPLOIEMENT-CLIENT.md`. |
| **Acceptation** | [ ] Org pilote créée [ ] ≥ 10 events non-test en console [ ] Feedback FPs listé (issues eng-) [ ] Compte-rendu 1 page (rewrite %, send_anyway, shadow) |
| **Estimation** | L |

---

### OPS-003 · Licence production (Stripe prod OU vendor)
| | |
|--|--|
| **Prio** | P0 |
| **Composant** | `ops` · `api` |
| **Type** | chore |
| **Description** | Brancher Stripe **live** (clés + webhook Dashboard) **ou** documenter et industrialiser le process licence vendor (issue-license + livrable client). |
| **Acceptation** | [ ] Un chemin licence bout-en-bout testé hors lab [ ] Runbook 15 min pour le support [ ] Échec webhook / clé invalide géré avec message console clair |
| **Estimation** | S–M |

---

### EXT-001 · Fiabiliser file d’events MV3 (pas de perte silencieuse)
| | |
|--|--|
| **Prio** | P0 |
| **Composant** | `extension` · `api` |
| **Type** | bug |
| **Description** | Le SW peut mourir avant `POST /v1/events/batch`. Renforcer queue locale, flush au wakeup, retry backoff, métrique/log « dropped ». |
| **Fichiers** | `src/lib/cloud.ts`, `src/background.ts`, `src/lib/storage.ts` |
| **Acceptation** | [ ] Test: kill SW pendant flush → events rejoués au prochain alarm [ ] Compteur `lastEventError` / journal local des échecs [ ] Doc courte dans CHANGELOG-TECHNIQUE |
| **Estimation** | M |

---

### ENG-001 · Process « Aligner pack org sur engine »
| | |
|--|--|
| **Prio** | P0 |
| **Composant** | `api` · `console` · `engine` |
| **Type** | feature |
| **Description** | Bouton console Packs : « Publier pack depuis @opsgate/engine » (réutilise logique `republish-engine-pack` / `buildGlobalRulesPack`) + bump epoch. |
| **Acceptation** | [ ] Un clic admin → nouveau pack actif avec règles IBAN/checksum actuelles [ ] Audit admin `pack_publish` [ ] Pas de collision de version |
| **Estimation** | S |

---

### DOC-001 · Kit premier client (1 page install + smoke)
| | |
|--|--|
| **Prio** | P0 |
| **Composant** | `docs` |
| **Type** | chore |
| **Description** | Guide « 30 minutes pilote » : API+PG, console, enroll, 3 prompts test, vérifier events + 1 rapport PDF. |
| **Acceptation** | [ ] MD (+ PDF optionnel) lié depuis DEPLOIEMENT [ ] Liste exacte des commandes Windows/Linux [ ] Critères go/no-go pilote |
| **Estimation** | S |

---

# P1 — Preuve, analytics, qualité terrain

### API-001 · Snapshot dashboard léger (remplacer full `summary()` chaud)
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `api` · `console` |
| **Type** | feature |
| **Description** | Endpoint `GET /v1/org/summary/lite` (agents counts, by_decision, events_by_day, pack version) sans purge ni isAgentLicensed N×. Dashboard charge lite d’abord ; drill-down charge le full. |
| **Acceptation** | [ ] P95 summary lite &lt; 300 ms sur org demo [ ] UI dashboard inchangée fonctionnellement [ ] Full summary toujours dispo pour panneaux listes |
| **Estimation** | M |

---

### API-002 · Meta `prompt_risk_score` sur events
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `api` · `extension` · `engine` |
| **Type** | feature |
| **Description** | Étendre le schéma event (optionnel) : `prompt_risk_score`, `prompt_risk_level`. Extension envoie si calculé ; API stocke/affiche. |
| **Acceptation** | [ ] Events JSON acceptent les champs [ ] Console Events colonne optionnelle [ ] Rétrocompat (events sans score OK) |
| **Estimation** | M |

---

### API-003 · Alertes risk score > seuil
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `api` · `console` |
| **Type** | feature |
| **Description** | Cron/job : si user risk ≥ seuil (ex. 70) sur 7j, notif canaux org (email/Telegram/Slack déjà présents). Config dans Monitoring → Notifications. |
| **Acceptation** | [ ] Seuil configurable [ ] Dédup (pas 1 mail/heure) [ ] Audit `risk_alert` [ ] Doc dans GUIDE |
| **Estimation** | M |

---

### CON-001 · Export CSV Risk users + période
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `console` · `api` |
| **Type** | feature |
| **Description** | Bouton export sur `#/risk` : agent, score, trend, events_count, last_event. |
| **Acceptation** | [ ] CSV téléchargeable 7/30/90j [ ] Respect filtre min_score |
| **Estimation** | S |

---

### CON-002 · Health strip « Santé org » (1 ligne)
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `console` |
| **Type** | feature |
| **Description** | Bandeau dashboard : rewrite %, send_anyway high, shadow unauth, proxy mode, unlicensed. |
| **Acceptation** | [ ] Visible sans scroll [ ] Liens vers Risk / Shadow / Events proxy / Agents |
| **Estimation** | S |

---

### CON-003 · Weekly export : joindre Security PDF
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `api` · `console` |
| **Type** | feature |
| **Description** | Option scheduled export : générer `security-report` PDF de la semaine et attacher à l’email (en plus CSV/JSON). |
| **Acceptation** | [ ] Toggle console Rapports [ ] PDF généré via script existant [ ] Limite taille attachment respectée |
| **Estimation** | M |

---

### EXT-002 · Suite i18n options + toasts (EN complet)
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `extension` |
| **Type** | feature |
| **Description** | Étendre `i18n-agent` à `options.tsx` / popup (pas seulement banner). |
| **Acceptation** | [ ] Options en EN si `agent_ui_lang=en` [ ] FR défaut inchangé |
| **Estimation** | S |

---

### ENG-002 · Tuning FPs post-pilote (batch)
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `engine` |
| **Type** | bug |
| **Description** | Backlog living : chaque FP pilote → test dans `test-detection.mjs` + fix règle. |
| **Acceptation** | [ ] ≥ 5 cas FP documentés et tests verts [ ] Pack republish |
| **Estimation** | M (continu) |

---

### PRX-001 · Proxy health en console (version MSI, mode effectif)
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `proxy` · `api` · `console` |
| **Type** | feature |
| **Description** | Agent proxy remonte `app_version`, mode observe/enforce **effectif**, last config epoch. Widget flotte affiche version min/max. |
| **Acceptation** | [ ] Liste agents proxy : version + mode [ ] Doc PROXY-RUNBOOK mis à jour |
| **Estimation** | M |

---

### PRX-002 · Timeline observe vs block (7/14 j)
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `console` · `api` |
| **Type** | feature |
| **Description** | Sur widget proxy ou Events : série temporelle events `source=proxy` par décision. |
| **Acceptation** | [ ] Graphique ou table jour × observe/block [ ] Filtre proxy déjà existant réutilisé |
| **Estimation** | S–M |

---

### DOC-002 · Threat model 2 pages (livrable client)
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `docs` · `security` |
| **Type** | chore |
| **Description** | Extraire FAQ due diligence → `docs/THREAT-MODEL.md` (acteurs, contrôles, hors scope). |
| **Acceptation** | [ ] MD FR (+ EN résumé) [ ] Lié STATUS + FAQ |
| **Estimation** | S |

---

### DOC-003 · DPIA template client FR/EN
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `docs` |
| **Type** | chore |
| **Description** | Template DPIA pré-rempli (finalités, minimisation metadata_only, rétention, sous-traitance). |
| **Acceptation** | [ ] Fichier utilisable en RFP [ ] Cohérent PRIVACY.md |
| **Estimation** | S |

---

### SEC-001 · AppSec baseline (SAST + deps + pen-test light)
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `ops` · `api` · `extension` |
| **Type** | security |
| **Description** | CI : `npm audit` / pnpm audit, lint secrets ; checklist pen-test 1 jour (auth, RLS, pack verify, event injection). |
| **Acceptation** | [ ] CI rouge si critical deps [ ] Rapport pen-test internal 1 page |
| **Estimation** | M |

---

### TST-001 · Smoke e2e automate
| | |
|--|--|
| **Prio** | P1 |
| **Composant** | `extension` · `api` · `console` |
| **Type** | chore |
| **Description** | Étendre `e2e-pilot.mjs` : enroll → inject text IBAN → mock detect → batch event → GET events contains rule. |
| **Acceptation** | [ ] `pnpm e2e` vert en CI locale [ ] Doc dans GUIDE-TEST |
| **Estimation** | M |

---

# P2 — Scale soft & différenciation

### CON-004 · RBAC viewer / SOC / policy-admin
| | |
|--|--|
| **Prio** | P2 |
| **Composant** | `api` · `console` |
| **Type** | feature |
| **Description** | Rôles prédéfinis : Viewer (read-only), SOC (events+risk+inbox), Policy (policy+packs), Admin full. |
| **Acceptation** | [ ] Permissions enforced API [ ] UI masque actions non autorisées |
| **Estimation** | L |

---

### CON-005 · MSP comparative table
| | |
|--|--|
| **Prio** | P2 |
| **Composant** | `console` · `api` |
| **Type** | feature |
| **Description** | Portfolio MSP : colonnes risk moyen, rewrite %, unlicensed, shadow unauth (batch lite). |
| **Acceptation** | [ ] Table triable [ ] Perf OK pour ≤ 50 orgs |
| **Estimation** | M |

---

### API-004 · Persist job `user_risk_scores`
| | |
|--|--|
| **Prio** | P2 |
| **Composant** | `api` |
| **Type** | feature |
| **Description** | Cron calcule et cache scores (table déjà prévue) pour alléger `/risk/*`. |
| **Acceptation** | [ ] Recalculate job + lecture cache [ ] Fallback live si stale |
| **Estimation** | M |

---

### API-005 · Grafana panels Risk / Shadow / Rewrite
| | |
|--|--|
| **Prio** | P2 |
| **Composant** | `ops` · `api` |
| **Type** | feature |
| **Description** | Étendre `docs/grafana/opsgate-dashboard.json` : series by decision incl. secure_rewrite, proxy block. |
| **Acceptation** | [ ] Dashboard importable [ ] Metrics Prometheus exposées |
| **Estimation** | S |

---

### EXT-003 · Secure Rewrite sur extraits Office (fichiers)
| | |
|--|--|
| **Prio** | P2 |
| **Composant** | `extension` · `engine` |
| **Type** | feature |
| **Description** | Après extract texte PDF/DOCX, proposer rewrite du texte extrait avant join (pas binaire reconstruit full). |
| **Acceptation** | [ ] Décision secure_rewrite sur file [ ] Limites documentées (pas de re-pack Office) |
| **Estimation** | L |

---

### ENG-003 · AI Trust Score (par hostname modèle)
| | |
|--|--|
| **Prio** | P2 |
| **Composant** | `engine` · `api` · `console` |
| **Type** | feature |
| **Description** | Agrégat risk/usage par outil IA (chatgpt vs claude). **Seulement si volume pilote suffisant.** |
| **Acceptation** | [ ] Spec 1 page [ ] API + mini UI |
| **Estimation** | L |

---

### PRX-003 · Allowlist hosts proxy éditable console
| | |
|--|--|
| **Prio** | P2 |
| **Composant** | `proxy` · `api` · `console` |
| **Type** | feature |
| **Description** | UI pour visualiser hosts effectifs (policy enabled_hosts ∩ allowlist proxy) + override org. |
| **Acceptation** | [ ] Liste readonly v1 puis override [ ] Sync proxy au poll |
| **Estimation** | M |

---

### DOC-004 · Case study anonyme post-pilote
| | |
|--|--|
| **Prio** | P2 |
| **Composant** | `docs` |
| **Type** | chore |
| **Description** | 1–2 pages : contexte, metrics rewrite/shadow, leçons FPs. |
| **Acceptation** | [ ] Publiable en démo décideurs |
| **Estimation** | S |

---

### V3-F / V3-G · Classification & Agent Guard
| | |
|--|--|
| **Prio** | P2+ (icebox) |
| **Composant** | multi |
| **Type** | feature |
| **Description** | **Ne pas démarrer** avant pipeline commercial + pilote. Rester dans `V3-BACKLOG.md`. |
| **Acceptation** | — icebox |
| **Estimation** | XL |

---

## Matrice par composant (vue rapide)

| Composant | P0 | P1 | P2 |
|-----------|----|----|-----|
| **ops** | OPS-001, 002, 003 | SEC-001 | — |
| **extension** | EXT-001 | EXT-002, TST-001 | EXT-003 |
| **api** | ENG-001 (partiel) | API-001..003, CON-003 | API-004, API-005 |
| **console** | ENG-001 (UI) | CON-001..003 | CON-004, CON-005 |
| **engine** | ENG-001 | ENG-002 | ENG-003 |
| **proxy** | — | PRX-001, PRX-002 | PRX-003 |
| **docs** | DOC-001 | DOC-002, DOC-003 | DOC-004 |

---

## Import Linear

1. Créer labels ci-dessus.  
2. Importer [`BACKLOG-90J-import.csv`](./BACKLOG-90J-import.csv) (CSV issues).  
3. Ou copier chaque ticket manuellement (titre = ID · Title).

## Import GitHub Issues

```bash
# Avec GitHub CLI installé et auth :
# gh issue create --title "..." --body "..." --label "P0,component:api"
```

Script d’aide (optionnel) : `scripts/create-backlog-issues.mjs` (à brancher sur `gh` si dispo).

---

## Définition de « Done » globale 90 j

- [ ] OPS-001 + OPS-002 + OPS-003 done  
- [ ] EXT-001 + ENG-001 done  
- [ ] Au moins API-002 ou API-003 (analytics loop)  
- [ ] CON-002 health strip  
- [ ] SEC-001 baseline  
- [ ] TST-001 smoke vert  

---

*OpsGate · Backlog 90j · DailyOps.Tech · 18 juillet 2026*
