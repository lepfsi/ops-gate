# OpsGate — User Guide (V1)

**Audience**: console administrators, pilots, support  
**Product version**: 1.2  
**Language**: English  

This guide covers day-to-day OpsGate use: extension, console, enrollment, policies, licenses, logs, and recovery.  
For local technical setup (Docker, ports), see also [`GUIDE-STACK-LOCALE.md`](./GUIDE-STACK-LOCALE.md).

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

**Single session**: a second sign-in offers “Force sign-out”.

**Wrong password**: the message shows how many attempts remain. After too many failures, the account is **locked** — a principal admin unlocks it under *Admins & groups*.

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

Fleet overview: licenses, connected agents, decisions, top threats.

- Click an indicator for detail (agent list or logs).
- **Expand**: charts fill the content area (top bar and left menu stay visible).
- **Collapse**: back to the normal view.
- **Force sync**: pushes config to online agents (effect within ~2 min).

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

### Useful settings

- **Language** FR / EN (Settings → General) — applies to the whole console.  
- **Log retention** (default 90 days) and log types.  
- **Login failure threshold** (account lockout).  
- **Monitoring**: online / long offline thresholds; work-hours schedule.

---

## 9. Events (logs) & export

Typical decisions: `mask_send`, `send_anyway`, `cancel`, enroll / unenroll.

### Retention

- Set by the **organization** (Settings → logs).  
- Beyond retention: **automatic purge**.  
- **Export** week, all, or a custom range (CSV / JSON).  
- Optional weekly archive before purge.

### Admin audit

Journal of console actions (policy, profiles, admins, packs…).  
**Principal** only. Export available.

---

## 10. Monitoring & schedule

- **Online** / **not connected long time** thresholds  
- **Schedule** (timezone, days, breaks) to avoid off-hours alerts  
- Log retention + weekly archive  

Timezones: Europe, Cameroon (`Africa/Douala`), Madagascar (`Africa/Antananarivo`), etc.

---

## 11. Assignment rules

Auto rules (label / hostname → group), **AND** conditions, ordered priority.  
Applied at enroll and via “Re-evaluate”.

---

## 12. Data & database — why everything can “disappear”

| Cause | Effect | Prevention |
|-------|--------|------------|
| API **without** Postgres | **Memory** store → empty on restart | Always start Postgres |
| `docker compose down -v` | Postgres volume **destroyed** | Do not use `-v` in pilot |
| New volume / other machine | “Empty” DB + DEMO re-seed | Check Docker volume |
| Short log retention | Old events **purged** | Adjust retention; export first |
| API restart in memory mode | Loss of agents, events, custom admins | Move to Postgres |

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

*OpsGate V1 · User guide · product reference*
