# Backend V2 — catalogue des capacités (17/07/2026)

## Livré / partiel

| Domaine | Statut | Notes |
|---------|--------|--------|
| **Parser PDF + DOCX** | ✅ | `office-extract.ts` (pdfjs + mammoth) |
| **Parser PPTX + XLSX** | ✅ | OOXML ZIP minimal (`zip-min.ts`) |
| **OCR images** | ✅ | `scanImages` : Tesseract.js local (PNG/JPEG/WebP…) + SVG texte ; max 4 Mo / 1600 px |
| **Bulk export agents** | ✅ | CSV/JSON console |
| **Bulk import CSV agents** | ✅ | `POST /v1/org/agents/import-csv` |
| **Moving rules AND** | ✅ | multi-conditions V1.x |
| **Moving rules OR / permanent** | ✅ | `conditionLogic`, `permanent` |
| **Portal / billing Stripe** | ◐ | Fondations `billing-stripe.ts` + checkout (env keys) |
| **Backup config + DB** | ✅ | `/org/backup`, `scripts/backup-db.ps1` |
| **Audit WORM** | ✅ | chaîne SHA-256 |
| **MSP multi-org** | ✅ | portfolio + MFA switch |
| **Export logs planifié mail** | ✅ | cron + run-now |

## Formats fichiers scannés (extension)

| Format | Extraction |
|--------|------------|
| PDF | pdfjs |
| DOCX | mammoth |
| PPTX | OOXML slides XML |
| XLSX / XLSM | sharedStrings + sheets |
| TXT / code / conf | lecture directe |
| SVG (si scanImages) | texte XML |
| PNG/JPEG/WebP/… | OCR Tesseract.js (si `scanImages`) |
| doc/xls/ppt legacy | non supporté → warn |

## Import CSV agents

Colonnes (header, séparateur `,` ou `;`) :

```
agent_id,device_label,host_name,group,profile,license
,PC-FIN-01,,Finance,Strict,yes
```

- Match : `agent_id` **ou** `device_label` **ou** `host_name` (agent déjà enrollé)
- `group` / `profile` : nom ou `group_id` / `profile_id`
- `license` : yes/no/true/false/1/0

Dry-run : `{ "csv": "...", "dry_run": true }`

## Moving rules

| Champ | Effet |
|-------|--------|
| `condition_logic: and\|or` | Toutes les cond. / au moins une |
| `only_if_unassigned` | Skip si déjà groupé |
| `permanent: true` | Force assign même si déjà groupé |

## Stripe (V2.1)

```
OPSGATE_STRIPE_SECRET_KEY=sk_…
OPSGATE_STRIPE_PUBLISHABLE_KEY=pk_…
OPSGATE_STRIPE_PRICE_SEAT=price_…
OPSGATE_CONSOLE_URL=https://…
```

- `GET /v1/billing/status`
- `POST /v1/billing/checkout` `{ quantity }` → URL Checkout
