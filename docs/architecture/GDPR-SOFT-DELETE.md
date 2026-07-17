# Soft-delete organisation (RGPD)

**Mis à jour** : 17 juillet 2026

## Objectif

Permettre au **principal** d’une organisation de :

1. **Exporter** un inventaire / portabilité (JSON)
2. **Soft-delete** l’org (arrêt du traitement, délai de grâce)
3. **Restaurer** avant la purge hard
4. **Purge définitive** (CASCADE SQL / nettoyage mémoire) après le délai

## Délai de grâce

| Env | Défaut | Rôle |
|-----|--------|------|
| `OPSGATE_GDPR_PURGE_DAYS` | `30` | Jours entre soft-delete et hard purge |
| `OPSGATE_GDPR_CRON_MINUTES` | `60` | Intervalle du cron de purge |
| `OPSGATE_ALLOW_DEMO_DELETE` | off | Autorise soft-delete de `DEMO-OPSGATE` (lab) |

## API

| Méthode | Path | Auth |
|---------|------|------|
| GET | `/v1/org/gdpr/status` | console |
| GET | `/v1/org/gdpr/export` | principal |
| POST | `/v1/org/gdpr/soft-delete` | principal · body `{ "confirm": "DELETE MY ORG", "reason?": "…" }` |
| POST | `/v1/org/gdpr/restore` | principal · body `{ "confirm": "RESTORE MY ORG" }` |

## Effets du soft-delete

- Colonnes org : `deleted_at`, `delete_purge_at`, `delete_reason`, `delete_requested_by`
- **Sessions** console de l’org révoquées
- **Agents** révoqués (unenroll)
- **Enroll** bloqué (`org_soft_deleted`)
- Config agent → `403 org_soft_deleted`
- Console : seules routes `/org/gdpr/*`, `/auth/me`, logout

## Restauration

- Possible tant que `delete_purge_at > now`
- Les **agents doivent être ré-enrôlés** (tokens invalidés)

## Hard purge

Cron `gdpr-cron` : `DELETE FROM organizations` (CASCADE enfants) pour les orgs dues.

## UI console

**Paramètres → Général** : bloc RGPD (export / soft-delete / restore).  
Si org déjà soft-deleted au login : **écran dédié** restore + export.

## Protection DEMO

`DEMO-OPSGATE` ne peut pas être soft-deleted sauf lab :
`OPSGATE_ALLOW_DEMO_DELETE=1` + body `{ "force": true, "confirm": "DELETE MY ORG" }`.
