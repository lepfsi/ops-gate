# @opsgate/proxy — MITM local multi-IA

**Version** : 1.2.x · modes **observe** / **enforce**  
**Docs** : [`PROXY-P0.md`](../../docs/architecture/PROXY-P0.md) · [`PROXY-P1.md`](../../docs/architecture/PROXY-P1.md) · [`PROXY-P2.md`](../../docs/architecture/PROXY-P2.md) · [`PROXY-PROD-WINDOWS.md`](../../docs/architecture/PROXY-PROD-WINDOWS.md) · runbook [`PROXY-RUNBOOK.md`](../../docs/architecture/PROXY-RUNBOOK.md)

Proxy HTTP(S) **local** OpsGate :

| Mode | Comportement |
|------|----------------|
| Host **allowlist** + MITM | TLS déchiffré, **observe** engine, pas de rewrite |
| Host hors allowlist | Tunnel transparent (P0) |
| `OPSGATE_PROXY_MITM=0` | Tunnel partout (P0) |

## Important — répertoire de travail

Toujours depuis la **racine monorepo** :

```powershell
cd C:\Users\Utilisateur\ops-gate
```

Sinon : `ERR_PNPM_NO_PKG_MANIFEST`.

## Setup (une fois)

```powershell
cd C:\Users\Utilisateur\ops-gate
pnpm install
pnpm proxy:gen-ca
pnpm proxy:ca-path
# Installer la CA dans le magasin utilisateur Windows :
certutil -addstore -user Root "C:\Users\Utilisateur\ops-gate\packages\proxy\data\ca\ca-cert.pem"

# Control plane (API doit tourner)
pnpm api:dev            # autre terminal
pnpm proxy:enroll       # ou auto au premier proxy:dev
```

Redémarrer Chrome/Edge après install CA.

## Commandes

```powershell
cd C:\Users\Utilisateur\ops-gate

pnpm proxy:dev          # 127.0.0.1:8888 (+ auto-enroll si API up)
pnpm proxy:enroll       # enroll agent type proxy
pnpm proxy:status       # CA + agent_id
pnpm proxy:pac          # génère opsgate-proxy.pac
pnpm proxy:inspect      # engine partagé (stdin/fichier)
pnpm proxy:gen-ca       # (re)génère CA
pnpm proxy:ca-path      # chemins + hint certutil
pnpm proxy:package      # stage portable + Node embarqué + ZIP
pnpm proxy:msi          # MSI WiX (inclut runtime\node\node.exe)
```

Health :

```powershell
curl http://127.0.0.1:8888/opsgate-proxy/health
```

## Brancher le navigateur

**PAC (recommandé)** :

```text
chrome.exe --proxy-pac-url=file:///C:/Users/Utilisateur/ops-gate/packages/proxy/opsgate-proxy.pac
```

**Proxy global** :

```text
chrome.exe --proxy-server=127.0.0.1:8888
```

## Variables d’environnement

| Variable | Défaut | Rôle |
|----------|--------|------|
| `OPSGATE_PROXY_HOST` | `127.0.0.1` | Bind |
| `OPSGATE_PROXY_PORT` | `8888` | Port |
| `OPSGATE_PROXY_ALLOWLIST` | — | Hosts extra (CSV) |
| `OPSGATE_PROXY_MITM` | `1` | `0` = tunnel only |
| `OPSGATE_API_URL` | `http://127.0.0.1:8787` | Control plane |
| `OPSGATE_ORG_CODE` | `DEMO-OPSGATE` | Org enroll |
| `OPSGATE_PROXY_AUTO_ENROLL` | `1` | Enroll au serve si pas de token |
| `OPSGATE_PROXY_MODE` | `enforce` | `enforce` = block/mask medium/high ; `observe` = journal seul |
| `OPSGATE_PROXY_SOFT_MASK` | off | `1`/`onwire` = rewrite body masqué + forward ; `local` = 422 sans amont |
| `OPSGATE_PROXY_HTTP2` | `1` | `0` = forcer ALPN HTTP/1.1 only ; `1` = h2 stream-aware (RST / mask DATA) |

## Chrome (test forcé — fiable sous Windows)

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="$env:TEMP\opsgate-chrome-proxy-test" --proxy-server="127.0.0.1:8888" --disable-quic "https://chatgpt.com"
```

PAC HTTP (proxy déjà lancé) :

```text
--proxy-pac-url=http://127.0.0.1:8888/opsgate-proxy.pac
```

## Sécurité

- CA **dev uniquement** — ne pas committer `data/ca/ca-key.pem`
- Bind loopback only
- Logs : metadata + previews redactées, **pas** le prompt brut
- Pas de MITM hors allowlist

## P2 (livré)

- Enroll `device_type=proxy` → `data/agent.json`
- Events `source=proxy` / `decision=observe` vers la console

## P3 foundations (en cours)

- Badge console **Proxy** (`device_type`)
- Sync config / heartbeat (`GET /v1/agents/me/config` toutes les 2 min)
- Flags org `proxy.mode` observe|enforce (enforce = stub log)
- Helper : `.\scripts\install-proxy-windows.ps1`

Voir [`PROXY-P3.md`](../../docs/architecture/PROXY-P3.md).
