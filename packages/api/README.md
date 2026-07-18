# `@opsgate/api` — Control Plane

API OpsGate (Hono). Store **memory** (défaut lab) ou **Postgres** (`DATABASE_URL`).

**Version** : 1.2.x · monorepo · multi-tenant, SSO, risk/shadow, MSP

## Run

```bash
# mémoire (quick)
pnpm api:dev

# Postgres
docker compose up -d
# PowerShell:
# $env:DATABASE_URL="postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"
pnpm api:dev
```

Default: `http://127.0.0.1:8787` · health: `GET /health`

## Domaines fonctionnels

| Domaine | Exemples de routes |
|---------|-------------------|
| Agents | enroll, config, events batch, force-sync |
| Policy / packs | policy, profiles, rule packs signés ed25519 |
| Org / MSP | summary, agents, monitoring, `msp-overview` (snapshot léger) |
| Identité | console auth, MFA, WebAuthn, OIDC/SAML |
| **V3 Risk / Shadow** | `/v1/org/risk/*`, `/v1/org/shadow-ai/*` |
| Ops | audit WORM, SIEM, metrics, backup, GDPR |

**Demo org code:** `DEMO-OPSGATE`  
**Dev admin:** header `X-OpsGate-Dev-Admin: demo` (lab)

## Config agent notable

- `policy.agent_ui_lang` : `fr` \| `en` \| `auto` (depuis monitoring org)  
- `policy.file_scan` : OCR / Office / configs  
- `policy.user_messages` : custom banner (sinon defaults i18n agent)

## Docs

- [`docs/architecture/CONTROL-PLANE.md`](../../docs/architecture/CONTROL-PLANE.md)  
- [`docs/architecture/PR1-API.md`](../../docs/architecture/PR1-API.md)  
- [`docs/GUIDE-STACK-LOCALE.md`](../../docs/GUIDE-STACK-LOCALE.md)  
- Gap produit : [`docs/STATUS-GAP-V1-V3.md`](../../docs/STATUS-GAP-V1-V3.md)
