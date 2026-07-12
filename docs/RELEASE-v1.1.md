# OpsGate **v1.1.0** — Pilot release

**Date** : 11 juillet 2026  
**Statut** : **Pilot-ready** (pas encore « enterprise GA »)

## Réponse courte : PR6 = fin du **v1.1 pilot** ?

**Oui** pour un **rendu v1.1 utilisable en pilote** (équipe interne / early customers techniques).

**Non** si on vise un **GA enterprise** (SSO, multi-tenant prod, support 24/7, store Chrome, SLA).

### Inclus v1.1 (livré PR0→PR6)

| Capacité | Statut |
|----------|--------|
| Extension DLP IA (prompt + upload) | ✅ |
| Moteur `@opsgate/engine` | ✅ |
| API enroll + config + events | ✅ |
| RulePack publish / activate | ✅ |
| Agent enroll + sync + cache règles | ✅ |
| Console Summary / Packs / Agents / Events | ✅ |
| Store memory **ou** Postgres | ✅ |
| Signature **ed25519** des packs + vérif agent | ✅ PR6 |
| Privacy doc + runbook + kit démo | ✅ |
| Mode `local_only` offline | ✅ |

### Explicitement hors v1.1 (plus tard)

| Capacité | Cible |
|----------|--------|
| Auth admin magic link / SSO | v1.1.1+ |
| Proxy local | v1.2 |
| Chrome Web Store public | post-pilote |
| UI no-code règles | P2 |
| Multi-région / HA | post-GA |
| Block forcé par défaut | opt-in strict only |

## Critères « go pilote » (checklist)

- [ ] `pnpm test` (rules + event schema) vert  
- [ ] `pnpm api:smoke` vert  
- [ ] `pnpm build` + `pnpm console:build` OK  
- [ ] Parcours manuel : enroll DEMO → détection → event console → publish pack → sync  
- [ ] Aucun prompt en clair en base (events metadata)  
- [ ] `docs/PRIVACY.md` partagé aux testeurs  

## Lancer le pilote

Voir `docs/demo/` + :

```bash
pnpm api:dev
pnpm console:dev
pnpm build   # charger l’extension
pnpm e2e     # smoke API automatisé
```

## Versioning packages

Tous les packages monorepo affichés **1.1.0** pour ce cut.
