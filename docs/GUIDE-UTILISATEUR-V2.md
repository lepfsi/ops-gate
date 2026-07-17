# OpsGate — Guide utilisateur / administrateur V2

**Version** : 2.1 (produit 1.2 + lot V2 juillet 2026)  
**Maturité** : **V2 functional / pre-GA** — [`STATUS-V2.md`](./STATUS-V2.md)  
**Langue** : Français  
**Public** : administrateurs console, référents sécurité, formateurs  

---

## 1. Introduction

OpsGate protège les données de l’entreprise lorsque les collaborateurs utilisent des **sites d’IA** dans le navigateur.  
Ce guide décrit l’usage quotidien de la **console** et de l’**extension**, ainsi que les options proxy et SSO.

Pour les décideurs (DSI/RSSI) : voir aussi `DECIDEURS-V2-FR.md`.  
Pour l’**installation chez le client** : `DEPLOIEMENT-CLIENT.md` (+ PDF).  
Pour les tests techniques : `GUIDE-TEST-V2.md`.  
Pour l’avancement global : `STATUS-V2.md`.

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
   - Email / mot de passe (ex. seed `admin@demo.local` / `0000` en démo), ou  
   - **Passkey / Windows Hello** (si enregistrée).  
4. Si **SSO enforce** : seul le bouton SSO est affiché.  
5. Si **MFA TOTP** activé : saisir le code Authenticator.  
6. **Session déjà ouverte** : demande d’acceptation (10 s) ou connexion **lecture seule**.  
7. **Multi-org** : choisir l’organisation ; bascule ultérieure = **code MFA** (portfolio MSP).

Changer immédiatement le mot de passe par défaut en production.

---

## 4. Tableaux de bord & navigation

- **Dashboard** : widgets libres (drag / resize), licences, connectivité, activité, messages.  
- **Portfolio MSP** (si multi-org) : KPI cross-tenants, ouverture avec MFA.  
- **Messages** : inbox user → admin (répondre, clôturer, ack client).  
- **Events** : filtres décision / sévérité / source (extension vs proxy).  
- **Agents** : groupes, profils, maintenance, **export + import CSV**.  
- **Policy** : action par défaut, hosts IA, profils départements.  
- **People** : users & groupes (dont import LDAP).  
- **Règles auto** : conditions **AND/OR**, règle **permanente**.  
- **Audit** : journal WORM + vérification d’intégrité (principal).  
- **Paramètres** : monitoring, SIEM, SMTP, notifications multi-canaux, LDAP, rapports, backup.

**Deep-links** : `#/dashboard`, `#/settings/mail`, `#/messages`, etc.  
**Forcer la synchronisation** : policy aux agents au prochain poll (~2 min).

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
4. Joindre un fichier : scan **PDF / DOCX / PPTX / XLSX** ; **OCR images** si activé en policy.  
5. **Contacter l’admin** depuis l’extension (messages).  
6. Journal local dans la popup ; events org si enrôlé.

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
| SAML | `/v1/auth/saml/start` ; env `OPSGATE_SAML_*` (signature IdP en prod) |
| MFA TOTP | Paramètres → Général (QR) ; **obligatoire multi-org** |
| WebAuthn / passkeys | Paramètres → Général + bouton login |
| LDAP | Paramètres → LDAP → Test / Sync / Cron |

---

## 8. Exports, alertes, backup

| Fonction | Où |
|----------|-----|
| Export logs planifié (e-mail) | Paramètres → Rapports + SMTP |
| Test envoi export | Bouton **Envoyer un export test maintenant** |
| Alertes licence / lockout / recovery | Paramètres → Notifications (+ Telegram/Slack) |
| Backup config org | Paramètres → Général → Exporter / Importer |
| Backup Postgres | `scripts/backup-db.ps1` (voir `architecture/BACKUP.md`) |

---

## 9. Mot de passe oublié (OTP e-mail)

1. Écran de login → récupération mot de passe.  
2. Saisir l’e-mail de l’**administrateur principal**.  
3. Un **OTP** est envoyé par e-mail (SMTP configuré côté API : `OPSGATE_SMTP_*`).  
4. Saisir l’OTP + nouveau mot de passe.  

Sans SMTP (lab) : l’OTP peut apparaître dans les logs API / mode dev uniquement.  
Détail ops : `architecture/SMTP-MAIL.md`.

---

## 10. Licences (côté client)

- Essai 30 jours à la création de l’organisation.  
- Licence full : coller la clé fournie par **DailyOps** (`OPS-XXXX-…`) dans **Paramètres → Gestion des licences → Ajouter**.  
- Les champs société / sièges / expiration sont **remplis par la clé** (lecture seule).  
- Vous **n’émettez pas** de licences depuis la console : l’émission est réservée au fournisseur (voir `LICENCES-CLIENTS.md` côté DailyOps).

---

## 11. Bonnes pratiques admin

1. Postgres durable (`DATABASE_URL`) en pilote réel.  
2. Force-install extension (MDM / AMO) + policy lock.  
3. SSO + MFA (et passkeys) pour les admins ; MFA multi-tenant.  
4. SMTP réel pour reset mdp / OTP / exports.  
5. SIEM branché pour le SOC.  
6. Backup DB quotidien + export config avant upgrade.  
7. Tester un secret **volontaire** chaque mois (contrôle d’efficacité).  
8. Ne jamais committer secrets IdP / bind LDAP / SMTP / Stripe.

---

## 12. Support

- Statut produit V2 : `STATUS-V2.md`  
- Déploiement client : `DEPLOIEMENT-CLIENT.md`  
- Cahier technique : `CHANGELOG-TECHNIQUE.md`, `architecture/*`  
- Privacy : `PRIVACY.md`  
- Runbook proxy : `architecture/PROXY-RUNBOOK.md`  
- Licences (vendeur vs client) : `LICENCES-CLIENTS.md`  

© DailyOps.Tech — OpsGate
