# OpsGate — Technical due-diligence FAQ (EN)

**Audience**: security engineers, technical CISOs, architects, senior developers, DLP/CASB consultants  
**Product version**: 1.2.x · V2 pre-GA + V3-P0  
**Use**: questions a demanding peer asks to judge **quality**, **domain mastery**, and **security standards** — with dense answers.

> This is **not** marketing copy. Answers map to the real architecture (MV3 extension, `@opsgate/engine`, Hono API, Postgres RLS, MITM proxy, Secure Rewrite, Risk/Shadow).  
> Product status: [`STATUS-V2.md`](./STATUS-V2.md) · gap: [`STATUS-GAP-V1-V3.md`](./STATUS-GAP-V1-V3.md) · privacy: [`PRIVACY.md`](./PRIVACY.md)  
> French source: [`FAQ-DUE-DILIGENCE-TECHNIQUE.md`](./FAQ-DUE-DILIGENCE-TECHNIQUE.md)  
> **10-slide deck**: [`FAQ-DUE-DILIGENCE-10Q.pptx`](./FAQ-DUE-DILIGENCE-10Q.pptx)

---

## A. Positioning & threat model

### A1. “Why a browser DLP instead of CASB / SSE / network DLP?”

Generative-AI leaks mainly happen in the **DOM** (pasted prompts, uploads) and on paths a network proxy may miss (non-MITM apps, WebSockets, clients off-proxy). Network CASB is strong for SaaS session control and TLS inspection, but:

1. **Latency and cost** of full-traffic MITM vs a targeted AI host allowlist.  
2. **False sense of coverage**: users can still paste secrets into ChatGPT if a host is missed.  
3. **UX**: blocking the whole site is often unacceptable; OpsGate intercepts the **send action** and offers mask / Secure Rewrite / cancel / logged send_anyway.

OpsGate is an **AI-specific business safety net**: extension (DOM) + optional local multi-AI proxy. It does **not** replace CASB; it is complementary **AI-usage control**, usually faster for a CISO to pilot.

### A2. “What is your explicit threat model?”

| Actor / scenario | OpsGate coverage | Honest limit |
|------------------|------------------|--------------|
| Careless employee pastes a secret into ChatGPT | Banner, mask, Secure Rewrite, policy block | Willful bypass outside the browser |
| Employee attaches a sensitive PDF/DOCX | Office scan + image OCR (if policy) | Encrypted archives, obscure formats |
| Shadow AI (unapproved tool) | Hostname inventory + auth/unauth status | Depends on events / scanned hosts |
| Malicious console admin | WORM audit, multi-tenant MFA, RLS | Primary admin is powerful (normal) |
| Attacker with already-compromised endpoint | Out of scope for anti-malware | Third-party EDR |
| Leak via business backend API (not AI UI) | Out of scope | Agent Guard = V3-G roadmap |

**Principles**: defense in depth (DOM + optional proxy) · least data to cloud (metadata events) · admin-driven policy · user can still work (rewrite > pure block).

### A3. “How are you not a keylogger / HR spyware?”

- Scan **at send/upload time**, not continuous keystroke capture.  
- Content script limited to declared **AI hosts** (`enabled_hosts`).  
- Cloud events: **constrained schema** — no `prompt` / `content` fields; API rejects forbidden payloads ([`EVENT-SCHEMA.md`](./architecture/EVENT-SCHEMA.md)).  
- `local_only` mode: **zero** org telemetry.  
- Public privacy policy: [`PRIVACY.md`](./PRIVACY.md).

This is **DLP governance**, not behavioral HR surveillance.

---

## B. Architecture & technical trust

### B1. “Where does detection run? Does the secret leave the machine?”

| Plane | Role | Raw secret |
|-------|------|------------|
| Extension content script | Intercept prompt/file, engine, banner | Stays local |
| `@opsgate/engine` | Regex + validators (Luhn, IBAN mod-97) | Local |
| Service worker | Policy/pack sync, event queue | Agent token, metadata |
| API | Policy, signed packs, events | Metadata (+ optional redacted previews) |
| Optional MITM proxy | Scan HTTPS bodies on AI allowlist | Local machine; soft-block/observe |

Default org policy: **`metadata_only`** — rule_ids, decision, hostname, severity, counts.  
Optional `metadata_plus_redacted_match`: truncated previews (max 5, ~24 chars), never full prompt.

