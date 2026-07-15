# Recovery concepteur  -  sécurisation (offline)

## Problème actuel

Un **seul** secret vendor (`OPSGATE_VENDOR_RECOVERY`) hashé et poussé aux agents :

- **Single point of failure** : fuite du secret → unenroll de masse (si offline > 2 h).
- Offline obligatoire : on ne peut pas interroger le cloud pour valider un OTP à chaque unenroll.

## Contraintes offline (le nœud dur)

| Besoin | Implication |
|--------|-------------|
| Device **sans réseau** | Vérification **locale** uniquement (hash / clé publique déjà en store) |
| Pas de replay | Après usage, le code ne doit plus marcher **même offline** sur le même device |
| Pas de fuite masse | Un code volé ne doit pas ouvrir **tous** les agents du parc |
| Audit | Au retour online, l’API doit savoir *quel* code a servi *quel* agent |

Donc : **pas de secret unique permanent partagé par toute l’org** en cible.  
Les OTP « cloud » purs (SMS, TOTP serveur) ne marchent **pas** sans réseau au moment du break-glass.

## Options

### A. Codes à usage unique pré-provisionnés (**recommandé V1.x**)

1. Console (principal) génère **N codes** (ex. 10-50) affichés **une fois** → stockés **hashés** (argon2id / scrypt).
2. Au **sync / force-sync**, chaque agent reçoit la **liste des hashes actifs** (pas les codes en clair).
3. Unenroll recovery : saisie d’un code → match local d’un hash → **splice** du hash du store local + journal `recovery_code_id` + event en file d’attente.
4. Au prochain online : event `recovery_code_consumed` → API marque le code **consumed** (ne repart plus aux autres agents).

**Pourquoi ça casse le SPOF :**

- Vol d’**un** code = **un** unenroll (pas le parc entier si on limite usage + invalidation).
- Après consommation locale, même code ne rejoue pas sur **ce** agent.
- Après sync, le code n’est plus poussé → les agents encore offline qui n’avaient pas ce hash… n’avaient déjà que l’ancien set (fenêtre bornée).

**Limites honnêtes :**

- Agent offline **longtemps** peut encore avoir d’anciens hashes jusqu’au prochain poll.
- Pool fini : regénérer + force-sync après usage intensif.
- Si un attaquant copie le store agent avant unenroll, il voit des hashes (pas les codes)  -  OK.

**Mitigations complémentaires :**

- Delay offline minimum (déjà ~2 h) avant d’accepter recovery.
- Rate-limit local (ex. 5 essais / 15 min) + lockout.
- Codes longs (16+ chars entropie) ; affichage type `XXXX-XXXX-XXXX`.
- Scope optionnel **par org** puis plus tard **par site / flotte**.

### B. Secret rotatif + fenêtre de validité

- Rotation périodique du secret vendor, double-accept (ancien + nouveau) 30 j.
- Réduit la fenêtre si fuite, **reste un secret partagé** = SPOF atténué seulement.

### C. Challenge offline asymétrique (V2 enterprise)

- Outil concepteur (clé privée HSM / USB) signe `agent_id || nonce || ts`.
- Agent vérifie avec clé publique embarquée au enroll.
- Meilleur modèle crypto ; UX plus lourde (outil + machine de signature).

### D. Hybride (idéal long terme)

- **A** pour break-glass terrain (technicien avec codes paper/sealed).
- **C** pour support concepteur remote.
- Jamais un seul password éternel dans `.env` seul.

## Recommandation OpsGate

| Phase | Action |
|-------|--------|
| **V1.x (mode principal)** | **Pool one-time** : console Admins → Générer / Invalider ; hashes sync agent ; burn local + `consumeRecoveryCode` à l’unenroll |
| **Transition** | Secret env `OPSGATE_VENDOR_RECOVERY` encore accepté en **secours** offline si pool vide (déprécié) |
| **V2** | Retrait secret env ; option **C** (ou D) break-glass enterprise |

**Usage agent** : username `vendor` (ou `recovery` / `opsgate`) + code `XXXX-XXXX-XXXX-XXXX`, uniquement si offline ≥ 2 h.

