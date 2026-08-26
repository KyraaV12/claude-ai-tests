import { fbm } from './noise.ts';

/**
 * Le terrain, défini comme une fonction du point.
 *
 * Aucune donnée n'est conservée : `elevationAt(seed, x, y)` répond la même
 * chose au premier comme au millionième appel. Ce qui suit n'en est que des
 * lectures.
 */

/** Taille caractéristique du relief, en unités du monde. */
const RELIEF_SCALE = 900;
const MOISTURE_SCALE = 1400;
/** Décalage de graine pour l'humidité : sinon elle épouserait exactement le relief. */
const MOISTURE_SEED_OFFSET = 0x9e3779b9;

export function elevationAt(seed: number, x: number, y: number): number {
  return fbm(seed, x / RELIEF_SCALE, y / RELIEF_SCALE, 5);
}

export function moistureAt(seed: number, x: number, y: number): number {
  return fbm(seed + MOISTURE_SEED_OFFSET, x / MOISTURE_SCALE, y / MOISTURE_SCALE, 3);
}

export type Biome = 'abysse' | 'eau' | 'sable' | 'plaine' | 'forêt' | 'roche' | 'neige';

/** Les seuils, du plus bas au plus haut. Lus dans l'ordre, le premier atteint gagne. */
const ELEVATION_BANDS: Array<{ upTo: number; dry: Biome; wet: Biome }> = [
  { upTo: 0.34, dry: 'abysse', wet: 'abysse' },
  { upTo: 0.42, dry: 'eau', wet: 'eau' },
  { upTo: 0.46, dry: 'sable', wet: 'sable' },
  { upTo: 0.62, dry: 'plaine', wet: 'forêt' },
  { upTo: 0.78, dry: 'roche', wet: 'forêt' },
  { upTo: Number.POSITIVE_INFINITY, dry: 'roche', wet: 'neige' },
];

export function biomeAt(seed: number, x: number, y: number): Biome {
  const elevation = elevationAt(seed, x, y);
  const moisture = moistureAt(seed, x, y);
  const band = ELEVATION_BANDS.find((candidate) => elevation < candidate.upTo)!;
  return moisture > 0.5 ? band.wet : band.dry;
}

/** Vrai là où une entité ne peut pas se poser : le décor guide sans mur invisible. */
export function isWater(biome: Biome): boolean {
  return biome === 'abysse' || biome === 'eau';
}

/**
 * Un point de départ sur la terre ferme, trouvé sans hasard.
 *
 * On parcourt une spirale depuis l'origine et on s'arrête au premier point sec.
 * Le résultat ne dépend que de la graine : deux parties de même graine
 * commencent au même endroit, et un rejeu retrouve ce point sans le stocker.
 */
export function findSpawn(seed: number, stride = 90, maxRings = 60): { x: number; y: number } {
  if (!isWater(biomeAt(seed, 0, 0))) return { x: 0, y: 0 };

  for (let ring = 1; ring <= maxRings; ring++) {
    const span = ring * stride;
    for (let i = -ring; i <= ring; i++) {
      const offset = i * stride;
      const candidates = [
        { x: offset, y: -span },
        { x: offset, y: span },
        { x: -span, y: offset },
        { x: span, y: offset },
      ];
      for (const candidate of candidates) {
        if (!isWater(biomeAt(seed, candidate.x, candidate.y))) return candidate;
      }
    }
  }
  // Un monde entièrement noyé sur 60 anneaux est possible en théorie ; mieux
  // vaut démarrer quelque part que boucler indéfiniment.
  return { x: 0, y: 0 };
}
