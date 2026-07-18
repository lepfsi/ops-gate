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

- **Quotidien** `pg_dump` + copie offsite (NAS / S3 / Azure Blob) en prod critique
- **Hebdo** test de restore sur environnement staging
- Conserver ≥ 7 j quotidiens + 4 hebdo + 3 mensuels

## C. Backup automatique système

Dump périodique de la base + export de la configuration org.

### Console

1. Paramètres → **Général** → section **Backup automatique (système)**  
2. Activer · choisir **7 / 14 / 30 jours** · nombre de copies · **dossier de stockage**  
3. **Enregistrer** · optionnellement **Lancer un backup maintenant** (principal)

### Dossier de stockage

Dans la console : bouton **Parcourir…** → lecteurs / dossiers de la **machine serveur API** (ex. disque D:) ; ou saisie d’un chemin **distant UNC**.  
**Vérifier l’accès** (probe écriture) est obligatoire avant enregistrement.

Priorité de résolution :

1. **Chemin choisi / vérifié** (`monitoring.autoBackup.directory`)  
   - Local : navigateur de dossiers serveur  
   - Distant : UNC `\\nas\share\opsgate`  
2. Variable d’env `OPSGATE_AUTO_BACKUP_DIR`  
3. Défaut `./backups/auto` (cwd du process API)

API navigation (principal) :

- `GET /v1/org/backup/fs/roots` — lecteurs  
- `GET /v1/org/backup/fs/list?path=` — sous-dossiers  
- `POST /v1/org/backup/fs/verify` — joignable + inscriptible (`create_if_missing`)

### Fichiers générés

```
<dossier configuré>/
  backup-opsgate-YYYYMMDD-HHMMSS.sql
  backup-opsgate-YYYYMMDD-HHMMSS.sql.sha256
  backup-opsgate-YYYYMMDD-HHMMSS-org-CODE.json
```

### Variables d’environnement

| Variable | Défaut | Rôle |
|----------|--------|------|
| `OPSGATE_AUTO_BACKUP_DIR` | `./backups/auto` | Fallback si l’admin n’a pas saisi de dossier |
| `OPSGATE_AUTO_BACKUP_CRON_MINUTES` | `60` | Fréquence de vérification du due (0 = off) |
| `DATABASE_URL` | — | Requis pour le `pg_dump` |

Sans `DATABASE_URL` (store mémoire), seul l’export config JSON est écrit.

### API

- `GET /v1/org/backup/auto` — statut + dernier run  
- `POST /v1/org/backup/auto/run` — run forcé (principal)  
- Config persistée dans `monitoring.autoBackup`

### Complément ops

En production critique, un cron OS quotidien (`backup-db.ps1`) + copie offsite reste recommandé **en complément** du planificateur 7/14/30 j.

## Export auto logs par e-mail

- Config : Paramètres → Rapports (destinataires, jour, heure, fuseau)
- SMTP : Paramètres → E-mail (test d’envoi d’abord)
- Cron API : `OPSGATE_EXPORTS_CRON_MINUTES` (défaut 15)
- **Test immédiat** : bouton « Envoyer un export test maintenant »

Si aucun event sur la période, un export « vide » + e-mail sont quand même envoyés (évite le silence total).
