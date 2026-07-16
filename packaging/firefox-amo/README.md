# Packaging Firefox AMO + enterprise

```powershell
pnpm store:firefox
# → dist/firefox-amo/opsgate-*-firefox.zip
```

| Fichier | Usage |
|---------|--------|
| `enterprise-policies.json.template` | Firefox `policies.json` force-install (self-host XPI) |
| `../docs/architecture/FIREFOX-AMO.md` | Guide publication |

Gecko id fixe : `opsgate@dailyops.local` (défini dans `package.json`).
