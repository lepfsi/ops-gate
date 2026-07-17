# OpsGate — Customer installation & deployment

**Audience**: integrators, system admins, pilot CIO/CISO teams  
**Product version**: 1.2 / V2 batch  
**Goal**: deploy OpsGate **at the customer site** (not only local lab)

> This is the **deployment entry point**.  
> User guides cover **day-to-day console use**; this doc covers **what to install, where, and in which order**.

| Related doc | Content |
|-------------|---------|
| [`FAQ-DEPLOIEMENT-V2.md`](./FAQ-DEPLOIEMENT-V2.md) | MSI / licenses / pilot phases (FR) |
| [`GUIDE-STACK-LOCALE.md`](./GUIDE-STACK-LOCALE.md) | Single-machine Docker lab |
| [`architecture/CHROME-WEB-STORE-MDM.md`](./architecture/CHROME-WEB-STORE-MDM.md) | Chrome/Edge force-install |
| [`architecture/FIREFOX-AMO.md`](./architecture/FIREFOX-AMO.md) | Firefox enterprise |
| [`architecture/PROXY-PROD-WINDOWS.md`](./architecture/PROXY-PROD-WINDOWS.md) | Proxy MSI production |
| [`architecture/BACKUP.md`](./architecture/BACKUP.md) | Backups |
| [`LICENCES-CLIENTS.md`](./LICENCES-CLIENTS.md) | License activation (customer side) |

---

## 1. Overview — what runs where

```
                    AT THE CUSTOMER
┌─────────────────────────────────────────────────────────────┐
│  MANAGEMENT SERVER (or cloud / VM)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Postgres    │  │ OpsGate API │  │ Console (static)    │ │
│  │ (durable)   │◄─│ :443 / TLS  │◄─│ HTTPS              │ │
│  └─────────────┘  └──────▲──────┘  └─────────────────────┘ │
└──────────────────────────│──────────────────────────────────┘
                           │ HTTPS (enroll, sync, events)
         ┌─────────────────┴─────────────────┐
         ▼                                   ▼
┌─────────────────────┐           ┌─────────────────────┐
│ END-USER PCs        │           │ OPTIONAL            │
│ Browser extension   │           │ Local proxy MSI     │
│ Chrome / Edge / FF  │           │ multi-AI MITM       │
└─────────────────────┘           └─────────────────────┘
```

| Component | Where | Required? |
|-----------|--------|-----------|
| **Postgres** | Management server | **Yes** in prod (otherwise data loss) |
| **API** | Management server | **Yes** for org mode |
| **Console** | Server / CDN / reverse proxy | **Yes** to administer |
| **Extension** | Every user PC | **Yes** (core product) |
| **Local proxy MSI** | Endpoints (or GPO) | **Optional** (HTTPS safety net) |

**Golden rule**: the extension **never** talks to Postgres directly. It only talks to the **API URL** (HTTPS in production).

---

## 2. Deployment scenarios

| Scenario | Description | Audience |
|----------|-------------|----------|
| **A. Single-PC lab** | Everything on `127.0.0.1` | Dev / demo |
| **B. Customer pilot (recommended)** | 1 API+DB server + N extension PCs (+ optional proxy) | First customer |
| **C. Production** | TLS, strong secrets, MDM force-install, backups, SMTP | Durable rollout |

This guide details **B**, then **C** hardening. For pure lab, see also [`GUIDE-STACK-LOCALE.md`](./GUIDE-STACK-LOCALE.md).

---

## 3. Prerequisites

### 3.1 Management server

- OS: Linux (recommended) or Windows Server / Windows 11 with Docker  
- **Node.js 20+** and **pnpm**  
- **Docker** (Postgres) **or** managed Postgres  
- Ports:
  - **5432** Postgres (ideally **not** on the public Internet)
  - **8787** API (dev) → production: **443** via reverse proxy  
  - **5173** console dev → production: static files + HTTPS  
- Outbound SMTP if emails (OTP, exports, alerts)

### 3.2 User PCs

- Windows 10/11 (or macOS/Linux for extension-only)  
- Chrome **or** Edge (Firefox supported)  
- Admin rights **only** for proxy MSI / GPO force-install

### 3.3 Deliverables from DailyOps / integrator

- Organization code (e.g. `ACME-2026`) or DEMO seed for pilot  
- Full license key if outside trial (`OPS-XXXX-…`)  
- Public HTTPS API URL (e.g. `https://opsgate.customer.tld`)  
- Optional: SSO, SMTP, SIEM secrets

---

## 4. Phase 1 — Control plane (server)

### Step 1.1 — Get the code / package

```powershell
cd ops-gate
pnpm install
```

### Step 1.2 — Durable Postgres

```powershell
docker compose up -d
docker compose ps
```

**Production**: use managed Postgres (RDS, Azure PG, etc.) with a strong `DATABASE_URL`.

### Step 1.3 — API environment

Create `.env` from `.env.example` (never commit secrets):

```bash
DATABASE_URL=postgres://USER:PASS@HOST:5432/opsgate
NODE_ENV=production
PORT=8787

OPSGATE_SETUP_EMAIL=admin@customer.tld
OPSGATE_SETUP_PASSWORD=StrongPassword≥8chars
OPSGATE_VENDOR_RECOVERY=LongUniqueSecret…

OPSGATE_CONSOLE_URL=https://console.customer.tld
OPSGATE_API_PUBLIC_URL=https://api.customer.tld
# + SMTP as needed
```

Without `DATABASE_URL` → **memory** store: **all data lost on restart**. Forbidden for customers.

