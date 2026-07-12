# PR3 — Agent extension : enroll + sync rules (DONE)

**Date** : 11 juillet 2026  
**Statut** : **Exists**  
**Depends** : PR0 engine · PR1 API · PR2 RulePack

## Objectif

Brancher l’extension réelle sur le control plane :

1. **Enrôler** un appareil avec un code org  
2. **Synchroniser** policy + pack de règles  
3. **Détecter** avec le pack en cache (fallback embarqué si local / offline)

## Ce qui existe

### Engine

```ts
detectSensitiveData(text, customRules?)
maskSensitiveData(text, detections, customRules?)
```

### Extension

| Module | Rôle |
|--------|------|
| `src/lib/cloud.ts` | `enrollAgent`, `syncConfig`, `reportEvents` |
| `src/lib/agent-store.ts` | settings + cache pack + mémoire CS |
| `src/lib/detect.ts` | détection sync/async avec pack actif |
| `src/options.tsx` | UI enroll / sync / unenroll / API URL |
| `src/background.ts` | messages ENROLL, SYNC_NOW, alarm 30 min |
| `src/contents/ai-sites.ts` | utilise pack mémoire |

### Settings (`OpsGateSettings`)

- `mode`: `local_only` \| `org_managed` \| …  
- `apiBaseUrl` (défaut `http://127.0.0.1:8787`)  
- `orgId`, `orgName`, `agentId`, `agentToken`  
- `rulesPackVersion`, `eventReporting`, `lastRulesSyncAt`

### Manifest

- `host_permissions`: `127.0.0.1:8787`, `localhost:8787`  
- `permissions`: `storage`, `alarms`

## Parcours test manuel

```bash
# Terminal 1
pnpm api:dev

# Terminal 2
pnpm build
# Charger build/chrome-mv3-prod dans Chrome
```

1. Ouvrir **Options** OpsGate  
2. URL API = `http://127.0.0.1:8787`  
3. Code = `DEMO-OPSGATE` → **Enrôler**  
4. Vérifier pack `1.0.0` (ou version active)  
5. (Option) Publish pack via API admin qui retire une règle  
6. **Synchroniser maintenant** → nouveau pack  
7. Sur ChatGPT, coller un secret → bandeau (console : `pack=x.y.z`)

## Unenroll

**Quitter l’org** → `local_only`, règles embarquées, token effacé.

## Events

Si `eventReporting` (policy org) : chaque entrée journal tente un `POST /v1/events/batch` (metadata only).

## Volontairement plus tard

- UI consentement explicite events  
- Retry queue offline robuste  
- HTTPS prod + pin  
- Signature ed25519 vérifiée côté agent  

## Suite chronologique

**PR4** — Console admin web (Summary + packs)  
ou hardening agent (consent, offline queue)
