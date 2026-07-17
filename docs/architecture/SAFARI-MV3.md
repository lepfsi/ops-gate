# OpsGate — Safari MV3 (V2 P2 foundations)

## Statut

Plasmo génère une cible **`safari-mv3`**.  
**Prep store** : `pnpm store:safari` → `dist/safari-store/` (+ guide [`PUBLICATION-STORES.md`](../PUBLICATION-STORES.md)).

```powershell
pnpm build:safari
# → build/safari-mv3-prod/

pnpm store:safari
# → dist/safari-store/extension/ + convert-on-macos.sh
```

Safari Web Extensions (macOS / iOS) nécessitent en plus :

1. **Xcode** + « Convert to Safari Web Extension » (ou `xcrun safari-web-extension-converter`)  
2. Compte **Apple Developer** pour distribution (Mac App Store / notarisation)  
3. Ajustements éventuels permissions / App Groups  

## Build

```powershell
cd ops-gate
pnpm install
pnpm build:safari
```

Artefact : `build/safari-mv3-prod/` (manifest MV3 + assets).

Conversion Xcode (macOS) :

```bash
xcrun safari-web-extension-converter build/safari-mv3-prod \
  --project-location ./build/safari-xcode \
  --app-name "OpsGate" \
  --bundle-identifier "tech.dailyops.opsgate" \
  --force
```

Puis ouvrir le projet Xcode → Run sur Safari.

## APIs

L’extension utilise le shim `src/lib/browser-api.ts` (`ext`) — compatible avec le runtime Safari Web Extensions (namespace `browser` / `chrome`).

## Limites

| Sujet | Note |
|-------|------|
| Content scripts multi-IA | Oui si hosts déclarés |
| chrome.alarms | Support Safari 16+ / vérifier version |
| Distribution | App Store Mac / entreprise Apple Business Manager |
| Windows | Safari non disponible — Chrome/Edge/Firefox |

## Checklist pilote Safari

- [ ] `pnpm build:safari`  
- [ ] Conversion Xcode sur Mac  
- [ ] Enable extension in Safari → Develop → Web Extension  
- [ ] Test ChatGPT + banner mask  
- [ ] Enroll API (ATS / localhost exceptions si besoin)  

Voir aussi Firefox AMO / Chrome CWS pour la distribution multi-navigateur.
