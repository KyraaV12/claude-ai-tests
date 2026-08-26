import { createRandom } from '../core/random.ts';
import { hash2 } from './noise.ts';
import { biomeAt, isWater } from './terrain.ts';
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

export type PropKind = 'arbre' | 'rocher';

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
    const biome = biomeAt(seed, x, y);

    // Rien ne pousse dans l'eau, et la densité dit quelque chose du biome.
    if (isWater(biome)) continue;
    const density = biome === 'forêt' ? 0.9 : biome === 'plaine' ? 0.35 : biome === 'roche' ? 0.3 : 0.1;
    if (roll > density) continue;

    const kind: PropKind = biome === 'forêt' || biome === 'plaine' ? 'arbre' : 'rocher';
    props.push({ x, y, radius: kind === 'arbre' ? 7 + local() * 6 : 5 + local() * 5, kind });
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
