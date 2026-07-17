# Packaging Firefox AMO + enterprise

```powershell
pnpm store:firefox
# → dist/firefox-amo/opsgate-*-firefox.zip
pnpm store:all
```

| Fichier / doc | Usage |
|---------------|--------|
| `enterprise-policies.json.template` | Firefox `policies.json` force-install (self-host XPI) |
| [`docs/PUBLICATION-STORES.md`](../../docs/PUBLICATION-STORES.md) | **Guide publication unifié** |
| [`docs/architecture/FIREFOX-AMO.md`](../../docs/architecture/FIREFOX-AMO.md) | Détail AMO |

Gecko id fixe : `opsgate@dailyops.local` (défini dans `package.json`).
