# DetectionEvent — schéma wire format v1

Complément de [PLATFORM-v1.1.md](./PLATFORM-v1.1.md).

## Event (agent → API)

```json
{
  "schema_version": 1,
  "client_event_id": "uuid-v4",
  "ts": "2026-07-11T14:22:01.123Z",
  "source": "prompt",
  "hostname": "chatgpt.com",
  "decision": "mask_send",
  "detection_count": 3,
  "highest_severity": "high",
  "rule_ids": ["generic-api-key", "password-assignment"],
  "types": ["API Key / Token", "Mot de passe"],
  "masked": true,
  "file_names": null,
  "redacted_matches": null
}
```

### Valeurs `source` / `decision`

| Champ | Valeurs |
|-------|---------|
| `source` | `prompt` \| `file` \| `system` \| `text` \| **`proxy`** (P2) |
| `decision` | `mask_send` \| `send_anyway` \| `cancel` \| `enroll` \| `unenroll` \| **`observe`** (proxy mode observe) |

Exemple event proxy (observe) :

```json
{
  "schema_version": 1,
  "client_event_id": "uuid-v4",
  "ts": "2026-07-15T16:48:03.974Z",
  "source": "proxy",
  "hostname": "chatgpt.com",
  "decision": "observe",
  "detection_count": 1,
  "highest_severity": "high",
  "rule_ids": ["generic-api-key"],
  "types": ["API Key / Token"],
  "masked": false,
  "redacted_matches": [{ "rule_id": "generic-api-key", "preview": "sk-abcde…2345" }],
  "device_label": "OpsGate Proxy"
}
```

## Champ `redacted_matches` (si policy org = metadata_plus_redacted_match)

```json
"redacted_matches": [
  { "rule_id": "generic-api-key", "preview": "sk-abcd…3456" }
]
```

Règles de rédaction agent :
- max 5 entrées  
- max 24 caractères de preview  
- jamais le prompt complet  
- jamais le contenu fichier

## Champs **interdits** (API rejette 400)

- `prompt`, `text`, `content`, `file_content`, `raw_match` non redacté long  
- PII libre hors schéma  

## Batch

```json
{
  "events": [ /* 1..50 DetectionEvent */ ]
}
```

Idempotence : `client_event_id` unique par agent → upsert ignore duplicate.
