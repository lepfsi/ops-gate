# Retours testeurs & feuille de route

**Date** : 17 juillet 2026  
**Statut produit** : **V2 functional / pre-GA** — voir [`STATUS-V2.md`](./STATUS-V2.md)

## Fait (V1.x + lot V2)

| Demande | Statut |
|---------|--------|
| Révocation console → agent sans mdp local | ✅ sync ≤2 min / auto local_only |
| Packs de règles expliqués | ✅ `docs/RULE-PACKS.md` + aide console |
| Domaines IA élargis + **grok.com** | ✅ |
| Signatures détection enrichies | ✅ |
| Taille upload 12 Mo | ✅ |
| Charte navy `#0f172a` + cyan `#22d3ee` (logo) | ✅ console |
| Profils : boutons IA + **Add AI** | ✅ |
| Déconnexion idle 5 min + audit admin | ✅ onglet Audit |
| Events conservés après revoke | ✅ |
| Types fichiers élargis (config/SQL/office) | ✅ **PDF/DOCX/PPTX/XLSX** + texte |
| OCR images | ✅ Tesseract.js (policy `scanImages`) |
| Label agent sur unenroll free | ✅ device_label dans events |
| SSO / MFA / passkeys / multi-tenant MSP | ✅ |
| Proxy MSI + soft-block | ✅ |
| Import CSV agents + moving OR/permanent | ✅ |
| Audit WORM + backup + notif multi-canal | ✅ |
| Doc déploiement client | ✅ `DEPLOIEMENT-CLIENT.md` (+ PDF) |

## Limites assumées (pre-GA)

| Sujet | État |
|-------|------|
| Formats Office **legacy** (doc/xls/ppt binaires) | Non supportés → warn |
| OCR multilingue (ex. français) | Pack **eng** par défaut (poids) ; `fra` = suite |
| Bulk 1000 agents → groupe LDAP | Import CSV + LDAP sync ; prune/map profil = optionnel |
| Extension **non désinstallable** Chrome | Force-install MDM / policy enterprise (doc packaging) |
| Publication CWS / AMO / App Store | Artefacts prêts ; **compte éditeur / review** hors monorepo |
| Billing Stripe self-serve | Fondations checkout ; portal GA = suite |
| SAML tous IdP | Signature IdP en prod ; C14N exclusive stricte = suite |

## V2 — Durcissement client & suite

- Extension force-install via Google Admin / Intune (doc `CHROME-WEB-STORE-MDM.md`, `DEPLOIEMENT-CLIENT.md`)  
- Policy Chrome `ExtensionInstallForcelist` + bloquer désinstallation  
- ~~Parser PDF/DOCX/Office réel~~ → **livré** (y compris PPTX/XLSX)  
- ~~OCR~~ → **livré** (Tesseract eng)  
- Publication store réelle + pilote client  
- Voir [`STATUS-V2.md`](./STATUS-V2.md), [`V2-BACKLOG.md`](./V2-BACKLOG.md), design [`architecture/PLATFORM-v2.md`](./architecture/PLATFORM-v2.md)

## Groupes & agents (comment scaler)

1. Créer **groupes** (ex. Finance, Eng)  
2. Créer **profil policy** et cocher les **groupes soumis**  
3. Créer **users** membres des groupes  
4. Sur chaque agent : assigner le **user** (hérite du profil du groupe)  
   ou assigner le **profil** directement  
5. **Import CSV** agents (console Agents) pour bulk terrain  

LDAP/AD : sync console + cron optionnel (`LDAP-AD-SYNC.md`).

## Charte logo

- Navy `#0f172a`, cyan `#22d3ee` / `#67e8f9`  
- Concept : **filtre de sécurité devant une porte de sortie** (gate + shield)  
- Assets : `assets/brand/`, `assets/icons/`  
- Raffinement icon : `assets/brand/opsgate-icon-refined.jpg` (à regénérer multi-tailles pour le store)
