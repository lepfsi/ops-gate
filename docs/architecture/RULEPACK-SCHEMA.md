# RulePack — schéma & cycle de vie

Complément de [PLATFORM-v1.1.md](./PLATFORM-v1.1.md).

## Format fichier

```json
{
  "schema_version": 1,
  "pack_id": "opsgate-global",
  "version": "1.3.0",
  "min_engine_version": "0.3.0",
  "published_at": "2026-07-11T12:00:00Z",
  "notes": "Ajout Huawei + MikroTik",
  "rules": [
    {
      "id": "aws-access-key",
      "name": "AWS Access Key",
      "category": "general",
      "severity": "high",
      "patterns": ["\\bAKIA[0-9A-Z]{16}\\b"],
      "keywords": [],
      "action_default": "mask",
      "description": "Clé d'accès AWS (AKIA…)"
    }
  ]
}
```

## Contraintes

- `rules[].id` unique dans le pack  
- `patterns` : regex valides, testées à la publication  
- Taille pack < 512 KB (MVP)  
- Signature ed25519 sur `checksum_sha256(canonical_json(rules)+version)`

## Résolution agent

1. Si `local_only` → `rules/rules.json` embarqué  
2. Si `org_managed` → cache `rules_pack` API, sinon fallback embarqué  
3. Merge futur (P2) : pack org **remplace** global (pas de merge rule-by-rule en v1.1)

## Publication console

1. Validate JSON + compile chaque regex  
2. Run `pnpm test:rules` équivalent côté CI (fixtures)  
3. Sign + store immuable `version`  
4. Bump `policy.rules_pack_version`  
5. Agents pull au prochain sync
