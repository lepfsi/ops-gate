# Backlog V2 — ne pas oublier

Mis à jour : 13 juillet 2026

## Confirmé pour V2 (pas V1)

| Item | Notes |
|------|--------|
| **Parser PDF/DOCX/PPT/XLS réel** | Extraction profonde dans l’extension (pdf.js, mammoth, etc.) — V1 = warn + log |
| **OCR images** | Policy `scanImages` réservée ; OCR offline coûteux |
| **Extension non désinstallable** | Force-install MDM + Chrome Enterprise `ExtensionInstallForcelist` |
| **Réglages système console** | Thème, durée idle custom, timezone, rétention logs |
| **LDAP / AD sync** | Champs prêts ; sync groupes AD → policy |
| **SSO + MFA** | PLATFORM-v2 |
| **Proxy local** | PLATFORM-v2 |
| **Chrome Web Store** | PLATFORM-v2 |
| **Portal personnel cloud** | Billing / multi-device |
| **Bulk CSV import agents** | Au-delà du multi-select UI |
| **Moving rules « permanent » vs one-shot** | Kaspersky a les deux modes — V1 : only_if_unassigned |

## Déjà livré (V1.x) suite retours

- Code org = tenant + licences org  
- Moving rules admin (label/hostname → groupe)  
- Bulk multi-select agents → groupe/profil  
- Groupes éditables + description  
- Audit principal-only + détail policy  
- Idle logout 5 min  
- grok.com, charte DailyOps couleurs console  
- Révocation console → agent local_only sans mdp  

## Liens

- [`ORG-CODE-AND-TENANT.md`](./ORG-CODE-AND-TENANT.md)  
- [`ROADMAP-TESTERS.md`](./ROADMAP-TESTERS.md)  
- [`architecture/PLATFORM-v2.md`](./architecture/PLATFORM-v2.md)  
- [`RULE-PACKS.md`](./RULE-PACKS.md)  
