# Packaging Chrome Web Store + MDM

```powershell
pnpm store:chrome
# ou tous les stores :
pnpm store:all
```

| Doc | Rôle |
|-----|------|
| [`docs/PUBLICATION-STORES.md`](../../docs/PUBLICATION-STORES.md) | **Guide publication unifié** |
| [`docs/architecture/CHROME-WEB-STORE-MDM.md`](../../docs/architecture/CHROME-WEB-STORE-MDM.md) | Force-install MDM |

| Dossier | Contenu |
|---------|---------|
| `mdm/` | Forcelist, .reg Chrome/Edge, Intune hint, self-hosted update.xml |
| `../store-common/` | Review notes EN + hébergement privacy policy |
