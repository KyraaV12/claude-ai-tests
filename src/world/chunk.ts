import { createRandom } from '../core/random.ts';
import { hash2 } from './noise.ts';
import { biomeAt } from './terrain.ts';
import type { Biome } from './terrain.ts';

/**
 * Découpage du monde en morceaux calculables à la demande.
 *
 * Un morceau n'est pas une donnée du jeu : c'est un cache d'une fonction. On
 * peut le jeter et le redemander, il revient identique. Rien à sauvegarder,
 * rien à transmettre — seule la graine voyage.
 */

export const CHUNK_SIZE = 320;
export const TILE_SIZE = 10;
export const TILES_PER_SIDE = CHUNK_SIZE / TILE_SIZE;

export type PropKind = 'arbre' | 'rocher' | 'buisson' | 'roseau';

/**
 * Ce qui pousse dans chaque biome, et en quelle abondance.
 *
 * Une table plutôt que des `if` en cascade : ajouter une plante au marais ne
 * doit pas obliger à relire la boucle de génération. `density` est la chance
 * qu'un emplacement tiré donne quelque chose ; les poids départagent ensuite.
 *
 * Rien ne pousse dans l'eau, et cela ne se déclare pas : l'absence d'entrée
 * suffit.
 */
const FLORA: Partial<Record<Biome, { density: number; kinds: Array<[PropKind, number]> }>> = {
  sable: { density: 0.35, kinds: [['roseau', 3], ['rocher', 1]] },
  plaine: { density: 0.5, kinds: [['arbre', 2], ['buisson', 3]] },
  forêt: { density: 0.92, kinds: [['arbre', 6], ['buisson', 2]] },
  roche: { density: 0.4, kinds: [['rocher', 5], ['buisson', 1]] },
  neige: { density: 0.22, kinds: [['rocher', 3], ['arbre', 1]] },
};

/** Rayon d'un élément, en deux bornes : le tirage se fait entre elles. */
const PROP_RADIUS: Record<PropKind, [number, number]> = {
  arbre: [7, 13],
  rocher: [5, 10],
  buisson: [4, 7],
  roseau: [3, 6],
};

/** Choisit un type parmi des poids, à partir d'un tirage entre 0 et 1. */
function pickKind(kinds: Array<[PropKind, number]>, roll: number): PropKind {
  const total = kinds.reduce((sum, [, weight]) => sum + weight, 0);
  let cursor = roll * total;
  for (const [kind, weight] of kinds) {
    cursor -= weight;
    if (cursor <= 0) return kind;
  }
  return kinds[kinds.length - 1]![0];
}

export interface Prop {
  x: number;
  y: number;
  radius: number;
  kind: PropKind;
}

export interface Chunk {
  cx: number;
  cy: number;
  /** Biome par tuile, rangée par rangée. */
  biomes: Biome[];
  props: Prop[];
}

/** Le morceau qui contient un point du monde. */
export function chunkCoordOf(value: number): number {
  return Math.floor(value / CHUNK_SIZE);
}

/**
 * Calcule un morceau. Fonction pure : mêmes arguments, même résultat, toujours.
 *
 * Les biomes sont échantillonnés en espace monde, pas par morceau : c'est ce
 * qui fait que deux morceaux voisins se raccordent sans couture visible.
 */
export function generateChunk(seed: number, cx: number, cy: number): Chunk {
  const originX = cx * CHUNK_SIZE;
  const originY = cy * CHUNK_SIZE;

  const biomes: Biome[] = [];
  for (let ty = 0; ty < TILES_PER_SIDE; ty++) {
    for (let tx = 0; tx < TILES_PER_SIDE; tx++) {
      biomes.push(biomeAt(seed, originX + (tx + 0.5) * TILE_SIZE, originY + (ty + 0.5) * TILE_SIZE));
    }
  }

  // Un générateur propre au morceau, dérivé de la graine et des coordonnées :
  // le décor d'un morceau ne dépend pas de l'ordre de visite des autres.
  const local = createRandom(Math.floor(hash2(seed ^ 0x5f375a86, cx, cy) * 0xffffffff) >>> 0);
  const props: Prop[] = [];
  const attempts = 14;

  for (let i = 0; i < attempts; i++) {
    const x = originX + local() * CHUNK_SIZE;
    const y = originY + local() * CHUNK_SIZE;
    const roll = local();
    const pick = local();
    const size = local();
    // Les quatre tirages sont faits quoi qu'il arrive, avant tout refus : le
    // générateur doit consommer autant de hasard sur un emplacement rejeté que
    // sur un accepté, sinon changer une densité décalerait tout le reste.
    const flora = FLORA[biomeAt(seed, x, y)];
    if (!flora || roll > flora.density) continue;

    const kind = pickKind(flora.kinds, pick);
    const [min, max] = PROP_RADIUS[kind];
    props.push({ x, y, radius: min + size * (max - min), kind });
  }

  return { cx, cy, biomes, props };
}

/**
 * Garde en mémoire les morceaux récemment vus, et jette les plus anciens.
 *
 * La capacité borne la mémoire d'un monde qui, lui, n'en a pas. Un morceau
 * évincé n'est pas perdu : il se recalcule à l'identique, et un test le vérifie.
 */
export class ChunkCache {
  readonly seed: number;
  readonly capacity: number;
  private readonly entries = new Map<string, Chunk>();
  private generations = 0;

  // La capacité doit dépasser ce qu'un grand écran montre d'un seul coup —
  // environ 120 morceaux en 1400 × 900 à l'échelle 2,4. En dessous, chaque
  // image évincerait ce que la précédente vient de calculer.
  constructor(seed: number, capacity = 320) {
    if (capacity < 1) throw new RangeError('La capacité doit valoir au moins 1');
    this.seed = seed;
    this.capacity = capacity;
  }

  /** Nombre de morceaux calculés depuis le début — ce que l'éviction fait remonter. */
  get generationCount(): number {
    return this.generations;
  }

  get size(): number {
    return this.entries.size;
  }

  get(cx: number, cy: number): Chunk {
    const key = `${cx},${cy}`;
    const cached = this.entries.get(key);
    if (cached) {
      // Réinsertion : Map conserve l'ordre d'insertion, ce qui suffit à tenir
      // une file de fraîcheur sans structure supplémentaire.
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }

    const chunk = generateChunk(this.seed, cx, cy);
    this.generations++;
    this.entries.set(key, chunk);

    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return chunk;
  }

  has(cx: number, cy: number): boolean {
    return this.entries.has(`${cx},${cy}`);
  }

  clear(): void {
    this.entries.clear();
  }
}
