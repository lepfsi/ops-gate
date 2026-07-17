# OpsGate — Backup & restore

## Pourquoi

Sans backup régulier, un incident (disque, erreur admin, ransomware) est **irrécupérable**.  
Deux niveaux :

| Niveau | Contenu | Outil |
|--------|---------|--------|
| **A. Config org** | Policy, profils, groupes, monitoring (sans secrets) | Console → Export / Import backup |
| **B. Base Postgres** | Tout (agents, events, audit, sessions, licences…) | `scripts/backup-db.ps1` + `pg_dump` |

## A. Backup configuration (console)

1. Connecté en **principal** → Paramètres → Général  
2. **Exporter le backup** → fichier JSON `opsgate-org-backup-….json`  
3. **Importer** sur une org de secours (merge prudent)

API :

- `GET /v1/org/backup`
- `POST /v1/org/backup/import`

Secrets SMTP / LDAP / Telegram **non** inclus en clair — à reconfigurer après import.

## B. Backup base de données

```powershell
cd ops-gate
$env:DATABASE_URL = "postgresql://USER:PASS@HOST:5432/opsgate"
.\scripts\backup-db.ps1
# → backups/backup-opsgate-YYYYMMDD-HHMMSS.sql (+ .sha256)
```

### Restauration

```powershell
# Instance vide / hors production
psql $env:DATABASE_URL -f backups\backup-opsgate-….sql
```

### Planification (recommandé)

- **Quotidien** `pg_dump` + copie offsite (NAS / S3 / Azure Blob)
- **Hebdo** test de restore sur environnement staging
- Conserver ≥ 7 j quotidiens + 4 hebdo + 3 mensuels

## Export auto logs par e-mail

- Config : Paramètres → Rapports (destinataires, jour, heure, fuseau)
- SMTP : Paramètres → E-mail (test d’envoi d’abord)
- Cron API : `OPSGATE_EXPORTS_CRON_MINUTES` (défaut 15)
- **Test immédiat** : bouton « Envoyer un export test maintenant »

Si aucun event sur la période, un export « vide » + e-mail sont quand même envoyés (évite le silence total).
