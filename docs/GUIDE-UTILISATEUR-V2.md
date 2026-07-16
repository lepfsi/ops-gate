# OpsGate — Guide utilisateur / administrateur V2

**Version** : 2.0 (alignée produit 1.2 + briques V2)  
**Langue** : Français  
**Public** : administrateurs console, référents sécurité, formateurs  

---

## 1. Introduction

OpsGate protège les données de l’entreprise lorsque les collaborateurs utilisent des **sites d’IA** dans le navigateur.  
Ce guide décrit l’usage quotidien de la **console** et de l’**extension**, ainsi que les options proxy et SSO.

Pour les décideurs (DSI/RSSI) : voir aussi `DECIDEURS-V2-FR.md`.  
Pour les tests techniques : `GUIDE-TEST-V2.md`.

---

## 2. Rôles

| Rôle | Peut |
|------|------|
| **Administrateur principal** | Tout (admins, policy, licences, recovery) |
| **Admin console** | Selon permissions (events, agents, policy…) |
| **Utilisateur final** | Extension : banner mask/block, journal local |

---

## 3. Première connexion console

1. Ouvrir l’URL console (ex. `http://127.0.0.1:5173`).  
2. Vérifier le statut **API OK**.  
3. Se connecter :
   - **SSO** (recommandé si OIDC/SAML configuré), ou  
   - Email / mot de passe (ex. seed `admin@demo.local` / `0000` en démo).  
4. Si **SSO enforce** : seul le bouton SSO est affiché.  
5. Si **MFA TOTP** activé : saisir le code Authenticator.

Changer immédiatement le mot de passe par défaut en production.

---

## 4. Tableaux de bord

- **Vue d’ensemble** : agents en ligne, events, licences.  
- **Events** : filtres décision / sévérité / source (extension vs proxy).  
- **Agents** : groupes, profils, maintenance, export.  
- **Policy** : action par défaut, hosts IA, profils départements.  
- **People** : users & groupes (dont import LDAP).  
- **Paramètres** : monitoring, SIEM, quotas, LDAP, rapports PDF.

**Forcer la synchronisation** : applique la policy aux agents au prochain poll (~2 min).

---

## 5. Extension navigateur

### Installation

| Navigateur | Build | Chargement |
|------------|-------|------------|
| Chrome / Edge | `pnpm build:chrome` | `build/chrome-mv3-prod` |
| Firefox | `pnpm build:firefox` | `about:debugging` → manifest |
| Safari | `pnpm build:safari` | Conversion Xcode (Mac) |

### Usage

1. Aller sur un site IA autorisé.  
2. Saisir un prompt contenant un secret de test.  
3. Le **bandeau OpsGate** propose : masquer & envoyer, envoyer tel quel (si policy), annuler.  
4. Journal local dans la popup (mode local) ; events org si enrôlé.

### Enrôlement org

Options → code org (ex. `DEMO-OPSGATE`) → enroll.  
La policy et le pack de règles se synchronisent automatiquement.

---

## 6. Proxy local (option)

Complète l’extension (filet HTTPS multi-IA).

```powershell
pnpm proxy:gen-ca
# Trust CA
pnpm proxy:enroll
pnpm proxy:dev
```

Modes : `observe` (journal) / `enforce` (block ou soft-mask on-wire).  
Production Windows : `pnpm proxy:msi` (Node portable inclus).

---

## 7. SSO, MFA, passkeys, SAML

| Méthode | Où |
|---------|-----|
| OIDC | Bouton SSO login ; env `OPSGATE_OIDC_*` |
| SAML | `/v1/auth/saml/start` ; env `OPSGATE_SAML_*` |
| MFA TOTP | Paramètres admin connecté |
| WebAuthn | API register/login passkey (console admin) |
| LDAP | Paramètres → LDAP → Test / Sync / Cron |

---

## 8. Licences (côté client)

- Essai 30 jours à la création de l’organisation.  
- Licence full : coller la clé fournie par **DailyOps** (`OPS-XXXX-…`) dans **Paramètres → Gestion des licences → Ajouter**.  
- Les champs société / sièges / expiration sont **remplis par la clé** (lecture seule).  
- Vous **n’émettez pas** de licences depuis la console : l’émission est réservée au fournisseur (voir `LICENCES-CLIENTS.md` côté DailyOps).

---

## 9. Bonnes pratiques admin

1. Postgres durable (`DATABASE_URL`) en pilote réel.  
2. Force-install extension (MDM / AMO) + policy lock.  
3. SSO + MFA pour les admins.  
4. SIEM branché pour le SOC.  
5. Tester un secret **volontaire** chaque mois (contrôle d’efficacité).  
6. Ne jamais committer secrets IdP / bind LDAP.

---

## 10. Support

- Cahier technique : `CHANGELOG-TECHNIQUE.md`, `architecture/*`  
- Privacy : `PRIVACY.md`  
- Runbook proxy : `architecture/PROXY-RUNBOOK.md`  
- Licences (vendeur vs client) : `LICENCES-CLIENTS.md`  

© DailyOps.Tech — OpsGate
