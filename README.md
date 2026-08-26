# claude-ai-tests

Moteur de jeu monde ouvert procédural, en TypeScript, servi dans le navigateur.

## Ce que contient le dépôt

| Chemin | Rôle |
| --- | --- |
| `src/core/` | Boucle à pas fixe, monde entité/composant, sérialisation, aléatoire à graine, pas de simulation, enregistrement et rejeu |
| `src/world/` | Bruit, terrain, découpage en morceaux, caméra |
| `src/net/` | Transport, protocole, hôte faisant autorité, client prédictif |
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

## Le réseau

L'hôte fait autorité : il exécute la simulation, les clients lui envoient leurs demandes et reçoivent son état. Un client **prédit** immédiatement ses propres demandes, puis, quand l'état d'autorité arrive, il le reprend et **rejoue** celles que l'hôte n'a pas encore confirmées.

Trois points portent tout le reste :

**Les demandes sont appliquées au pas qu'elles portent**, jamais à celui où le paquet arrive. Sinon la chronologie de l'hôte serait décalée de celle du client et aucune prédiction ne tomberait juste.

**Le client garde une avance** sur le dernier état reçu. Sans elle, ses demandes arrivent datées d'un pas déjà joué et sont rejetées. Cette avance part d'une valeur fixe mais **ne le reste pas** : le rejeu des demandes non confirmées la fait croître d'elle-même jusqu'à couvrir l'aller-retour. Mesurée par le banc : 6 pas à 20 ms de latence, 55 pas à 500 ms. Personne ne l'a réglée — c'est une propriété de la réconciliation, pas un paramètre.

**Les demandes d'un pas sont triées par joueur** avant d'être appliquées. L'ordre d'arrivée des paquets ne doit pas changer le résultat.

Ce qui se mesure : un client ne se voit **jamais** corrigé, quelle que soit la latence — il connaît ses propres demandes. Il ne peut pas deviner celles des autres, qui sont extrapolés puis rattrapés ; c'est normal et compté séparément.

**Le terrain ne circule jamais.** Seules les entités sont transmises, chaque pair recalcule le monde depuis la graine. C'est ce que la frontière de T3 achète ici, et un test le vérifie.

### Ce que le transport est, et n'est pas

`BroadcastChannel` relie deux onglets du même navigateur. **Ce n'est pas du multijoueur par Internet** — c'est un banc d'essai du netcode sur un site statique, où aucun serveur ne peut vivre. Le netcode passe par une interface `Transport` : un WebSocket ou un WebRTC s'y substitue sans toucher au reste.

`MemoryNetwork` en est la troisième implémentation, et la seule qui puisse mentir sur commande : latence, gigue, pertes, doublons, désordre, le tout **tiré d'un générateur à graine**. Une perte de paquet qui fait échouer une vérification se reproduit à l'identique — un banc dont les échecs ne se reproduisent pas ne sert à rien.

## Le banc de vérification

