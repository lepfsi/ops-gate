# SMTP — e-mails (OTP, notifications)

## En une phrase

Le **client configure son propre serveur SMTP** dans la console  
(**Paramètres → E-mail / SMTP**). OpsGate l’utilise pour envoyer les OTP de reset mdp et les notifications.

## Que renseigner (admin client)

| Champ | Exemple |
|-------|---------|
| Activer | oui |
| Hôte | `smtp.office365.com` / `smtp.gmail.com` / SMTP interne |
| Port | `587` (STARTTLS) ou `465` (TLS) |
| Utilisateur / mot de passe | compte fourni par la DSI |
| Expéditeur (From) | `OpsGate <noreply@votre-domaine.com>` |

Puis **Enregistrer** → **Tester la connexion** / **Tester + envoyer un e-mail**.

Sans config active : pas d’envoi réel (log serveur ; en lab un OTP peut encore s’afficher si autorisé).

## API

| Endpoint | Qui | Rôle |
|----------|-----|------|
| `GET /v1/org/mail/status` | admin console | Statut (sans secret) |
| `PUT /v1/org/mail/settings` | principal | Enregistrer la config |
| `POST /v1/org/mail/test` | principal | Test + e-mail optionnel |
| `POST /v1/auth/password-reset/request` | public | Envoie l’OTP via ce SMTP |

## Repli technique (install / lab)

Si aucune config org n’est active, l’API peut utiliser les variables d’environnement  
`OPSGATE_SMTP_HOST`, `OPSGATE_SMTP_PORT`, `OPSGATE_SMTP_USER`, `OPSGATE_SMTP_PASS`, `OPSGATE_SMTP_FROM`  
(ou alias `SMTP_*`). Ce n’est **pas** un second mode produit à expliquer au client : c’est un fallback ops.

## Code

| Fichier | Rôle |
|---------|------|
| `packages/api/src/mail.ts` | Envoi nodemailer |
| Console → Paramètres → E-mail / SMTP | UI client |
| `requestPasswordResetOtp` | OTP par e-mail |

## Checklist

1. [ ] SMTP activé + host / auth / From  
2. [ ] Test connexion OK  
3. [ ] Reset mdp → e-mail reçu  
4. [ ] SPF/DKIM du domaine From OK chez le client mail  
