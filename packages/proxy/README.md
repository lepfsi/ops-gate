# @opsgate/proxy — P1 (MITM observe)

**Phase** : P1  
**Docs** : [`PROXY-P0.md`](../../docs/architecture/PROXY-P0.md) · [`PROXY-P1.md`](../../docs/architecture/PROXY-P1.md)

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
```

Redémarrer Chrome/Edge après install CA.

## Commandes

```powershell
cd C:\Users\Utilisateur\ops-gate

pnpm proxy:dev          # 127.0.0.1:8888
pnpm proxy:pac          # génère opsgate-proxy.pac
pnpm proxy:inspect      # engine partagé (stdin/fichier)
pnpm proxy:gen-ca       # (re)génère CA
pnpm proxy:ca-path      # chemins + hint certutil
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

## Sécurité

- CA **dev uniquement** — ne pas committer `data/ca/ca-key.pem`
- Bind loopback only
- Logs : metadata + previews redactées, **pas** le prompt brut
- Pas de MITM hors allowlist

## P2 (suivant)

Enroll proxy, events API `source=proxy`, pack sync, mode enforce.
