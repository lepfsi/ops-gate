# Backlog V2 — ne pas oublier

Mis à jour : 13 juillet 2026

## Confirmé pour V2 (pas V1)

| Item | Notes |
|------|--------|
| **Parser PPT/XLS / Office legacy** | PDF+DOCX en V1.x (pdfjs + mammoth) ; reste xlsx/pptx/doc |
| **OCR images** | Policy `scanImages` réservée ; OCR offline coûteux |
| **Extension non désinstallable** | Force-install MDM + Chrome Enterprise `ExtensionInstallForcelist` |
| **Réglages système console** | Thème, durée idle custom, timezone, rétention logs, **langue UI** |
| **LDAP / AD sync** | Champs prêts ; sync groupes AD → policy |
| **SSO + MFA** | PLATFORM-v2 |
| **Proxy local** | **Saut data-plane** — P0–P2 dans `packages/proxy` : PAC, MITM observe, enroll, events `source=proxy`. P3 = installer + console badge + enforce. |
| **Chrome Web Store** | PLATFORM-v2 |
| **Multi-navigateur (Firefox / Safari)** | Chromium (Chrome/Edge/Brave/Opera) = Plasmo MV3 aujourd’hui. Firefox = manifest V2/V3 adapté + build `plasmo --target=firefox-mv3`. Safari = port Xcode / App Store (lourd). Voir `docs/CAHIER-CONCEPTEUR.md` § multi-browser |
| **Portal personnel cloud** | Billing / multi-device |
| **Bulk CSV import agents** | Au-delà du multi-select UI |
| **Moving rules OR / permanent** | V1.x : AND multi-cond + priorité ; modes permanent / one-shot Kaspersky en V2 |

## Déjà livré (V1.x) suite retours

- Code org = tenant + licences org  
- Moving rules multi-conditions AND + priorité editable / ↑↓  
- Bulk multi-select agents → groupe/profil  
- Groupes éditables + description  
- Audit principal-only + détail policy  
- Events avec filtres (décision / sévérité / source / recherche)  
- Idle logout 5 min + **session unique par compte admin**  
- grok.com + liste élargie sites IA local_only  
- HostPicker « + Add AI » (customs visibles)  
- PDF/DOCX parse réel (mammoth + pdfjs)  
- Cahier concepteur `docs/CAHIER-CONCEPTEUR.md`  
- Charte DailyOps couleurs console  
- Révocation console → agent local_only sans mdp  

## Liens

- [`CAHIER-CONCEPTEUR.md`](./CAHIER-CONCEPTEUR.md)  
- [`ORG-CODE-AND-TENANT.md`](./ORG-CODE-AND-TENANT.md)  
- [`ROADMAP-TESTERS.md`](./ROADMAP-TESTERS.md)  
- [`architecture/PLATFORM-v2.md`](./architecture/PLATFORM-v2.md)  
- [`RULE-PACKS.md`](./RULE-PACKS.md)  
