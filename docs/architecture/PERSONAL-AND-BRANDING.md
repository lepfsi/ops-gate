# Personal (standalone) & licences

**Date** : 12 juillet 2026

## Y a-t-il une console personnelle ?

**Non — pas de console web séparée pour l’abonnement personnel en pilot.**

| Usage | Interface de gestion |
|--------|----------------------|
| **Organisation** (`DEMO-OPSGATE`) | Console web `pnpm console:dev` (admins, policies, agents, licences sièges) |
| **Personnel** (`PERSONAL`) | **Extension → Options** uniquement (+ API locale) |

### Flux personnel (local)

1. `pnpm api:dev`  
2. Extension → Options → **Usage personnel**  
3. Clé licence démo : `OPS-PERSONAL-DEMO-2026`  
4. Label appareil → Activer  
5. Gérer sites / scan / sync dans Options (pas de lock admin)

Le **portal cloud** personnel (compte, facturation, multi-devices) est prévu plus tard — ce n’est pas la console org.

### Clés démo

- `OPS-PERSONAL-DEMO-2026`
- `OPS-HOME-TRIAL`
- Env : `OPSGATE_PERSONAL_LICENSE_KEYS=key1,key2`

## Licences org (sièges agents)

Console → **Agents** :

| Métrique | Signification |
|----------|----------------|
| Sièges total | Quota org (`licenseSeats`) |
| Utilisés | Agents avec `licenseAssigned` |
| **Disponibles** | `total − utilisés` (ou ∞ si illimité) |
| Unlicensed | Agents sans siège (après grace) |
| Grace | En période de 5 min |

DEMO seed : **25 sièges**. PERSONAL : **1 siège** (via clé).
