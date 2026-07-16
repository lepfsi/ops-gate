# OpsGate — Journal technique (traces écrites)

**Public** : développeurs / mainteneurs qui reviennent dans 6 mois ou 5 ans.  
**But** : ne pas s’égarer — *quoi a été fait, où, comment ça marche, où lire la suite*.  
**Mis à jour** : 16 juillet 2026  

---

## 0. Carte du monorepo (point d’entrée)

```
ops-gate/
├── packages/
│   ├── engine/     # Détection + mask (règles JSON + Luhn/FP)
│   ├── api/        # Control plane Hono (memory | Postgres)
│   ├── console/    # MMC React/Vite (admin)
│   └── proxy/      # Proxy local MITM (data-plane P0–P3)
├── src/            # Extension Plasmo MV3 (Chrome/Edge/…)
├── scripts/        # PDF, PAC système, proxy silencieux, helpers Windows
└── docs/           # Produit, archi, DSI, runbooks, ce journal
```

| Si tu cherches… | Ouvre… |
|-----------------|--------|
| Démarrer la stack | `docs/GUIDE-STACK-LOCALE.md`, `docs/architecture/PROXY-RUNBOOK.md` |
| Décideurs DSI | `docs/DSI-FILTRAGE-DONNEES-SENSIBLES.md` (+ PDF) |
| Admins console | `docs/GUIDE-UTILISATEUR.md` (+ PDF) |
| Roadmap V2 | `docs/V2-BACKLOG.md`, `docs/architecture/PLATFORM-v2.md` |
| Règles sensibles | `packages/engine/rules/rules.json` + `packages/engine/src/rules-engine.ts` |
| Branding PDF | `scripts/pdf_brand.py` (BrandMark login MMC) |

---

## 1. Architecture en 3 plans

```
[Navigateur]
   ├─ Extension (DOM)  warn | mask | block  → events source=prompt|file
   └─ Proxy MITM       observe | enforce    → events source=proxy
              │
              ▼
        API /v1  ←── Console MMC
        (memory store  OR  Postgres DATABASE_URL)
```

- **Extension** : UX utilisateur ; file locale d’events si offline (`src/lib/cloud.ts`).  
- **Proxy** : filet réseau allowlist multi-IA ; soft-block **par requête** (pas bannissement du site).  
- **API** : enroll, policy, packs, events, summary, rapports PDF, licences.

---

## 2. Lots livrés récents (session V1.x / pré-V2)

### 2.1 Proxy MITM & enforce

| Sujet | Détail | Fichiers clés |
|-------|--------|----------------|
| Allowlist multi-IA | ChatGPT, Claude, Gemini, Copilot, Grok, Perplexity, etc. + `enabled_hosts` policy | `packages/proxy/src/config.ts`, `allowlist.ts`, `sync.ts` |
| Buffer avant forward | Ne relaie le corps qu’après scan (évite log block alors que ChatGPT a déjà lu) | `packages/proxy/src/mitm.ts`, `observe.ts` |
| Soft-block par requête | 403 keep-alive + `observer.reset()` ; site accessible après | `mitm.ts` |
| JWT session | Ne coupe plus le site (headers auth ignorés ; règle jwt hors enforce seul) | `observe.ts`, `rules-engine.ts` |
| Label agent | Hostname seul (plus de préfixe « OpsGate Proxy ») | `api-client.ts`, `app.ts` `normalizeDeviceLabel` |
| PAC / silencieux | PAC système Windows ; démarrage proxy sans fenêtre | `scripts/set-system-proxy-pac.ps1`, `start-proxy-silent.ps1` |

**Commandes dev proxy**

```powershell
cd ops-gate
pnpm proxy:gen-ca
pnpm proxy:enroll   # API up
pnpm proxy:dev
# ou silencieux :
.\scripts\start-proxy-silent.ps1
.\scripts\set-system-proxy-pac.ps1
```

### 2.2 Moteur de détection

| Sujet | Détail | Fichiers |
|-------|--------|----------|
| Credit-card FP | Luhn, préfixe 3–6, format groupé, contexte mot-entier (pas « pan » dans span) | `packages/engine/src/rules-engine.ts` |
| Mask partiel | `XXXX-XXXX-XXXX-1234`, email, IBAN, API keys | `packages/engine/src/masker.ts` |
| Catalogue règles | Secrets cloud, IBAN, carte, configs réseau (Fortinet, Cisco…) | `packages/engine/rules/rules.json` |

### 2.3 API & console

