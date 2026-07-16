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

| Mode | Env | Comportement |
|------|-----|----------------|
| Soft-block (défaut enforce) | — | HTTP **403** sur la requête sensible ; TLS keep-alive ; site accessible ensuite |
| Soft-mask (P1) | `OPSGATE_PROXY_SOFT_MASK=1` | HTTP **422** JSON `opsgate_soft_mask` sans contacter l’amont ; session conservée |

> Soft-mask n’est **pas** un rewrite du JSON ChatGPT/Claude : c’est une réponse locale neutre. Un vrai mask on-wire multi-vendor reste roadmap V2.x.

## Logs

- `packages/proxy/data/logs/service-stdout.log`
- `packages/proxy/data/logs/service-stderr.log`
- ou `proxy-stdout.log` (silent script)

## Checklist prod

1. API durable (Postgres) joignable  
2. CA trustée  
3. Enroll proxy OK (`pnpm proxy:status`)  
4. Service/tâche auto  
5. PAC/GPO  
6. SIEM org si requis  
7. Test : envoi sensible → 403/422, puis navigation site OK  

Voir aussi `PROXY-RUNBOOK.md`.
