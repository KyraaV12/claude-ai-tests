import { TILES_PER_SIDE } from '../world/chunk.ts';
import type { Chunk } from '../world/chunk.ts';
import type { Biome } from '../world/terrain.ts';

/**
 * Palette du monde, fixe.
 *
 * Le décor a ses couleurs propres, indépendantes du thème clair ou sombre de
 * la page : c'est l'image du jeu, pas de l'interface.
 */
export const BIOME_COLORS: Record<Biome, string> = {
  abysse: '#12283D',
  eau: '#215E7C',
  sable: '#D9C89C',
  plaine: '#7CA25C',
  forêt: '#3D6A44',
  roche: '#8B8E90',
  neige: '#E8EDF1',
};

/**
 * Peint chaque morceau une fois, sur une image gardée en réserve.
 *
 * Sans ce cache, chaque image du jeu repeindrait un millier de rectangles par
 * morceau visible — des dizaines de milliers en tout. Le terrain ne changeant
 * jamais, une seule peinture suffit, ensuite recopiée à l'échelle.
 *
 * Le cache est du côté du rendu, séparé du générateur qui, lui, reste une
 * fonction pure : on peut jeter les images sans toucher au monde.
 */
export class TerrainPainter {
  readonly capacity: number;
  private readonly images = new Map<string, HTMLCanvasElement>();

  constructor(capacity = 320) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.images.size;
  }

  imageFor(chunk: Chunk): HTMLCanvasElement {
    const key = `${chunk.cx},${chunk.cy}`;
    const cached = this.images.get(key);
    if (cached) {
      this.images.delete(key);
      this.images.set(key, cached);
      return cached;
    }

    const canvas = document.createElement('canvas');
    canvas.width = TILES_PER_SIDE;
    canvas.height = TILES_PER_SIDE;
    const ctx = canvas.getContext('2d')!;

    for (let ty = 0; ty < TILES_PER_SIDE; ty++) {
      for (let tx = 0; tx < TILES_PER_SIDE; tx++) {
        const biome = chunk.biomes[ty * TILES_PER_SIDE + tx];
        if (!biome) continue;
        ctx.fillStyle = BIOME_COLORS[biome];
        ctx.fillRect(tx, ty, 1, 1);
      }
    }

    this.images.set(key, canvas);
    while (this.images.size > this.capacity) {
      const oldest = this.images.keys().next();
      if (oldest.done) break;
      this.images.delete(oldest.value);
    }
    return canvas;
  }

  clear(): void {
    this.images.clear();
  }
}