| Sujet | Détail | Fichiers |
|-------|--------|----------|
| Logs proxy on/off | `logCategories.proxyEvents` | `types.ts`, `app.ts` events/batch, Settings → Logs |
| Maintenance agent | `leave` \| `outage` \| `remote` hors offline long | `types.ts`, stores, Agents UI |
| Moving rules | Match label **ou** host ; apply on upsert ; défaut `onlyIfUnassigned=false` | `memory-store` / `pg-store`, MovingRulesView |
| Dashboard Connexion | En ligne / **Inactif** / Hors ligne long / Maintenance | `App.tsx`, `summary-helpers.ts` |
| Agents UX | Recherche, filtres, tri, export CSV/JSON, scroll horizontal | `App.tsx` AgentsView |
| Rapport sécurité PDF | Semaine / plage / 90 j — KPIs + charts | `security-report.ts`, `GET /v1/org/reports/security`, `scripts/build-security-report-pdf.py`, Settings → Rapports |
| Docs DSI + Guide PDF | BrandMark login MMC, navy/teal | `scripts/build-dsi-pdf.py`, `build-guide-pdf.py`, `pdf_brand.py` |

### 2.4 Concepts produit (à retenir)

| Concept | Signification |
|---------|----------------|
| **Schedule org** | Heures de travail : silence des *alertes* offline long hors plage — **pas** un timer de sync |
| **Inactif (stale)** | `onlineMs < offline ≤ offlineLongMs` (ex. 15 min → 2 h) |
| **Offline long** | `last_seen > offlineLongMs` |
| **Maintenance** | Congé / panne / remote → exclus des alertes offline long |
| **Double filet** | Extension warn peut laisser passer ; proxy enforce peut encore bloquer le fil |
| **Memory vs Postgres** | Sans `DATABASE_URL`, restart API = perte agents/events |

---

## 3. Génération des PDF (branding)

```powershell
python scripts/build-dsi-pdf.py
python scripts/build-guide-pdf.py
# Rapport sécu (via API console, ou) :
python scripts/build-security-report-pdf.py sample.json --out docs/reports/out.pdf
```

- Charte : navy `#0A1128`, teal `#2BD9C5`  
- Logo : **BrandMark** porte/bouclier = même composant que login MMC (`BrandMark.tsx` / `pdf_brand.py`)  
- Police : Arial système (accents FR)

---

## 4. Endpoints / surfaces utiles

| Surface | Chemin / UI |
|---------|-------------|
| Summary dashboard | `GET /v1/org/summary` |
| Events | `GET /v1/org/events`, export CSV/JSON |
| Rapport sécu | `GET /v1/org/reports/security?range=current_week\|week\|custom\|all&format=json\|pdf` |
| Monitoring / log categories | `GET/PATCH /v1/org/monitoring` |
| Agents maintenance | `PATCH /v1/org/agents/:id` `{ maintenance_mode }` |
| Proxy health | `http://127.0.0.1:8888/opsgate-proxy/health` |
| PAC | `http://127.0.0.1:8888/opsgate-proxy.pac` |

---

## 5. Comment démarrer (rappel 3 services)

```powershell
cd ops-gate
pnpm api:dev          # :8787
pnpm console:dev      # :5173
pnpm proxy:dev        # :8888
```

Prod future : services Windows / silent scripts ; pas 3 terminaux ouverts.

---

## 6. V2 P0 livré — SIEM + Prometheus (16 juillet 2026)

| Sujet | Détail | Fichiers |
|-------|--------|----------|
| Syslog RFC5424 / CEF | Forward best-effort après `events/batch` | `packages/api/src/siem.ts` |
| Config org | `monitoring.siem` (host, port, udp/tcp, facility, format) | `types.ts`, merge, console Monitoring |
| Prometheus | `GET /metrics` (+ token optionnel `OPSGATE_METRICS_TOKEN`) | `packages/api/src/metrics.ts`, `app.ts` |
| Grafana | Dashboard JSON | `docs/grafana/opsgate-dashboard.json`, `docs/grafana/README.md` |
| listOrgs | Multi-tenant scrape | `memory-store` / `pg-store` |

## 7. V2 P1 livré — Proxy prod foundations · MFA · quotas (16 juillet 2026)

| Sujet | Détail | Fichiers / docs |
|-------|--------|----------------|
| Service / tâche Windows proxy | install script NSSM ou Task Scheduler | `scripts/install-proxy-service-windows.ps1`, `PROXY-PROD-WINDOWS.md` |
| Soft-mask option | `OPSGATE_PROXY_SOFT_MASK=1` → 422 JSON local | `packages/proxy/src/mitm.ts` |
| MFA TOTP | setup / enable / disable + login `totp_code` | `totp.ts`, store, console Settings + login |
| SSO OIDC | statut env `OPSGATE_OIDC_*` | `GET /v1/auth/oidc/status`, `AUTH-MFA-SSO.md` |
| Rate limit login | `OPSGATE_RATE_LOGIN_PER_MIN` | `rate-limit.ts` |
| Quota events/jour | `monitoring.quotas.maxEventsPerDay` | events/batch 429, console Monitoring |

## 8. V2 P1 suite — OIDC flow complet (16 juillet 2026)

