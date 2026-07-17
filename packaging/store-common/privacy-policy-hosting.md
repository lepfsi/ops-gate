# Héberger la privacy policy pour les stores

Les stores exigent une **URL HTTPS publique** pointant vers une page lisible (pas seulement le `.md` du monorepo).

## Option A — Site produit

Publier le contenu de `docs/PRIVACY.md` sur :

```
https://dailyops.tech/opsgate/privacy
```

(ou domaine client / éditeur).

## Option B — GitHub Pages (rapide)

1. Créer un repo public `opsgate-privacy` ou dossier `docs/` Pages  
2. Convertir PRIVACY.md → `index.html` simple  
3. Activer Pages → HTTPS  

## Option C — Même origin que la console

Servir une page statique `/privacy` depuis le reverse-proxy de la console client (acceptable pour unlisted enterprise si l’URL reste accessible aux reviewers).

## Checklist

- [ ] HTTPS valide (pas de cert self-signed pour CWS/AMO public)  
- [ ] Contenu aligné avec `docs/PRIVACY.md` (modes local / org)  
- [ ] URL collée dans CWS + AMO + App Store Connect  
- [ ] Lien aussi dans le README produit  

## Texte minimal (si page HTML)

Utiliser le corps de `docs/PRIVACY.md` — sections modes local/org, données envoyées, contact DPO/éditeur.
