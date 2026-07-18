# `@opsgate/engine`

Moteur de détection OpsGate (partagé extension, proxy, tests, console).

**Version** : 1.2.x · monorepo

## API principale

| Export | Rôle |
|--------|------|
| `detectSensitiveData(text, rules?)` | Détection (pack org ou embarqué) |
| `maskSensitiveData(...)` | Masquage simple |
| `secureRewrite(...)` | **V3** anonymisation intelligente |
| `calculatePromptRiskScore(...)` | **V3** score 0–100 + reco |
| `getRules()` / `runRulesEngine` | Pack + moteur |
| `isValidIban` / `isValidLuhn` | Validations |

Pack embarqué : [`rules/rules.json`](./rules/rules.json)

## Usage

```ts
import {
  detectSensitiveData,
  secureRewrite,
  calculatePromptRiskScore
} from "@opsgate/engine"
```

Pas de dépendance runtime. Source TypeScript — bundlé par Plasmo / consumers.

## Tests

```bash
# depuis la racine monorepo
pnpm test:rules
node scripts/test-secure-rewrite.mjs
node scripts/test-prompt-risk.mjs
```

## Docs

- [`docs/architecture/PR0-ENGINE.md`](../../docs/architecture/PR0-ENGINE.md)  
- [`docs/RULE-PACKS.md`](../../docs/RULE-PACKS.md)  
- V3 Secure Rewrite : [`docs/roadmap-v3/FEATURE-SPEC-SECURE-REWRITE-v1.md`](../../docs/roadmap-v3/FEATURE-SPEC-SECURE-REWRITE-v1.md)