### B2. “How is the rule pack authenticated?”

- Published pack: JSON **checksum** + **ed25519** signature.  
- Agent fetches SPKI **public key** and verifies before apply (`pack_verify_failed` otherwise).  
- Stops a network MITM or compromised server from injecting arbitrary rules without the private key.

### B3. “Multi-tenant isolation?”

- Postgres + **RLS** (`app.current_org_id` / controlled bypass).  
- Agent tokens **org-scoped**; console session bound to org.  
- MSP: same admin email across orgs; **MFA required** on every tenant switch.  
- Org GDPR soft-delete (export, grace, hard purge).

Auditor check: no cross-org `SELECT` without system bypass; no agent token reuse across tenants.

### B4. “Manifest V3 service worker death?”

MV3 SW is **ephemeral**. OpsGate:

- Local event queue + retry (`flushEventQueue`).  
- Conscious retry/fire-and-forget on batch.  
- Known debt documented — experts value honesty over “we never lose an event.”

### B5. “Why monorepo engine/api/console/proxy?”

- **Single detection truth** (`@opsgate/engine`): extension = proxy = tests.  
- Avoids “proxy masks differently from extension.”  
- Shared rule regression tests (`pnpm test:rules`).

---

## C. Detection quality & false positives

### C1. “Is this only regex? That’s weak.”

Yes **and** no:

- **Base**: compiled patterns per rule (secrets, network configs, PII…).  
- **Validators**: Luhn (cards), **IBAN mod-97**, placeholder filters.  
- **Selective keyword gates** (infra configs) to cut noise.  
- **IBAN**: checksum required; compact **and** spaced patterns; no mandatory “IBAN” keyword.  
- **Phone vs IBAN**: valid IBAN digit subsequences not classified as phone.  
- **V3 Secure Rewrite**: structured replacements with **consistent mapping** in one document.

Not a document ML classifier. It is **rule DLP + anti-FP hygiene** — auditable and standard for lightweight DLP. Multi-level classification = V3-F roadmap.

### C2. “False positives on cards / JWT / sessions?”

- Cards: Luhn + known test numbers excluded.  
- JWT: Authorization / cookie / access_token contexts often **ignored** (browser session ≠ pasting a secret into a prompt).  
- Passwords: placeholders / `***` filtered.  
- Emails: demo domains excluded.

Assumed trade-off: **recall vs precision**. Prefer fewer dubious hits over blocking prod on every ChatGPT session JWT.

### C3. “Who owns rules? Versioning?”

- Org pack versioned (`1.0.x`), console publish / activate / rollback.  
- Disable rules by id (new pack).  
- Enrolled agent **prefers org pack** over embedded engine.  
- Ops: republish pack after engine fixes (e.g. IBAN) — `republish-engine-pack.mjs`.

### C4. “OCR / files attack surface?”

- **Tesseract.js** OCR runs **locally** (no image upload to OpsGate cloud).  
- Org + profile `file_scan` (images, Office, configs, DBs, media_warn).  
- Legacy binary Office: often confirm-only.  
- Main risks: **perf** and **OCR FPs**, not OpsGate server exfiltration.

---

## D. Identity & admin control

### D1. “MFA, SSO, passkeys — enterprise grade?”

| Mechanism | Status | Expert note |
|-----------|--------|-------------|
| TOTP MFA | Shipped | Forced on multi-tenant switch |
| Passkeys / WebAuthn | Shipped | Hello / biometrics console |
| OIDC | Shipped | JWKS, JIT user |
| SAML SP | Shipped | Validate per customer IdP |
| LDAP/AD sync | Shipped | Optional cron |
| Session challenge | Shipped | Concurrent / read-only |

MSP switch **requires** a 6-digit code every time — good anti-admin-lateralization signal.

### D2. “How does an admin unlock a locked endpoint?”

- Protected unenroll: admin password hashes.  
- **Vendor recovery** only if offline ≥ threshold (default 2h) + one-time pool.  
- Prevents an attacker on an **online** machine from using vendor break-glass.

### D3. “Console RBAC granularity?”

Console permissions (`console_access`, `manage_policies`, …) + admin roles.  
Not full Okta+SCIM ABAC everywhere — **pragmatic mid-market**. LDAP/groups + moving rules for agent assignment.

