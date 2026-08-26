# claude-ai-tests

Bac à sable pour un moteur de jeu en TypeScript, servi dans le navigateur.

## Ce que contient le dépôt

| Chemin | Rôle |
| --- | --- |
| `src/core/` | Boucle à pas fixe, monde entité/composant, sérialisation, aléatoire à graine, pas de simulation, enregistrement et rejeu |
| `src/systems/` | Saisie clavier, déplacement, collisions, rendu canvas |
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

**Un seul chemin de code fait avancer le monde.** `Simulation.step(input)` est le seul endroit où l'état change. La boucle du navigateur et le rejeu hors écran l'appellent tous les deux : si le rejeu passait ailleurs, il ne prouverait rien sur le jeu réel. `step()` ne lit ni l'horloge ni `Math.random()` — son argument suffit.

## Enregistrer, rejouer, comparer

Une partie tient dans une graine et la suite des entrées, pas par pas (`Recording`). `replay()` la rejoue depuis un monde neuf, `compare()` confronte les deux états finaux et **situe le premier écart** — `components.transform[3][1].x` plutôt qu'un simple « différent ».

Dans la page, <kbd>R</kbd> enregistre puis rejoue et compare. Une session d'une centaine de pas pèse environ 1,5 ko d'entrées, là où la suite des instantanés correspondants en pèserait des centaines de kilo-octets.

C'est la brique commune à trois choses à venir : sauvegardes comparables, reproduction d'un bug à partir d'un enregistrement, et réconciliation réseau.

## Publication

`.github/workflows/pages.yml` contient deux jobs :

- **`check`** — types, tests, construction. Tourne sur chaque pull request, donc le signal arrive avant la fusion.
- **`deploy`** — construit `dist/` et le publie sur GitHub Pages. Ne tourne que sur `main` (ou à la main via `workflow_dispatch`), et seulement si `check` est passé.

Une erreur de type ou un test rouge arrête la chaîne : le site en ligne ne peut pas être en avance sur ce qui a été vérifié.

Pages est configuré avec **Source : GitHub Actions** (réglage fait une fois dans Settings → Pages). Le workflow ne peut pas créer le site lui-même : le `GITHUB_TOKEN` d'Actions n'a pas le droit de le faire.

Site : https://kyraav12.github.io/claude-ai-tests/
