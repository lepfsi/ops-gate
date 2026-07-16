# OpsGate — WebAuthn (passkeys) & SAML 2.0 SP

## WebAuthn / Passkeys

| Env | Défaut | Rôle |
|-----|--------|------|
| `OPSGATE_WEBAUTHN` | `1` | Activer |
| `OPSGATE_WEBAUTHN_RP_ID` | hostname console | rpId |
| `OPSGATE_CONSOLE_URL` | origin attendu | clientData.origin |

### Endpoints

| Méthode | Path | Auth |
|---------|------|------|
| `GET` | `/v1/auth/webauthn/status` | public |
| `POST` | `/org/admins/me/webauthn/register/options` | admin |
| `POST` | `/org/admins/me/webauthn/register` | admin — body `{ challenge_id, credentialId, publicKeyJwk }` |
| `GET` | `/org/admins/me/webauthn/credentials` | admin |
| `DELETE` | `/org/admins/me/webauthn/credentials/:id` | admin |
| `POST` | `/auth/webauthn/login/options` | public |
| `POST` | `/auth/webauthn/login` | public — assertion |

**Persistance** : store process-local (redémarrage API = re-enrôler passkeys). Persistance Postgres = roadmap.

**Client** : utiliser `navigator.credentials.create/get` puis envoyer JWK exportée + assertion base64url.

---

## SAML 2.0 (Service Provider)

| Env | Rôle |
|-----|------|
| `OPSGATE_SAML_IDP_SSO_URL` | URL SSO IdP (requis) |
| `OPSGATE_SAML_IDP_ENTITY_ID` | EntityID IdP (requis) |
| `OPSGATE_SAML_IDP_CERT` | PEM cert IdP (vérif soft signature) |
| `OPSGATE_SAML_SP_ENTITY_ID` | EntityID SP (défaut metadata URL) |
| `OPSGATE_SAML_ACS_URL` | ACS POST |
| `OPSGATE_SAML_EMAIL_ATTR` | Attribut email (défaut `email`) |

### Endpoints

| Path | Rôle |
|------|------|
| `GET /v1/auth/saml/status` | Config publique |
| `GET /v1/auth/saml/metadata` | XML metadata SP |
| `GET /v1/auth/saml/start` | Redirect AuthnRequest (deflate) |
| `POST /v1/auth/saml/acs` | SAMLResponse → session admin (fragment console) |

Réutilise le mapping admin OIDC (`createAdminSessionOidc` + JIT si activé).

**Limite** : C14N exclusive stricte non implémentée — lab / IdP compatibles ; en prod valider avec le cert IdP et tests d’intégration.

---

## LDAP cron

| Env | Rôle |
|-----|------|
| `OPSGATE_LDAP_CRON_MINUTES` | Intervalle (ex. `60`) |
| `OPSGATE_LDAP_CRON_MS` | Intervalle ms (prioritaire si > 0) |
| `OPSGATE_LDAP_BIND_PASSWORD` | Secret bind |

Démarrage : `packages/api/src/index.ts` → `startLdapCron(store)`.  
Parcourt les orgs non-personnelles avec `monitoring.ldap.enabled`.
