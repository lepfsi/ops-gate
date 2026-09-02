# OpsVault ↔ OpsGate — Contrat d’intégration (P1 + P2 + NHI P3)

**Mis à jour** : 29 juillet 2026  
**Rôle de ce document** : **contrat API / tunnel** entre le credential plane (OpsVault) et le PEP OpsGate.  
**Roadmap produit/technique OpsGate** qui planifie *quand* implémenter ce contrat :  
[`roadmap-v3/ROADMAP-TECHNIQUE-OPSGATE.md`](./roadmap-v3/ROADMAP-TECHNIQUE-OPSGATE.md)

| Phase roadmap OpsGate | Contenu tunnel (ce doc) |
|-----------------------|-------------------------|
| Phase 1 consolidation | § Phase 1 — Inject basique (`handle` / `material`) |
| Phase 2 runtime agentique | § Phase 2 — Leases JIT + risk + session binding |
| Phase 3 posture | § Phase 3 — NHI policy-export feed OpsGate |

## Rôles

| Composant | Rôle |
|-----------|------|
| **OpsVault** | Credential plane : secrets machine, leases JIT, risk policy, audit |
| **OpsGate** | PEP : score de risque, session, step-up ; injecte le material hors prompt |
| **Agent** | Ne reçoit que des **handles / hints**, jamais le clair |

## Authentification

### Agent client (handle only)

```http
Authorization: Bearer ov_agent_<token>
```

### OpsGate injector (material + redeem)

```http
Authorization: Bearer ov_inj_<token>
# ou
X-OpsVault-Injector: <token>
# ou agent role=injector
```

```env
OPS_VAULT_INJECTOR_TOKEN=ov_inj_...
OPS_VAULT_INJECT_KEY=   # AES-256 base64 32 bytes
```

---

## Phase 1 — Inject basique

```http
POST /v1/inject
Authorization: Bearer ov_agent_... | ov_inj_...
Content-Type: application/json

{
  "secretId": "uuid",
  "mode": "handle",
  "purpose": "openai.chat",
  "requestId": "opsgate-req-123"
}
```

| `mode` | Qui | Réponse |
|--------|-----|---------|
| `handle` | Agent | `{ handle, secretRef, hint, expiresAt, lease }` — **pas de material** |
| `material` | Injector | `{ material, handle, lease, … }` |

---

## Phase 2 — Leases JIT + risk

### Champs OpsGate recommandés

```json
{
  "secretId": "uuid",
  "mode": "handle",
  "action": "openai.chat",
  "sessionId": "opsgate-session-abc",
  "workloadId": "k8s:ns/sa-name",
  "riskScore": 0.35,
  "ttlSec": 120,
  "maxUses": 3,
  "requestId": "req-…",
  "stepUpApproved": false
}
```

| Champ | Rôle |
|-------|------|
| `action` | Scope fin (agent × action × temps) — sinon `purpose` |
| `sessionId` | Binding session OpsGate (optionnellement obligatoire via policy) |
| `workloadId` | Identité soft (K8s SA, SPIFFE id, deploy id) |
| `riskScore` | 0–1 fourni par OpsGate |
| `stepUpApproved` | `true` après MFA/approbation humaine (si `step_up`) |

### Décisions risk (policy vault)

| Score vs seuils | Decision | Effet |
|-----------------|----------|--------|
| ≥ `denyAbove` (déf. 0.85) | `deny` | HTTP 403 |
| ≥ `stepUpAbove` (0.6) | `step_up` | 403 jusqu’à `stepUpApproved` |
| ≥ `reduceTtlAbove` (0.4) | `reduce_ttl` | TTL = `reducedTtlSec` |
| sinon | `allow` | TTL = `defaultLeaseTtlSec` |

Config UI : **Agents → Risk** ou `GET/PUT /v1/risk-policy`.

### Cycle de vie lease

