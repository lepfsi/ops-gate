# OpsGate — Auth console : MFA TOTP + SSO OIDC (V2 P1 + polish)

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

### Console

Login : champ code MFA si l’API renvoie `mfa_required`.  
Profil admin : section activer/désactiver MFA (UI).

---

## SSO OIDC — flow + polish

Sans dépendance externe (`packages/api/src/oidc.ts`). Compatible **Microsoft Entra ID**, **Okta**, **Google Workspace**.

### Variables d’environnement (API)

| Env | Rôle | Défaut |
|-----|------|--------|
| `OPSGATE_OIDC_ISSUER` | URL issuer | — (requis) |
| `OPSGATE_OIDC_CLIENT_ID` | Client ID | — (requis) |
| `OPSGATE_OIDC_CLIENT_SECRET` | Secret | recommandé |
| `OPSGATE_OIDC_REDIRECT_URI` | Callback API | `{API}/v1/auth/oidc/callback` |
| `OPSGATE_OIDC_SCOPES` | Scopes | `openid profile email` |
| `OPSGATE_API_PUBLIC_URL` | Base API publique | — |
| `OPSGATE_CONSOLE_URL` | return_to défaut | `http://127.0.0.1:5173/` |
| `OPSGATE_OIDC_ALLOWED_DOMAINS` | CSV domaines email | tous |
| `OPSGATE_OIDC_RETURN_ORIGINS` | Origines return_to extra | — |
| **`OPSGATE_OIDC_JWKS`** | Vérif signature id_token (JWKS) | **`1` (on)** |
| **`OPSGATE_OIDC_JIT`** | Créer admin si email inconnu | `0` |
| **`OPSGATE_OIDC_JIT_ORG_CODE`** | Org cible JIT | 1ʳᵉ org non-personnelle |
| **`OPSGATE_SSO_ENFORCE`** | Interdit login password | `0` |
| **`OPSGATE_OIDC_REQUIRE_EMAIL_VERIFIED`** | Exige email_verified | `0` |

### Endpoints

| Méthode | Path | Rôle |
|---------|------|------|
| `GET` | `/v1/auth/oidc/status` | `{ enabled, jit, jwks_verify, sso_enforce, … }` |
| `GET` | `/v1/auth/oidc/start?return_to=&force=` | Redirect IdP |
| `GET` | `/v1/auth/oidc/callback?code=&state=` | Code → session |

### Flux

```
Console → /v1/auth/oidc/start → IdP → /v1/auth/oidc/callback
  → JWKS verify id_token (si jwks_uri)
  → email claim (+ domain / email_verified)
  → createAdminSessionOidc | JIT upsertAdmin
  → redirect console#opsgate_token=…
```

### Mapping admin

1. Claims : `email` → `preferred_username` → `upn`  
2. Admin existant actif + `console_access` (ou principal)  
3. **JIT** (`OPSGATE_OIDC_JIT=1`) : crée un admin secondaire `console_access` sur l’org cible  
4. MFA local **non** exigé en SSO  
5. Session unique + force  

### JWKS (polish)

- Fetch `jwks_uri` (cache 1 h)  
- Signature **RS256 / ES256** (+ RS/ES 384/512)  
- Contrôles `iss`, `aud` (= client_id), `exp` (±60 s), `nonce` si présent  
- Désactiver : `OPSGATE_OIDC_JWKS=0` (dev uniquement)

### SSO enforce

`OPSGATE_SSO_ENFORCE=1` + OIDC configuré :

- `POST /v1/auth/login` → **403** `sso_required`  
- Console : masque email/password, SSO only  

### Sécurité

| Mesure | Détail |
|--------|--------|
| PKCE S256 | Oui |
| State one-time | TTL 10 min |
| JWKS | Oui (défaut) |
| Fragment token | `#opsgate_token` |
| return_to | sanitisé |
| Rate limit | `OPSGATE_RATE_LOGIN_PER_MIN` |
| Domaines | `OPSGATE_OIDC_ALLOWED_DOMAINS` |

### Erreurs fragment

| Code | Signification |
|------|----------------|
| `admin_not_found` | Pas d’admin (JIT off) |
| `jit_org_missing` / `jit_create_failed` | JIT impossible |
| `email_not_verified` | Claim email_verified faux |
| `oidc_jwt_sig_invalid` / `oidc_jwt_*` | JWKS / claims |
| `sso_required` | (login password, pas fragment) |
| … | (voir historique status, invalid_state, etc.) |

### Config Entra (rappel)

```bash
OPSGATE_OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
OPSGATE_OIDC_CLIENT_ID=...
OPSGATE_OIDC_CLIENT_SECRET=...
OPSGATE_OIDC_REDIRECT_URI=https://api…/v1/auth/oidc/callback
OPSGATE_CONSOLE_URL=https://console…
OPSGATE_OIDC_ALLOWED_DOMAINS=example.com
OPSGATE_OIDC_JIT=1
OPSGATE_OIDC_JIT_ORG_CODE=DEMO-OPSGATE
# OPSGATE_SSO_ENFORCE=1
```

## Rate limit

`OPSGATE_RATE_LOGIN_PER_MIN` (défaut **30**/IP/minute).

## WebAuthn & SAML

Voir **`WEBAUTHN-SAML.md`** — passkeys + SAML SP (metadata / ACS).

## Suite possible

- JIT rôle / groupe depuis claims (`groups`)  
- Redis pour state OIDC multi-instance  
- WebAuthn credentials en Postgres  
- SAML C14N exclusive  