**Invalidation pool** : **tous** les codes du pool sont **effacés** (actifs et déjà utilisés).

## Checklist pilote réel (validation)

| # | Étape | OK ? |
|---|--------|------|
| 1 | Principal : **Générer** 10 codes · copier / `.txt` | |
| 2 | Force-sync auto (ou manuel) · agent **Synchroniser** | |
| 3 | Agent offline ≥ 2 h (ou last sync vieux) | |
| 4 | Désinscription Options : user `vendor` + **un** code | |
| 5 | Agent désenrôlé · code **utilisé** en console | |
| 6 | Même code rejoué → **échec** | |
| 7 | **Invalider le pool** · **tous** les codes effacés · force-sync | |
| 8 | Stock bas (&lt;5) affiché · regénérer | |

Fallback : mdp admin local si `protect_unenroll` ; secret legacy `OPSGATE_VENDOR_RECOVERY` encore poussé (transition).

### Cadre opérationnel du pool one-time (obligatoire)

Sans cadre, un pool mal géré = encore un SPOF (fuite de la feuille de codes) ou un panne (plus de codes offline).

| Règle | Détail |
|-------|--------|
| **Génération** | Principal uniquement · 10-50 codes · entropie ≥ 80 bits · format `XXXX-XXXX-XXXX-XXXX` |
| **Affichage** | **Une seule fois** à la génération · export PDF chiffré / coffre-fort · jamais re-affichable |
| **Stockage API** | Hash argon2id seulement · `active` / `consumed_at` / `consumed_agent_id` |
| **Distribution agent** | Hashes actifs dans le pack/policy sync (pas les codes) |
| **Consommation** | Match local → retire le hash · file event `recovery_code_consumed` |
| **Invalidation parc** | Au prochain poll online · code ne repart plus |
| **Rate-limit local** | 5 essais / 15 min + lockout progressif |
| **Delay offline** | Toujours ≥ 2 h sans sync avant d’accepter recovery |
| **Seuil bas** | Alerte console si &lt; 5 codes actifs · regénération + force-sync |
| **Rotation** | **Invalider le pool** (principal) : DELETE tous les codes du pool ; bump epoch |
| **Audit** | `recovery_codes_generated`, `recovery_code_consumed`, `recovery_pool_revoked` |
| **Fallback** | Admin mdp local (protect_unenroll) si pool vide + online bientôt |

**Console :** ne montrer les codes en clair **qu’à la génération** (principal + audit fort).  
Ensuite : compteurs « restants / consommés », jamais re-affichage du secret.

## Licences constructeur (console)

| Élément | Détail |
|---------|--------|
| **Trial** | 30 jours depuis création org · mode `trial` |
| **Activation** | Paramètres → Gestion des licences → **Ajouter une licence** |
| **Clé** | `OG1.<payload>.<hmac>` liée à un **orgCode** (mismatch → refus) |
| **Champs client** | Lecture seule (entreprise, adresse, email, exp, sièges) remplis par la clé |
| **Émission** | `node scripts/issue-license.mjs --org CODE --company "…" --address "…" --email … --seats N --expires YYYY-MM-DD` |
| **Secret** | `OPSGATE_LICENSE_SECRET` (prod) |
| **Portail constructeur** | UI d’émission multi-client → **V2** |

## Schéma futur

```
recovery_codes (
  id, org_id, code_hash, label, created_at,
  consumed_at, consumed_agent_id, active
)
```

Sync payload : `recovery_code_hashes: string[]` (actifs seulement).  
Agent : array local, splice on match, queue event.

## FAQ rapide

**« On change le code unique ou plusieurs one-time ? »**  
→ **Plusieurs one-time** (A). Un seul code permanent = SPOF.

**« Offline, comment invalider partout d’un coup ? »**  
→ Impossible instantanément. On invalide **au prochain sync** + consommation **locale** immédiate. C’est le compromis offline.

**« Et si tous les codes sont brûlés pendant une panne réseau ? »**  
→ Fallback admin mdp (si protect_unenroll + admin local) ou regénération dès le retour online + pack/sync.