| Sujet | Détail | Fichiers |
|-------|--------|----------|
| OIDC module | Discovery, PKCE S256, state TTL, token exchange, claims email | `packages/api/src/oidc.ts` |
| Start / callback | `GET /v1/auth/oidc/start`, `GET /v1/auth/oidc/callback` | `app.ts` |
| Session SSO | `createAdminSessionOidc(email)` (skip mdp + MFA local) | `memory-store`, `pg-store`, `store-types` |
| Console SSO | Bouton login + fragment `#opsgate_token` + erreurs IdP | `console/App.tsx`, `api.ts`, `i18n` |
| Mapping | email / preferred_username / upn → `org_admins` existant | pas de JIT |
| Docs | flow, Entra, env, erreurs | `AUTH-MFA-SSO.md` |

## 9. V2 P1 suite — Soft-mask on-wire proxy (16 juillet 2026)

| Sujet | Détail | Fichiers |
|-------|--------|----------|
| Modes | `OPSGATE_PROXY_SOFT_MASK` = `off` / `local` / `onwire` (`1` → onwire) | `packages/proxy/src/soft-mask.ts` |
| Rewrite | Body HTTP/1.1 masqué (engine) + Content-Length + forward amont | `soft-mask.ts`, `mitm.ts` |
| Fallback | gzip / non-HTTP1.1 / rien masqué → 422 local | `mitm.ts` |
| Events | décision `mask_send`, types `proxy_mask_onwire` / `proxy_mask_local` | `observe.ts`, `api-client.ts` |
| Health | `soft_mask` dans `/opsgate-proxy/health` | `proxy-server.ts` |
| Docs | `PROXY-PROD-WINDOWS.md` | |

## 10. V2 P1 suite — MSI proxy Windows (16 juillet 2026)

| Sujet | Détail | Fichiers |
|-------|--------|----------|
| Bundle | esbuild ESM standalone `opsgate-proxy.mjs` | `scripts/package-proxy-stage.ps1` |
| Paths install | ProgramData / `OPSGATE_PROXY_DATA_DIR` | `packages/proxy/src/paths.ts` |
| Stage + ZIP | `dist/proxy-stage`, `opsgate-proxy-*-win-x64.zip` | package script |
| MSI WiX 3.14 | heat+candle+light, auto-download tools | `scripts/build-proxy-msi.ps1`, `packaging/proxy/` |
| Post-install | CA + trust + enroll + tâche planifiée | `scripts/post-install.ps1` (dans le stage) |
| npm scripts | `pnpm proxy:package` · `pnpm proxy:msi` | `package.json` |

## 11. V2 P1 suite — HTTP/2 stream-aware (16 juillet 2026)

| Sujet | Détail | Fichiers |
|-------|--------|----------|
| Frames | Parse/encode DATA, RST, preface | `packages/proxy/src/http2-frames.ts` |
| Session MITM | Hold par stream, END_STREAM, idle | `http2-mitm.ts` |
| Enforce | RST_STREAM (CANCEL) sans tuer la connexion | `mitm.ts` ALPN h2 |
| Soft-mask h2 | Rewrite payloads DATA on-wire | `rewriteStreamDataMasked` |
| Kill-switch | `OPSGATE_PROXY_HTTP2=0` → h1 only | health `http2` |
| Docs | PROXY-PROD / RUNBOOK | |

## 12. V2 P1 suite — Node portable dans MSI (16 juillet 2026)

| Sujet | Détail | Fichiers |
|-------|--------|----------|
| Embed | Node win-x64 officiel → `runtime/node/node.exe` | `scripts/package-proxy-stage.ps1` |
| Cache | `tools/cache/node-v*-win-x64/` (gitignore) | build local réutilisable |
| Pin | défaut **v22.14.0** ; `-NodeVersion` / `OPSGATE_EMBED_NODE_VERSION` | |
| Slim | copie `node.exe` + LICENSE seulement (pas npm) | ~30–40 MB |
| Scripts | `run-proxy.cmd` / `opsgate-proxy.cmd` / post-install préfèrent runtime | |
| Opt-out | `-SkipEmbeddedNode` | stage sans Node |

## 13. Suite recommandée

1. Firefox MV3  
2. Chrome Web Store / MDM force-install  
3. Redis pour rate-limit multi-instance  
4. OIDC : JIT admin, JWKS verify, `sso_enforce`, SAML  
5. H2 : HPACK decode (scan headers) si besoin terrain  

Détail : `docs/V2-BACKLOG.md` · `docs/architecture/PLATFORM-v2.md`.

---

## Convention pour les prochains changements

Quand tu modifies le produit :

1. **Code** + tests manuels décrits dans le PR / commit  
2. **Mettre à jour ce journal** (section datée) ou le backlog V2  
3. Si surface utilisateur / DSI : guide ou `DSI-FILTRAGE-…`  
4. Si proxy : `PROXY-RUNBOOK.md`  

Ainsi dans 5 ans, ce fichier + `docs/` suffisent pour retrouver le fil.
