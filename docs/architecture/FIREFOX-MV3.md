# OpsGate — Extension Firefox MV3 (V2 P2)

## Cible

| Navigateur | Manifest | Build |
|------------|----------|--------|
| Chrome / Edge / Chromium | MV3 | `pnpm build:chrome` → `build/chrome-mv3-prod` |
| **Firefox** 121+ | MV3 | `pnpm build:firefox` → `build/firefox-mv3-prod` |

ID Gecko : `opsgate@dailyops.local` (`package.json` → `manifest.browser_specific_settings.gecko`).

## Build

```powershell
cd ops-gate
pnpm install
pnpm build:firefox
# ou les deux :
pnpm build:all
```

Dev hot-reload :

```powershell
pnpm dev:firefox
```

## Installation manuelle (Firefox)

1. Ouvrir `about:debugging#/runtime/this-firefox`
2. **Charger un module temporaire…**
3. Sélectionner `build/firefox-mv3-prod/manifest.json`
4. Vérifier l’icône OpsGate dans la barre d’extensions

> Temporary add-on : se décharge au redémarrage de Firefox. Pour la prod : package signé AMO / politique entreprise.

## Package (.zip) / AMO

```powershell
pnpm package:firefox          # plasmo zip
pnpm store:firefox            # AMO ZIP + listing + enterprise templates
# → dist/firefox-amo/opsgate-*-firefox.zip
```

Publication AMO + force-install : [`FIREFOX-AMO.md`](./FIREFOX-AMO.md).

## Différences Chrome vs Firefox

| Sujet | Note |
|-------|------|
| APIs | Shim `src/lib/browser-api.ts` (`ext` → `chrome` ou `browser`) |
| Background | Plasmo génère le worker adapté à la cible |
| Storage / alarms | Supportés MV3 Firefox 121+ |
| Content scripts | Mêmes matches multi-IA |
| Service worker idle | Alarme sync 2 min inchangée |

## Prérequis runtime

- Firefox **≥ 121** (MV3 service worker / extensions modernes)
- API OpsGate joignable pour enroll (même `http://127.0.0.1:8787`)

## Limites connues

- Pas encore de listing **AMO** (Firefox Add-ons) — distribution temporaire / entreprise
- Safari non supporté (P2 ultérieur)
- Certains sites IA peuvent différer légèrement en DOM sous Gecko (même engine de détection)

## Fichiers

| Fichier | Rôle |
|---------|------|
| `package.json` scripts `*:firefox` + gecko id | Build |
| `src/lib/browser-api.ts` | Abstraction API |
| Background / popup / options / CS | utilisent `ext` |
