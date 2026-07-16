# SMTP — e-mails transactionnels (OTP, notifications)

## Objectif

Remplacer le mode « OTP affiché en log / dev » par un **vrai envoi SMTP** pour :

- réinitialisation mot de passe admin (OTP 6 chiffres) ;
- notification quand un principal réinitialise le mdp d’un secondaire ;
- futurs e-mails produit (même module `mail.ts`).

La MFA TOTP (Authenticator) reste **dans l’app** (pas d’e-mail) — c’est un second facteur hors bande e-mail.

## Modèle produit (important)

| Mode | Qui configure | Expéditeur (From) |
|------|----------------|-------------------|
| **SaaS / control plane DailyOps** | **Vous** (env serveur) une fois pour toutes | `OpsGate <noreply@dailyops.tech>` |
| **Client final** | **Rien** en général | Reçoit déjà les mails OpsGate |
| **Option client** (on-prem / politique « mon SMTP ») | Client : host / user / pass | **Optionnel** ; vide = `noreply@dailyops.tech`. Mieux : adresse **du domaine client** (SPF/DKIM) |

**Règle SPF/DKIM** : si le client envoie via *son* serveur SMTP avec From `noreply@dailyops.tech`, beaucoup de boîtes rejeteront le mail. D’où : From optionnel en UI, mais recommandé = domaine client dès qu’il active « mon SMTP ».

## Configuration

### A. Arrière-plan DailyOps (pré-config serveur — cas normal)

Sur l’instance control plane que **vous** hébergez :

```powershell
$env:OPSGATE_SMTP_HOST = "smtp.votrefournisseur.com"
$env:OPSGATE_SMTP_PORT = "587"
$env:OPSGATE_SMTP_USER = "noreply@dailyops.tech"
$env:OPSGATE_SMTP_PASS = "********"
$env:OPSGATE_SMTP_FROM = "OpsGate <noreply@dailyops.tech>"
```

Le client **n’a pas besoin** de toucher Paramètres → SMTP pour que les OTP partent.

### B. Console client (optionnel)

**Paramètres système → E-mail / SMTP**

1. Cocher **Utiliser mon propre serveur SMTP** (seulement si besoin)  
2. Host, port, utilisateur, mot de passe  
3. **From optionnel** (vide = `noreply@dailyops.tech`)  
4. **Enregistrer** → **Tester**  

Prioritaire sur l’env si `enabled` + host.  
Mot de passe jamais renvoyé en lecture.

### Détail variables d’environnement

| Variable | Exemple | Rôle |
|----------|---------|------|
| `OPSGATE_SMTP_HOST` | `smtp.…` | Serveur SMTP DailyOps |
| `OPSGATE_SMTP_PORT` | `587` | Port |
| `OPSGATE_SMTP_SECURE` | `1` | TLS implicite (465) |
| `OPSGATE_SMTP_USER` | `noreply@dailyops.tech` | Auth |
| `OPSGATE_SMTP_PASS` | `…` | Secret |
| `OPSGATE_SMTP_FROM` | `OpsGate <noreply@dailyops.tech>` | Expéditeur (défaut code si absent) |
| `OPSGATE_SMTP_TLS_REJECT` | `0` | Lab self-signed |
| `OPSGATE_MAIL_DEV_OTP` | `1` | Lab : OTP dans la réponse JSON |

Alias : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.

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
