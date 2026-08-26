# claude-ai-tests

Bac à sable pour un moteur de jeu en TypeScript, servi dans le navigateur.

## Ce que contient le dépôt

| Chemin | Rôle |
| --- | --- |
| `src/core/` | Boucle à pas fixe, monde entité/composant, sérialisation, aléatoire à graine |
| `src/systems/` | Saisie clavier, déplacement, rendu canvas |
| `web/` | Pages statiques : le banc d'essai à la racine, la tranche T0 sous `game/` |
| `test/` | Tests unitaires, exécutés par le lanceur intégré de Node |
| `scripts/build.mjs` | Construction : esbuild pour le bundle, copie de `web/` vers `dist/` |

## Développer

```sh
npm install
npm run check     # types + tests + build
npm run build     # produit dist/
npx serve dist    # ou : python3 -m http.server -d dist 8000
```

`npm test` s'appuie sur l'exécution directe du TypeScript par Node (`--experimental-strip-types`) : aucune compilation préalable, aucun outil de test à installer.

## Deux règles qui tiennent depuis le premier jour

**La simulation est déterministe.** Pas de temps fixe, jamais de `Math.random()` dans le code de simulation — un générateur à graine à la place. Deux exécutions avec les mêmes entrées donnent le même état, condition nécessaire aux sauvegardes comparables et à la réplication réseau.

**L'état du jeu est une donnée pure.** Les composants ne portent aucune méthode ; `World.snapshot()` produit du JSON sérialisable tel quel, `World.restore()` le reprend. Sauvegarde, comparaison et transport réseau reposent tous sur ce couple.

## Publication

Le workflow `.github/workflows/pages.yml` vérifie les types, exécute les tests, construit `dist/` et le publie sur GitHub Pages à chaque push sur `main`. Il peut aussi être lancé à la main (`workflow_dispatch`). Une erreur de type ou un test rouge arrête le déploiement : le site en ligne ne peut pas être en avance sur ce qui a été vérifié.

Pages est configuré avec **Source : GitHub Actions** (réglage fait une fois dans Settings → Pages). Le workflow ne peut pas créer le site lui-même : le `GITHUB_TOKEN` d'Actions n'a pas le droit de le faire.

Site : https://kyraav12.github.io/claude-ai-tests/
