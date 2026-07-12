# PR0 — `@opsgate/engine` (DONE)

**Date** : 11 juillet 2026  
**Statut** : **Exists** (make it good later)

## Ce qui existe

```
packages/engine/
  package.json          # @opsgate/engine
  rules/rules.json      # SoT des règles
  src/
    index.ts
    types.ts
    detector.ts
    rules-engine.ts
    masker.ts
```

Extension :

```ts
import { detectSensitiveData, maskSensitiveData } from "@opsgate/engine"
```

Workspace pnpm : `.` + `packages/*`

## Vérif

```bash
pnpm test:rules   # 19/19
pnpm build        # chrome-mv3-prod OK
```

## Pas encore (volontairement)

- Build tsc → dist (source TS bundlée par Plasmo, suffisant)
- API / console
- Signature RulePack
- Extraction monorepo apps/extension

## Suite

**PR1** — API skeleton (health, org, enroll, config pull)
