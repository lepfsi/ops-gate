# OpsGate — Decision-maker documentation V2

**Audience**: CIO, CISO, security architects, risk committees  
**Product version**: 1.2 / pre-GA V2  
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
| Files | Text uploads, PDF/DOCX scanning |

**Privacy by design**: local mode never leaves the device. Org mode sends **metadata** (rule type, decision, hostname) — not full prompts by default.

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
| Password + TOTP MFA | Pilot / break-glass |
| **OIDC SSO** (Entra, Okta…) | Enterprise default |
| **SAML 2.0** | Legacy IdPs |
| **WebAuthn / passkeys** | Passwordless login |
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

## 7. Compliance & residual risk

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

| Delivered (V1.x / V2 prep) | Next |
|---------------------------|------|
| Multi-browser, proxy, SSO, MFA, LDAP, SIEM, MSI | Hardened WebAuthn HA, full SAML C14N, Safari App Store |

Contact: DailyOps.Tech / OpsGate sales.

---

*Confidential — for customers and partners.*