---

## E. Logging, evidence, compliance

### E1. “Are logs forensically sound / immutable?”

- **Admin audit WORM**: SHA-256 chain (prev_hash / entry_hash), append-only, integrity check in console.  
- **Detection events**: configurable retention (~90d default), separate from admin legal retention (min 90d).  
- CSV/JSON export, SIEM syslog/CEF, Prometheus `/metrics`.

Not hardware tape WORM — **application seal** against soft tampering (SaaS mid-market standard).

### E2. “GDPR / DPIA arguments?”

- Minimization: no full prompt in cloud by default.  
- Local-first.  
- Org soft-delete + DSAR export.  
- Purpose: IT security, not marketing profiling.  
- Configurable retention.  
- Often **customer-hosted** control plane → customer controls processing location.

Customer remains **controller**; OpsGate is tool / processor per hosting contract.

### E3. “Secure Rewrite mapping deterministic? Collusion risk?”

- **Consistent within one document** (same host → same pseudonym).  
- Does **not** claim cryptographic anonymity against external data cross-checks.  
- Goal: **useful AI prompt without pasting the real secret** — operational risk reduction, not formal k-anonymity.

Serious experts accept this if **stated explicitly**.

---

## F. MITM proxy

### F1. “Local MITM — more dangerous than the risk?”

**Local** MITM on the user machine, **enterprise CA** (GPO), **AI allowlist**:

- Not an opaque carrier MITM.  
- Soft-block **per request** (not site ban).  
- Observe vs enforce modes.  
- Auth headers / session JWT often excluded to avoid breaking sites.

Document in runbooks: CA trust, host scope, perf, certificate pinning (rare for consumer AI).

### F2. “Extension vs proxy — who wins?”

| | Extension | Proxy |
|--|-----------|-------|
| Coverage | DOM UX, rewrite, files | HTTPS body multi-AI |
| Bypass | Client off host list | App without proxy / edge DOH |
| UX | Rich banner | More raw soft-block/observe |

**Complementary**. Org policy aligns hosts. Events `source=prompt|file|proxy`.

---

## G. V3 product (Risk, Shadow, Rewrite)

### G1. “Risk Score — serious scoring or vanity metric?”

**Explicit** formula over events (severities, send_anyway, mask/rewrite, unauth shadow, recurrence).  
Trend = period N vs N-1 (±5 pt threshold).  
No black-box ML.  
Limit: depends on **event quality/volume**; silent agents look “low risk” (not “safe” — **low activity**).

### G2. “Shadow AI — inventory or blocking?”

Inventory + authorized/unauthorized/unknown (admin).  
Blocking a Shadow host = **policy hosts / proxy**, not magic DNS.  
Useful for CISO **discovery**, not full CASB app control.

### G3. “How do you measure Secure Rewrite adoption?”

Event decision `secure_rewrite` vs `mask_send` / `send_anyway`.  
Dashboard rewrite share.  
Security PDF §6 AI Security.  
Product KPI: rewrite adoption on medium/high (V3 spec).

---

## H. Application security

### H1. “OWASP / API surface?”

- Agent Bearer auth + token hash.  
- Console session + MFA.  
- Event schema validation (forbidden fields).  
- Rate limits (memory/redis).  
- Postgres RLS.  
- Pack signing.  
- SMTP/LDAP passwords not returned on GET.

For formal audit: external pen-test, SAST CI, dependency scanning (formalize pre-GA).

### H2. “Extension supply chain?”

- Plasmo build, documented store artifacts.  
- npm deps (pdfjs, tesseract, mammoth) — known surface.  
- Extension CSP; rule packs are JSON patterns, not remote arbitrary code.  
- ed25519 pack keys out of prod repo.

### H3. “Secrets in repo / lab?”

Lab: demo codes, `ALLOW_DEV_UNSIGNED`, dev admin headers.  
Prod: `DATABASE_URL`, signing keys, SMTP, Stripe — **env**, not commit.

---

## I. Operations & resilience

### I1. “Multi-region HA?”

**Out of current scope** (documented). Typical customer deploy: Postgres + API + console behind TLS reverse-proxy.  
Config backup + DB script + **auto backup 7/14/30 days**.  
No false “99.99 multi-AZ global” claim.

