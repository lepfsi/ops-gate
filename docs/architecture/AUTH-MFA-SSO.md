# OpsGate — Auth console : MFA TOTP + fondations SSO (V2 P1)

## MFA TOTP (livré)

Compatible Google Authenticator / Microsoft Authenticator.

### Flux

1. Admin connecté → `POST /v1/org/admins/me/mfa/setup`  
   → `secret` + `otpauth_url`  
2. Scanner dans l’app  
3. `POST /v1/org/admins/me/mfa/enable` `{ "code": "123456" }`  
4. Login suivant : `POST /v1/auth/login` avec `totp_code` si MFA actif  
   - Sans code → `error: mfa_required`  
   - Code faux → `mfa_invalid`

### Désactivation

`POST /v1/org/admins/me/mfa/disable` `{ "password", "code" }`

### Stockage

| Store | Champs |
|-------|--------|
| Memory | `OrgAdmin.totpEnabled`, `totpSecret`, `totpPendingSecret` |
| Postgres | colonnes `totp_*` (soft-alter) |

**Sécurité** : secrets TOTP en base — chiffrer au repos en prod multi-tenant (roadmap).

### Console

Login : champ code MFA si l’API renvoie `mfa_required`.  
Profil admin : section activer/désactiver MFA (UI).

## SSO OIDC (fondations)

Variables d’environnement API :

| Env | Rôle |
|-----|------|
| `OPSGATE_OIDC_ISSUER` | URL issuer (ex. `https://login.microsoftonline.com/.../v2.0`) |
| `OPSGATE_OIDC_CLIENT_ID` | Client ID |
| `OPSGATE_OIDC_CLIENT_SECRET` | Secret (callback — à brancher) |
| `OPSGATE_OIDC_REDIRECT_URI` | Callback console |

Statut : `GET /v1/auth/oidc/status`  
→ `{ enabled, issuer, client_id, note }`

**Pas encore** : redirect authorize, code exchange, mapping claims → admin org.  
Prochaine itération : flow Authorization Code + PKCE, lien `email` claim → `org_admins`.

## Rate limit login

`OPSGATE_RATE_LOGIN_PER_MIN` (défaut **30**/IP/minute) → HTTP 429.
