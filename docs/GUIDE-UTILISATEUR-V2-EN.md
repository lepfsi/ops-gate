# OpsGate — User / Admin Guide V2

**Version**: 2.0 (product 1.2 + V2 capabilities)  
**Language**: English  
**Audience**: console admins, security champions, trainers  

---

## 1. Introduction

OpsGate protects company data when staff use **AI websites** in the browser.  
This guide covers the **console**, **extension**, optional **proxy**, and SSO options.

For executives (CIO/CISO): see `DECIDEURS-V2-EN.md`.  
For QA steps: `GUIDE-TEST-V2.md`.

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
3. Sign in with **SSO** (if configured) or email/password (demo seed may be `admin@demo.local` / `0000`).  
4. If **SSO enforce** is on, only the SSO button appears.  
5. If **TOTP MFA** is enabled, enter the Authenticator code.

Change default passwords immediately in production.

---

## 4. Dashboards

- **Overview**: online agents, events, licenses.  
- **Events**: filter by decision / severity / source.  
- **Agents**: groups, profiles, maintenance, export.  
- **Policy**: default action, AI hosts, department profiles.  
- **People**: users & groups (including LDAP import).  
- **Settings**: monitoring, SIEM, quotas, LDAP, PDF reports.

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
4. Local journal in the popup; org events when enrolled.

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
| SAML | `/v1/auth/saml/start`; `OPSGATE_SAML_*` |
| TOTP MFA | Settings while signed in |
| WebAuthn | Passkey register/login APIs |
| LDAP | Settings → LDAP → Test / Sync / Cron |

---

## 8. Licenses (customer side)

- 30-day trial from organization creation.  
- Full license: paste the key provided by **DailyOps** (`OPS-XXXX-…`) under **Settings → License management → Add**.  
- Company / seats / expiry fields are **filled by the key** (read-only).  
- You **do not issue** licenses from the console — issuance is vendor-only (see `LICENCES-CLIENTS.md` for DailyOps ops).

---

## 9. Admin best practices

1. Durable Postgres (`DATABASE_URL`) for real pilots.  
2. Force-install the extension (MDM / AMO) + policy lock.  
3. SSO + MFA for admins.  
4. Connect SIEM for the SOC.  
5. Monthly intentional secret test (control effectiveness).  
6. Never commit IdP or LDAP bind secrets.

---

## 10. Support

- Technical trail: `CHANGELOG-TECHNIQUE.md`, `architecture/*`  
- Privacy: `PRIVACY.md`  
- Proxy runbook: `architecture/PROXY-RUNBOOK.md`  
- Licenses (vendor vs customer): `LICENCES-CLIENTS.md`  

© DailyOps.Tech — OpsGate
