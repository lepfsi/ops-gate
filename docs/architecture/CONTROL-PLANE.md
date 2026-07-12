# Control plane — force-sync, policies, multi-admins, groups, recovery

**Date** : 11 juillet 2026  
**Statut** : Pilot v1.1+

## Auth console & admins

1. **Administrator principal** (setup) : email install (`OPSGATE_SETUP_EMAIL` / `admin@demo.local`), mdp défaut `0000` (`OPSGATE_SETUP_PASSWORD`) — à changer.  
2. Login console obligatoire (`POST /v1/auth/login` → Bearer session).  
3. **OTP** = reset **uniquement** le principal (email principal).  
4. Admins secondaires : **email obligatoire** + rôles  
   `console_access | unenroll_agents | manage_admins | manage_policies | manage_users`.  
5. Protection désenrôlement endpoint : policy/profil `protect_unenroll` + admins avec droit `unenroll_agents` (principal inclus).  
6. Event unenroll : `admin:Label` | `vendor_recovery` | `free`.

### Vendor recovery (limité)

- Accepté **seulement** si last sync agent **≥ 2h** (poll 15 min).  
- Postes encore synchronisés reçoivent les nouveaux mdp via sync → pas de wipe massif si fuite du secret vendor.

## Groupes & users (pré-LDAP)

- **Groupes** → optionnellement liés à un profil policy.  
- **Users** → membres de groupes.  
- **Agents** → liés à un user (hérite policy du groupe) ou override profil manuel.  
- À la création d’un profil : sélection groupes / users soumis.

### Roadmap LDAP

Sync AD/LDAP pour :
- importer groupes AD (`ldapExternalId`) ;
- mapper groupe AD → policy profil ;
- assigner automatiquement l’agent au user/groupe AD au enroll.

Champs déjà prévus : `OrgUser.externalId`, `UserGroup.ldapExternalId`.

## Force-sync (pas de visite poste par poste)

Les extensions Chrome ne reçoivent pas de push TCP fiable sans FCM/WebPush.

**Modèle OpsGate :**

1. Console → **Forcer la synchronisation** (`POST /v1/org/force-sync`)  
   → incrémente `policy.configEpoch` (+ version).
2. Agents **pollent toutes les 2 minutes** (`chrome.alarms`).
3. Au sync, l’agent applique hosts / uploads / event_reporting / pack / mdp / profil.

Toute modification de policy ou de profil déclenche aussi un bump d’epoch.

## Policy customisable (console)

Onglet **Policy** :

| Champ | Effet agent |
|-------|-------------|
| Sites IA (hosts) | Sur quels domaines le content-script filtre |
| Scanner uploads | `scanUploads` |
| Collecte events | `eventReporting` (télémétrie cloud) |
| Action défaut | warn / mask_* / block |
| Mdp désinscription | optionnel |

### Profils département (policy1, policy2…)

- Créer des profils (ex. **Finance** : pas d’upload, hosts réduits).
- Onglet **Agents** → assigner un profil.
- Config agent sert la **policy effective** (profil ou défaut org).

## Events

- Agent journalise localement + envoie `/v1/events/batch` (metadata only).
- Si échec (API down, token) → **file d’attente** locale, flush au prochain sync.
- `rule_ids` renseignés depuis les détections.
- Console Events normalise le payload.

**Prérequis** : agent enrollé, `event_reporting=true`, détection réelle sur un host policy.

**Note memory store** : redémarrer l’API efface events/agents en RAM → ré-enrôler.

## Recovery concepteur (oubli mdp admin)

- Secret vendor : `OpsGate-Vendor-Recovery!` (env `OPSGATE_VENDOR_RECOVERY`).
- Hash poussé à l’agent (`recovery_password_hash`).
- Si mdp org armé : désenrôlement accepte **mdp admin OU recovery**.
- Console Policy → « Afficher le recovery (dev) ».

## Reset mdp via OTP

1. `POST /v1/org/password-reset/request` → OTP (dev : renvoyé + log API ; prod : email).
2. `POST /v1/org/password-reset/confirm` `{ otp, new_password }`.
3. Nouveau hash + force epoch.

## Licences

- User : licence manuelle (`true` / `false`) ou héritage groupe (`grantsLicense`).
- Agent sans user lié : considéré licensed (device-only).
- Agent lié à un user sans licence : **grâce 5 min** puis `UNLICENSED` (protection off côté client + badge rouge console).

## MFA / reset offline (roadmap)

| Besoin | Pilot | Cible |
|--------|-------|--------|
| OTP email | stub log + dev_otp | SMTP / provider |
| Reset offline admin console | non (besoin API) | recovery codes imprimés, TOTP offline |
| MFA login | non | TOTP / WebAuthn |
| MFA unenroll endpoint | username+password | + second facteur admin |

## Limites

- Pas de push instantané offline (poll 15 min).
- OTP email = stub (pas de SMTP branché en pilot).
- Profils / admins / groups / licences PG : overlay mémoire.
- LDAP non branché (champs prêts).

## Build Plasmo — warning registry npm

```
Error fetching package information for "plasmo" [TypeError: fetch failed]
getaddrinfo ENOTFOUND registry.npmjs.org
… DONE | Finished …
```

**Non bloquant** : le bundle se produit quand même (`DONE`).  
Cause : Plasmo tente un check version en ligne ; DNS/réseau vers `registry.npmjs.org` indisponible.  
Action : ignorer en offline, ou rétablir l’accès npm. Aucune correction code requise si `build/chrome-mv3-prod` est généré.
