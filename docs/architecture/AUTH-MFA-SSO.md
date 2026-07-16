# OpsGate — Auth console : MFA TOTP + SSO OIDC (V2 P1)

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

---

## SSO OIDC — flow complet (Authorization Code + PKCE)

Sans dépendance externe (`packages/api/src/oidc.ts`). Compatible **Microsoft Entra ID**, **Okta**, **Google Workspace**, tout IdP OIDC standard.

### Variables d’environnement (API)

| Env | Rôle | Requis |
|-----|------|--------|
| `OPSGATE_OIDC_ISSUER` | URL issuer (ex. `https://login.microsoftonline.com/{tenant}/v2.0`) | Oui |
| `OPSGATE_OIDC_CLIENT_ID` | Client ID (application IdP) | Oui |
| `OPSGATE_OIDC_CLIENT_SECRET` | Secret client (confidential client) | Recommandé |
| `OPSGATE_OIDC_REDIRECT_URI` | Callback API (défaut `{API}/v1/auth/oidc/callback`) | Oui en prod |
| `OPSGATE_OIDC_SCOPES` | Défaut `openid profile email` | Non |
| `OPSGATE_API_PUBLIC_URL` | Base publique API (si redirect_uri auto) | Prod |
| `OPSGATE_CONSOLE_URL` | URL console (return_to par défaut) | Prod |
| `OPSGATE_OIDC_ALLOWED_DOMAINS` | CSV domaines email autorisés (ex. `contoso.com,fabrikam.fr`) | Non |
| `OPSGATE_OIDC_RETURN_ORIGINS` | Origines return_to supplémentaires (anti open-redirect) | Non |

### Endpoints

| Méthode | Path | Rôle |
|---------|------|------|
| `GET` | `/v1/auth/oidc/status` | `{ enabled, issuer, client_id, redirect_uri, flow, … }` |
| `GET` | `/v1/auth/oidc/start?return_to=&force=` | Génère state+PKCE, redirect IdP |
| `GET` | `/v1/auth/oidc/callback?code=&state=` | Échange code, session, redirect console |

### Flux détaillé

```
Console ──► GET /v1/auth/oidc/start?return_to=https://console…
              │  state, nonce, code_verifier stockés (TTL 10 min)
              │  code_challenge = S256(verifier)
              ▼
           IdP authorize (Entra / Okta / …)
              │  login + MFA côté IdP
              ▼
           GET /v1/auth/oidc/callback?code&state
              │  takePending(state)
              │  POST token_endpoint (code + code_verifier + secret)
              │  id_token + userinfo → email claim
              │  createAdminSessionOidc(email)  // admin existant
              ▼
           Redirect console#opsgate_token=ogs_…&opsgate_via=oidc
              │
Console ──► setToken + GET /v1/auth/me
```

### Mapping admin

1. Claims utilisés (dans l’ordre) : `email` → `preferred_username` → `upn`  
2. L’email doit correspondre à un **`org_admins` actif** avec `console_access` (ou principal)  
3. **Pas de JIT** (création auto) dans cette version — créer l’admin dans OpsGate avec le **même email** que l’IdP  
4. **MFA local TOTP non exigé** pour le login SSO (l’IdP a déjà authentifié)  
5. Session unique : si déjà connecté ailleurs → erreur `session_already_active` + bouton console « SSO — forcer »

### Sécurité

| Mesure | Détail |
|--------|--------|
| PKCE S256 | Obligatoire même avec client secret |
| State | One-time, TTL 10 min, mémoire process |
| Nonce | Vérifié si présent dans l’id_token |
| Token en fragment | `#opsgate_token` non envoyé au serveur console (pas de query log) |
| return_to | Sanitisé (localhost + `OPSGATE_CONSOLE_URL` + `OPSGATE_OIDC_RETURN_ORIGINS`) |
| Rate limit | Même plafond que login (`OPSGATE_RATE_LOGIN_PER_MIN`) |
| Domaines | Filtre optionnel `OPSGATE_OIDC_ALLOWED_DOMAINS` |
| Audit | action `login`, detail « Connexion console SSO OIDC », meta `{ via, issuer, sub }` |

> Note : le payload `id_token` est décodé sans vérif JWKS locale car les tokens sont obtenus **directement** du `token_endpoint` de l’issuer découvert (TLS). Une vérif JWKS complète reste une évolution possible.

### Configuration Entra ID (exemple)

1. App registration → **Web** redirect URI = `https://api.example.com/v1/auth/oidc/callback`  
2. Certificates & secrets → créer un secret  
3. Token configuration → claim **email** (ou s’assurer que UPN = email admin)  
4. API permissions : `openid`, `profile`, `email` (delegated)  
5. Env API :

```bash
OPSGATE_OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
OPSGATE_OIDC_CLIENT_ID=<app-id>
OPSGATE_OIDC_CLIENT_SECRET=<secret>
OPSGATE_OIDC_REDIRECT_URI=https://api.example.com/v1/auth/oidc/callback
OPSGATE_CONSOLE_URL=https://console.example.com
OPSGATE_API_PUBLIC_URL=https://api.example.com
OPSGATE_OIDC_ALLOWED_DOMAINS=example.com
```

### Console

- Bouton **« Se connecter avec SSO (entreprise) »** si `oidc/status.enabled`  
- Callback : lecture du fragment, stockage token, nettoyage URL  
- Erreurs IdP / mapping affichées sur l’écran de login

### Erreurs fragment (`#opsgate_oidc_error=`)

| Code | Signification |
|------|----------------|
| `oidc_not_configured` | Env manquantes |
| `invalid_state` | State inconnu / expiré |
| `missing_code` | IdP n’a pas renvoyé de code |
| `email_claim_missing` | Pas d’email dans les claims |
| `admin_not_found` | Aucun admin OpsGate pour cet email |
| `account_locked` | Compte verrouillé |
| `session_already_active` | Session concurrente (proposer force) |
| `domain_not_allowed` | Domaine hors allowlist |
| `nonce_mismatch` | id_token nonce ≠ pending |
| `idp_error` | Erreur renvoyée par l’IdP |
| `oidc_callback_failed` / `oidc_start_failed` | Erreur technique |

## Rate limit login / SSO

`OPSGATE_RATE_LOGIN_PER_MIN` (défaut **30**/IP/minute) → HTTP 429 (login) ou redirect erreur (SSO).

## Suite possible

- JIT provisioning admin (création auto + rôle défaut)  
- Vérification signature id_token via JWKS  
- WebAuthn / passkeys  
- SAML 2.0  
- Enforce SSO only (`sso_enforce` org flag)