```text
1. POST /v1/inject mode=handle  →  lease active + handle
2. OpsGate POST /v1/leases/{handle}/material  →  material (consomme use)
3. POST /v1/leases/{id}/renew   →  prolonge TTL (re-évalue risk)
4. POST /v1/leases/{id}/revoke  →  mort immédiate
```

Rotation ou delete d’un secret machine → **révocation de tous ses leases**.

### Secrets dynamiques (éphémères)

```http
POST /v1/leases
{ "dynamic": true, "action": "temp.token", "ttlSec": 60, "maxUses": 1, "riskScore": 0.1 }
```

Material généré côté serveur, stocké **uniquement sur le lease** (pas de secret permanent).  
Redeem : `POST /v1/leases/{handle}/material` (injector).

### Endpoints P2

| Method | Path | Auth |
|--------|------|------|
| POST | `/v1/inject` | agent / injector (+ risk) |
| POST | `/v1/leases` | agent / injector / vault |
| GET | `/v1/leases` | vault (ou agent = ses leases) |
| GET | `/v1/leases/:id` | — |
| POST | `/v1/leases/:id/renew` | vault / owner agent / injector |
| POST | `/v1/leases/:id/revoke` | vault / injector |
| POST | `/v1/leases/:handle/material` | injector only |
| POST | `/v1/leases/revoke-all` | vault `{ secretId? agentId? }` |
| GET/PUT | `/v1/risk-policy` | vault |

### Session binding

Si le lease a un `sessionId` et que redeem envoie :

```http
X-OpsGate-Session: opsgate-session-abc
```

alors mismatch → 403.

### Codes d’erreur

| Code HTTP | `code` | Cas |
|-----------|--------|-----|
| 401 | — | Token invalide |
| 403 | `risk_deny` / `step_up` / agent_not_allowed | Policy |
| 410 | `expired` / `exhausted` | Lease mort |
| 404 | — | Secret / lease inconnu |

---

## Flux de référence P2

```text
Agent demande action "stripe.charge"
  → OpsGate calcule riskScore + sessionId
  → POST /v1/inject mode=handle { secretId, action, riskScore, sessionId }
  → reçoit handle (pas de clé)
  → OpsGate POST /v1/leases/{handle}/material
  → injecte material dans le proxy/connector
  → transcript LLM = handle/hint seulement
  → fin d’action : revoke lease (ou maxUses atteint)
```

## Phase 3 — NHI (OpsGate PEP feed)

### Inventaire & permissions

| Method | Path | Rôle |
|--------|------|------|
| GET | `/v1/nhi/inventory` | UI / admin |
| POST | `/v1/nhi/sync` | Sync agents → identities |
| POST | `/v1/nhi/permissions` | Grant Identity → Secret |
| DELETE | `/v1/nhi/permissions/:id` | Revoke grant |
| GET | `/v1/nhi/findings` | Dashboard gouvernance |
| GET | `/v1/nhi/policy-export` | **Feed OpsGate** (vault ou injector + `?vaultId=`) |
| GET | `/v1/nhi/audit-export` | Pack conformité JSON |

### Enforcement

Si une identité liée à l’agent a **au moins un** grant NHI :

- inject n’est autorisé que pour les `secretId` listés ;
- `actions` peut restreindre (`*` ou `openai.chat`, …).

Sinon : fallback P1 `allowedAgents` sur le secret.

### Policy export (OpsGate)

```http
GET /v1/nhi/policy-export
X-Vault-Id: …
# ou injector:
Authorization: Bearer ov_inj_…?vaultId=…
```

```json
{
  "format": "opsvault-nhi-policy-v1",
  "identities": […],
  "permissions": [{ "identityId", "secretId", "actions" }],
  "secrets": [{ "id", "purpose", "allowedAgents" }],
  "riskPolicy": {…},
  "agents": […]
}
```

OpsGate charge ce document périodiquement (ou à chaud) pour **pré-filtrer** les tool calls avant même d’appeler `/v1/inject`.

### Hors scope (plus tard)

SPIFFE full mesh, dual control, broker connector catalog, NHI multi-tenant SaaS.
