# Retours testeurs & feuille de route

**Date** : 13 juillet 2026

## Fait dans cette itération

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
| Types fichiers élargis (config/SQL/warn media/office) | ✅ partiel (voir limites) |
| Label agent sur unenroll free | ✅ device_label dans events |

## Limites assumées (V1.x)

| Sujet | État |
|-------|------|
| PDF / Word / PPT / XLS parsing profond | **Warn + log** (pas d’extraction complète) |
| OCR images | **Stub** (policy `scanImages` réservée) |
| Bulk 1000 agents → groupe LDAP | Partial : groupes + profils + assign user/profile |
| Extension **non désinstallable** Chrome | **V2** — force-install MDM / Chrome enterprise policy |
| Préférences système (thème, idle custom) | **V2** — fondation audit + idle fixe 5 min |

## V2 — Durcissement client

- Extension force-install via Google Admin / Intune  
- Policy Chrome `ExtensionInstallForcelist` + bloquer désinstallation  
- Voir `architecture/PLATFORM-v2.md`

## Groupes & agents (comment scaler)

1. Créer **groupes** (ex. Finance, Eng)  
2. Créer **profil policy** et cocher les **groupes soumis**  
3. Créer **users** membres des groupes  
4. Sur chaque agent : assigner le **user** (hérite du profil du groupe)  
   ou assigner le **profil** directement  

Bulk massif (CSV / LDAP) → V2.1.

## Charte logo

- Navy `#0f172a`, cyan `#22d3ee` / `#67e8f9`  
- Concept : **filtre de sécurité devant une porte de sortie** (gate + shield)  
- Assets : `assets/brand/`, `assets/icons/`  
- Raffinement icon : `assets/brand/opsgate-icon-refined.jpg` (à regénérer multi-tailles pour le store)
