# OpsGate — Analyse approfondie fichiers & proxy

**Date** : 25 juillet 2026  
**Statut** : **T1–T5 livrés en code** · suite explicitement **remisée**  
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
| **AI Agent Protection** (agents autonomes, outils API, hors navigateur web) | Périmètre product + data-plane différent (pas SPA file input) ; V3-G | **V3-G** — voir §4 |
| PDF **format-preserving** redact | Complexité pdfium/lib ; mask `.txt` suffit court terme | Backlog technique |
| Access / **MDB / ACCDB** | Formats legacy ; demande rare | Backlog technique |
| OCR **en MITM** (latence hold) | OCR volontairement off sur le chemin réseau ; extension + `/scan-file` | Design T4 |
| SQLite MITM > 2 Mo | Cap latence | Design T4 |
| Legacy Office `.doc` / `.xls` / `.ppt` | Demander conversion moderne | Message UX déjà clair |
| Audio / vidéo contenu | Warning + log seulement | Policy `media_warn` |
| Classification sémantique ML | Hors DLP règles | V3-F |
| AI Trust Score modèles | Data longue durée | V3-E |

---

## 4. AI Agent Protection (reporté)

**Nom produit** : *AI Agent Protection* (aligné roadmap « AI Agent Guard » / V3-G).

### Ce que ça voudrait dire

Protéger les **agents IA hors navigateur** et les canaux non couverts par l’extension SPA :

- CLI / IDE agents (Cursor, Claude Code, copilots locaux)
- Appels API LLM depuis backends métier
- Outils MCP / function-calling qui exfiltrent des fichiers ou secrets
- Desktop apps IA hors allowlist navigateur

### Ce que OpsGate fait **déjà** (ne pas confondre)

| Canal | Couverture |
|-------|------------|
| Sites web IA (ChatGPT, Claude, …) | Extension + policy hosts |
| Egress HTTPS allowlist | Proxy MITM (si déployé) |
| Kill switch agent console | `ai_access: blocked` (endpoint / extension) |
| Shadow AI inventaire hosts | Discovery web |

### Pourquoi ce n’est **pas** la suite immédiate de T1–T5

1. T1–T5 sécurisent le **chemin fichier + web UI** — gap commercial le plus douloureux.  
2. Agent Protection exige un **autre data-plane** (hooks process, SDK, reverse-proxy API, ou agent desktop).  
3. Risque de dispersion avant GA (stores / pilote / packaging).

### Quand le rouvrir

- Gate pre-GA franchie (distribution + pilote)  
- Demande client explicite « agents IDE / API »  
- Spécification dédiée (périmètre, OS, privacy) avant code  

**Statut backlog** : **V3-G — remisé** (priorité P2/P3, effort élevé).  
Ne pas démarrer d’implémentation sans arbitrage produit.

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
