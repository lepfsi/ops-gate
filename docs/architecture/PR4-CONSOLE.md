# PR4 — OpsGate Console web (DONE)

**Date** : 11 juillet 2026  
**Statut** : **Exists**  
**Depends** : PR1 API · PR2 RulePack · (PR3 agent pour données live)

## Objectif

Donner un **visage** au control plane : summary + gestion des packs, sans attendre le SSO.

## Package

`packages/console` — **Vite + React 18**

## Run

```bash
pnpm api:dev        # :8787
pnpm console:dev    # :5173
```

## Fonctionnel

| Onglet | Actions |
|--------|---------|
| Summary | KPI agents / events / packs, décisions, top rules |
| Rule packs | Publish clone + `disable_rule_ids`, activate version |
| Agents | Liste devices enrollés |
| Events | Timeline metadata-only |

- URL API configurable (localStorage)  
- Header dev admin auto  
- Pas de prompt brut affiché  

## Volontairement plus tard

- Auth magic link  
- Éditeur JSON règles full  
- Graphiques  
- Multi-org switcher  
- Deploy static (Vercel) + API EU  

## Suite chrono

**PR5** — Postgres (remplacer memory store)  
ou polish démo end-to-end (script API + console + extension)
