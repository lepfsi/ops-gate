# Feature Spec — AI Risk Score (par prompt) + Simulation Mode

**Version** : 1.0  
**Date** : 17 juillet 2026  
**Priorité** : P0  
**Statut** : Draft  

---

## 1. Vision

Aujourd’hui le Risk Score existe au niveau **utilisateur** (Shadow AI + comportement sur 30 jours).  
Nous l’enrichissons maintenant au niveau **prompt individuel** et y ajoutons un mode de simulation avant envoi.

Objectif :
- Donner à l’utilisateur une **évaluation instantanée et claire** du risque de chaque prompt.
- Lui permettre de **simuler** ce qui pourrait fuiter avant de décider d’envoyer.

Ces deux capacités renforcent fortement Secure Rewrite et améliorent l’expérience globale.

---

## 2. AI Risk Score par prompt

### 2.1 Objectif
Chaque prompt analysé reçoit un score de risque de 0 à 100, calculé en temps réel, avec un détail transparent.

### 2.2 Formule (V1 – simple et explicable)

```
Score de base = 0

+ chaque détection Critical / High   → +15 à +25 (selon catégorie)
+ chaque détection Medium            → +8
+ chaque détection Low               → +3

+ présence de catégories particulièrement sensibles :
  - Secrets / API Keys / Credentials     → +10
  - Configurations réseau (Fortinet…)    → +12
  - Données RH / PII                     → +10
  - Code source sensible                 → +8

Score final = min(100, Score de base)
```

Le détail est toujours exposé à l’utilisateur (transparence).

### 2.3 Affichage dans l’extension

```
Risk Score : 87/100  ████████████████░░░░  High

Éléments détectés :
✓ 2 API Keys
✓ 1 Configuration Fortinet
✓ 3 Internal IPs
✓ 1 Password

Recommandation : Anonymiser avant envoi
```

### 2.4 Interface TypeScript

```ts
export interface PromptRiskScore {
  score: number;                    // 0-100
  level: "low" | "medium" | "high" | "critical";
  factors: {
    category: string;
    count: number;
    contribution: number;
  }[];
  recommendation: "allow" | "mask" | "secure_rewrite" | "block";
  calculatedAt: string;
}

export function calculatePromptRiskScore(
  detections: Detection[]
): PromptRiskScore;
```

---

## 3. AI Simulation Mode

### 3.1 Objectif
Avant l’envoi, permettre à l’utilisateur de **visualiser clairement ce qui pourrait fuiter**.

C’est une vue pédagogique et décisionnelle.

### 3.2 Contenu de la simulation

```
┌────────────────────────────────────────────────────────────┐
│  AI Simulation Mode                                        │
│                                                            │
│  Votre prompt contient :                                   │
│                                                            │
│  ✓ VPN configuration                                       │
│  ✓ Internal subnet (192.168.x.x)                           │
│  ✓ Public IP                                               │
│  ✓ Certificate                                             │
│  ✓ Password hash                                           │
│                                                            │
│  Impact estimé :  HIGH                                     │
│                                                            │
│  Recommandation :                                          │
│  Anonymize before sending (Secure Rewrite recommandé)      │
│                                                            │
│  [ Lancer Secure Rewrite ]   [ Envoyer quand même ]  [✕]   │
└────────────────────────────────────────────────────────────┘
```

### 3.3 Déclenchement
- Automatique dès qu’un prompt dépasse un seuil de risque (configurable, ex. ≥ 40)
- Ou via un bouton « Simuler le risque » dans l’interface

### 3.4 Données retournées

```ts
export interface SimulationResult {
  riskScore: PromptRiskScore;
  detectedItems: {
    label: string;           // "VPN configuration"
    category: string;
    severity: "low" | "medium" | "high" | "critical";
    example?: string;        // extrait anonymisé
  }[];
  impact: "low" | "medium" | "high" | "critical";
  recommendation: string;
  suggestedAction: "secure_rewrite" | "mask" | "block" | "allow";
}
```

---

## 4. Intégration avec Secure Rewrite

Les deux fonctionnalités sont conçues pour fonctionner ensemble :

1. Détection → Risk Score calculé
2. Si score élevé → Simulation Mode s’affiche
3. Depuis la Simulation, l’utilisateur peut lancer directement **Secure Rewrite**
4. Après Secure Rewrite, un nouveau Risk Score (beaucoup plus bas) est affiché

Flux recommandé :
**Détection → Simulation → Secure Rewrite → Envoi sécurisé**

---

## 5. Journalisation

Pour chaque prompt analysé :

```ts
{
  decision: "simulated" | "secure_rewrite" | "mask_send" | "send_anyway" | "cancel",
  prompt_risk_score: 87,
  remaining_risk_score: 12,          // après rewrite éventuel
  simulation_shown: true,
  // ... métadonnées existantes
}
```

---

## 6. Points d’attention UX

- Ne pas être trop intrusif : le mode Simulation ne doit s’ouvrir automatiquement que pour les scores élevés.
- Toujours laisser la possibilité de voir le détail.
- Le score et la simulation doivent être compréhensibles par un non-expert.
- Temps de calcul cible : < 150 ms.

---

## 7. Critères de succès

- % de prompts à risque où la Simulation est consultée
- Taux de conversion Simulation → Secure Rewrite
- Réduction des « Envoyer quand même » sur les prompts High
- Clarté perçue du score (tests utilisateurs)

---

## 8. Plan d’implémentation

1. Implémenter `calculatePromptRiskScore()` dans le moteur
2. Créer le composant UI de Simulation Mode
3. Brancher le déclenchement automatique selon seuil
4. Intégrer le lien direct vers Secure Rewrite
5. Mettre à jour la journalisation
6. Tests + ajustement des poids du score

---

## 9. Relation avec le Risk Score Utilisateur

| Niveau              | Objectif                              | Horizon      |
|---------------------|---------------------------------------|--------------|
| Prompt (ce document)| Évaluation instantanée + aide à la décision | Immédiat    |
| Utilisateur (déjà spécifié) | Vue comportementale sur 7/30/90 jours | Déjà en cours |

Les deux scores coexistent et se complètent.

---

*Document vivant – à mettre à jour pendant l’implémentation.*
