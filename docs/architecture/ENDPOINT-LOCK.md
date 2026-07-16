# Verrou endpoint (modèle Kaspersky / Check Point)

**Date** : 11 juillet 2026  
**Statut** : Implémenté (v1.1+)

## Principe terrain

Un utilisateur **ne doit pas** pouvoir :

1. Modifier les policies de l’agent managé  
2. Contourner la protection en se « désynchronisant » gratuitement **lorsque l’admin a armé un mdp de sortie**

## Modèle OpsGate

Deux mécanismes distincts :

| Mécanisme | Quand | Effet |
|-----------|--------|--------|
| **Policy lock** (`managedLockActive`) | Premier sync org réussi | Policies / hosts / désactivation non modifiables |
| **Mdp de désinscription** (`managementPasswordHash`) | Admin l’a défini dans la policy (optionnel) | Requis **uniquement** au moment du désenrôlement |

| État agent | Modification policy | Désenrôlement |
|------------|---------------------|----------------|
| Jamais enrôlé (`local_only`) | Libre | N/A |
| Enrôlé, **pas encore** de sync réussi | Verrouillé (soft) | **Libre** (pas encore « armé ») |
| Sync OK, **aucun** mdp dans la policy | Verrouillé | **Libre** |
| Sync OK, **mdp défini** par l’admin | Verrouillé | **Mdp obligatoire** (dialog au clic « Désenrôler ») |

### Flux

1. Admin **peut** définir un mot de passe de désinscription dans la console (hash stocké côté API). **Par défaut (démo) : aucun mdp.**  
2. Agent s’enrôle + **premier sync OK** → active `managedLockActive` + stocke `management_password_hash` s’il est non vide.  
3. Utilisateur ne peut plus désactiver l’extension ni changer hosts / scan.  
4. Token API mort / offline → **dernière policy reste appliquée** (pas de contournement).  
5. Clic « Désenrôler » :
   - hash vide → sortie immédiate ;
   - hash présent → **fenêtre de saisie mdp** (pas de champ permanent dans l’UI) → vérif locale du hash → clear.  
6. Admin retire le mdp en console → prochains sync agents : sortie libre à nouveau.

### Démo

- Seed org `DEMO-OPSGATE` : **pas de mdp** par défaut.  
- Console → **Policy** → mdp de désinscription / OTP / recovery.  
- Exemple mdp org : `OpsGateAdmin!` (si vous le définissez).  
- **Recovery concepteur** (oubli mdp) : `OpsGate-Vendor-Recovery!` (env `OPSGATE_VENDOR_RECOVERY`).

Voir aussi `CONTROL-PLANE.md` (force-sync, profils, events).

## Ce qui n’est pas couvert (OS)

- Désinstallation Chrome / suppression dossier extension → **couvert par MDM force-install**  
  Voir [`CHROME-WEB-STORE-MDM.md`](./CHROME-WEB-STORE-MDM.md) (`ExtensionInstallForcelist`)  
- Tamper protection OS-level (root / admin local)  

Le modèle couvre le **tamper applicatif** (UI + storage agent).  
Combiner avec **force-install MDM** pour empêcher le retrait de l’extension.
