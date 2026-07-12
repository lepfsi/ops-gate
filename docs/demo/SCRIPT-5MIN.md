# Script démo OpsGate — 5 minutes

**Public** : équipes ops / tech / managers PME  
**Support** : Chrome + ChatGPT (ou Claude) + extension chargée  
**Ton** : rassurant, professionnel, jamais alarmiste

---

## 0:00 – 0:30 · Accroche

**Dire :**

> « Vos équipes utilisent déjà ChatGPT et Claude. La question n’est plus *si*, c’est *ce qu’elles collent dedans* : configs firewall, clés API, mots de passe.  
> OpsGate protège ces interactions **sans bloquer** l’usage de l’IA. »

**Montrer :** badge OpsGate en bas à droite de la page ChatGPT.

---

## 0:30 – 1:30 · Prompt « normal » (contrôle négatif)

**Faire :** coller le *Prompt A* (conversation technique sans secret) → Envoyer.

**Dire :**

> « Un échange technique classique : pas d’alerte. On ne veut pas polluer l’utilisateur. »

---

## 1:30 – 3:00 · Secret applicatif (cœur de la démo)

**Faire :** coller le *Prompt B* (clé API + password) → Envoyer.

**Attendu :** bandeau OpsGate.

**Parcourir les boutons (à voix haute) :**

1. **Voir les détails** — montrer type / sévérité / extrait  
2. **Masquer & Envoyer** — le texte se transforme en placeholders, l’envoi part  
3. *(Option)* rouvrir le popup → entrée de journal

**Dire :**

> « L’utilisateur garde le contrôle. OpsGate recommande le masquage, mais n’impose rien.  
> Traitement 100 % local : rien n’est envoyé à un serveur OpsGate. »

---

## 3:00 – 4:15 · Config infra (différenciateur)

**Faire :** coller le *Prompt C* (snippet Fortinet ou MikroTik) → Envoyer → **Masquer & Envoyer**.

**Dire :**

> « C’est notre différenciateur : pas seulement les e-mails et les IBAN.  
> On détecte les configs **Fortinet, Cisco, Juniper, Huawei, MikroTik, Palo Alto**, les VPN WireGuard, etc.  
> Exactement le type de copier-coller qu’un ingénieur réseau fait le lundi matin. »

---

## 4:15 – 4:50 · Upload fichier (quarantaine)

**Faire :** joindre `samples/01-secrets-app.txt` (ou glisser-déposer).

**Attendu :**

- Fichier **pas** joint tout de suite (quarantaine)
- Bandeau « Fichier en attente »
- Choisir **Masquer puis joindre** → un seul fichier `*.opsgate-masked`

**Dire :**

> « Même logique sur les fichiers : on ne laisse pas l’original partir avant décision.  
> Après masquage, une seule pièce jointe contrôlée. »

---

## 4:50 – 5:00 · Clôture

**Montrer :** popup (journal) + rappel options.

**Dire :**

> « Installation en une minute, règles enrichissables, adapté aux PME et équipes ops.  
> Prochaine étape : pilote sur 10–20 utilisateurs, on affine les faux positifs ensemble.  
> *Utilisez l’IA librement. Protégez vos données automatiquement.* »

---

## Plan B (si un site casse l’UI)

| Problème | Contournement |
|----------|----------------|
| Pas de bandeau | Recharger la page + vérifier badge ; basculer Claude ↔ ChatGPT |
| Envoi trop rapide | Utiliser le bouton Envoyer (pas Entrée) |
| Upload non intercepté | Coller le contenu du fichier en prompt (Prompt B/C) |
| Extension inactive | Popup → **Actif** |

---

## Variante 3 minutes (elevator)

1. Accroche (20 s)  
2. Prompt B + Masquer (90 s)  
3. Prompt C ou upload (60 s)  
4. Clôture (30 s)
