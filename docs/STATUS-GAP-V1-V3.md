# OpsGate — Gap analysis V1 → V3 (ce qui reste pour finir)

**Date** : 18 juillet 2026  
**Public** : concepteur / produit / ops  
**But** : une page pour prioriser la finition (pre-GA → GA → V3 polish)

---

## 1. Carte de maturité (vue d’ensemble)

```
V1  ████████████████████  DLP extension + control plane + engine     ≈ DONE
V2  ██████████████████░░  Enterprise (proxy, SSO, MSP, stores kit)   pre-GA
V3  ████████████░░░░░░░░  Différenciation (Rewrite, Risk, Shadow)    P0 code · polish
GA  ░░░░░░░░░░░░░░░░░░░░  Stores live + pilote + Stripe prod         BLOQUANT commercial
```

| Train | Contenu | Bloquant commercial ? |
|-------|---------|------------------------|
| **V1** | Extension, engine, API, console basique, packs | Non (socle) |
| **V2** | Proxy MSI, SSO/MFA, multi-tenant, WORM, packaging stores | **Oui** si pas de canal de distribution |
| **V3-P0** | Secure Rewrite, Risk prompt, Shadow AI + risk user | Non (différenciateur démo) |
| **V3 suite** | Analytics Risk, Trust Score, classification… | Non (roadmap) |

---

## 2. Ce qui est **livré** (ne plus re-spécifier)

### V1 / socle
- Extension MV3 multi-navigateurs (build)  
- Moteur règles + mask + (V3) Secure Rewrite  
- Enroll, policy, packs signés, events  
- Console policy / agents / events / audit  

### V2 enterprise
- Proxy MITM Windows (MSI), soft-block  
- Postgres + RLS, MSP multi-org  
- MFA TOTP, passkeys, OIDC/SAML  
- Audit WORM, backup, SIEM, Prometheus  
- Kit `pnpm store:all` + docs MDM  
- Stripe portal (code), soft-delete GDPR  
- Scan Office étendu + OCR (policy)  

### V3 P0 (code 17–18/07)
- Secure Rewrite + modal  
- Risk score prompt + Simulation  
- Shadow AI inventaire + risk utilisateurs  
- UX banner / MSP / file scan profils / i18n agents  

---

## 3. Ce qui **manque** pour annoncer **V2.0 GA**

| Item | Type | Effort | Notes |
|------|------|--------|-------|
| Listing **CWS** (unlisted ou public) en review acceptée | Ops | Moyen | Artefacts monorepo prêts |
| Listing **AMO** Firefox | Ops | Moyen | Idem |
| Safari App Store (si cible) | Ops + Mac | Élevé | Prep monorepo ; compte Apple |
| **Pilote client** checklist DEPLOIEMENT §11 | Commercial | Variable | Feedback terrain obligatoire |
| Stripe **clés prod** + webhook Dashboard | Ops | Faible | Ou process licence vendor seul |
| SAML validé sur IdP client (ADFS/Okta/…) | Intégration | Moyen | C14N / metadata par client |
| PDF guides régénérés (FR/EN) après features V3 | Doc | Faible | `pnpm docs:pdf:*` |

Sans stores **ou** MDM documenté chez un pilote, on reste **pre-GA**.

---

## 4. Ce qui **manque** pour une **V3.0** « finie » (après P0)

| Item | Epic | Priorité | Notes |
|------|------|----------|-------|
| Meta `prompt_risk_score` dans events API | V3-B | P1 | Journal / analytics |
| Alertes risk > seuil + notif | V3-D | P1 | Console + canaux existants |
| Dashboard Risk tendances / export | V3-D | P1 | Wireframes |
| Persist job `user_risk_scores` | V3-C | P2 | Live suffit pour V1 |
| Grafana panel Risk/Shadow | V3-D | P2 | JSON dashboard existant à étendre |
| AI Trust Score (par modèle) | V3-E | P2 | Data longue durée |
| Classification multi-niveau | V3-F | P3 | Légal + UX |
| AI Agent Guard (hors navigateur) | V3-G | P3 | Trop tôt |

---

## 5. Dettes techniques / polish (courtes, haute valeur)

| Zone | Problème | Action |
|------|----------|--------|
| `summary()` API | Lourd (purge, top rules, licence par agent) | Garder snapshot léger (MSP) ; optionnellement lazy summary dashboard |
| Events extension MV3 | SW peut mourir avant flush | Continuer fiabilisation journal / keepalive |
| Packs org | Peuvent stagner vs engine | Script `scripts/republish-engine-pack.mjs` + process console |
| Nested `ops-gate/ops-gate` | Copie locale accidentelle | **Ne pas commit** (gitignore) |
| Tests e2e automatisés | Peu de couverture UI | Étendre `e2e-pilot` / smoke |
| Docs PDF | MD à jour, PDF parfois en retard | Rebuild avant livraison client |

---

## 6. Ordre de finition recommandé

```
A. Ops pre-GA (bloquant vente)
   1. Canal distribution (CWS unlisted OU MDM client documenté)
   2. Pilote §11 DEPLOIEMENT
   3. Licence : vendor OU Stripe prod

B. Polish produit (crédibilité)
   4. ~~Dashboard widgets V3 + rapport PDF § Risk/Shadow/Rewrite~~ (18/07)
   5. Rebuild PDF décideurs/déploiement (`pnpm docs:pdf:v2`)
   6. Meta risk events + alertes score
   7. Dashboard Risk analytics V3-D étendu

C. Suite V3 (après GA)
   8. Trust Score / classification / Agent Guard
```

---

## 7. Liens

| Doc | Rôle |
|-----|------|
| [`STATUS-V2.md`](./STATUS-V2.md) | Statut pre-GA |
| [`RELEASE-v2.md`](./RELEASE-v2.md) | Cut V2 |
| [`RELEASE-v3.md`](./RELEASE-v3.md) | Cut V3 P0 |
| [`V2-BACKLOG.md`](./V2-BACKLOG.md) | Reste V2 |
| [`V3-BACKLOG.md`](./V3-BACKLOG.md) | Epics V3 |
| **[`BACKLOG-90J-P0-P2.md`](./BACKLOG-90J-P0-P2.md)** | **Tickets actionnables 90 j (P0–P2)** |
| [`BACKLOG-90J-import.csv`](./BACKLOG-90J-import.csv) | Import Linear / CSV |
| [`DEPLOIEMENT-CLIENT.md`](./DEPLOIEMENT-CLIENT.md) | Livrable client |
| [`DECIDEURS-V2-FR.md`](./DECIDEURS-V2-FR.md) | Pitch décideurs |

---

*OpsGate · STATUS-GAP · DailyOps.Tech · 18 juillet 2026*
