# OpsGate — Guide utilisateur (V1)

**Public** : administrateurs console, pilotes, support  
**Version produit** : 1.2  
**Langue** : français  

Ce guide décrit l’usage quotidien d’OpsGate : extension, console, enrôlement, policies, licences, logs et recovery.  
Pour l’installation technique locale (Docker, ports), voir aussi [`GUIDE-STACK-LOCALE.md`](./GUIDE-STACK-LOCALE.md).

---

## 1. Vue d’ensemble

| Composant | Rôle |
|-----------|------|
| **Extension** | Détecte les données sensibles sur les sites IA, applique la policy, journalise les décisions |
| **API (control plane)** | Enrôlement, sync policy/packs, events, authentification console |
| **Console** | Administration : dashboard, policy, agents, packs, événements, audit |
| **Postgres** | Stockage durable (recommandé en pilote / prod) |

Sans **Postgres**, l’API utilise un store **mémoire** : **toutes les données sont perdues au redémarrage**.

---

## 2. Première connexion console

1. Démarrer l’API (et Postgres si utilisé).
2. Ouvrir la console (ex. `http://127.0.0.1:5173`).
3. Se connecter avec l’email principal et le mot de passe d’installation.
4. Changer le mot de passe à la première connexion si demandé.

**Mode avancé (login)** : le champ URL API est masqué par défaut ; l’activer uniquement pour pointer une autre instance.

**Session unique** : une seconde connexion propose « Forcer la déconnexion ».

**Mauvais mot de passe** : le message indique combien d’essais restent. Après trop d’échecs, le compte est **verrouillé** — un administrateur principal le débloque dans *Admins & groupes*.

---

## 3. Enrôlement (extension)

### Organisation

1. Options de l’extension OpsGate.
2. Saisir l’**URL API** et le **code organisation** (ex. `DEMO-OPSGATE`).
3. Nommer l’appareil (label).
4. **Enrôler**.

Après un sync réussi :

- les policies sont **gérées** par l’org (non modifiables localement) ;
- la protection reste active hors ligne avec la **dernière policy** reçue.

### Personnel

Clé de licence personnelle → mode personnel (pas de télémétrie org vers la console).

### Désinscription

Si la policy l’exige : identifiant + mot de passe administrateur.  
Recovery concepteur : réservé au principal / support (voir §8).

---

## 4. Tableau de bord

Vue d’ensemble de la flotte : licences, agents connectés, décisions, menaces fréquentes.

- Cliquez un indicateur pour voir le détail (liste d’agents ou logs).
- **Étendre** : les graphiques remplissent l’écran de contenu (la barre du haut et le menu de gauche restent visibles).
- **Réduire** : retour à la vue normale.
- **Force sync** : pousse la configuration aux agents en ligne (effet sous ~2 min).

---

## 5. Policy

### Policy org par défaut

S’applique aux agents **licenciés sans profil / groupe** spécifique.

- **Sites IA** : catalogue par groupes + sites personnalisés  
- **Action par défaut** : `warn` | `mask_recommend` | `mask_force` | `block`  
- **Collecte d’events** : on/off  
- **Messages utilisateur** : textes du bandeau (optionnel)

Enregistrer puis **Synchroniser** (ou attendre le poll ≤ 2 min).

### Policies par département (profils)

1. Créer un profil (ex. Finance).  
2. Assigner via **groupes** (ou agent).  
3. Les agents du groupe héritent du profil.  
4. Vous pouvez **désactiver** un profil sans le supprimer.

---

## 6. Licences

- Un **siège** = un agent protégé.  
- Sans siège : période de **grâce** (24 h), puis protection inactive (**unlicensed**).  
- L’assignation à un **groupe** (ou manuelle) active en général le siège.  
- Essai : **30 jours** à la création de l’organisation.  
- Licence full : clé du type `OPS-XXXX-XXXX-XXXX-XXXX` (Paramètres → Licences).  
- Dashboard : listes Licensed / Grace / UNLICENSED.

---

## 7. Packs de règles

Un **pack** est le jeu de signatures de détection poussé aux agents sans rebuilder l’extension.

