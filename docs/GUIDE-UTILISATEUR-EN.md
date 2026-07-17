# OpsGate - User Guide (V1)

**Audience**: console administrators, pilots, support 
**Product version**: 1.2 / V2 batch (July 2026) 
**Language**: English 

This guide covers day-to-day OpsGate use: extension, console, enrollment, policies, licenses, logs, messages, MFA, and recovery. 
For local technical setup (Docker, ports), see also [`GUIDE-STACK-LOCALE.md`](./GUIDE-STACK-LOCALE.md). 
Richer V2 guide: [`GUIDE-UTILISATEUR-V2-EN.md`](./GUIDE-UTILISATEUR-V2-EN.md).

---

## 1. Overview

| Component | Role |
|-----------|------|
| **Extension** | Detects sensitive data on AI sites, applies policy, logs decisions |
| **API (control plane)** | Enrollment, policy/pack sync, events, console authentication |
| **Console** | Administration: dashboard, policy, agents, packs, events, audit |
| **Postgres** | Durable storage (recommended for pilot / production) |

Without **Postgres**, the API uses an in-memory store: **all data is lost on restart**.

---

## 2. First console sign-in

1. Start the API (and Postgres if used).
2. Open the console (e.g. `http://127.0.0.1:5173`).
3. Sign in with the principal email and install password.
4. Change the password on first login if prompted.

**Advanced (login)**: the API URL field is hidden by default; enable it only to point at another instance.

**Concurrent session**: if another browser is already signed in, the open session gets a prompt (accept / refuse). With no response within **10 s**, the session is released. Alternative: **read-only** (view only, no changes).

**Passkey / Windows Hello**: button on the login screen (after registration under Settings → General).

**Wrong password**: the message shows how many attempts remain. After too many failures, the account is **locked** - a principal admin unlocks it under *Admins & groups*.

**Multi-organization (MSP)**: same email on several orgs → org picker at login; switch requires **MFA code**; **MSP portfolio** for a consolidated view.

---

## 3. Enrollment (extension)

### Organization

1. OpsGate extension options.
2. Enter the **API URL** and **organization code** (e.g. `DEMO-OPSGATE`).
3. Name the device (label).
4. **Enroll**.

After a successful sync:

- policies are **managed** by the org (not editable locally);
- protection stays active offline with the **last policy** received.

### Personal

Personal license key → personal mode (no org telemetry to the console).

### Unenroll

If policy requires it: admin identifier + password. 
Vendor recovery: principal / support only (see §8).

---

## 4. Dashboard

Fleet overview: licenses, connected agents, decisions, top threats, user requests.

- **Movable / resizable** widgets (local preference).
- Click an indicator for detail (agent list or logs).
- **Expand**: full-screen dashboard (Esc to exit).
- **Force sync**: pushes config to online agents (effect within ~2 min).
- Deep links: `#/policy`, `#/agents`, `#/settings/mail`, etc.

---

## 5. Policy

### Default org policy

Applies to **licensed** agents without a specific profile / group.

- **AI sites**: catalog by groups + custom sites 
- **Default action**: `warn` | `mask_recommend` | `mask_force` | `block` 
- **Event collection**: on/off 
- **User messages**: banner texts (optional)

Save then **Sync** (or wait for poll ≤ 2 min).

### Department policies (profiles)

1. Create a profile (e.g. Finance). 
2. Assign via **groups** (or agent). 
3. Agents in the group inherit the profile. 
4. You can **disable** a profile without deleting it.

---

## 6. Licenses

- One **seat** = one protected agent. 
- Without a seat: **grace** period (24 h), then inactive protection (**unlicensed**). 
- Assigning to a **group** (or manually) usually activates the seat. 
- Trial: **30 days** from organization creation. 
- Full license: key like `OPS-XXXX-XXXX-XXXX-XXXX` (Settings → Licenses). 
- Dashboard: Licensed / Grace / UNLICENSED lists.

---

## 7. Rule packs

A **pack** is the detection signature set pushed to agents without rebuilding the extension.

- **Publish**: new version (optionally without noisy rules). 
- **Activate**: version received on next sync.

---

## 8. Admins, recovery & settings

### Admins & groups

- Multiple administrators; one or more **principals** (full access). 
- **Edit** account · **New password** · **Unlock** · delete (by role). 
- **Groups** link agents and policy profiles.

