# PR2 — RulePack publish & versioning (DONE)

**Date** : 11 juillet 2026  
**Statut** : **Exists**  
**Depends** : PR0 engine · PR1 API

## Objectif

Publier et activer des **versions de packs de règles** par org, sans rebuild de l’extension.  
Les agents reçoivent le pack **actif** via `GET /v1/agents/me/config`.

## Ce qui existe

### Store

- Packs immuables par `orgId` + `version`
- Un seul pack `active` à la fois
- Policy.bump à chaque activation / publish activé

### Endpoints (dev admin: `X-OpsGate-Dev-Admin: demo`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/org/rules/packs` | Liste versions |
| GET | `/v1/org/rules/packs/:version` | Détail + rules |
| POST | `/v1/org/rules/packs` | Publish (rules full **ou** clone + `disable_rule_ids`) |
| POST | `/v1/org/rules/packs/:version/activate` | Rollback / switch |
| PATCH | `/v1/org/policy` | Policy org (hosts, reporting…) |

### Agent

`GET /v1/agents/me/config` → `rules_pack` = **pack actif** (plus le global hardcodé).

### Validation publish

- `rules` array non vide  
- `id` uniques  
- chaque `pattern` compile en RegExp  
- taille < 512 KB  
- signature : `dev-unsigned:<checksum16>` (ed25519 = plus tard)

### Seed

Org `DEMO-OPSGATE` démarre avec pack **`1.0.0`** (= contenu `@opsgate/engine`).

## Exemple publish (désactiver une règle)

```bash
curl -s -X POST http://127.0.0.1:8787/v1/org/rules/packs \
  -H "Content-Type: application/json" \
  -H "X-OpsGate-Dev-Admin: demo" \
  -d '{"disable_rule_ids":["email-address"],"notes":"moins de FP email","activate":true}'
```

## Run / verify

```bash
pnpm api:dev
pnpm api:smoke
```

Smoke PR2 couvre : list → publish → agent sync → invalid 400 → activate rollback.

## Volontairement plus tard

- ed25519 réel  
- Postgres  
- Auth admin  
- UI console  
- Agent extension qui consomme le pack (cache local) → **PR3**

## Suite chronologique

**PR3** — Extension : enroll UI + sync config/rules depuis l’API.