`src/bench/checks.ts` définit dix-huit vérifications comme des **fonctions ordinaires** : ni `node:test`, ni rien du navigateur. Deux harnais les exécutent — `test/bench.test.ts` sous Node, et la page [Test Runner](https://kyraav12.github.io/claude-ai-tests/bench/) dans un fil séparé. Deux listes qui se ressemblent finissent toujours par diverger, et c'est alors le banc qui ment ; ici il n'y en a qu'une.

Chaque vérification rend un verdict **et ses mesures**. Un rouge sans chiffres ne dit pas si l'on est passé de 0,2 à 0,3 ou de 0,2 à 400.

### Le scénario, et son empreinte

Un scénario est une graine, des joueurs, une suite d'actions datées — rien d'autre. L'état final s'en déduit, et son empreinte SHA-256 le résume en soixante-quatre caractères. `SCENARIO_018` (graine 847291, quatre joueurs, neuf actions, neuf cents pas) porte son empreinte **figée dans le dépôt** : toute modification du moteur qui change le monde la casse, et le nombre d'entités dit de quel côté penche la régression.

Un test vérifie que le garde-fou garde : on décale la graine d'une unité et le verdict doit basculer. Une empreinte qui accepterait tout ne protégerait de rien.

`src/bench/hash.ts` est un SHA-256 écrit à la main, synchrone. Node offre `node:crypto`, le navigateur seulement `crypto.subtle`, qui est asynchrone : emprunter les deux donnerait deux chemins de code et une empreinte incomparable. Un test le confronte à `node:crypto` sur des entrées variées, accents et paires de substitution comprises.

### Ce qui est mesuré

| | |
|---|---|
| Montée en charge | 3 → 8 joueurs : tick hôte de 900 à 400 pas/s (le temps réel en demande 60), bande passante de 64 à 131 kio/s |
| Latence | 20, 50, 100, 200, 500 ms — écart final sous 0,3 unité partout |
| Pertes | 0, 1, 5, 10, 20 % — la partie converge à chaque taux |
| Dégradations | doublons 20 %, désordre 30 %, gigue ±6 pas, et les cinq à la fois |
| Déconnexion | départ annoncé et coupure sèche, personnage conservé, inventaire intact |
| Reconnexion | même entité retrouvée, empreinte d'état identique à celle de l'hôte |
| Fluidité | 50, 100, 200 ms : aucune saccade à l'affichage ; 500 ms : pire saut plafonné à deux fois le pas normal |

**Ce qui cédera en premier, et le banc le dit :** la bande passante croît linéairement avec le nombre de joueurs, parce que l'état complet est diffusé dix fois par seconde — 9,6 kio par paquet à huit joueurs. Le tick, lui, garde un facteur cinq de marge. C'est l'encodage différentiel qu'il faudra écrire, pas l'optimisation de la boucle.

### Deux pannes trouvées en mesurant

**Un `join` perdu laissait le joueur hors du monde pour toujours.** Le client l'annonçait une seule fois, à la construction ; rien ne le rejouait. Sans pertes on ne le voit jamais — il a fallu 5 % pour que le banc s'arrête sur une entité absente. Le client redemande maintenant son entrée jusqu'à se voir dans l'état d'autorité.

**Le personnage d'un joueur déconnecté filait tout droit à l'infini.** L'hôte ne lui envoyait plus aucune demande, donc `applyControl` ne s'exécutait pas, donc aucun freinage. Un commentaire du code affirmait pourtant qu'il « ralentit et s'arrête ». Lâcher les touches est une **demande**, pas une absence de demande : l'hôte en pousse une vide, et le personnage s'arrête.

### Une réserve sur les chiffres

« Pas client par seconde » n'est pas un nombre d'images par seconde : aucun rendu n'a lieu dans le banc. C'est ce qu'un client peut *simuler*, donc le plafond au-dessus duquel aucune boucle d'affichage ne montera. Le vrai chiffre d'images se lit sur la page du jeu.

## Voir bouger les autres

Un client n'a jamais tort sur lui-même — c'est vérifié à toutes les latences. Sur les **autres**, il l'était, et cela se voyait : leur personnage saccadait dix fois par seconde. Deux causes, deux correctifs, tous deux mesurés.

**L'état porte désormais les dernières demandes appliquées.** Le client rejouait les autres personnages sans savoir sur quoi ils appuyaient : ni accélération, ni freinage, une glissade en ligne droite entre deux états. Il reçoit maintenant, avec chaque état, la demande que l'hôte a appliquée pour chacun, et les rejoue avec les mêmes forces. Le compteur de corrections passe de 80 à **0** sur six cents pas sans latence. Seul le déplacement est extrapolé : rejouer une pose ferait clignoter chez le client une construction que l'autorité effacerait.

**Ce qui reste est absorbé à l'affichage.** L'horloge du client se recale une dizaine de fois par seconde — le nombre de pas rejoués varie d'un état à l'autre — et le personnage distant y gagne ou perd trois pas d'un coup. Mesuré dans le navigateur, à deux onglets : jusqu'à **32 unités** de saut là où un pas normal en fait 6,3.

La réponse n'est pas de toucher à la simulation : le déterminisme, le rejeu et les empreintes en dépendent. `src/net/smoothing.ts` garde un **décalage purement visuel** par entité. Au moment de la correction, le décalage encaisse le saut pour que l'image ne bouge pas, puis fond en deux dixièmes de seconde — avec un plafond de vitesse de rattrapage, sans lequel un gros décalage se paierait d'un élan qu'aucun personnage ne pourrait courir. Une fois le décalage nul, l'affichage est de nouveau exactement la simulation : ni retard permanent, ni mollesse ajoutée.

Résultat mesuré : **aucune saccade jusqu'à 200 ms** de latence, et à 500 ms le pire saut tombe de 355 à 13 unités. Le client ne se lisse jamais lui-même — ce serait ajouter de la latence ressentie à chaque touche, exactement ce que la prédiction évite.

Ce qui demeure, et qui n'est pas résolu ici : l'horloge du client saute encore. La gestion du temps côté client — l'étirer et le contracter d'un pas à la fois plutôt que de le recaler d'un bond — est la vraie réponse, et elle n'est pas écrite. Une tentative de rendre l'horloge monotone a été mesurée puis abandonnée : elle créait cent recalages à 100 ms là où il n'y en avait aucun.

## Récolter

<kbd>F</kbd> récolte l'arbre ou le rocher le plus proche : trois blocs pour un arbre, deux pour un rocher. Huit blocs au départ seulement, donc bâtir oblige à récolter.

**Un arbre est du dérivé, un arbre abattu est de l'état.** C'est la difficulté propre à un monde généré. La réponse retenue ici : le générateur n'est jamais modifié — il continue de produire cet arbre à cet endroit, pour toujours. Ce qui est enregistré, c'est une **exception** : `{ cx, cy, index }`, où `index` est le rang de l'élément dans l'ordre de génération de son morceau.

Le monde visible se lit comme **le généré moins les exceptions**. Un test verrouille la frontière : après récolte, `generateChunk` rend toujours le même nombre d'éléments. S'il cassait, le terrain aurait cessé d'être une fonction pure de la graine.

Le coût est proportionnel à ce qu'on a réellement changé : une entité par élément récolté, rien pour les millions d'arbres intacts.

`nearestProp` recalcule les morceaux plutôt que de lire le cache du rendu : la simulation ne doit rien devoir à l'affichage, et `generateChunk` étant pure, le résultat est le même.

## Construire

<kbd>E</kbd> pose une construction devant le joueur. Quarante blocs au départ, un par pose, trois refus nommés : *sans ressource*, *sur l'eau*, *place occupée*.

Une construction est une **entité**, donc de l'état : sauvegardée, comparée, un jour répliquée. C'est l'inverse du terrain. La frontière posée en T3 tient, et cette tranche l'éprouve sur deux points :

**La simulation lit le monde dérivé, elle ne l'écrit jamais.** Refuser de bâtir sur l'eau interroge `biomeAt`, une fonction pure de la graine : le refus est reproductible et le rejeu reste exact.

**Toute action passe par la trame d'entrée.** `InputFrame` porte désormais `build`. Un geste qui n'y figurerait pas ne serait pas enregistré, et le rejeu divergerait sans explication. La direction de pose vient de `Controlled.facingX/Y`, retenue quand la saisie cesse — c'est de l'état, donc sérialisé.

Coût assumé : chaque trame porte un booléen, ce qui fait passer une session de cent pas de 1,8 à 4 ko. Un encodage par plages le réglera quand ça comptera.

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
