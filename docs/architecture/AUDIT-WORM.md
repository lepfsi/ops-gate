# Audit admin WORM & rétention légale

## Objectif

Le journal d’administration (`admin_audit_events`) est **append-only** côté produit :

- pas d’endpoint de suppression / modification d’entrées ;
- chaque entrée porte un **sceau SHA-256** chaîné (`prev_hash` → `entry_hash`) ;
- une **rétention légale** (jours) est configurable, indépendante de la rétention des events de détection.

## Chaîne d’intégrité

```
seq=1  prev=GENESIS     hash=H1
seq=2  prev=H1          hash=H2
seq=3  prev=H2          hash=H3
…
```

Payload hashé (UTF-8) :

```
prevHash|seq|id|orgId|action|detail|adminId|createdAt
```

Algorithme : **SHA-256** hex.

Implémentation : `packages/api/src/audit-worm.ts`.

## API console

| Méthode | Chemin | Rôle |
|---------|--------|------|
| GET | `/v1/org/audit` | Liste (principal) + champs `seq`, `entry_hash`, `prev_hash` |
| GET | `/v1/org/audit/integrity` | Vérifie la chaîne (jusqu’à 5000 entrées) |

## Console

- Badge **WORM** + bouton **Vérifier l’intégrité**
- Paramètres → Logs : **Rétention légale audit admin** (min 90 j, défaut 365)
- Export CSV inclut `seq` / hashes

## Postgres

Colonnes (migration soft `ADD COLUMN IF NOT EXISTS`) :

- `seq BIGINT`
- `entry_hash TEXT`
- `prev_hash TEXT`

## Limites (honnêteté produit)

- WORM **applicatif** (API + hash) ≠ stockage objet immuable type S3 Object Lock.
- Un opérateur DB superuser peut encore altérer les lignes — le sceau le **détecte** à la vérif.
- Entrées **legacy** sans hash : comptées, n’invalident pas la chaîne des nouvelles entrées.
