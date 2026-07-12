# Clés ed25519 (PR6)

Générées automatiquement au premier démarrage de l’API si absentes.

| Fichier | Commit ? |
|---------|----------|
| `ed25519-private.pem` | **NON** (gitignored) |
| `ed25519-public.pem` | optionnel ; aussi exposé via `GET /v1/crypto/public-key` |

En prod : injecter la clé privée via secret manager, ne jamais la committer.
