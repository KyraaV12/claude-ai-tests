import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Le garde-fou du déterminisme, lu dans le code lui-même.
 *
 * `Math.sin` et `Math.cos` ne sont pas tenus par la norme de rendre le même
 * résultat d'un moteur à l'autre, et ils ne le font pas : le banc a trouvé le
 * scénario de référence rendant une empreinte en CI et une autre dans le
 * navigateur. Même graine, même monde, quarante-neuf entités des deux côtés, et
 * un `y` qui différait à la quatorzième décimale.
 *
 * Un test qui compare deux nombres ne rattraperait pas la prochaine occurrence :
 * il faudrait deux moteurs pour la voir. On lit donc le code. Ce test coûte
 * quelques millisecondes et interdit à la panne de revenir par une porte
 * qu'aucune assertion numérique ne surveille.
 */

/** Ce qui n'est pas garanti identique d'une implémentation à l'autre. */
const FORBIDDEN = ['Math.sin', 'Math.cos', 'Math.tan', 'Math.hypot', 'Math.exp', 'Math.pow', 'Math.log', 'Math.atan2', 'Math.cbrt', 'Math.sinh', 'Math.cosh'];

/**
 * Les fichiers dont l'état dépend, et qui doivent donc rester exacts.
 *
 * Tout ce qui touche à l'affichage en est exclu et le dit : une couleur qui
 * diffère d'un milliardième ne se voit pas, et personne n'en calcule
 * l'empreinte.
 */
const DISPLAY_ONLY = new Set([
  'systems/render.ts',
  'systems/firstperson.ts', // une autre projection des mêmes coordonnées
  'systems/terrain-painter.ts',
  'net/smoothing.ts',
  'world/camera.ts',
  'tools/inspect.ts',
  'tools/panel.ts',
  'main.ts',
  'core/trig.ts', // c'est lui qui les remplace : il a le droit de les nommer
  'bench/main.ts',
  'bench/worker.ts',
  'bench/checks.ts', // mesure et rapporte, ne fait pas avancer le monde
]);

/**
 * La frontière entre le temps réel et le temps logique.
 *
 * Le moteur *doit* lire l'horloge murale : c'est son travail de la convertir en
 * un nombre entier de pas. Ce qu'il ne fait pas, c'est la laisser entrer dans
 * la simulation — elle n'en ressort qu'en pas comptés.
 */
const KEEPS_THE_TIME = new Set(['core/engine.ts']);

/** Le code seul : une mention en commentaire est une explication, pas un appel. */
function codeOf(file: string): Array<{ line: number; text: string }> {
  const source = readFileSync(join('src', file), 'utf8');
  return source.split('\n').map((text, index) => ({
    line: index + 1,
    text: text.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '').replace(/^\s*\/\*.*$/, ''),
  }));
}

function sourceFiles(directory: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const label = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...sourceFiles(join(directory, entry.name), label));
    else if (entry.name.endsWith('.ts')) found.push(label);
  }
  return found;
}

test("la simulation n'emploie aucune fonction non reproductible", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles('src')) {
    if (DISPLAY_ONLY.has(file)) continue;
    for (const { line, text } of codeOf(file)) {
      for (const banned of FORBIDDEN) {
        if (text.includes(`${banned}(`)) offenders.push(`${file}:${line} — ${banned}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `à remplacer par src/core/trig.ts :\n  ${offenders.join('\n  ')}`,
  );
});

test('la liste des fichiers d affichage ne dérive pas', () => {
  // Si l'on renomme un fichier sans mettre la liste à jour, l'exception
  // continuerait de protéger un fichier qui n'existe plus — et le nouveau
  // passerait au travers sans qu'on le remarque.
  const existing = new Set(sourceFiles('src'));
  const stale = [...DISPLAY_ONLY, ...KEEPS_THE_TIME].filter((file) => !existing.has(file));
  assert.deepEqual(stale, [], 'des exceptions désignent des fichiers disparus');
});

test('aucune horloge murale ne pilote la simulation', () => {
  // Une seule lecture de Date.now() dans un système, et un rejeu de partie
  // nocturne se rejouerait en plein jour.
  const offenders: string[] = [];
  for (const file of sourceFiles('src')) {
    if (DISPLAY_ONLY.has(file)) continue;
    if (KEEPS_THE_TIME.has(file)) continue;
    if (file.startsWith('bench/') || file.startsWith('net/')) continue;
    for (const { line, text } of codeOf(file)) {
      for (const banned of ['Date.now(', 'new Date(', 'performance.now(', 'Math.random(']) {
        if (text.includes(banned)) offenders.push(`${file}:${line} — ${banned})`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
