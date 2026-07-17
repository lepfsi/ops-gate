# OpsGate – Vision Produit & Roadmap Stratégique

**Version** : 1.0  
**Date** : 17 juillet 2026  
**Statut** : Document de référence  
**Auteur** : Équipe Produit & Technique

---

## 1. Vision

OpsGate est une **plateforme de sécurité dédiée à l’utilisation de l’Intelligence Artificielle en entreprise**.

Notre objectif n’est pas de bloquer les IA génératives, mais de permettre leur utilisation en toute confiance grâce à une couche de protection intelligente située entre les utilisateurs et les modèles d’IA.

**Philosophie :**  
> **Enable AI. Secure Data.**

---

## 2. Le problème

Les collaborateurs utilisent quotidiennement :
- ChatGPT
- Claude
- Gemini
- Copilot
- Mistral
- DeepSeek
- et d’autres modèles IA

Ils y transmettent parfois involontairement :
- documents confidentiels
- configurations réseau
- mots de passe
- clés API
- données RH
- informations financières
- code source
- secrets industriels

Les PME disposent rarement d’outils simples, abordables et efficaces pour contrôler ces échanges.

---

## 3. Positionnement

**OpsGate n’est pas un simple DLP.**

C’est une **AI Security Platform** pensée pour les PME.

Le DLP devient une fonctionnalité parmi d’autres.

**Phrase de positionnement :**
> OpsGate protects every interaction between your organization and Generative AI.

---

## 4. Proposition de valeur

OpsGate protège chaque interaction entre l’entreprise et les modèles d’IA.

Le produit :
- inspecte les prompts en temps réel
- analyse les fichiers joints
- détecte les données sensibles
- propose une version anonymisée intelligente (Secure Rewrite)
- calcule un score de risque instantané
- applique les politiques de sécurité
- journalise toutes les interactions

… sans empêcher les collaborateurs d’utiliser leur IA préférée.

---

## 5. Les piliers du produit

### 5.1 AI Gateway
Passerelle sécurisée entre les utilisateurs et les modèles IA (extension navigateur + proxy optionnel).

### 5.2 Prompt Protection
Inspection en temps réel des prompts avec détection de :
- Secrets & API Keys
- Credentials
- Configurations réseau (Fortinet, Cisco, etc.)
- Données personnelles
- Informations financières
- Code source sensible

### 5.3 File Protection
Inspection des documents avant envoi (PDF, Word, Excel, images, archives).

### 5.4 Secure Rewrite ⭐ (Fonctionnalité phare)
Anonymisation intelligente en un clic.

L’utilisateur colle un contenu sensible → OpsGate propose une version nettoyée :
- IP internes → `10.x.x.x`
- Mots de passe → `********`
- Noms d’hôtes → `FW-01`
- Comptes → `user-01`
- Certificats et autres données sensibles

L’utilisateur obtient toujours de l’aide de l’IA, sans exposer les données critiques.

### 5.5 AI Risk Score ⭐
Chaque prompt reçoit un score de risque instantané (0-100) avec détail des éléments détectés et recommandation.

### 5.6 AI Simulation Mode ⭐
Avant l’envoi, OpsGate simule ce qui pourrait fuiter et affiche :
- Liste des éléments sensibles détectés
- Niveau d’impact (Low / Medium / High)
- Recommandation claire (ex. : « Anonymize before sending »)

### 5.7 AI Usage Analytics & Dashboard
Tableaux de bord orientés DSI / RSSI :
- Prompts analysés
- Prompts à risque
- Secrets détectés
- Configurations critiques
- Top utilisateurs / Top IA / Tendances

### 5.8 Policy Engine
Politiques différenciées par département (RH, Finance, IT, Direction, Prestataires…).

### 5.9 Audit & Compliance
Journalisation complète (qui, quoi, quand, quelle IA, quel niveau de risque, quelles données détectées).

---

## 6. Fonctionnalités futures prioritaires

| Priorité | Fonctionnalité              | Description                                      | Horizon     |
|----------|-----------------------------|--------------------------------------------------|-------------|
| P0       | Secure Rewrite              | Anonymisation intelligente en un clic            | Court terme |
| P0       | AI Risk Score (par prompt)  | Score + détail + recommandation                  | Court terme |
| P0       | AI Simulation Mode          | Simulation des fuites avant envoi                | Court terme |
| P1       | AI Agent Guard              | Protection des agents IA autonomes               | Moyen terme |
| P1       | AI Trust Score              | Score de confiance par modèle IA                 | Moyen terme |
| P1       | Classification intelligente| Public / Internal / Confidential / Restricted    | Moyen terme |
| P2       | Gouvernance IA complète     | Modules avancés de gouvernance et conformité     | Long terme  |

---

## 7. Roadmap proposée

### Phase 1 – Fondations (MVP actuel + stabilisation)
- Extension navigateur robuste
- Détection de secrets et configurations
- Journalisation
- Dashboard basique
- Shadow AI Discovery + Risk Score utilisateur

### Phase 2 – Différenciation (Priorité immédiate)
- **Secure Rewrite**
- **AI Risk Score par prompt**
- **AI Simulation Mode**
- Amélioration du masquage intelligent
- Politiques par groupe / département

### Phase 3 – Visibilité & Gouvernance
- Dashboard avancé orienté DSI
- Analytics complets
- Audit & rapports
- AI Trust Score (évaluation des modèles)

### Phase 4 – Agents & Intelligence
- AI Agent Guard
- Classification intelligente (hybride règles + IA)
- Modules de gouvernance avancés

---

## 8. Vision à 3 ans

OpsGate devient **la plateforme de référence de sécurisation de l’IA pour les PME**.

Modules envisagés :
- AI Gateway
- Prompt Protection
- File Protection
- Agent Protection
- Policy Engine
- Audit & Compliance
- Analytics
- AI Governance

L’ambition : permettre aux entreprises d’adopter l’IA générative **en toute confiance**, sans freiner la productivité.

---

## 9. Conclusion

OpsGate ne cherche pas à restreindre l’adoption de l’IA.  
Il cherche à la rendre **sûre, maîtrisée et conforme**.

En se positionnant clairement comme une **AI Security Platform** et en misant sur des fonctionnalités mémorables (Secure Rewrite, Risk Score + Simulation Mode), le produit se dote d’une identité forte, différenciante et commercialement puissante.

---

*Document vivant – à mettre à jour au fur et à mesure de l’évolution du produit.*
