# OpsGate — Checklist de validation MVP

Date de campagne : _______________  
Testeur : _______________  
Version build : 0.3.0  

## Prérequis

- [ ] `pnpm build` OK
- [ ] Extension chargée depuis `build/chrome-mv3-prod`
- [ ] Badge **OG** visible en bas à droite sur le site IA
- [ ] Console : `[OpsGate] Content script actif sur …`

## A. Prompts texte

| # | Scénario | ChatGPT | Claude | Gemini | Notes |
|---|----------|---------|--------|--------|-------|
| A1 | Prompt normal (pas de secret) → envoi libre | ☐ | ☐ | ☐ | |
| A2 | `sk-…` / API key → bandeau | ☐ | ☐ | ☐ | |
| A3 | `password=…` réel → bandeau | ☐ | ☐ | ☐ | |
| A4 | `password=password` → **pas** d’alerte FP | ☐ | ☐ | ☐ | |
| A5 | Config Fortinet/Cisco → bandeau infra | ☐ | ☐ | ☐ | |
| A6 | Masquer & Envoyer → texte masqué puis envoi | ☐ | ☐ | ☐ | |
| A7 | Envoyer quand même → envoi + journal | ☐ | ☐ | ☐ | |
| A8 | Annuler → pas d’envoi | ☐ | ☐ | ☐ | |
| A9 | Voir les détails → liste lisible | ☐ | ☐ | ☐ | |

## B. Uploads fichiers

| # | Scénario | ChatGPT | Claude | Gemini | Notes |
|---|----------|---------|--------|--------|-------|
| B1 | Fichier `.txt` propre → joint 1 seule fois | ☐ | ☐ | ☐ | |
| B2 | Fichier secret → quarantaine (0 fichier pendant bandeau) | ☐ | ☐ | ☐ | |
| B3 | Masquer puis joindre → **1** fichier `*.opsgate-masked` | ☐ | ☐ | ☐ | |
| B4 | Joindre original (risqué) → **1** original + toast rouge | ☐ | ☐ | ☐ | |
| B5 | Ne pas joindre → 0 fichier | ☐ | ☐ | ☐ | |
| B6 | PDF/image → toast scan partiel (pas de crash) | ☐ | ☐ | ☐ | |

## C. Popup / options

| # | Scénario | OK | Notes |
|---|----------|----|-------|
| C1 | Toggle Actif / Inactif fonctionne | ☐ | |
| C2 | Journal affiche prompt vs fichier | ☐ | |
| C3 | Effacer le journal | ☐ | |
| C4 | Options : désactiver scan uploads | ☐ | |

## D. Non-régression moteur

```bash
pnpm test:rules
```

- [ ] Tous les tests passent

## Décision go / no-go

- [ ] **GO** démo interne  
- [ ] **NO-GO** — bloquants : _______________________

## Faux positifs observés

| Texte / fichier | Règle | Gravité perçue | Action proposée |
|-----------------|-------|----------------|-----------------|
| | | | |
