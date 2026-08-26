import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash2, valueNoise, fbm } from '../src/world/noise.ts';
import { elevationAt, biomeAt, isWater, findSpawn } from '../src/world/terrain.ts';
import {
  ChunkCache,
  CHUNK_SIZE,
  TILE_SIZE,
  TILES_PER_SIDE,
  chunkCoordOf,
  generateChunk,
} from '../src/world/chunk.ts';

const SEED = 20260826;

/** La première graine satisfaisant un critère — évite de coder en dur une valeur
 *  qui deviendrait fausse au moindre ajustement du bruit. */
function firstSeedWhere(predicate: (seed: number) => boolean): number {
  for (let seed = 1; seed <= 500; seed++) if (predicate(seed)) return seed;
  throw new Error('aucune graine ne satisfait le critère sur 500 essais');
}

test('hash2 rend toujours la même valeur pour le même point', () => {
  assert.equal(hash2(SEED, 3, -7), hash2(SEED, 3, -7));
  assert.notEqual(hash2(SEED, 3, -7), hash2(SEED, 3, -8));
  assert.notEqual(hash2(SEED, 3, -7), hash2(SEED + 1, 3, -7));
});

test('hash2 reste dans [0, 1)', () => {
  for (let x = -50; x < 50; x++) {
    for (let y = -3; y < 3; y++) {
      const value = hash2(SEED, x, y);
      assert.ok(value >= 0 && value < 1, `hash2(${x}, ${y}) = ${value}`);
    }
  }
});

test('le bruit est continu : un déplacement infime ne change presque rien', () => {
  // La continuité n'est pas cosmétique : c'est elle qui garantit qu'un tuilage
  // par morceaux ne laisse aucune couture visible aux frontières.
  for (const x of [0, 1.5, -12.25, 103.75]) {
    const a = valueNoise(SEED, x, 4.2);
    const b = valueNoise(SEED, x + 1e-6, 4.2);
    assert.ok(Math.abs(a - b) < 1e-4, `saut de ${Math.abs(a - b)} en x = ${x}`);
  }
});

test('fbm reste borné dans [0, 1]', () => {
  for (let i = 0; i < 400; i++) {
    const value = fbm(SEED, i * 0.37, i * -0.11, 5);
    assert.ok(value >= 0 && value <= 1, `fbm hors bornes : ${value}`);
  }
});

test('le terrain ne dépend que de la graine et du point', () => {
  const points = [
    [0, 0],
    [1234.5, -987.25],
    [-50000, 50000],
  ] as const;
  for (const [x, y] of points) {
    assert.equal(elevationAt(SEED, x, y), elevationAt(SEED, x, y));
    assert.equal(biomeAt(SEED, x, y), biomeAt(SEED, x, y));
  }
});

test('deux graines produisent des mondes différents', () => {
  let differences = 0;
  for (let i = 0; i < 200; i++) {
    if (biomeAt(SEED, i * 137, i * 91) !== biomeAt(SEED + 1, i * 137, i * 91)) differences++;
  }
  assert.ok(differences > 50, `seulement ${differences} points diffèrent sur 200`);
});

test('chunkCoordOf place un point dans le bon morceau, négatifs compris', () => {
  assert.equal(chunkCoordOf(0), 0);
  assert.equal(chunkCoordOf(CHUNK_SIZE - 1), 0);
  assert.equal(chunkCoordOf(CHUNK_SIZE), 1);
  assert.equal(chunkCoordOf(-1), -1);
  assert.equal(chunkCoordOf(-CHUNK_SIZE), -1);
  assert.equal(chunkCoordOf(-CHUNK_SIZE - 1), -2);
});

test('générer un morceau deux fois donne exactement le même résultat', () => {
  assert.deepEqual(generateChunk(SEED, 3, -2), generateChunk(SEED, 3, -2));
});

test('deux morceaux voisins ne se ressemblent pas', () => {
  assert.notDeepEqual(generateChunk(SEED, 0, 0), generateChunk(SEED, 1, 0));
});

test('les tuiles d un morceau sont bien la lecture du terrain en espace monde', () => {
  // C'est ce qui interdit toute couture : aucune donnée n'appartient au
  // morceau, il ne fait qu'échantillonner une fonction continue du plan.
  const chunk = generateChunk(SEED, -4, 7);
  for (let ty = 0; ty < TILES_PER_SIDE; ty++) {
    for (let tx = 0; tx < TILES_PER_SIDE; tx++) {
      const worldX = -4 * CHUNK_SIZE + (tx + 0.5) * TILE_SIZE;
      const worldY = 7 * CHUNK_SIZE + (ty + 0.5) * TILE_SIZE;
      assert.equal(chunk.biomes[ty * TILES_PER_SIDE + tx], biomeAt(SEED, worldX, worldY));
    }
  }
});

