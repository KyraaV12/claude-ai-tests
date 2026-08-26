/**
 * Bruit déterministe en espace monde.
 *
 * Tout est fonction de la graine et des coordonnées, jamais d'un état : le même
 * point rend toujours la même valeur, quel que soit l'ordre dans lequel on le
 * demande, la machine qui le demande, ou le fait qu'on l'ait déjà demandé.
 *
 * C'est ce qui permet à un monde infini de ne rien stocker. Le terrain n'est ni
 * sauvegardé ni répliqué : il se recalcule.
 */

/**
 * Hachage entier vers [0, 1). Deux coordonnées voisines donnent des valeurs sans lien.
 *
 * La graine est multipliée avant d'être combinée, et le tout passe par une
 * finalisation en avalanche : sans elle, `hash2(seed, 0, 0)` se réduisait
 * presque à `seed`, et les petites graines — précisément celles qu'on tape —
 * donnaient des valeurs basses. Le monde de la graine 1 était noyé.
 */
export function hash2(seed: number, x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Interpolation lissée : dérivée nulle aux extrémités, donc pas d'arête visible. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Bruit de valeur bilinéaire, continu sur tout le plan.
 *
 * La continuité n'est pas cosmétique : c'est elle qui garantit qu'un tuilage
 * par morceaux ne laisse aucune couture. Un bruit tiré par tuile produirait des
 * bords visibles à chaque frontière.
 */
export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);

  const c00 = hash2(seed, x0, y0);
  const c10 = hash2(seed, x0 + 1, y0);
  const c01 = hash2(seed, x0, y0 + 1);
  const c11 = hash2(seed, x0 + 1, y0 + 1);

  const top = c00 + (c10 - c00) * fx;
  const bottom = c01 + (c11 - c01) * fx;
  return top + (bottom - top) * fy;
}

/**
 * Somme d'octaves : de grandes formes, puis du détail de plus en plus fin.
 *
 * Le résultat reste dans [0, 1] parce qu'on divise par la somme des amplitudes,
 * ce qui évite d'avoir à borner après coup — et donc d'écraser les extrêmes.
 */
export function fbm(seed: number, x: number, y: number, octaves = 4): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let normalisation = 0;

  for (let i = 0; i < octaves; i++) {
    // Une graine décalée par octave : sans ça, les octaves se superposeraient
    // exactement aux mêmes endroits et le relief serait régulier.
    total += valueNoise(seed + i * 8191, x * frequency, y * frequency) * amplitude;
    normalisation += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / normalisation;
}