### Step 1.4 — Start the API

```powershell
pnpm --filter @opsgate/api start
# lab: pnpm api:dev
```

```powershell
curl https://api.customer.tld/health
# expect store=postgres
```

### Step 1.5 — Admin console

**Lab**: `pnpm console:dev` → `http://127.0.0.1:5173`  

**Production**:

```powershell
pnpm --filter @opsgate/console build
# Serve packages/console/dist over HTTPS
```

Point the console API base URL to `https://api.customer.tld`.

### Step 1.6 — TLS reverse proxy (prod)

- `https://api.customer.tld` → `http://127.0.0.1:8787`  
- `https://console.customer.tld` → console static files  

---

## 5. Phase 2 — First business setup

1. Open **console** → sign in.  
2. **Change password** immediately.  
3. Enable **TOTP MFA** (Settings → General) — required if multi-org.  
4. Note the **organization code**.  
5. (Optional) Activate full license key from DailyOps.  
6. Set **policy** → **Force sync**.  
7. Configure **SMTP** + send test.  
8. (Optional) Notifications, SIEM, scheduled export, config backup.

Server-ready checklist:

- [ ] `/health` -> `store=postgres`
- [ ] Console login OK + password changed
- [ ] Org code shared to endpoints
- [ ] HTTPS reachable from a user PC
- [ ] Postgres backup scheduled

---

## 6. Phase 3 — Extension on endpoints

### 6.1 Pilot (sideload, 1–20 PCs)

```powershell
pnpm build:chrome
# Load build/chrome-mv3-prod as unpacked extension
```

Firefox: `pnpm build:firefox` → temporary add-on via `about:debugging`.

### 6.2 Production (force-install)

| Browser | Method |
|---------|--------|
| Chrome / Edge | Store (unlisted) + **MDM/GPO** force-install list |
| Firefox | AMO + `policies.json` |

```powershell
pnpm store:chrome
pnpm store:firefox
```

See MDM templates under `dist/chrome-store/mdm/` after packaging.

### 6.3 Org enrollment (each PC / profile)

1. OpsGate extension **Options**.  
2. **API URL** = `https://api.customer.tld` (not `127.0.0.1` unless single-PC lab).  
3. **Org code**.  
4. Device label.  
5. **Enroll**.  

Expected: managed mode, policy received, agent visible in Console → Agents.

### 6.4 Smoke test

1. Open an AI site.  
2. Paste a **test secret**.  
3. OpsGate **banner** appears.  
4. Console → **Events** shows a row.

---

## 7. Phase 4 — Local proxy (optional)

```powershell
msiexec /i dist\opsgate-proxy-1.2.0.msi /qn
```

Trust CA, enroll proxy to same API/org code, configure PAC/GPO.  
Details: `architecture/PROXY-PROD-WINDOWS.md`.

**Note**: proxy ≠ orange banner. UI banner remains the **extension**.

---

## 8. Go-live order (summary)

```
1. Postgres UP
2. API UP (store=postgres) + TLS
3. Console UP + first admin + password + MFA
4. Policy + license
5. Extension on 1 pilot PC + enroll
6. Secret test → event in console
7. Fleet extension (MDM)
8. (Optional) Proxy MSI
9. SMTP / alerts / SIEM / backups
```

---

## 9. Network & firewall

| Flow | Source | Destination | Port |
|------|--------|-------------|------|
| Enroll / sync / events | Endpoints | Customer API | 443 |
| Admin console | Admin PCs | Console | 443 |
| API → Postgres | API host | DB | 5432 (private) |
| API → SMTP / SIEM | API host | Mail / SIEM | as configured |

**Do not** expose Postgres on the Internet.

---

## 10. Production security checklist

- [ ] `NODE_ENV=production`
- [ ] Strong `DATABASE_URL`
- [ ] Strong setup password + vendor recovery
- [ ] TLS on API and console
- [ ] Admin MFA enabled
- [ ] No `OPSGATE_ALLOW_DEV_ADMIN`
- [ ] Daily Postgres backup + restore test
- [ ] Config export before upgrades
- [ ] Secret rotation documented

---

## 11. Customer go validation

| # | Test | OK |
|---|------|----|
| 1 | `GET /health` -> `store=postgres` | [ ] |
| 2 | Console login + password change | [ ] |
| 3 | Enrolled agent visible | [ ] |
| 4 | Force sync applies policy change | [ ] |
| 5 | Detection event in console | [ ] |
| 6 | API restart **keeps** agents/admins | [ ] |
| 7 | Backup exists | [ ] |

```powershell
pnpm api:validate-pg
```

---

## 12. Common incidents

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Extension stays *local_only* | Wrong API URL / org code | Check Options + `/health` from PC |
| Empty events | Not enrolled / reporting off | Enroll + policy + test secret |
| Data loss on restart | Memory store | Set `DATABASE_URL` |
| Pack verify failed | Signing keys / API down | Check API + ed25519 keys |
| Proxy MSI no effect | No PAC / CA untrusted | GPO PAC + Root store |

---

## 13. Support

- User guide: [`GUIDE-UTILISATEUR-V2-EN.md`](./GUIDE-UTILISATEUR-V2-EN.md)  
- Decision makers: [`DECIDEURS-V2-EN.md`](./DECIDEURS-V2-EN.md)  
- FAQ: [`FAQ-DEPLOIEMENT-V2.md`](./FAQ-DEPLOIEMENT-V2.md)  

Contact: **contact@dailyops.tech** — include org code, API version (`/health`), browser.

---

*OpsGate · Customer deployment guide · DailyOps.Tech · July 2026*
