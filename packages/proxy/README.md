# @opsgate/proxy — P0 spike

**Phase** : P0 (design + spike)  
**Doc** : [`docs/architecture/PROXY-P0.md`](../../docs/architecture/PROXY-P0.md)

Proxy HTTP(S) **local** OpsGate :

- Bind **`127.0.0.1`** uniquement (défaut)
- **Allowlist** hosts IA (chatgpt, claude, gemini, grok, …)
- **CONNECT** tunnel (observe passif) — pas de MITM TLS en P0
- **PAC** généré
- **`inspect`** : même `@opsgate/engine` que l’extension

## Prérequis

```bash
# depuis la racine monorepo
pnpm install
```

## Commandes

```bash
# Démarrer le proxy (JSON logs sur stdout)
pnpm proxy:dev

# Générer le PAC
pnpm proxy:pac
# → packages/proxy/opsgate-proxy.pac

# Prouver le chemin engine (détection)
echo "api_key=sk-abcdefghijklmnopqrstuv" | pnpm proxy:inspect
# ou
pnpm --filter @opsgate/proxy inspect -- ../../docs/demo/samples/01-secrets-app.txt
```

Health local (sans PAC) :

```bash
curl http://127.0.0.1:8888/opsgate-proxy/health
```

## Config

| Variable | Défaut | Rôle |
|----------|--------|------|
| `OPSGATE_PROXY_HOST` | `127.0.0.1` | Bind |
| `OPSGATE_PROXY_PORT` | `8888` | Port |
| `OPSGATE_PROXY_ALLOWLIST` | (vide) | Hosts **en plus** (CSV) |

## Brancher Chrome (dev)

### Option A — PAC (recommandé)

1. `pnpm proxy:pac`  
2. `pnpm proxy:dev`  
3. Chrome flags (chemin absolu du `.pac`) :

```text
chrome.exe --proxy-pac-url=file:///C:/Users/.../ops-gate/packages/proxy/opsgate-proxy.pac
```

### Option B — proxy global navigateur

```text
chrome.exe --proxy-server=127.0.0.1:8888
```

Tout le trafic passe au process ; hors allowlist = tunnel direct **sans** inspect.

## Ce que vous devez voir (P0)

Logs JSON quand le navigateur ouvre un site allowlist :

```json
{"msg":"connect","host":"chatgpt.com","allowlisted":true,"mode":"observe_tunnel"}
```

Hors allowlist :

```json
{"msg":"connect","host":"example.com","allowlisted":false,"mode":"direct_tunnel"}
```

## P1 (suivant)

- CA locale + MITM **uniquement** allowlist  
- Parse corps JSON chat (1 host)  
- Mode observe avec détections engine sur le wire  

## Sécurité

- Ne pas exposer le port hors machine  
- Ne pas committer de certificats MITM  
- Events futurs = metadata only (`source: "proxy"`)
