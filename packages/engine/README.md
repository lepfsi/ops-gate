# `@opsgate/engine`

Moteur de détection OpsGate (PR0).

- `detectSensitiveData(text)`
- `maskSensitiveData(text, detections)`
- `getRules()` / `runRulesEngine(text)`
- Pack embarqué : `rules/rules.json`

**Usage**

```ts
import { detectSensitiveData, maskSensitiveData } from "@opsgate/engine"
```

Pas de dépendance runtime. TypeScript source — bundlé par Plasmo / futurs packages.

Voir `docs/architecture/PLATFORM-v1.1.md`.
