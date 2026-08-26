# claude-ai-tests

## index.html

Une page web autonome (« Banc d'essai ») qui vérifie en direct, dans le navigateur du lecteur, ce qui répond vraiment : structure, feuille de style, JavaScript, polices web, thème et taille de fenêtre.

Aucune dépendance à installer. Pour la servir localement :

```sh
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000. Un double-clic sur le fichier fonctionne aussi.

## Publication

Le workflow `.github/workflows/pages.yml` déploie la racine du dépôt sur GitHub Pages à chaque push sur `main`, et peut aussi être lancé à la main (`workflow_dispatch`).

Prérequis, à faire une seule fois : dans Settings → Pages, choisir **Source : GitHub Actions**. Le workflow ne crée pas le site lui-même — le `GITHUB_TOKEN` d'Actions n'a pas les droits nécessaires.

Site : https://kyraav12.github.io/claude-ai-tests/
