# SMTP — e-mails transactionnels (OTP, notifications)

## Objectif

Remplacer le mode « OTP affiché en log / dev » par un **vrai envoi SMTP** pour :

- réinitialisation mot de passe admin (OTP 6 chiffres) ;
- notification quand un principal réinitialise le mdp d’un secondaire ;
- futurs e-mails produit (même module `mail.ts`).

La MFA TOTP (Authenticator) reste **dans l’app** (pas d’e-mail) — c’est un second facteur hors bande e-mail.

## Configuration (2 façons)

### A. Console (recommandé pour le client / admin principal)

**Paramètres système → E-mail / SMTP**

1. Cocher **Activer SMTP**  
2. Host, port (587 ou 465), utilisateur, mot de passe, From  
3. **Enregistrer SMTP**  
4. **Tester la connexion** / **Tester + envoyer un e-mail**  

Prioritaire sur les variables d’environnement si `enabled` + host renseignés.  
Le mot de passe n’est **jamais** renvoyé en lecture (comme le bind LDAP).

### B. Variables d’environnement (serveur / Docker)

| Variable | Exemple | Rôle |
|----------|---------|------|
| `OPSGATE_SMTP_HOST` | `smtp.office365.com` | Serveur SMTP |
| `OPSGATE_SMTP_PORT` | `587` | Port (587 STARTTLS, 465 TLS) |
| `OPSGATE_SMTP_SECURE` | `1` | Forcer TLS (typ. 465) |
| `OPSGATE_SMTP_USER` | `noreply@…` | Auth |
| `OPSGATE_SMTP_PASS` | `…` | Mot de passe / app password |
| `OPSGATE_SMTP_FROM` | `OpsGate <noreply@dailyops.tech>` | Expéditeur |
| `OPSGATE_SMTP_TLS_REJECT` | `0` | Lab : cert self-signed |
| `OPSGATE_MAIL_DEV_OTP` | `1` | **Lab** : OTP dans la réponse JSON |

Alias : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.

```powershell
$env:OPSGATE_SMTP_HOST = "smtp.office365.com"
$env:OPSGATE_SMTP_PORT = "587"
$env:OPSGATE_SMTP_USER = "noreply@votre-domaine.com"
$env:OPSGATE_SMTP_PASS = "********"
$env:OPSGATE_SMTP_FROM = "OpsGate <noreply@votre-domaine.com>"
pnpm api:dev
```

### Lab sans SMTP (MailHog / log)

Sans `OPSGATE_SMTP_HOST` : l’OTP est **journalisé** côté API ; en non-production il peut encore apparaître dans la réponse (`dev_otp`) pour les tests console.

```powershell
# Option : MailHog local
$env:OPSGATE_SMTP_HOST = "127.0.0.1"
$env:OPSGATE_SMTP_PORT = "1025"
$env:OPSGATE_SMTP_FROM = "OpsGate <dev@localhost>"
```

## Flux

```
Console « Mot de passe oublié »
  → POST /v1/auth/password-reset/request { email }
  → store : challenge OTP (hash, TTL 10 min)
  → mail.sendPasswordResetOtpEmail(to, otp)
  → client saisit OTP + nouveau mdp
  → POST /v1/auth/password-reset/confirm
```

## API

| Endpoint | Auth | Rôle |
|----------|------|------|
| `POST /v1/auth/password-reset/request` | public | Envoie OTP |
| `POST /v1/auth/password-reset/confirm` | public | Applique le nouveau mdp |
| `GET /health` | public | Champ `mail: { configured, host, … }` |
| `GET /v1/org/mail/status` | console | Statut org + env (sans secret) |
| `PUT /v1/org/mail/settings` | principal | Enregistre SMTP org |
| `POST /v1/org/mail/test` | principal | Verify + e-mail de test optionnel |

## Code

| Fichier | Rôle |
|---------|------|
| `packages/api/src/mail.ts` | Nodemailer, templates OTP brandés |
| `memory-store` / `pg-store` `requestPasswordResetOtp` | Génère OTP + envoi |
| `app.ts` | Routes reset + reset mdp secondaire (notice e-mail) |

## Sécurité

- Ne **jamais** activer `OPSGATE_MAIL_DEV_OTP` en production.
- Secrets SMTP uniquement en env / secret store, pas dans le repo.
- Réponses anti-énumération si l’e-mail n’est pas un principal.
- OTP stocké **hashé** (même schéma que mdp management).

## Checklist prod

1. [ ] `OPSGATE_SMTP_*` renseignés  
2. [ ] `GET /health` → `mail.configured: true`  
3. [ ] Test reset depuis la console → e-mail reçu  
4. [ ] `OPSGATE_MAIL_DEV_OTP` **absent**  
5. [ ] SPF/DKIM du domaine d’envoi OK chez le client mail  
