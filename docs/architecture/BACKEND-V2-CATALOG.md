# Backend & produit V2 — catalogue des capacités

**Mis à jour** : 17 juillet 2026  
**Statut global** : voir [`../STATUS-V2.md`](../STATUS-V2.md)

---

## 1. Synthèse livré / partiel / suite

| Domaine | Statut | Notes |
|---------|--------|--------|
| Parser PDF + DOCX | ✅ | `office-extract.ts` (pdfjs + mammoth) |
| Parser PPTX + XLSX | ✅ | OOXML ZIP (`zip-min.ts`) |
| OCR images | ✅ | Tesseract.js eng, SW background, `scanImages` |
| Bulk export agents | ✅ | CSV/JSON console |
| Bulk import CSV agents | ✅ | `POST /v1/org/agents/import-csv` |
| Moving rules AND | ✅ | multi-conditions |
| Moving rules OR / permanent | ✅ | `conditionLogic`, `permanent` |
| Portal / billing Stripe | ✅ | Checkout + portal + webhook sièges · UI console licence |
| Backup config + DB | ✅ | `/org/backup`, `scripts/backup-db.ps1` |
| Audit WORM | ✅ | SHA-256 chain + integrity API |
| MSP multi-org | ✅ | portfolio + MFA switch |
| Export logs planifié mail | ✅ | cron + run-now |
| Session challenge / read-only | ✅ | 10 s consent |
| Passkeys UI | ✅ | Settings + login |
| Notif multi-canal | ✅ | email, Telegram, Slack, webhook |
| Inbox user→admin | ✅ | extension + console Messages |
| Deep-links console | ✅ | `hash-route.ts` |
| SIEM + metrics | ✅ | syslog + Prometheus |
| Proxy MSI | ✅ | |
| SSO OIDC/SAML | ✅ | |
| LDAP + cron | ✅ | |
| Doc déploiement client | ✅ | `DEPLOIEMENT-CLIENT*.md/.pdf` |
| Soft-delete org GDPR | ✅ | export + soft-delete + restore + hard purge |

---

## 2. API — surfaces clés

| Surface | Paths / modules |
|---------|-----------------|
| Auth | login, MFA, OIDC, SAML, WebAuthn, session challenge, switch-org |
| Org | policy, profiles, groups, users, agents, bulk-assign, import-csv |
| Moving | `/org/moving-rules` (+ apply-all) |
| Events | list, export, archives, scheduled export |
| Audit | `/org/audit`, `/org/audit/integrity` |
| Backup | `/org/backup`, `/org/backup/import` |
| Billing | `/billing/status`, `/billing/checkout` |
| Vendor | licences, status (secret dual-key) |
| Observability | `/health`, `/metrics`, SIEM forward |

---

## 3. Formats fichiers scannés (extension)

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

---

## 4. Import CSV agents

Colonnes (header, séparateur `,` ou `;`) :

```
agent_id,device_label,host_name,group,profile,license
,PC-FIN-01,,Finance,Strict,yes
```

- Match : `agent_id` **ou** `device_label` **ou** `host_name` (agent déjà enrollé)
- `group` / `profile` : nom ou `group_id` / `profile_id`
- `license` : yes/no/true/false/1/0  
- Dry-run : `{ "csv": "...", "dry_run": true }`

---

## 5. Moving rules

| Champ | Effet |
|-------|--------|
| `condition_logic: and\|or` | Toutes les cond. / au moins une |
| `only_if_unassigned` | Skip si déjà groupé |
| `permanent: true` | Force assign même si déjà groupé |

---

## 6. Stripe (portal personnel)

```
OPSGATE_STRIPE_SECRET_KEY=sk_…
OPSGATE_STRIPE_PUBLISHABLE_KEY=pk_…
OPSGATE_STRIPE_PRICE_SEAT=price_…
OPSGATE_STRIPE_WEBHOOK_SECRET=whsec_…
OPSGATE_CONSOLE_URL=https://…
```

| Endpoint | Rôle |
|----------|------|
| `GET /v1/billing/status` | Public + enrichi si session console |
| `POST /v1/billing/checkout` | `{ quantity }` → Checkout Session (principal) |
| `POST /v1/billing/portal` | Customer Portal (après 1er checkout) |
| `POST /v1/billing/webhook` | Signature Stripe → sièges + `monitoring.stripeBilling` |

UI console : **Paramètres → Gestion des licences** (bloc Abonnement Stripe).  
Events Dashboard à brancher : `checkout.session.completed`, `customer.subscription.*`.

---

## 7. Docs associées

| Doc | Rôle |
|-----|------|
| [`../STATUS-V2.md`](../STATUS-V2.md) | Statut une page |
| [`../V2-BACKLOG.md`](../V2-BACKLOG.md) | Backlog priorisé |
| [`../DEPLOIEMENT-CLIENT.md`](../DEPLOIEMENT-CLIENT.md) | Install client |
| [`../CHANGELOG-TECHNIQUE.md`](../CHANGELOG-TECHNIQUE.md) | Journal dev |
| [`AUDIT-WORM.md`](./AUDIT-WORM.md) | Intégrité audit |
| [`BACKUP.md`](./BACKUP.md) | Backups |
| [`SECRET-ROTATION.md`](./SECRET-ROTATION.md) | Dual-key secrets |
