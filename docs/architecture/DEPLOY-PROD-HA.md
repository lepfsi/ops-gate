# OpsGate — Déploiement production & Haute disponibilité

> Synthèse produit + pratiques industry (2025–2026).  
> Lab local (`docker compose` Postgres seul) ≠ architecture prod recommandée.

---

## 1. Docker + Postgres embarqué : est-ce le meilleur combo prod ?

### Verdict

| Contexte | Recommandation |
|----------|----------------|
| **Lab / démo / pilote mono-VM** | Docker Compose (Postgres + API + console) **OK** |
| **Production mid-market on-prem** | **API/console conteneurisés ou service Windows** + **Postgres externalisé** (VM dédiée, cluster, ou managed) |
| **Production SaaS / cloud** | API multi-instances + **Postgres managé** (RDS, Azure DB, Cloud SQL, Aiven…) |

### Ce que font les autres (pratiques courantes)

1. **Séparer le stateful du stateless**  
   - API / console = sans état (scale-out horizontal).  
   - Postgres = service dédié, volumes persistants, backups, éventuellement HA (Patroni, cloud multi-AZ).  
   - Mettre **Postgres dans le même compose que l’app** en prod est accepté pour petits déploiements, mais **déconseillé** dès que l’on veut HA, upgrades indépendants ou responsabilité ops claire.

2. **Docker pour l’app, pas forcément pour la DB**  
   - Beaucoup d’équipes : conteneurs pour l’API, **DB hors Docker** (ou conteneur DB isolé avec volume + backup + monitoring).  
   - Docker Postgres en prod est viable **si** volume nommé, healthchecks, backups automatiques (`pg_dump` / base backup), et procédure de restore testée.

3. **.exe / MSI + DB séparée**  
   - Typique Windows enterprise (comme **proxy OpsGate MSI** déjà livré).  
   - Control plane : service Windows ou IIS reverse-proxy + Node service, pointant vers `DATABASE_URL` externe.  
   - Avantage : intégration AD/GPO, pas d’obligation Docker sur le serveur métier.  
   - Inconvénient : packaging et upgrades un peu plus lourds que l’image container.

### Recommandation OpsGate (produit déployable)

```
                    ┌─────────────────┐
   Agents / Proxy   │  Reverse proxy  │  TLS
   Extension        │  (nginx/IIS)    │
                    └────────┬────────┘
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         API #1          API #2        Console (static)
         (stateless)     (stateless)   (CDN ou même host)
              └──────────────┬──────────────┘
                             ▼
                    PostgreSQL (externe)
                    + backups 7/14/30 j
```

- **Lab** : `docker compose` Postgres (actuel) + API locale.  
- **Prod mononode** : un host API + un host/service Postgres (ou compose 2 services avec volume + backup).  
- **Prod robuste** : N instances API derrière LB + Postgres managed/replicated.

**Pas de monolithe « un seul .exe qui embarque la DB »** pour le control plane : la DB séparée est le standard (restauration, scale, conformité).

---

## 2. Haute disponibilité (HA) — dispositions actuelles & implémentable

### Aujourd’hui (implémenté / design)

| Composant | HA ? | Détail |
|-----------|------|--------|
| **API** | **Scale-out ready** si store Postgres | Sessions/tokens en DB ; pas d’état local obligatoire pour le hot path |
| **Postgres lab** | **Non** (single container) | Point unique de défaillance |
| **Console** | Oui (statique) | Multi-copies / CDN |
| **Extension / agent** | Résilience client | Policy en cache, file d’events locale si API down |
| **Proxy endpoint** | Par poste | MSI local — HA = redondance poste, pas serveur central |
| **Backup** | Oui (manuel + auto 7/14/30) | Config org JSON + `pg_dump` |

### Documenté explicitement (FAQ due diligence)

- **HA multi-région** : hors scope actuel — pas de claim 99,99 % multi-AZ global.  
- **API down** : agent continue en local (policy cache, queue events).  
- **Backup** : config console + script DB + **backup auto** 7/14/30 j.

### HA implémentable (chemin réaliste)

**Niveau 1 — Prod mono-région (recommandé pilote GA)**  
1. Postgres externe (VM + disque résilient ou managed single-AZ).  
2. 2+ instances API derrière reverse-proxy (healthcheck `/health`).  
3. Backup auto 7 j + copie offsite.  
4. Restore testé trimestriel.

**Niveau 2 — HA DB**  
1. Postgres primary/replica (streaming) ou managed multi-AZ.  
2. Failover automatique (cloud) ou Patroni/repmgr (on-prem).  
3. RPO/RTO documentés avec le client.

**Niveau 3 — Multi-région**  
- Actif/passif : replica asynchrone + runbook bascule.  
- Actif/actif multi-write : **non supporté** (pas de design multi-master).

**Limites code à traiter pour HA stricte**  
- Crons (`exports`, `auto-backup`, LDAP, GDPR) : aujourd’hui **un process** — en multi-API, utiliser un leader lock (Postgres advisory lock) ou un seul worker « jobs ».  
- WebSocket temps réel inbox : non ; **poll 12 s** côté console (suffisant pour support admin).  
- Filesystem locaux (backups, exports) : partage NFS/S3 ou coller les jobs sur un nœud dédié.

---

## 3. Backup automatique

Planificateur **système** avec fréquences **7 / 14 / 30 jours** :

| Élément | OpsGate |
|---------|---------|
| Config | Console → Paramètres → Général → **Backup automatique** |
| Contenu | Export config org (JSON) + `pg_dump` si `DATABASE_URL` |
| Intervalle | 7, 14 ou 30 jours |
| Rétention | `keepCount` copies sur disque |
| Dossier | Choix admin (autre disque / NAS) → sinon `OPSGATE_AUTO_BACKUP_DIR` → `./backups/auto` |
| Cron | `OPSGATE_AUTO_BACKUP_CRON_MINUTES` (défaut 60 ; `0` = off) |
| Manuel | Bouton « Lancer un backup maintenant » (principal) |

Voir aussi [`BACKUP.md`](./BACKUP.md).

---

## 4. Checklist déploiement client type

- [ ] Postgres 15+ (externe ou compose prod) + `DATABASE_URL`  
- [ ] API + console derrière TLS  
- [ ] Secrets en env (signing, SMTP, Stripe)  
- [ ] Backup auto activé + copie offsite  
- [ ] Extension déployée (MDM / store) + proxy MSI si MITM  
- [ ] SSO/MFA selon politique client  
- [ ] Test restore staging  
- [ ] Si HA : 2 API + healthcheck + DB replica/managed  

---

*Dernière mise à jour : 2026-07-18*