### Vendor recovery

| Phase | Practice |
|-------|----------|
| Current | Strong secret `OPSGATE_VENDOR_RECOVERY`; offline delay ≥ 2 h |
| Recommended V1.x | **One-time code pool** (bottom of *Admins & groups*, principal only) |

### Messages (Kaspersky-style inbox)

End users can **contact admin** from the extension. 
Console → **Messages**: read, reply, close; the client gets a banner / ack popup.

### Useful settings

- **Language** FR / EN and **date/time** (Settings → General). 
- **TOTP MFA** + **passkeys** (Windows Hello / fingerprint). 
- **Configuration backup**: JSON export / import (principal). 
- **Event log retention** and **legal audit retention** (min. 90 days, WORM). 
- **Notifications**: email + Telegram / Slack / webhook channels. 
- **Email / SMTP**: required for OTP, alerts, and scheduled exports. 
- **Reports**: scheduled log export (day/time/recipients) + **Send test now**. 
- **Monitoring**: online / long offline thresholds; work schedule; SIEM.

---

## 9. Events (logs) & export

Typical decisions: `mask_send`, `send_anyway`, `cancel`, enroll / unenroll.

### Retention & scanned files

- Event retention set by the **organization** (Settings → Logs). 
- Beyond retention: **automatic purge** - export first. 
- **Manual export** CSV/JSON; **scheduled export** by email (Settings → Reports). 
- Extension: scan **PDF, DOCX, PPTX, XLSX**; **image OCR** when policy `scanImages` is on.

### Admin audit (WORM)

Append-only journal with **SHA-256 seal** (integrity chain). 
**Principal** only. **Verify integrity** button + CSV export.

---

## 10. Monitoring & schedule

- **Online** / **not connected long time** thresholds 
- **Schedule** (timezone, days, breaks) to avoid off-hours alerts 
- Log retention + weekly archive 

Timezones: Europe, Cameroon (`Africa/Douala`), Madagascar (`Africa/Antananarivo`), etc.

---

## 11. Agents & assignment rules

- **Export** agents CSV/JSON; **CSV import** (group / profile / license on already enrolled agents). 
- **Moving rules**: label / hostname → group; **AND** or **OR** conditions; **permanent** option (even if already grouped). 
- Applied at enroll and via “Re-evaluate”.

---

## 12. Data & database - why everything can “disappear”

| Cause | Effect | Prevention |
|-------|--------|------------|
| API **without** Postgres | **Memory** store → empty on restart | Always start Postgres |
| `docker compose down -v` | Postgres volume **destroyed** | Do not use `-v` in pilot |
| New volume / other machine | “Empty” DB + DEMO re-seed | Check Docker volume |
| Short log retention | Old events **purged** | Adjust retention; export first |
| API restart in memory mode | Loss of agents, events, custom admins | Move to Postgres |
| No backups | Irrecoverable loss | `scripts/backup-db.ps1` + console config export |

**Backup**: Settings → General → Export backup; full DB: `scripts/backup-db.ps1` (see `architecture/BACKUP.md`).

The `DEMO-OPSGATE` seed runs **only if** the org does not exist yet: it **does not overwrite** an existing org.

### Durable startup checklist

```powershell
docker compose up -d
$env:DATABASE_URL = "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"
pnpm api:dev
pnpm console:dev
```

Check the API log: `store=postgres` (not `memory`).

---

## 13. Console shortcuts (V1)

| Action | Detail |
|--------|--------|
| `/` | Focus events search / filter (Events tab) |
| Theme | Light / dark on the status strip |

---

## 14. Support & related docs

| Document | Content |
|----------|---------|
| [`GUIDE-STACK-LOCALE.md`](./GUIDE-STACK-LOCALE.md) | Docker, ports, extension build |
| [`RECOVERY-CONCEPTEUR.md`](./RECOVERY-CONCEPTEUR.md) | One-time pool, offline |
| [`RULE-PACKS.md`](./RULE-PACKS.md) | Rule packs |
| [`RUNBOOK-OPS.md`](./RUNBOOK-OPS.md) | Operations |
| [`PRIVACY.md`](./PRIVACY.md) | Modes & privacy |

Support contact: **contact@dailyops.tech** (include organization code and version).

---

*OpsGate V1.2 / V2 batch · User guide · product reference · July 2026*
