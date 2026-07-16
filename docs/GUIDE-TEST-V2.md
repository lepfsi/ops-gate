# OpsGate V2 — Guide de test (étapes, tâches, commandes)

**Public** : QA, intégrateur, pilote DSI  
**Prérequis** : Windows 10/11, Node 20+, pnpm, Python 3 + fpdf (PDF), Docker (Postgres optionnel)

---

## 0. Préparation (une fois)

```powershell
cd C:\Users\Utilisateur\ops-gate
pnpm install
```

| Tâche | Commande | Attendu |
|-------|----------|---------|
| Moteur de règles | `pnpm test:rules` | OK / exit 0 |
| Schéma events | `pnpm test:events` | OK |
| Typecheck API | `cd packages\api ; npx tsc --noEmit` | exit 0 |
| Typecheck console | `cd packages\console ; npx tsc --noEmit` | exit 0 |

---

## 1. Stack locale (API + Console)

### 1.1 Postgres (recommandé)

```powershell
docker compose up -d
$env:DATABASE_URL = "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"
```

### 1.2 API

```powershell
# Terminal A
cd C:\Users\Utilisateur\ops-gate
$env:DATABASE_URL = "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"   # si PG
pnpm api:dev
```

| Check | Commande | Attendu |
|-------|----------|---------|
| Health | `curl http://127.0.0.1:8787/health` | `ok: true`, features listées |
| RLS | même JSON → `pg_rls` si postgres | mode on/strict |
| Metrics | `curl http://127.0.0.1:8787/metrics` | texte Prometheus |

### 1.3 Console

```powershell
# Terminal B
pnpm console:dev
# → http://127.0.0.1:5173
```

| Tâche | Étapes | Attendu |
|-------|--------|---------|
| Login local | `admin@demo.local` / `0000` | Accès dashboard |
| Policy | Modifier hosts IA → Save → Force sync | Epoch incrémenté |
| Monitoring | Quotas / SIEM / LDAP onglets | Sauvegarde OK |

---

## 2. Extension navigateur

### 2.1 Chrome / Edge

```powershell
pnpm build:chrome
# chrome://extensions → Mode dev → Charger non empaquetée
# Dossier : build\chrome-mv3-prod
```

| Tâche | Étapes | Attendu |
|-------|--------|---------|
| Prompt secret | ChatGPT → coller clé `sk-...` longue | Banner mask / block |
| Upload fichier | Joindre .txt avec IBAN | Scan fichier |
| Enroll | Options → code `DEMO-OPSGATE` | Mode org, lock policy |

### 2.2 Firefox

```powershell
pnpm build:firefox
# about:debugging → This Firefox → Charger temporaire
# build\firefox-mv3-prod\manifest.json
```

### 2.3 Safari (Mac)

```powershell
pnpm build:safari
# Puis xcrun safari-web-extension-converter (voir docs/architecture/SAFARI-MV3.md)
```

### 2.4 Packages store

```powershell
pnpm store:chrome    # dist\chrome-store\
pnpm store:firefox   # dist\firefox-amo\
```

---

## 3. Proxy MITM

```powershell
# Terminal C
pnpm proxy:gen-ca
certutil -addstore -user Root "packages\proxy\data\ca\ca-cert.pem"
pnpm proxy:enroll
$env:OPSGATE_PROXY_MODE = "enforce"
$env:OPSGATE_PROXY_SOFT_MASK = "1"
pnpm proxy:dev
```

Chrome test :

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --user-data-dir="$env:TEMP\opsgate-chrome-proxy" `
  --proxy-server="127.0.0.1:8888" `
  --disable-quic "https://chatgpt.com"
```

| Tâche | Attendu |
|-------|---------|
| Health proxy | `curl http://127.0.0.1:8888/opsgate-proxy/health` → soft_mask, http2 |
| Secret dans chat | mask on-wire ou 403/RST h2 |
| Navigation site | reste possible (soft-block par requête) |

### MSI

```powershell
pnpm proxy:msi
# dist\opsgate-proxy-*.msi
```

---

## 4. Auth avancée

| Feature | Activation | Test |
|---------|------------|------|
| OIDC | `OPSGATE_OIDC_*` env | Bouton SSO console |
| OIDC JWKS | défaut ON | Mauvais issuer → reject |
| OIDC JIT | `OPSGATE_OIDC_JIT=1` | Email inconnu → admin créé |
| SSO enforce | `OPSGATE_SSO_ENFORCE=1` | Password login 403 |
| SAML | `OPSGATE_SAML_IDP_*` | `/v1/auth/saml/metadata` + start |
| WebAuthn | `OPSGATE_WEBAUTHN=1` | register options (admin) + login |
| MFA TOTP | UI Settings | Authenticator 6 digits |

```powershell
curl http://127.0.0.1:8787/v1/auth/oidc/status
curl http://127.0.0.1:8787/v1/auth/saml/status
curl http://127.0.0.1:8787/v1/auth/webauthn/status
```

---

## 5. LDAP / AD

| Tâche | Détail |
|-------|--------|
| Config | Console → Paramètres → LDAP |
| Test | Bouton Tester |
| Dry-run | Sync lecture seule |
| Sync | Users + groups dans People |
| Cron | `$env:OPSGATE_LDAP_CRON_MINUTES=60` au démarrage API |

```powershell
$env:OPSGATE_LDAP_BIND_PASSWORD = "********"
$env:OPSGATE_LDAP_CRON_MINUTES = "60"
pnpm api:dev
```

---

## 6. Multi-tenant / Redis / RLS

| Feature | Env | Check |
|---------|-----|-------|
| Redis rate-limit | `OPSGATE_REDIS_URL=redis://127.0.0.1:6379` | health.rate_limit_backend=redis |
| RLS | `OPSGATE_PG_RLS=on\|strict` | health.pg_rls |
| Quotas | Monitoring max events/agents | 429 si dépassé |

---

## 7. Observabilité

| Tâche | Commande |
|-------|----------|
| Prometheus | `curl http://127.0.0.1:8787/metrics` |
| Grafana | Importer `docs/grafana/opsgate-dashboard.json` |
| SIEM | Config Monitoring → host:port syslog |
| Rapport PDF | Console Settings → Rapports |

---

## 8. Checklist « go / no-go » pilote

- [ ] API health OK (postgres si prod)  
- [ ] Login console + (SSO ou password)  
- [ ] Extension bloque/masque secret sur 1 site IA  
- [ ] Events visibles console  
- [ ] Force-sync appliqué sous 2 min  
- [ ] Proxy enforce testé **ou** reporté explicitement  
- [ ] CA proxy trustée si MITM  
- [ ] Backup / restore Postgres documenté  
- [ ] Extension force-install planifié (CWS/MDM ou AMO)  

---

## 9. Commandes utiles (résumé)

```powershell
pnpm install
pnpm test
pnpm api:dev
pnpm console:dev
pnpm build:chrome
pnpm build:firefox
pnpm build:safari
pnpm store:chrome
pnpm store:firefox
pnpm proxy:dev
pnpm proxy:msi
pnpm docs:pdf:all
```

---

## 10. Dépannage rapide

| Symptôme | Action |
|----------|--------|
| API store=memory perdu | DATABASE_URL + docker compose |
| Extension ne voit rien | Mauvais dossier build / pas de host match |
| Proxy silencieux | Chrome sans --proxy-server / PAC |
| OIDC invalid_state | Horloge / restart API (state mémoire) |
| LDAP bind fail | URL ldaps, cert, bind DN, env password |
| RLS trop strict | `OPSGATE_PG_RLS=on` (pas strict en dev) |
