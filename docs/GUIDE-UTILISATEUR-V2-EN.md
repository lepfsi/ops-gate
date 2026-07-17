# OpsGate — User / Admin Guide V2

**Version**: 2.1 (product 1.2 + V2 batch July 2026)  
**Maturity**: **V2 functional / pre-GA** — see [`STATUS-V2.md`](./STATUS-V2.md)  
**Language**: English  
**Audience**: console admins, security champions, trainers  

---

## 1. Introduction

OpsGate protects company data when staff use **AI websites** in the browser.  
This guide covers the **console**, **extension**, optional **proxy**, and SSO options.

For executives (CIO/CISO): see `DECIDEURS-V2-EN.md`.  
For **customer install**: `DEPLOIEMENT-CLIENT-EN.md` (+ PDF).  
For QA steps: `GUIDE-TEST-V2.md`.  
For product progress: `STATUS-V2.md`.

---

## 2. Roles

| Role | Can |
|------|-----|
| **Principal admin** | Everything (admins, policy, licenses, recovery) |
| **Console admin** | Per permissions (events, agents, policy…) |
| **End user** | Extension banner mask/block, local journal |

---

## 3. First console sign-in

1. Open the console URL (e.g. `http://127.0.0.1:5173`).  
2. Check **API OK**.  
3. Sign in with **SSO**, email/password (demo may be `admin@demo.local` / `0000`), or **passkey / Windows Hello**.  
4. If **SSO enforce** is on, only the SSO button appears.  
5. If **TOTP MFA** is enabled, enter the Authenticator code.  
6. **Session already open**: accept/refuse within 10 s, or **read-only** sign-in.  
7. **Multi-org**: pick organization; later switches require **MFA** (MSP portfolio).

Change default passwords immediately in production.

---

## 4. Dashboards & navigation

- **Dashboard**: free widgets (drag/resize), licenses, connectivity, activity, requests.  
- **MSP portfolio** (multi-org): cross-tenant KPIs, open with MFA.  
- **Messages**: user → admin inbox (reply, close, client ack).  
- **Events**: filter by decision / severity / source.  
- **Agents**: groups, profiles, maintenance, **export + CSV import**.  
- **Policy**: default action, AI hosts, department profiles.  
- **People**: users & groups (including LDAP).  
- **Moving rules**: **AND/OR** conditions, **permanent** option.  
- **Audit**: WORM journal + integrity check (principal).  
- **Settings**: monitoring, SIEM, SMTP, multi-channel notifications, LDAP, reports, backup.

**Deep links**: `#/dashboard`, `#/settings/mail`, `#/messages`, etc.  
**Force sync** pushes policy to agents on the next poll (~2 minutes).

---

## 5. Browser extension

### Install

| Browser | Build | Load |
|---------|-------|------|
| Chrome / Edge | `pnpm build:chrome` | `build/chrome-mv3-prod` |
| Firefox | `pnpm build:firefox` | `about:debugging` → manifest |
| Safari | `pnpm build:safari` | Xcode converter (Mac) |

### Daily use

1. Open an allow-listed AI site.  
2. Paste a test secret into the prompt.  
3. The **OpsGate banner** offers mask & send, send anyway (if policy allows), or cancel.  
4. Attach a file: scan **PDF / DOCX / PPTX / XLSX**; **image OCR** if policy enables it.  
5. **Contact admin** from the extension (messages).  
6. Local journal in the popup; org events when enrolled.

### Org enrollment

Options → org code (e.g. `DEMO-OPSGATE`) → enroll.  
Policy and rule pack sync automatically.

---

## 6. Local proxy (optional)

Complements the extension (HTTPS multi-AI safety net).

```powershell
pnpm proxy:gen-ca
# Trust CA
pnpm proxy:enroll
pnpm proxy:dev
```

Modes: `observe` (log only) / `enforce` (block or on-wire soft-mask).  
Windows production: `pnpm proxy:msi` (portable Node included).

---

## 7. SSO, MFA, passkeys, SAML

| Method | Where |
|--------|-------|
| OIDC | SSO button; `OPSGATE_OIDC_*` |
| SAML | `/v1/auth/saml/start`; `OPSGATE_SAML_*` (IdP signature in prod) |
| TOTP MFA | Settings → General (QR); **required for multi-org** |
| WebAuthn / passkeys | Settings → General + login button |
| LDAP | Settings → LDAP → Test / Sync / Cron |

---

## 8. Exports, alerts, backup

| Feature | Where |
|---------|-------|
| Scheduled log export (email) | Settings → Reports + SMTP |
| Test export send | **Send a test export now** |
| License / lockout / recovery alerts | Settings → Notifications (+ Telegram/Slack) |
| Org config backup | Settings → General → Export / Import |
| Postgres backup | `scripts/backup-db.ps1` (see `architecture/BACKUP.md`) |

---

## 9. Licenses (customer side)

- 30-day trial from organization creation.  
- Full license: paste the key provided by **DailyOps** (`OPS-XXXX-…`) under **Settings → License management → Add**.  
- Company / seats / expiry fields are **filled by the key** (read-only).  
- You **do not issue** licenses from the console — issuance is vendor-only (see `LICENCES-CLIENTS.md` for DailyOps ops).

---

## 10. Admin best practices

1. Durable Postgres (`DATABASE_URL`) for real pilots.  
2. Force-install the extension (MDM / AMO) + policy lock.  
3. SSO + MFA (and passkeys) for admins; multi-tenant MFA.  
4. Real SMTP for password reset / OTP / exports.  
5. Connect SIEM for the SOC.  
6. Daily DB backup + config export before upgrades.  
7. Monthly intentional secret test (control effectiveness).  
8. Never commit IdP / LDAP / SMTP / Stripe secrets.

---

## 11. Support

- Product status V2: `STATUS-V2.md`  
- Customer deployment: `DEPLOIEMENT-CLIENT-EN.md`  
- Technical trail: `CHANGELOG-TECHNIQUE.md`, `architecture/*`  
- Privacy: `PRIVACY.md`  
- Proxy runbook: `architecture/PROXY-RUNBOOK.md`  
- Licenses (vendor vs customer): `LICENCES-CLIENTS.md`  

© DailyOps.Tech — OpsGate