test('rien ne pousse dans l eau', () => {
  for (let cx = -3; cx <= 3; cx++) {
    for (let cy = -3; cy <= 3; cy++) {
      for (const prop of generateChunk(SEED, cx, cy).props) {
        assert.equal(isWater(biomeAt(SEED, prop.x, prop.y)), false, `décor noyé en ${prop.x},${prop.y}`);
      }
    }
  }
});

test('le décor tombe bien à l intérieur de son morceau', () => {
  const chunk = generateChunk(SEED, 5, -6);
  for (const prop of chunk.props) {
    assert.ok(prop.x >= 5 * CHUNK_SIZE && prop.x < 6 * CHUNK_SIZE, `x = ${prop.x}`);
    assert.ok(prop.y >= -6 * CHUNK_SIZE && prop.y < -5 * CHUNK_SIZE, `y = ${prop.y}`);
  }
});

test('le cache rend le même morceau sans le recalculer', () => {
  const cache = new ChunkCache(SEED, 16);
  const first = cache.get(2, 2);
  const second = cache.get(2, 2);

  assert.equal(first, second, 'la même instance doit être rendue');
  assert.equal(cache.generationCount, 1);
});

test('le cache ne dépasse jamais sa capacité', () => {
  const cache = new ChunkCache(SEED, 8);
  for (let i = 0; i < 40; i++) cache.get(i, 0);

  assert.equal(cache.size, 8);
  assert.equal(cache.generationCount, 40);
});

test('un morceau évincé revient identique', () => {
  // Toute la promesse du monde dérivé tient dans ce test : on peut jeter le
  // décor sans rien perdre, puisqu'il se recalcule.
  const cache = new ChunkCache(SEED, 4);
  const before = structuredClone(cache.get(0, 0));

  for (let i = 1; i <= 10; i++) cache.get(i, 0); // pousse (0,0) hors du cache
  assert.equal(cache.has(0, 0), false, 'le morceau devrait avoir été évincé');

  assert.deepEqual(cache.get(0, 0), before);
});

test('revisiter un morceau le garde en mémoire', () => {
  const cache = new ChunkCache(SEED, 3);
  cache.get(0, 0);
  cache.get(1, 0);
  cache.get(0, 0); // rafraîchit (0,0) : c'est (1,0) qui doit partir en premier
  cache.get(2, 0);
  cache.get(3, 0);

  assert.equal(cache.has(0, 0), true);
  assert.equal(cache.has(1, 0), false);
});

test('une capacité nulle est refusée', () => {
  assert.throws(() => new ChunkCache(SEED, 0), RangeError);
});

test('le point de départ n est jamais dans l eau', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const spawn = findSpawn(seed);
    assert.equal(isWater(biomeAt(seed, spawn.x, spawn.y)), false, `graine ${seed} démarre dans l'eau`);
  }
});

test('le point de départ ne dépend que de la graine', () => {
  assert.deepEqual(findSpawn(SEED), findSpawn(SEED));
});

test('le départ reste à l origine quand elle est sèche', () => {
  const dry = firstSeedWhere((seed) => !isWater(biomeAt(seed, 0, 0)));
  assert.deepEqual(findSpawn(dry), { x: 0, y: 0 });
});

test('le départ s écarte de l origine quand elle est noyée', () => {
  const flooded = firstSeedWhere((seed) => isWater(biomeAt(seed, 0, 0)));
  const spawn = findSpawn(flooded);

  assert.notDeepEqual(spawn, { x: 0, y: 0 });
  assert.equal(isWater(biomeAt(flooded, spawn.x, spawn.y)), false);
});

test('les petites graines ne sont pas biaisées', () => {
  // hash2(graine, 0, 0) se réduisait presque à la graine : les mondes des
  // graines 1, 2, 3 étaient systématiquement noyés. Or une petite graine est
  // exactement ce qu'on tape. Régression coûteuse à retrouver, facile à figer.
  let total = 0;
  for (let seed = 1; seed <= 300; seed++) total += hash2(seed, 0, 0);
  const mean = total / 300;

  assert.ok(Math.abs(mean - 0.5) < 0.05, `moyenne ${mean.toFixed(3)}, attendue proche de 0,5`);
});

test('la proportion de mer ne dépend pas de l ordre de grandeur de la graine', () => {
  const share = (from: number, to: number): number => {
    let wet = 0;
    for (let seed = from; seed <= to; seed++) if (isWater(biomeAt(seed, 0, 0))) wet++;
    return wet / (to - from + 1);
  };
  const small = share(1, 300);
  const large = share(100_000, 100_300);

  assert.ok(small > 0.15 && small < 0.6, `proportion aberrante pour les petites graines : ${small}`);
  assert.ok(Math.abs(small - large) < 0.12, `petites ${small.toFixed(2)} vs grandes ${large.toFixed(2)}`);
});
