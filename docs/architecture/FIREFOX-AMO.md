# OpsGate — Firefox AMO & distribution enterprise (V2 P2)

## Objectif

1. Publier l’extension sur **[addons.mozilla.org](https://addons.mozilla.org)** (listed ou **unlisted**).  
2. Distribuer en entreprise via **XPI signé** + `policies.json` (force-install).

Complète le build MV3 : [`FIREFOX-MV3.md`](./FIREFOX-MV3.md).  
**Guide multi-canal** : [`../PUBLICATION-STORES.md`](../PUBLICATION-STORES.md).

## Package

```powershell
cd ops-gate
pnpm store:firefox
# ou
pnpm store:all
.\scripts\package-firefox-amo.ps1
```

Artefacts (`dist/firefox-amo/`) :

| Fichier | Usage |
|---------|--------|
| `opsgate-<ver>-firefox.zip` | Upload développeur AMO |
| `SHA256SUMS.txt` | Intégrité |
| `listing/` | Textes + checklist |
| `source-notes.md` | Notes reviewers (build from source) |
| `enterprise/` | `policies.json` template |

## Identité Gecko

```json
"browser_specific_settings": {
  "gecko": {
    "id": "opsgate@dailyops.local",
    "strict_min_version": "121.0"
  }
}
```

L’id **email-style** est stable pour force-install enterprise (ne pas le changer après déploiement).

## Publication AMO

1. Compte [AMO Developers](https://addons.mozilla.org/developers/)  
2. **Submit a New Add-on**  
3. Choisir :
   - **On this site** (listed / public), ou  
   - **On your own** (**Unlisted**) — recommandé pour pilotes enterprise  
4. Upload `opsgate-*-firefox.zip`  
5. Privacy policy HTTPS (`docs/PRIVACY.md` hébergé)  
6. Attendre signature automatique / review  

Après signature, télécharger le **`.xpi`** signé pour distribution offline.

### Review tips

- Fournir `source-notes.md` (commande `pnpm build:firefox`)  
- Expliquer mode local vs org (metadata only)  
- Hosts IA = content scripts only  

## Force-install enterprise (sans store public)

### 1. XPI signé unlisted

Publier unlisted → télécharger XPI → héberger en HTTPS interne :

```
https://extensions.corp.example/opsgate/opsgate-1.2.0.xpi
```

### 2. policies.json (Firefox ESR / entreprise)

Windows (exemple) :

```
C:\Program Files\Mozilla Firefox\distribution\policies.json
```

Template : `packaging/firefox-amo/enterprise-policies.json.template`

```json
{
  "policies": {
    "ExtensionSettings": {
      "opsgate@dailyops.local": {
        "installation_mode": "force_installed",
        "install_url": "https://extensions.corp.example/opsgate/opsgate-latest.xpi"
      }
    }
  }
}
```

### 3. Intune / GPO

- Déployer le fichier `policies.json` via Intune **Win32** / Prefs  
- Ou ADMX Firefox ESR (ExtensionSettings)  

### Vérification

```
about:policies          → ExtensionSettings applied
about:addons            → OpsGate · managed / not removable
```

## Dev sans signature

```
about:debugging#/runtime/this-firefox
→ Charger un module temporaire
→ build/firefox-mv3-prod/manifest.json
```

## Comparaison Chrome CWS

| | Chrome CWS | Firefox AMO |
|--|------------|-------------|
| Package | `pnpm store:chrome` | `pnpm store:firefox` |
| Force-install | ExtensionInstallForcelist | policies.json ExtensionSettings |
| ID | 32 lettres a-p (après publish) | `opsgate@dailyops.local` (manifest) |
| Doc | `CHROME-WEB-STORE-MDM.md` | ce fichier |

## Checklist DSI

- [ ] Build `pnpm store:firefox`  
- [ ] Compte AMO + unlisted ou listed  
- [ ] Privacy URL  
- [ ] XPI signé hébergé (enterprise)  
- [ ] policies.json déployé  
- [ ] Test user standard : pas de Remove  
