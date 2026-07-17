# OpsGate — Decision-maker documentation V2

**Audience**: CIO, CISO, security architects, risk committees  
**Product version**: 1.2 / V2 batch (July 2026)  
**Maturity**: **V2 functional / pre-GA** — see [`STATUS-V2.md`](./STATUS-V2.md)  
**Vendor**: DailyOps.Tech  

---

## 1. What is it?

**OpsGate** is a **lightweight data-loss prevention (DLP)** product focused on **generative AI tools** (ChatGPT, Claude, Gemini, Copilot, Perplexity, and more).

It answers one question:

> *How do we let employees use AI freely without leaking secrets, customer data, or infrastructure configs?*

OpsGate is **not** a full network CASB and **not** a conversation surveillance tool. It is a **business safety net**: local detection, clear user actions (mask / block / log), and central governance for IT and security teams.

---

## 2. How it works (60 seconds)

```
User ──► AI website (browser)
              │
     ┌────────┼────────┐
     ▼        ▼        ▼
 Extension  Local proxy (optional)
 (page)     (HTTPS MITM)
     │        │
     └────┬───┘
          ▼
   Rules engine (@opsgate/engine)
   secrets · PII · network configs · cloud keys
          │
          ▼
   Banner / soft-block / soft-mask
          │
          ▼
   Console + API (metadata events)
   SIEM · metrics · security PDF reports
```

1. **Detect** in the browser (and/or proxy) before send.  
2. **Act**: mask secrets, block, or log per policy.  
3. **Govern**: admins set rules, groups, profiles, licenses.  
4. **Prove**: events, audit, exports, SIEM, PDF reports.

---

## 3. What you protect

| Category | Examples |
|----------|----------|
| App secrets | OpenAI/Anthropic keys, AWS, Azure, GCP, Stripe, JWT |
| Identity / PII | Emails, IBAN, payment cards (with FP controls) |
| Infrastructure | Fortinet, MikroTik, WireGuard, network snippets |
| Files | Text uploads, PDF/DOCX/**PPTX/XLSX**, **image OCR** (local Tesseract) |

**Privacy by design**: local mode never leaves the device. Org mode sends **metadata** (rule type, decision, hostname) — not full prompts by default. File parse and OCR stay **on the endpoint**.

---

## 4. Layered architecture

| Layer | Role | Why it matters |
|-------|------|----------------|
| **Extension** Chrome / Edge / Firefox / Safari* | UX, banner, enroll | Fast rollout |
| **Local proxy** | Safety net when DOM breaks | Defense in depth |
| **API + Postgres** | Multi-tenant control plane + RLS | Governance & audit |
| **Console** | IT/SOC cockpit | Visibility & policy |
| **SIEM / Prometheus** | Existing SOC stack | No silo |

\*Safari: MV3 build + Apple/Xcode packaging.

---

## 5. Identity & access (admins)

| Mechanism | Use |
|-----------|-----|
| Password + TOTP MFA | Pilot / break-glass; **required for multi-tenant** |
| **OIDC SSO** (Entra, Okta…) | Enterprise default |
| **SAML 2.0** | Legacy IdPs; IdP signature required in prod |
| **WebAuthn / passkeys** | Windows Hello, fingerprint, FIDO2 keys |
| **Concurrent session** | 10 s consent / read-only (anti-takeover) |
| **SSO enforce** | Disable local passwords |
| **JIT** | Create admin on first SSO |
| **LDAP / AD** | Group & user sync + cron |

---

## 6. Deployment at scale

| Channel | Description |
|---------|-------------|
| Sideload | Pilot (`build/chrome-mv3-prod`) |
| **Chrome Web Store** + MDM force-install | Managed Windows fleet |
| **Firefox AMO** + policies.json | ESR / enterprise |
| **Proxy MSI** + portable Node | Silent service, PAC/GPO |
| Docker Postgres | Durable storage |

---

## 7. Compliance, audit & continuity

| Capability | Decision value |
|------------|----------------|
| **WORM audit** (SHA-256 chain) | Integrity proof of admin actions |
| **Legal audit retention** (≥ 90 days) | Retention requirements alignment |
| **Config + Postgres backup** | Lightweight BCP / recovery |
| **Scheduled exports + SIEM** | Operational evidence for SOC |
| **MSP multi-org** | One operator governs many customers |

**Reduces**: accidental AI leaks, blind spots, policy bypass (app lock + MDM).

**Does not replace**: full network DLP, cloud CASB, EDR, server-side LLM classification.

**Recommendation**: OpsGate **complements** EDR + proxy + SIEM for the **AI-specific** risk.

---

## 8. Pilot success metrics (30–90 days)

- % of endpoints with force-installed extension  
- Mask/block events per week  
- Policy deploy latency (force-sync < 2 min)  
- “Secret pasted into ChatGPT” incidents before/after  
- AI site coverage (host allowlist)  

---

## 9. Product status & roadmap

| Delivered (V1.x + V2 batch) | Next (pre-GA → GA) |
|----------------------------|---------------------|
| Multi-browser, proxy, SSO, multi-tenant MFA, passkeys, LDAP, SIEM, MSI | Real store listing (CWS/AMO/Apple), customer pilot |
| PDF/DOCX/PPTX/XLSX scan + image OCR | Offline FR OCR pack, public Safari App Store |
| WORM audit, backup, multi-channel alerts, MSP, **Stripe portal**, **GDPR soft-delete** | Production Stripe keys, store listings, customer pilot |

**Deployment**: integrator guide [`DEPLOIEMENT-CLIENT-EN.md`](./DEPLOIEMENT-CLIENT-EN.md) (+ PDF).  
**Progress detail**: [`STATUS-V2.md`](./STATUS-V2.md) · [`V2-BACKLOG.md`](./V2-BACKLOG.md).

Contact: DailyOps.Tech / OpsGate sales.

---

*Confidential — for customers and partners · 17 July 2026*