**Single-region HA is implementable**: multi-instance API (stateless + Postgres) behind LB; managed/replica DB; crons on one worker.  
Details: [`architecture/DEPLOY-PROD-HA.md`](./architecture/DEPLOY-PROD-HA.md).

### I2. “If the API is down?”

- Agent: last policy + pack cache (`managedLockActive`).  
- Local detection continues.  
- Events queued locally.  
- Vendor recovery if locked and offline threshold met.

### I3. “How many events/agents before it breaks?”

Configurable org quotas.  
Summary/risk can be heavy (bounded listEvents; MSP uses light snapshot).  
Mid-market lab scale validated; **no public 10k-agent benchmark** — do not invent in demos.

---

## J. Standards & maturity

### J1. “ISO 27001 / SOC2 certified?”

**Not claimed** as product-certified at pre-GA.  
Controls *aligned*: data minimization, MFA access, audit trail, tenant isolation, retention.  
Credible post-GA path: SOC2 Type I on hosted control plane (if SaaS), or customer on-prem shared responsibility.

### J2. “NIST CSF mapping?”

| Function | OpsGate |
|----------|---------|
| Identify | Shadow AI inventory, top rules, risk users |
| Protect | Mask/block/rewrite policy, file scan, proxy enforce |
| Detect | Engine + events + SIEM |
| Respond | User→admin inbox, force-sync, unenroll, PDF reports |
| Recover | Backup, GDPR soft-delete restore window |

### J3. “Why you vs heavy endpoint DLP (legacy suites)?”

- AI time-to-value in **days**, not months.  
- Non-hostile UX (rewrite).  
- Specialization: **AI prompts/uploads** + infra configs.  
- On-prem possible.  
Contra: not full-channel DLP (USB, print, email) — **do not oversell**.

---

## K. Trap questions — short answers

| Trap | Answer |
|------|--------|
| “Do you see all prompts?” | No. Metadata by default. |
| “100% of AI leaks?” | No; off-browser / off-host = gap. |
| “Zero false positives?” | No; validators + policy trade-off. |
| “Replace our CASB?” | No; complementary. |
| “AI that understands full document context?” | Not yet; rules + deterministic rewrite. |
| “Store GA?” | Artifacts ready; live listing = ops (pre-GA). |
| “Mathematical anonymity for rewrite?” | No; operational risk reduction. |

---

## L. Mastery checklist (no slides)

A strong OpsGate interlocutor can, cold:

1. Draw extension ↔ engine ↔ API ↔ Postgres RLS ↔ proxy.  
2. Explain **metadata_only** vs redacted match.  
3. Differentiate mask, Secure Rewrite, block, send_anyway.  
4. Explain **ed25519 pack signatures**.  
5. Explain MFA on every MSP switch.  
6. Explain risk trend (±5 pts, sliding period).  
7. Admit **limits** (compromised endpoint, off-browser, pre-GA stores).  
8. Cite STATUS, DEPLOYMENT, EVENT-SCHEMA, PRIVACY, RELEASE-v3.

---

## M. Questions to ask the **customer** back

1. Which AI tools are **approved** today (list)?  
2. Existing enterprise proxy? TLS inspection already?  
3. Chrome force-install MDM or pilot sideload?  
4. Control plane hosting: **customer** or vendor SaaS?  
5. Legal: **zero** cloud metadata possible (→ local_only / strict on-prem)?  
6. Pilot success KPI: drop high send_anyway? rewrite adoption? shadow discovered?

---

## N. Monorepo references for auditors

| Topic | Where |
|-------|--------|
| Event schema | `docs/architecture/EVENT-SCHEMA.md` |
| Privacy | `docs/PRIVACY.md` |
| Engine / IBAN / rewrite | `packages/engine/` |
| Security report V3 | `packages/api/src/security-report.ts` |
| Risk / Shadow | `packages/api/src/risk-shadow.ts` |
| Pack signing | `packages/api/src/signing.ts` |
| RLS | `packages/api/src/db/rls.sql` |
| Client deployment | `docs/DEPLOIEMENT-CLIENT-EN.md` |
| GA gap | `docs/STATUS-GAP-V1-V3.md` |

---

*OpsGate · Technical due-diligence FAQ · DailyOps.Tech · 18 July 2026*  
*For technical discovery, RFP, or warm-up before a CISO demo.*
