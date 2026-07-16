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
- `run-proxy.cmd` — service entry (ProgramData logs)
- `scripts/post-install.ps1` — CA, trust, enroll, scheduled task
- `scripts/uninstall-service.ps1`

## Runtime prerequisite

**Node.js 20+ LTS** must be on PATH (not bundled in MSI v1).

## Docs

`docs/architecture/PROXY-PROD-WINDOWS.md`
