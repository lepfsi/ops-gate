# Code organisation, tenant & licences

## Intention produit (commerciale)

Oui — le **code organisation** est la clé d’entrée d’un **tenant** :

1. Sans code org valide → **pas d’enrôlement** dans une organisation (pas d’agent managé).  
2. Avec le code → l’agent rejoint **cette** org uniquement (isolation multi-tenant).  
3. Ensuite, **l’organisation décide** de la licence (sièges agents, assignation manuelle, héritage groupe).

```
[Extension]  --org_code DEMO-OPSGATE-->  [API / tenant]
                                              │
                                              ├─ Policy / profils / packs
                                              ├─ Licences (sièges)
                                              └─ Events metadata
```

## Usage personnel vs organisation

| Mode | Code / clé | Licences | Console admin |
|------|------------|----------|---------------|
| **Organisation** | Code org (ex. `DEMO-OPSGATE`) | Quota sièges org | Oui (admins) |
| **Personnel** | Clé licence perso | 1 siège (clé) | Non (Options only) |
| **local_only** | Aucun | N/A | Non |

## Ce que le code n’est **pas**

- Ce n’est pas un mot de passe utilisateur final  
- Ce n’est pas un SSO  
- Ce n’est pas une licence à lui seul (sauf mode personnel avec clé)

## Alignement code actuel

- `POST /v1/enroll` avec `org_code` → `findOrgByCode`  
- `licenseSeats` sur l’org + `licenseAssigned` sur l’agent  
- Console Agents : assigner / retirer sièges  

Voir aussi licences dans `CONTROL-PLANE.md` et `PERSONAL-AND-BRANDING.md`.
