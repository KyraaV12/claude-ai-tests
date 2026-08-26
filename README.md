# claude-ai-tests

Moteur de jeu monde ouvert procédural, en TypeScript, servi dans le navigateur.

## Ce que contient le dépôt

| Chemin | Rôle |
| --- | --- |
| `src/core/` | Boucle à pas fixe, monde entité/composant, sérialisation, aléatoire à graine, pas de simulation, enregistrement et rejeu |
| `src/world/` | Bruit, terrain, découpage en morceaux, caméra |
| `src/systems/` | Saisie clavier, déplacement, collisions, rendu canvas |
| `src/tools/` | Inspecteur : logique sans DOM (`inspect.ts`) et panneau (`panel.ts`) |
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

## Le monde ouvert

**Les entités sont l'état ; le décor est dérivé.** C'est la distinction qui rend un monde infini tenable.

| | Entités | Terrain |
| --- | --- | --- |
| Stocké | oui | non |
| Sauvegardé | oui | non |
| Répliqué (à venir) | oui | non |
| Reconstruction | depuis l'instantané | depuis la graine et le point |

`elevationAt(seed, x, y)` répond la même chose au premier comme au millionième appel. Un morceau de 320 unités n'est donc pas une donnée du jeu : c'est le cache d'une fonction. `ChunkCache` en garde un nombre borné et jette les plus anciens ; un morceau évincé revient identique, et un test le vérifie.

Le bruit est échantillonné **en espace monde**, jamais par morceau : c'est ce qui interdit toute couture aux frontières. Un bruit tiré par morceau produirait un bord visible à chaque jointure.

Le point de départ est cherché en spirale depuis l'origine jusqu'à la terre ferme — selon la graine, l'origine est noyée une fois sur trois.

La caméra appartient à l'affichage, jamais à la simulation : elle est lissée avec le temps réel, donc non déterministe, et c'est sans conséquence puisque aucun système ne la lit. La faire entrer dans `Simulation.step()` casserait le rejeu.

## Inspecter

La boucle sait s'arrêter (`Engine.pause()`) et avancer d'un nombre exact de pas (`stepOnce(n)`). À l'arrêt le rendu continue mais **n'interpole plus** : ce qui est affiché est exactement l'état qu'on inspecte.

Le panneau liste les entités, montre les composants de celle qui est sélectionnée, et **écrit les champs numériques à chaud**. On sélectionne au clic dans l'aire de jeu — la distance passe par les bords repliés, comme la physique — ou dans la liste ; l'entité choisie est cerclée à l'écran.

Toute la logique vit dans `src/tools/inspect.ts`, sans DOM, et se teste sans navigateur : quelle entité est sous le curseur, quels champs sont modifiables, ce qu'une écriture accepte. `panel.ts` ne fait que l'afficher.

Deux refus délibérés : une valeur non finie n'est jamais écrite — un `NaN` dans une position contaminerait tout au pas suivant — et un champ vidé pour être retapé n'écrit rien, là où `Number('')` aurait mis zéro.

Le moteur reçoit son ordonnanceur par injection, ce qui rend pause et pas-à-pas vérifiables hors navigateur : les tests pilotent les images à la main.

## Publication

`.github/workflows/pages.yml` contient deux jobs :

- **`check`** — types, tests, construction. Tourne sur chaque pull request, donc le signal arrive avant la fusion.
- **`deploy`** — construit `dist/` et le publie sur GitHub Pages. Ne tourne que sur `main` (ou à la main via `workflow_dispatch`), et seulement si `check` est passé.

Une erreur de type ou un test rouge arrête la chaîne : le site en ligne ne peut pas être en avance sur ce qui a été vérifié.

Pages est configuré avec **Source : GitHub Actions** (réglage fait une fois dans Settings → Pages). Le workflow ne peut pas créer le site lui-même : le `GITHUB_TOKEN` d'Actions n'a pas le droit de le faire.

Site : https://kyraav12.github.io/claude-ai-tests/
