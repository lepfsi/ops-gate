# OpsGate Console (MMC)

UI admin React/Vite pour le control plane.

**Version** : 1.2.x · monorepo

## Run

```bash
# terminal 1 — API
pnpm api:dev

# terminal 2 — Console
pnpm console:dev
```

Ouvre **http://127.0.0.1:5173**

Lab : header admin injecté automatiquement (`X-OpsGate-Dev-Admin: demo`).

## Onglets principaux

| Onglet | Rôle |
|--------|------|
| **Tableau de bord** | Summary, widgets, licences, connectivité |
| **Portfolio MSP** | Multi-org (même email admin) + KPI |
| **Policy** | Action, hosts, file scan, messages banner, profils |
| **People** | Admins, users, groups |
| **Packs** | Publish / activate packs de règles |
| **Agents** | Enrollés, licences, import CSV |
| **Events** | Métadonnées détection |
| **Risk Score** | Scores utilisateurs, tendances, pagination |
| **Shadow AI** | Inventaire outils IA (auth / unauth) |
| **Audit** | Journal WORM admin |
| **Paramètres** | Langue console + **langue agents**, monitoring, SSO… |

## Build

```bash
pnpm console:build
# vendor branding :
pnpm console:build:vendor
```

## i18n

Console : `src/i18n.ts` (préférence locale navigateur admin).  
**Agents** (banner) : indépendant — Paramètres → Langue des agents (`fr`/`en`/`auto`).

## Docs

- [`docs/architecture/PR4-CONSOLE.md`](../../docs/architecture/PR4-CONSOLE.md)  
- [`docs/GUIDE-UTILISATEUR-V2.md`](../../docs/GUIDE-UTILISATEUR-V2.md)
