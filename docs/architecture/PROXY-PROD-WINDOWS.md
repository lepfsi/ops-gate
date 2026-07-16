# OpsGate Proxy — production Windows (V2 P1)

## Objectif

Remplacer les terminaux `pnpm proxy:dev` par un **démarrage silencieux** (service / tâche) et un **PAC/GPO** d’entreprise.

## Composants

| Élément | Rôle |
|---------|------|
| Proxy Node (`packages/proxy`) | MITM allowlist multi-IA, soft-block par requête |
| CA locale | Trust store utilisateur/machine |
| PAC | Seuls les hosts IA → `127.0.0.1:8888` |
| Service / tâche | Démarrage auto sans console |

## Installation

### A. MSI packagé (recommandé prod / GPO)

```powershell
cd ops-gate
pnpm install
# Build stage + MSI (télécharge WiX 3.14 dans tools\wix314 si besoin)
pnpm proxy:msi
# Artefacts :
#   dist\opsgate-proxy-1.2.0.msi
#   dist\opsgate-proxy-1.2.0-win-x64.zip   (portable)
```

Install machine :

```powershell
# UI
msiexec /i dist\opsgate-proxy-1.2.0.msi
# Silent
msiexec /i dist\opsgate-proxy-1.2.0.msi /qn
```

- Binaries : `C:\Program Files\OpsGate\Proxy\`
- Data (CA, agent, logs) : `%ProgramData%\OpsGate\Proxy\`
- Registry : `HKLM\SOFTWARE\OpsGate\Proxy`
- Post-install auto (CA + tache + enroll) via custom action ; si skip :

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Program Files\OpsGate\Proxy\scripts\post-install.ps1"
```

Prérequis runtime : **Node.js 20+ LTS** dans le PATH (le MSI n’embarque pas Node).

Stage seul (sans MSI) :

```powershell
pnpm proxy:package
# → dist\proxy-stage + ZIP
```

### B. Dev monorepo (scripts)

```powershell
cd ops-gate
pnpm install
pnpm proxy:gen-ca
certutil -addstore -user Root "packages\proxy\data\ca\ca-cert.pem"
# API doit tourner pour enroll
pnpm proxy:enroll
.\scripts\install-proxy-service-windows.ps1 -TaskOnly
# ou avec NSSM (recommandé service SYSTEM) :
# .\scripts\install-proxy-service-windows.ps1 -NssmPath C:\tools\nssm\nssm.exe
```

Silent sans service (session courante) :

```powershell
.\scripts\start-proxy-silent.ps1
.\scripts\start-proxy-silent.ps1 -Stop
```

## PAC / GPO (silencieux pour le navigateur)

```powershell
.\scripts\set-system-proxy-pac.ps1
# Off:
.\scripts\set-system-proxy-pac.ps1 -Off
```

**Chrome Enterprise / Intune** (exemple) :

| Policy | Valeur |
|--------|--------|
| `ProxyMode` | `pac_script` |
| `ProxyPacUrl` | `http://127.0.0.1:8888/opsgate-proxy.pac` |

Le PAC est servi par le proxy lui-même : le service doit être **up** avant la navigation.

## Soft-block vs soft-mask

| Mode | Env `OPSGATE_PROXY_SOFT_MASK` | Comportement |
|------|-------------------------------|----------------|
| Soft-block (défaut) | unset / `0` / `off` | HTTP **403** ; TLS keep-alive ; site accessible ensuite |
| Soft-mask **on-wire** (P1) | `1` / `onwire` / `true` / `rewrite` | Rewrite du body HTTP/1.1 (JSON/texte/multipart) via engine masker → **forward amont** masqué ; header `X-OpsGate-Masked: 1` ; event `mask_send` |
| Soft-mask **local** | `local` / `422` | HTTP **422** JSON `opsgate_soft_mask` **sans** contacter l’amont (fallback / mode strict) |

### On-wire — détails

- Buffer requête complète → `detectSensitiveData` + `maskSensitiveData` sur le body  
- Recalcule `Content-Length`, retire `Transfer-Encoding: chunked` si décodé  
- JWT / emails session : non masqués (même filtre que soft-block)  
- Body gzip/br ou non-HTTP/1.1 → **fallback local 422**  
- Health : `GET /opsgate-proxy/health` → champ `soft_mask: "off"|"local"|"onwire"`  

```powershell
$env:OPSGATE_PROXY_SOFT_MASK = "1"   # on-wire
# ou
$env:OPSGATE_PROXY_SOFT_MASK = "local"
pnpm proxy:dev
```

## Logs

- `packages/proxy/data/logs/service-stdout.log`
- `packages/proxy/data/logs/service-stderr.log`
- ou `proxy-stdout.log` (silent script)

## Checklist prod

1. API durable (Postgres) joignable  
2. MSI installé **ou** stage + post-install  
3. Node.js 20+ sur le poste  
4. CA trustée (`%ProgramData%\OpsGate\Proxy\ca\ca-cert.pem`)  
5. Enroll proxy OK (`node bin\opsgate-proxy.mjs status`)  
6. Service/tâche auto  
7. PAC/GPO  
8. SIEM org si requis  
9. Test : envoi sensible → mask/403/422, puis navigation site OK  

Voir aussi `PROXY-RUNBOOK.md` · packaging WiX : `packaging/proxy/`.
