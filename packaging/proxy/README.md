# OpsGate Proxy — packaging Windows (MSI)

## Build

From monorepo root:

```powershell
pnpm proxy:package   # stage + ZIP only
pnpm proxy:msi       # stage + MSI (WiX 3.14 auto-download → tools/wix314)
```

Outputs (gitignored under `dist/`) :

| Artefact | Rôle |
|----------|------|
| `dist/proxy-stage/` | Layout installable |
| `dist/opsgate-proxy-<ver>-win-x64.zip` | Portable |
| `dist/opsgate-proxy-<ver>.msi` | Windows Installer |

## Contents of stage / MSI

- `bin/opsgate-proxy.mjs` — esbuild bundle (engine + node-forge)
- `runtime/node/node.exe` — **Node portable** win-x64 (officiel nodejs.org, pin LTS)
- `run-proxy.cmd` / `opsgate-proxy.cmd` — service + CLI (utilisent le Node embarqué)
- `scripts/post-install.ps1` — CA, trust, enroll, scheduled task
- `scripts/uninstall-service.ps1`

## Runtime

**Aucun Node système requis** : le stage/MSI embarque `runtime/node/node.exe`.

| Option | Effet |
|--------|--------|
| (défaut) | Télécharge Node **v22.14.0** win-x64 → cache `tools/cache/` |
| `-NodeVersion 20.18.1` | Pin une autre version |
| `$env:OPSGATE_EMBED_NODE_VERSION` | Idem |
| `-SkipEmbeddedNode` | Stage sans Node (PATH requis) |

Redistribution : binaire officiel Node (licence MIT) — voir `runtime/node/LICENSE`.

## Docs

`docs/architecture/PROXY-PROD-WINDOWS.md`