- **Publier** : nouvelle version (éventuellement sans certaines règles bruyantes).  
- **Activer** : version reçue au prochain sync.

---

## 8. Admins, recovery & paramètres

### Admins & groupes

- Plusieurs administrateurs ; un ou plusieurs **principals** (accès complet).  
- **Modifier** un compte · **Nouveau mdp** · **Déverrouiller** · supprimer (selon droits).  
- **Groupes** pour lier agents et profils policy.

### Recovery concepteur

| Phase | Pratique |
|-------|----------|
| Actuel | Secret fort `OPSGATE_VENDOR_RECOVERY` ; délai offline ≥ 2 h |
| Recommandé V1.x | **Pool de codes one-time** (bas de page *Admins & groupes*, principal uniquement) |

### Paramètres utiles

- **Langue** FR / EN (Paramètres → Général) — s’applique à toute la console.  
- **Rétention des logs** (défaut 90 jours) et types de journaux.  
- **Seuil d’échecs de login** (verrouillage compte).  
- **Monitoring** : seuils online / hors-ligne ; planning heures de travail.

---

## 9. Événements (logs) & export

Décisions typiques : `mask_send`, `send_anyway`, `cancel`, enroll / unenroll.

### Rétention

- Définie par l’**entreprise** (Paramètres → logs).  
- Au-delà : **purge automatique**.  
- **Exporter** la semaine, tout, ou une période (CSV / JSON).  
- Archive auto fin de semaine si activée.

### Audit admin

Journal des actions console (policy, profils, admins, packs…).  
Réservé au **principal**. Export disponible.

---

## 10. Monitoring & horaires

- Seuils **online** / **not connected long time**  
- **Planning** (fuseau, jours, pauses) pour ne pas alerter hors heures  
- Rétention logs + archive hebdo  

Fuseaux : Europe, Cameroun (`Africa/Douala`), Madagascar (`Africa/Antananarivo`), etc.

---

## 11. Règles d’affectation

Règles auto (label / hostname → groupe), conditions en **AND**, priorité ordonnée.  
Appliquées à l’enroll et via « Ré-évaluer ».

---

## 12. Données & base — pourquoi tout peut « disparaître »

| Cause | Effet | Prévention |
|-------|--------|------------|
| API **sans** base Postgres | Store **mémoire** → vide au restart | Toujours démarrer Postgres |
| `docker compose down -v` | Volume Postgres **détruit** | Ne pas utiliser `-v` en pilote |
| Nouveau volume / autre machine | DB « vide » + re-seed DEMO | Vérifier le volume Docker |
| Rétention logs courte | Events anciens **purgés** | Ajuster la rétention ; exporter avant |
| Redémarrage API en mémoire | Perte agents, events, admins | Passer à Postgres |

Le seed `DEMO-OPSGATE` ne s’exécute **que si** l’org n’existe pas encore : il **ne réécrit pas** une org déjà présente.

### Checklist démarrage durable

```powershell
docker compose up -d
$env:DATABASE_URL = "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"
pnpm api:dev
pnpm console:dev
```

Vérifier le log API : `store=postgres` (et non `memory`).

---

## 13. Raccourcis console (V1)

| Action | Détail |
|--------|--------|
| `/` | Focus recherche / filtre événements (onglet Événements) |
| Thème | Clair / sombre sur le bandeau d’état |

---

## 14. Support & docs liées

| Document | Contenu |
|----------|---------|
| [`GUIDE-STACK-LOCALE.md`](./GUIDE-STACK-LOCALE.md) | Docker, ports, build extension |
| [`RECOVERY-CONCEPTEUR.md`](./RECOVERY-CONCEPTEUR.md) | Pool one-time, offline |
| [`RULE-PACKS.md`](./RULE-PACKS.md) | Packs de règles |
| [`RUNBOOK-OPS.md`](./RUNBOOK-OPS.md) | Exploitation |
| [`PRIVACY.md`](./PRIVACY.md) | Modes & privacy |

Contact support : **contact@dailyops.tech** (indiquer le code organisation et la version).

---

*OpsGate V1 · Guide utilisateur · document de référence produit*
