# OpsGate Console (PR4)

UI admin légère pour le control plane.

## Run

```bash
# terminal 1 — API
pnpm api:dev

# terminal 2 — Console
pnpm console:dev
```

Ouvre **http://127.0.0.1:5173**

Dev admin header injecté automatiquement : `X-OpsGate-Dev-Admin: demo`

## Onglets

- **Summary** — agents, events, décisions, top rules, pack actif  
- **Rule packs** — publish (clone + disable rules), activate / rollback  
- **Agents** — appareils enrollés  
- **Events** — metadata only  

## Build

```bash
pnpm console:build
```
