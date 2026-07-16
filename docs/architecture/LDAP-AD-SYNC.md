# OpsGate — Sync LDAP / Active Directory (V2 P2)

## Objectif

Importer **groupes** et **utilisateurs** depuis AD/LDAP vers l’inventaire OpsGate :

| AD | OpsGate |
|----|---------|
| Group (`objectGUID` / DN) | `UserGroup.ldapExternalId` + name |
| User (`objectGUID` / UPN) | `OrgUser.externalId` + email + `groupIds` via `memberOf` |

Les **profils policy** liés aux groupes OpsGate restent manuels (mapper un groupe sync → profil dans la console People).

## Prérequis

- API avec dépendance `ldapts` (`packages/api`)
- Compte de service AD en **lecture** (bind)
- Réseau API → DC (`ldaps://` 636 recommandé)

## Configuration

### Console

**Paramètres → LDAP / AD**

| Champ | Exemple |
|-------|---------|
| URL | `ldaps://dc01.example.com:636` |
| Bind DN | `CN=svc-opsgate,OU=Service Accounts,DC=example,DC=com` |
| Mot de passe | (ou env serveur) |
| Base DN | `DC=example,DC=com` |
| Filtre users | users AD actifs (défaut) |
| Filtre groupes | `(objectClass=group)` |
| TLS insecure | lab seulement (cert auto-signé) |

### Environnement (recommandé prod)

```bash
# Prioritaire sur le mot de passe stocké en monitoring_json
OPSGATE_LDAP_BIND_PASSWORD=********
```

Ne pas committer le secret. Le champ console peut rester vide si l’env est défini.

## API

| Méthode | Path | Rôle |
|---------|------|------|
| `GET` | `/v1/org/ldap/status` | Config publique (sans secret) |
| `POST` | `/v1/org/ldap/test` | Bind + search léger |
| `POST` | `/v1/org/ldap/sync` | `{ "dry_run": true\|false }` |
| `PATCH` | `/v1/org/monitoring` | Persiste `monitoring.ldap` |

Sync écrit :

- `POST` groupes → `upsertGroup` (match `ldapExternalId` ou nom)
- `POST` users → `upsertUser` (match `externalId` ou email)
- Membership : attribut `memberOf` → IDs groupes déjà sync

## Flux admin

1. Remplir config → **Enregistrer**  
2. **Tester la connexion**  
3. **Dry-run** (compte g/u vus, aucune écriture)  
4. **Synchroniser maintenant**  
5. Onglet **People** : vérifier groupes / users  
6. Lier groupes → **profils policy** si besoin  

## Sécurité

- Mot de passe jamais renvoyé par `GET`  
- Préférer `ldaps://` + cert valide  
- Compte service least-privilege (read-only)  
- RLS Postgres : sync sous session admin org (tenant isolé)  

## Limites v1

- Pas de sync planifiée auto (cron / bouton manuel ; ou appeler l’API en tâche planifiée)  
- Pas de suppression des users absents d’AD (no prune)  
- OpenLDAP : adapter filtres (`objectClass=inetOrgPerson`, `groupOfNames`)  
- Mapping AD group → policy profile : manuel après sync  

## Fichiers

| Fichier | Rôle |
|---------|------|
| `packages/api/src/ldap.ts` | Client + sync |
| `packages/api/src/types.ts` | `OrgLdapSettings` |
| `app.ts` | endpoints `/org/ldap/*` |
| Console Settings tab LDAP | UI |

## Exemple OpenLDAP

```
URL: ldap://ldap.example.com:389
Bind DN: cn=admin,dc=example,dc=com
Base DN: dc=example,dc=com
User filter: (objectClass=inetOrgPerson)
Group filter: (objectClass=groupOfNames)
```

Pour `groupOfNames`, l’appartenance côté user peut nécessiter une évolution (member vs memberOf) — AD est le chemin nominal.
