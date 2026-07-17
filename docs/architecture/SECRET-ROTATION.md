# Rotation formalisée des secrets

## Vendor licence (émission clés `OPS-…`)

| Variable | Rôle |
|----------|------|
| `OPSGATE_VENDOR_LICENSE_SECRET` | Secret **courant** (min 12 car.) |
| `OPSGATE_VENDOR_LICENSE_SECRET_PREVIOUS` | Secret **précédent** accepté pendant la grace |
| `OPSGATE_LICENSE_SECRET` / `_PREVIOUS` | Alias historiques |

Header client : `X-OpsGate-Vendor-Key`.

Statut (sans fuite de secret) : `GET /v1/vendor/status` → `rotation.previous_configured`.

### Runbook

1. Générer un secret fort (ex. 32+ octets base64).
2. Déployer : `CURRENT=nouveau`, `PREVIOUS=ancien`.
3. Mettre à jour scripts / CI / bureau concepteur.
4. Après grace (ex. 7 jours) : retirer `*_PREVIOUS`.

Code : `packages/api/src/secret-rotation.ts`.

## Vendor recovery

| Variable | Rôle |
|----------|------|
| `OPSGATE_VENDOR_RECOVERY` | Secret recovery offline |
| `OPSGATE_VENDOR_RECOVERY_PREVIOUS` | Grace rotation |

## SMTP / autres

Rotation = resaisie dans **Paramètres → E-mail / SMTP** (mot de passe write-only).  
Pas de dual-key SMTP : un seul secret actif par org.

## WebAuthn / SAML (prod)

- `OPSGATE_WEBAUTHN_RP_ID` + `OPSGATE_CONSOLE_URL` (HTTPS hors lab)
- Passkeys persistés Postgres (`webauthn_credentials`) si `DATABASE_URL`
- SAML : `OPSGATE_SAML_REQUIRE_SIGNATURE=1` ou `NODE_ENV=production` + cert IdP → signature obligatoire
