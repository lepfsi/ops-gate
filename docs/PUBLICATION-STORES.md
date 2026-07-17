# OpsGate — Publication stores (CWS · AMO · Safari · Edge)

**Date** : 17 juillet 2026  
**Statut** : **artefacts & process monorepo prêts** · publication réelle = comptes éditeur + review  
**Version code** : 1.2.x  

> Ce document est le **point d’entrée publication**.  
> Détails techniques par canal :  
> - Chrome / Edge MDM → [`architecture/CHROME-WEB-STORE-MDM.md`](./architecture/CHROME-WEB-STORE-MDM.md)  
> - Firefox AMO → [`architecture/FIREFOX-AMO.md`](./architecture/FIREFOX-AMO.md)  
> - Safari → [`architecture/SAFARI-MV3.md`](./architecture/SAFARI-MV3.md)  

---

## 1. Vue d’ensemble

| Canal | Commande package | Artefact | Force-install enterprise |
|-------|------------------|----------|--------------------------|
| **Chrome Web Store** | `pnpm store:chrome` | `dist/chrome-store/*.zip` | `ExtensionInstallForcelist` (GPO/Intune) |
| **Edge Add-ons** | même ZIP Chrome (ou soumission Edge) | idem | Forcelist Edge |
| **Firefox AMO** | `pnpm store:firefox` | `dist/firefox-amo/*.zip` | `policies.json` + XPI signé |
| **Safari App Store** | `pnpm store:safari` | `dist/safari-store/extension/` | Apple Business Manager |

Tout en une fois :

```powershell
cd ops-gate
pnpm store:all
# → dist/chrome-store/ · dist/firefox-amo/ · dist/safari-store/ · dist/STORES-INDEX.md
```

Sans rebuild (si builds déjà présents) :

```powershell
.\scripts\package-all-stores.ps1 -SkipBuild
```

---

## 2. Prérequis éditeur (ops / legal)

