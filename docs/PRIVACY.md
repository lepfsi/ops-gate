# OpsGate — Confidentialité (utilisateurs finaux)

**Version produit** : 1.2.0  
**Dernière mise à jour** : 16 juillet 2026

## En une phrase

OpsGate analyse vos prompts **dans votre navigateur**. En mode local, **rien n’est envoyé** à un serveur OpsGate. En mode organisation, seules des **métadonnées** (pas le texte du prompt) peuvent être partagées avec votre org.

## Modes

### Mode local (`local_only`) — défaut

- Détection et masquage **100 % local**
- Journal **uniquement** sur votre machine (`chrome.storage.local`)
- **Aucun** appel réseau OpsGate (sauf si vous activez plus tard le store)

### Mode organisation (`org_managed`)

Après enrôlement avec un code fourni par votre IT :

| Donnée | Envoyée au cloud ? |
|--------|---------------------|
| Contenu du prompt / fichier | **Non** |
| Extraits secrets bruts | **Non** (par défaut) |
| Types de règles déclenchées | Oui (métadonnées) |
| Décision (masquer / envoyer / annuler) | Oui |
| Site IA (hostname) | Oui |
| Horodatage | Oui |

Vous pouvez **quitter l’org** dans Options → retour au mode local.

## Qui peut voir quoi

- **Vous** : journal local dans la popup  
- **Admin org** : dashboard agrégé (console) — pas de lecture de vos conversations  
- **OpsGate (éditeur)** : ne reçoit pas vos prompts ; l’infra cloud héberge les events de **votre** organisation si vous utilisez le control plane  

## Stockage

- Extension : navigateur local  
- Control plane (optionnel) : base Postgres (UE recommandée) — rétention indicative 90 jours  

## Permissions navigateur (Chrome / Firefox)

| Permission | Usage |
|------------|--------|
| `storage` | Journal local, token d’enrôlement, cache de policy |
| `alarms` | Synchronisation périodique de la policy (mode org) |
| Accès sites IA | Injection du content script uniquement sur les domaines IA listés |

Aucun accès permanent à l’historique de navigation hors sites IA déclarés.

## Contact

Questions privacy : votre administrateur OpsGate / IT.  
Pour le Chrome Web Store : héberger ce document en HTTPS public (URL privacy policy).
