/**
 * Sinus et cosinus reproductibles d'un moteur à l'autre.
 *
 * `Math.sin` et `Math.cos` ne sont **pas** tenus par la norme de rendre le
 * résultat correctement arrondi : chaque implémentation choisit ses
 * approximations. Mesuré ici entre le V8 de Node et celui de Chromium, sur
 * quatre mille angles : les deux diffèrent sur les derniers bits. Additions,
 * multiplications, divisions et racines carrées, elles, sont exactes à la
 * norme IEEE 754 et donnent le même résultat partout.
 *
 * Conséquence concrète, trouvée par le banc : le scénario de référence rendait
 * une empreinte en CI et une autre dans le navigateur. Même monde, même graine,
 * quarante-neuf entités des deux côtés, et un `y` qui différait à la
 * quatorzième décimale — assez pour que deux empreintes SHA-256 n'aient plus
 * rien à voir.
 *
 * On n'utilise donc ici que des opérations exactes. Les coefficients sont ceux
 * des noyaux de fdlibm, et l'ordre d'évaluation est fixe : à opérations
 * exactes et ordre fixe, le résultat est le même sur toute machine conforme.
 *
 * Ce module ne sert que la **simulation**. L'affichage peut continuer d'appeler
 * `Math.cos` : une couleur qui diffère d'un milliardième ne se voit pas, et
 * personne n'en calcule l'empreinte.
 */

/**
 * Longueur d'un vecteur, sans passer par `Math.hypot`.
 *
 * `Math.hypot` fait un travail de plus — une mise à l'échelle qui évite les
 * débordements sur des nombres énormes — et la norme ne dit pas comment. Les
 * deux V8 mesurés ici s'accordent, mais rien ne l'oblige, et le monde n'a pas
 * de coordonnées assez grandes pour que la protection serve. Une racine carrée
 * est exacte à la norme ; on s'en tient là.
 */
export function vectorLength(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return vectorLength(bx - ax, by - ay);
}

/** π/2 coupé en deux, pour que la réduction d'intervalle ne perde pas de bits. */
const HALF_PI_HI = 1.5707963267341256;
const HALF_PI_LO = 6.077100506506192e-11;
const TWO_OVER_PI = 0.6366197723675814;

// Noyau du sinus sur [-π/4, π/4].
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

// Noyau du cosinus sur [-π/4, π/4].
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kernelSin(x: number): number {
  const z = x * x;
  const poly = S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6))));
  return x + x * z * poly;
}

function kernelCos(x: number): number {
  const z = x * x;
  const poly = C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6))));
  return 1 - 0.5 * z + z * z * poly;
}

/**
 * Ramène l'angle dans [-π/4, π/4] et dit dans quel quadrant il était.
 *
 * Le retranchement se fait en deux temps, avec les deux moitiés de π/2 :
 * soustraire un π/2 arrondi ferait perdre, pour les grands angles, exactement
 * les bits qu'on cherche à préserver.
 */
function reduce(x: number): { r: number; quadrant: number } {
  const n = Math.round(x * TWO_OVER_PI);
  const r = x - n * HALF_PI_HI - n * HALF_PI_LO;
  return { r, quadrant: ((n % 4) + 4) % 4 };
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const { r, quadrant } = reduce(x);
  switch (quadrant) {
    case 0:
      return kernelSin(r);
    case 1:
      return kernelCos(r);
    case 2:
      return -kernelSin(r);
    default:
      return -kernelCos(r);
  }
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const { r, quadrant } = reduce(x);
  switch (quadrant) {
    case 0:
      return kernelCos(r);
    case 1:
      return -kernelSin(r);
    case 2:
      return -kernelCos(r);
    default:
      return kernelSin(r);
  }
}
