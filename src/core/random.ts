/**
 * Générateur pseudo-aléatoire à graine (mulberry32).
 *
 * `Math.random()` est banni du code de simulation : sans graine explicite, deux
 * exécutions ne produisent pas le même monde, et ni une sauvegarde comparable
 * ni une simulation répliquée sur le réseau ne sont possibles. Une graine, une
 * suite — toujours la même.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
