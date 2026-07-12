# Checklist présentateur

## J-1 / matin même

- [ ] `pnpm build` OK, version **0.3.0** (ou plus)
- [ ] Extension chargée depuis `build/chrome-mv3-prod` (pas la racine repo)
- [ ] ChatGPT **et** Claude ouverts (plan B)
- [ ] Session IA **sans données client réelles**
- [ ] Fichiers `docs/demo/samples/` accessibles (Explorateur ou bureau)
- [ ] `PROMPTS.md` ouvert dans un second écran / note
- [ ] Mode « Ne pas déranger » / notifications off
- [ ] Zoom navigateur ~100–110 % (bandeau lisible en partage d’écran)

## 2 minutes avant

- [ ] Badge OpsGate visible sur la page IA
- [ ] Popup → **Actif**
- [ ] Journal vidé (plus propre pour la démo)
- [ ] Un onglet ChatGPT **neuf** ou rechargé
- [ ] Partage d’écran : fenêtre navigateur uniquement (pas le repo entier)

## Pendant

- [ ] Suivre [SCRIPT-5MIN.md](./SCRIPT-5MIN.md)
- [ ] Toujours dire « **données fictives de démo** » avant de coller un secret
- [ ] Sur le bandeau : **détails** avant **masquer** (effet pédagogique)
- [ ] Montrer le **journal** en fin de démo (crédibilité)

## Après

- [ ] Noter les frictions (site, sélecteur, FP)
- [ ] Demander : *« Vous colleriez quoi, vous, sans y penser ? »*
- [ ] Proposer le pilote 10–20 users + `docs/VALIDATION.md`

## Objections fréquentes

| Objection | Réponse courte |
|-----------|----------------|
| « On a déjà un DLP enterprise » | OpsGate est **léger**, focus **IA web**, déployable en minutes pour PME/ops. |
| « Ça bloque mon flux » | Non : **non bloquant**, l’utilisateur décide toujours. |
| « Et la confidentialité du scan ? » | **100 % local**, pas de backend OpsGate. |
| « Les interfaces IA changent » | Oui, risque connu ; on maintient les sélecteurs + règles. |
| « Faux positifs ? » | Règles affinées (IBAN, placeholders…) ; on itère avec le pilote. |

## Matériel slides (optionnel)

1. Slide titre + wordmark `assets/brand/opsgate-wordmark.png`  
2. Slide problème (fuite config / clé)  
3. Slide capture bandeau (screenshot live préférable)  
4. Slide différenciateur infra  
5. Slide call-to-action pilote
