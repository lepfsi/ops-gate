# OpsGate — Chrome Web Store & force-install MDM (V2 P2)

## Objectif

1. **Publier** l’extension sur le Chrome Web Store (ou Edge Add-ons).  
2. **Forcer l’install** sur le parc via GPO / Intune / Chrome Enterprise (non désinstallable par l’utilisateur).

**Guide publication multi-canal** : [`../PUBLICATION-STORES.md`](../PUBLICATION-STORES.md).

## Package store

```powershell
cd ops-gate
pnpm store:chrome
# ou tous les stores :
pnpm store:all
# ou
.\scripts\package-chrome-store.ps1
```

Artefacts (`dist/chrome-store/`) :

| Fichier | Usage |
|---------|--------|
| `opsgate-<ver>-chrome.zip` | Upload dev console CWS |
| `SHA256SUMS.txt` | Intégrité |
| `listing/` | Textes + checklist |
| `mdm/` | REG, Intune, forcelist |

Build seul :

```powershell
pnpm build:chrome
pnpm package:chrome   # plasmo package zip
```

## Publication Chrome Web Store

1. Compte [Chrome Web Store Developer](https://chrome.google.com/webstore/devconsole)  
2. **New item** → upload le ZIP  
3. Renseigner listing (`dist/chrome-store/listing/`)  
4. Privacy policy HTTPS (héberger `docs/PRIVACY.md`)  
5. Justifier permissions (storage, alarms, hosts IA)  
6. Soumettre review  
7. **Noter l’Extension ID** (32 caractères `a`–`p`)

Remplacer `EXTENSION_ID` dans tous les fichiers `packaging/chrome-store/mdm/`.

### Notes review

- Mode **local** : zéro réseau OpsGate.  
- Mode **org** : métadonnées d’events uniquement (pas le corps du prompt par défaut).  
- Hosts `127.0.0.1` : control plane local / pilote — acceptable si décrit.

## Force-install MDM

### Principe

Policy Chrome Enterprise :

```
ExtensionInstallForcelist =
  <EXTENSION_ID>;https://clients2.google.com/service/update2/crx
```

Effets :

- Install auto  
- Mises à jour via le store  
- Utilisateur **ne peut pas désinstaller** (icône grisée / managed)

### Windows GPO / Registry

Fichier prêt : `packaging/chrome-store/mdm/chrome-force-install.reg`

```
HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist
  "1" = "EXTENSION_ID;https://clients2.google.com/service/update2/crx"
```

Edge : `packaging/chrome-store/mdm/edge-force-install.reg`  
(`Software\Policies\Microsoft\Edge\ExtensionInstallForcelist`)

### Microsoft Intune

1. **Devices → Configuration → Create → Settings catalog**  
2. Search **Google Chrome** → **Extension install forcelist**  
3. Value : `EXTENSION_ID;https://clients2.google.com/service/update2/crx`  
4. Assign to device groups  

JSON d’aide : `packaging/chrome-store/mdm/intune-settings-catalog.json`

### Chrome Browser Cloud Management

1. [admin.google.com](https://admin.google.com) → Devices → Chrome → Apps & extensions  
2. Add from Chrome Web Store → OpsGate  
3. Installation policy : **Force install** (+ pin optionnel)

### Vérification poste

```
chrome://policy          → ExtensionInstallForcelist = OK
chrome://extensions      → OpsGate · "Installed by your administrator"
```

## Self-hosted CRX (airgap)

Si pas de CWS (réseau isolé) :

1. Générer une clé d’extension stable (ID fixe)  
2. Signer un `.crx`  
3. Héberger `updates.xml` + `.crx` en HTTPS interne  
4. Forcelist : `ID;https://extensions.corp…/updates.xml`  

Template : `packaging/chrome-store/mdm/self-hosted-update.xml.template`

## Complément verrou endpoint

Force-install MDM empêche la **désinstallation** navigateur.  
Le **policy lock** OpsGate (`ENDPOINT-LOCK.md`) empêche le contournement **dans** l’extension (désactivation UI / unenroll).

Les deux se complètent.

## Checklist DSI

- [ ] Extension publiée (ou CRX self-host)  
- [ ] Extension ID documenté  
- [ ] Forcelist GPO / Intune / CBCM  
- [ ] Privacy policy URL  
- [ ] Enroll org code + API joignable (mode managé)  
- [ ] Proxy PAC optionnel (data-plane)  
- [ ] Test user standard : pas de Remove  

## Fichiers

| Chemin | Rôle |
|--------|------|
| `scripts/package-chrome-store.ps1` | Build + ZIP + listing |
| `packaging/chrome-store/mdm/*` | Policies |
| `docs/PRIVACY.md` | Policy store |
| `docs/architecture/ENDPOINT-LOCK.md` | Tamper in-app |
