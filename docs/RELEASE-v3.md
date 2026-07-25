# OpsGate **V3** — Différenciation produit (cut partiel)

**Date** : 25 juillet 2026 (maj deep analysis)  
**Version code monorepo** : **1.2.x** (features V3 P0 + deep analysis T1–T5 sur socle V2)  
**Statut** : **V3-P0 functional** + **file/proxy deep analysis livré** · V3-G AI Agent Protection **remisé**  
**Synthèse globale** : [`STATUS-V2.md`](./STATUS-V2.md) · **backlog** : [`V3-BACKLOG.md`](./V3-BACKLOG.md) · **deep analysis** : [`roadmap-v3/DEEP-ANALYSIS-STATUS.md`](./roadmap-v3/DEEP-ANALYSIS-STATUS.md)

---

## En une phrase

La V3 transforme OpsGate de « DLP léger pour l’IA » en **plateforme d’AI security** démo-ready : **Secure Rewrite**, **risk**, **Shadow AI**, et une **analyse fichiers / proxy** crédible (PDF, Office, OCR, SQLite, MITM multipart, mask OOXML).

---

## Périmètre V3 P0 — état (18/07 → 25/07/2026)

| Epic | Contenu | Statut |
|------|---------|--------|
| **V3-A Secure Rewrite** | Anonymisation intelligente 1 clic, preview, events `secure_rewrite` | ✅ **Livré** |
| **V3-B Risk prompt + Simulation** | Score 0–100, bandeau, auto-sim ≥ seuil | ✅ **Livré** (meta event optionnelle suite) |
| **V3-C Shadow AI + Risk user** | Inventaire outils, scores agents, console `#/risk` + `#/shadow` | ✅ **Livré** |
| **Deep analysis T1–T5** | Proxy scan + OCR + SQLite + MITM deep + mask format-preserving | ✅ **Livré** (25/07) |
| **V3-D Dashboard Risk analytics** | Alertes seuil, Grafana, export | ⬜ Suite |
| **V3-E / F** | Trust Score modèles, classification | ⬜ Plus tard |
| **V3-G AI Agent Protection** | Agents hors navigateur (IDE, API, MCP…) | ⏸️ **Remisé** |

---

## Compléments livrés avec le lot V3 (maturité UX / fiabilité)

| Sujet | Notes |
|-------|--------|
| Banner extension redesign | Toolbar pills, CTA Secure Rewrite, danger discret |
| Langue agents (`agent_ui_lang`) | `fr` / `en` / `auto` — indépendante de la console admin |
| Portfolio MSP densifié | KPI offline, events 7j, attention ; API snapshot léger (plus de `summary()` N×) |
| IBAN | Checksum + patterns espacés ; packs republishables ; keyword non obligatoire |
| Policy file scan | Org + **profils** (OCR/images, Office, configs…) |
| Risk list pagination | 20 users / page |
| Dashboard soft refresh | Pas de flash « chargement » si cache summary |
| Deep analysis proxy | `/scan-file`, `/mask-file`, OCR, SQLite, MITM multipart deep |
| Mask Office format-preserving | DOCX/PPTX/XLSX (fallback `.txt` PDF/images) |

---

## Versioning

| Élément | Valeur |
|---------|--------|
| `package.json` monorepo | `1.2.0` |
| `@opsgate/engine` / api / console / proxy | `1.2.0` |
| Maturité marketing | **V2 pre-GA** + **V3-P0 functional** (features démo) |
| Prochaine cut marketing | **V2.0 GA** (stores + pilote) puis **V3.0** (gate analytics + polish) |

Convention : le **numéro semver monorepo** reste 1.2.x tant que la distribution GA n’est pas annoncée ; les epics V3 sont des **capabilities** sur ce train.

---

## Docs associées

| Public | Document |
|--------|----------|
| Concepteur | [`CAHIER-CONCEPTEUR.md`](./CAHIER-CONCEPTEUR.md) · [`CHANGELOG-TECHNIQUE.md`](./CHANGELOG-TECHNIQUE.md) |
| Client déploiement | [`DEPLOIEMENT-CLIENT.md`](./DEPLOIEMENT-CLIENT.md) (+ PDF) |
| Décideurs | [`DECIDEURS-V2-FR.md`](./DECIDEURS-V2-FR.md) (+ PDF) — section V3 différenciation |
| Gap finition | [`STATUS-GAP-V1-V3.md`](./STATUS-GAP-V1-V3.md) |

---

*OpsGate · RELEASE-v3 · DailyOps.Tech · 18 juillet 2026*
