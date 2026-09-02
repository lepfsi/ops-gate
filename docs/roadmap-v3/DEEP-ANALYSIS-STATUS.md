# OpsGate — Analyse approfondie fichiers & proxy

**Date** : 29 juillet 2026  
**Statut** : **T1–T5 livrés en code** · suite technique fichiers en maintenance  
**Roadmap globale** (agents, MCP, OpsVault) : [`ROADMAP-TECHNIQUE-OPSGATE.md`](./ROADMAP-TECHNIQUE-OPSGATE.md)  
**Philosophie** : *Enable AI. Secure Data.* — profondeur réelle localement, promesse honnête

---

## 1. Objectif

Rendre crédible la promesse **Data Protection** (fichiers joints aux sites IA) sans tout faire dans l’extension navigateur :

| Couche | Rôle |
|--------|------|
| **Extension** | UX (quarantine, banner, mask/rewrite), scan léger, offload proxy |
| **Proxy local (MSI)** | Moteur lourd : extract, OCR, SQLite, MITM multipart, mask format-preserving |
| **Control plane** | Policy `file_scan`, events metadata (pas le contenu brut) |

---

## 2. Livré (tranches T1–T5)

| Tranche | Capacité | Où |
|---------|----------|-----|
| **T1** | PDF texte (pdfjs) + DOCX/PPTX/XLSX (OOXML) + texte | `packages/proxy/src/content-extract.ts`, `file-scan.ts` · `POST /opsgate-proxy/scan-file` |
| **T2** | OCR images + PDF scannés (JPEG embarqués DCT) | `ocr.ts`, `pdf-images.ts` · Tesseract.js · `OPSGATE_OCR_LANG` |
| **T3** | SQLite binaire (schéma + échantillon lignes) | `sqlite-extract.ts` · sql.js WASM |
| **T4** | MITM **deep scan multipart** (même extracteurs) | `multipart-parse.ts`, `deep-body-scan.ts`, `mitm.ts`, `http2-mitm.ts` · hold max 6 Mo (`OPSGATE_PROXY_HOLD_MAX`) |
| **T5** | Mask / Secure Rewrite **format préservé** OOXML | Extension `format-preserve-mask.ts` · proxy `POST /opsgate-proxy/mask-file` |

### Comportement utile

- Extension : PDF > 30 p., échec extract, images OCR fail, `.db`/`.sqlite` → **offload proxy**
- MITM enforce : avant release, parse multipart → extract DOCX/PDF/… → block si secrets (fichiers binaires → soft-block local, pas mask on-wire illusoire)
- Mask fichiers : **DOCX / PPTX / XLSX** gardent l’extension ; PDF / images / SQLite → fallback **`.txt`**

### Smoke

```bash
pnpm --filter @opsgate/proxy smoke:scan
# OCR live optionnel :
# OPSGATE_SMOKE_OCR=1 pnpm --filter @opsgate/proxy smoke:scan
```

---

## 3. Remis à plus tard (ne pas re-ouvrir sans arbitrage)

| Sujet | Pourquoi plus tard | Epic / note |
|-------|-------------------|-------------|
| **AI Agent Protection** (runtime MCP / agents) | Hors scope **fichiers** ; planifié en **Phase 2–3** roadmap technique + OpsVault | Voir §4 + [`ROADMAP-TECHNIQUE-OPSGATE.md`](./ROADMAP-TECHNIQUE-OPSGATE.md) |
| PDF **format-preserving** redact | Complexité pdfium/lib ; mask `.txt` suffit court terme | Backlog technique |
| Access / **MDB / ACCDB** | Formats legacy ; demande rare | Backlog technique |
| OCR **en MITM** (latence hold) | OCR volontairement off sur le chemin réseau ; extension + `/scan-file` | Design T4 |
| SQLite MITM > 2 Mo | Cap latence | Design T4 |
| Legacy Office `.doc` / `.xls` / `.ppt` | Demander conversion moderne | Message UX déjà clair |
| Audio / vidéo contenu | Warning + log seulement | Policy `media_warn` |
| Classification sémantique ML | Hors DLP règles | V3-F |
| AI Trust Score modèles | Data longue durée | V3-E |

---

## 4. AI Agent Protection — hors scope de *ce* doc fichiers

**Nom produit** : *AI Agent Protection* (ex- « AI Agent Guard » / V3-G).

Ce n’est **plus un oubli** : le plan d’implémentation est dans  
**[`ROADMAP-TECHNIQUE-OPSGATE.md`](./ROADMAP-TECHNIQUE-OPSGATE.md)** :

| Phase roadmap | Contenu agent |
|---------------|---------------|
| **Phase 1** | Consolidation, API interne, Shadow typé, **tunnel OpsVault inject P1** |
| **Phase 2** | Runtime MCP, identité agent, policies contextuelles, **leases OpsVault P2** |
| **Phase 3** | Posture, discovery active, **NHI policy-export OpsVault** |

### Ce que OpsGate fait **déjà** (ne pas confondre)

| Canal | Couverture |
|-------|------------|
| Sites web IA (ChatGPT, Claude, …) | Extension + policy hosts |
| Egress HTTPS allowlist | Proxy MITM (si déployé) |
| Kill switch agent console | `ai_access: blocked` |
| Shadow AI inventaire hosts | Discovery web |
| Fichiers / deep analysis | T1–T5 (ce document) |

### Règle

Ne **pas** mélanger le backlog « fichiers » (T1–T5) avec le runtime agentique :  
finir Phase 1, **puis** Phase 2 agents/MCP + OpsVault.

---

## 5. Limites honnêtes (positionnement)

- DLP **par règles** (~pack engine), pas classification document ML  
- Pas d’eDiscovery / pas de stockage du contenu dans le control plane  
- Proxy OCR et SQLite = **local** ; MITM deep ≠ OCR complet  
- Format-preserving = **OOXML moderne** uniquement  

**Pitch crédible** : *DLP GenAI local-first + analyse fichiers sérieuse (proxy) + mask Office utilisable*.  
**Pitch à éviter** : *DLP endpoint universel / protection agents autonomes* (tant que V3-G n’est pas livré).

---

## 6. Liens

- Brief historique : [`Recommandations.md`](./Recommandations.md)  
- Backlog V3 : [`../V3-BACKLOG.md`](../V3-BACKLOG.md)  
- Gap V1–V3 : [`../STATUS-GAP-V1-V3.md`](../STATUS-GAP-V1-V3.md)  
- Journal technique : [`../CHANGELOG-TECHNIQUE.md`](../CHANGELOG-TECHNIQUE.md)  
- Gateway narrative : [`ROADMAP-AI-SECURITY-GATEWAY.md`](./ROADMAP-AI-SECURITY-GATEWAY.md)  