| Prérequis | Chrome | Firefox | Safari |
|-----------|--------|---------|--------|
| Compte développeur | [CWS DevConsole](https://chrome.google.com/webstore/devconsole) (~5 USD one-time) | [AMO Developers](https://addons.mozilla.org/developers/) (gratuit) | [Apple Developer](https://developer.apple.com) (99 USD/an) |
| Privacy policy **HTTPS publique** | Oui | Oui | Oui (App Privacy) |
| Screenshots | ≥ 1 (1280×800) | ≥ 1 | Mac App Store |
| Single purpose / justification perms | Oui | Notes review | Nutrition labels |
| Identité stable | Extension ID **après** 1ʳᵉ publish | `opsgate@dailyops.local` (déjà dans manifest) | Bundle `tech.dailyops.opsgate` |

### Privacy policy

1. Héberger `docs/PRIVACY.md` en HTML/HTTPS (site DailyOps / GitHub Pages / console publique).  
2. URL stable du type `https://dailyops.tech/opsgate/privacy` (exemple).  
3. Coller l’URL dans chaque formulaire store.

Sans URL HTTPS publique, **la review échoue**.

---

## 3. Chrome Web Store (priorité pilote Windows)

### 3.1 Package

```powershell
pnpm store:chrome
```

| Sortie | Rôle |
|--------|------|
| `dist/chrome-store/opsgate-*-chrome.zip` | Upload CWS |
| `listing/` | Textes + checklist |
| `mdm/` | REG / Intune / forcelist |
| `SHA256SUMS.txt` | Intégrité |

### 3.2 Soumission (console Google)

1. **New item** → upload ZIP  
2. Remplir Name / Summary / Description (`listing/store-description.txt`)  
3. Category : Productivity  
4. Privacy policy URL  
5. Single purpose : *Prevent accidental leakage of sensitive data into generative AI web apps*  
6. Permission justifications (voir `listing/README.md`)  
7. Screenshots : popup + banner mask + options enroll  
8. Visibility recommandée pilote : **Unlisted** (lien direct) ou **Private** (domaines Google Workspace)  
9. Submit for review  

### 3.3 Après acceptation

1. Noter **Extension ID** (32 caractères `a`–`p`)  
2. Écrire dans `packaging/chrome-store/mdm/extension-id.placeholder`  
3. Remplacer `EXTENSION_ID` dans les `.reg` et Intune JSON  
4. Déployer forcelist (voir CHROME-WEB-STORE-MDM)

### 3.4 Edge

- Option A : même ID CWS si sync Edge Add-ons  
- Option B : [Partner Center](https://partner.microsoft.com/dashboard) → soumettre le même ZIP  
- Forcelist : `packaging/chrome-store/mdm/edge-force-install.reg`

---

## 4. Firefox AMO

### 4.1 Package

```powershell
pnpm store:firefox
```

Gecko id stable : **`opsgate@dailyops.local`** (ne pas changer après déploiement).

### 4.2 Soumission

1. [Submit a New Add-on](https://addons.mozilla.org/developers/addon/submit/)  
2. **On your own (Unlisted)** recommandé pour enterprise  
3. Upload ZIP  
4. Privacy policy URL  
5. Joindre notes : `dist/firefox-amo/source-notes.md`  
6. Attendre signature  

### 4.3 Enterprise

1. Télécharger le **`.xpi` signé**  
2. Héberger en HTTPS interne  
3. `policies.json` → `packaging/firefox-amo/enterprise-policies.json.template`  
4. `about:policies` pour vérifier  

---

## 5. Safari (macOS / iOS)

### 5.1 Package (Windows ou Mac)

```powershell
pnpm store:safari
# → dist/safari-store/extension/
```

### 5.2 Conversion (Mac + Xcode uniquement)

```bash
bash dist/safari-store/convert-on-macos.sh
# ou
xcrun safari-web-extension-converter dist/safari-store/extension \
  --project-location ./build/safari-xcode \
  --app-name "OpsGate" \
  --bundle-identifier "tech.dailyops.opsgate" \
  --force
```

### 5.3 Distribution

| Mode | Usage |
|------|--------|
| Mac App Store | Public / ABM |
| Developer ID + notarize | Install hors store (enterprise) |
| Sideload dev | Safari → Develop → Web Extension |

Parc **Windows** : Safari n’existe pas — prioriser Chrome/Edge + Firefox.

---

## 6. Assets graphiques (checklist)

| Asset | Source repo | Statut |
|-------|-------------|--------|
| Icon 16–128 | `assets/icons/icon-*.png` | ✅ |
| Icon 128 store | `assets/icons/icon-128.png` | ✅ |
| Banner | `assets/brand/opsgate-banner-1280.png` | ✅ à recadrer si besoin |
| Screenshots 1280×800 | **À capturer** (popup, banner, options) | ⬜ ops |
| Promo 440×280 / 1400×560 | Optionnel CWS | ⬜ |

---

## 7. Justifications review (copier-coller)

**Single purpose**  
Prevent accidental leakage of secrets, PII and infrastructure configs into generative AI web applications.

**Data use**  
- Local mode: all processing on-device; no OpsGate network.  
- Org mode: optional enrollment; only **detection metadata** (rule types, decision, hostname) — not full prompt text by default.  
- No ads, no sale of user data.

**Hosts**  
Content scripts only on an allowlist of generative-AI sites (ChatGPT, Claude, Gemini, Copilot, etc.). Optional `127.0.0.1` for on-prem control plane during pilots.

---

## 8. Checklist « publication done » (GA)

- [ ] Privacy policy HTTPS live  
- [ ] Screenshots capturés et uploadés  
- [ ] **CWS** : ZIP soumis · review OK · Extension ID documenté · forcelist testée  
- [ ] **AMO** : unlisted signé · XPI hébergé ou listed · policies.json testée  
- [ ] **Safari** : (optionnel GA1) Xcode ship ou explicitement hors scope pilote Windows  
- [ ] `dist/STORES-INDEX.md` archivé avec SHA-256  
- [ ] DEPLOIEMENT-CLIENT checklist § extension force-install validée chez client  

---

## 9. Commandes récap

```powershell
pnpm store:chrome     # CWS + MDM
pnpm store:firefox    # AMO + enterprise
pnpm store:safari     # prep App Store / Xcode
pnpm store:all        # les trois + dist/STORES-INDEX.md
```

```powershell
# Validation rapide présence artefacts
Test-Path dist\chrome-store\*.zip
Test-Path dist\firefox-amo\*.zip
Test-Path dist\safari-store\extension\manifest.json
Get-Content dist\STORES-INDEX.md
```

---

## 10. Ce que le monorepo ne peut pas faire

| Action | Qui |
|--------|-----|
| Payer le compte CWS / Apple | Éditeur / finance |
| Cliquer « Submit for review » | Ops produit |
| Passer la review Google/Mozilla/Apple | Reviewers stores |
| Capturer screenshots marketing | Design / PM |
| Héberger privacy policy HTTPS | Infra site |

Le monorepo livre les **ZIP, listing, policies MDM, checklists et SHA-256**.  
La « publication réelle » est un **runbook ops** une fois les comptes ouverts.

---

*OpsGate · PUBLICATION-STORES · DailyOps.Tech · 17 juillet 2026*
