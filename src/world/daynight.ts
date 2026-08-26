import { cos } from '../core/trig.ts';
/**
 * L'heure du monde, déduite du compteur de pas.
 *
 * Rien n'est stocké. L'heure n'est pas de l'état : c'est une lecture du temps
 * logique, au même titre que le terrain est une lecture de la graine. Deux
 * conséquences qui valent d'être dites — un rejeu retrouve la même nuit sans
 * qu'aucune horloge ait été enregistrée, et le réseau n'a rien à transmettre :
 * chaque pair compte les mêmes pas, donc voit le même ciel.
 *
 * Aucune de ces fonctions ne lit `Date.now()`. Une seule le ferait, et le
 * déterminisme s'effondrerait — le rejeu d'une partie de nuit se rejouerait
 * en plein jour.
 */

/** Deux minutes de jeu pour un jour entier. Assez court pour voir le cycle. */
export const STEPS_PER_DAY = 7200;

/**
 * L'heure à laquelle un monde neuf commence : le petit matin.
 *
 * Démarrer à minuit ferait ouvrir le jeu sur un écran noir ; démarrer à midi
 * cacherait la moitié du travail. Le lever de soleil montre les deux.
 */
const DAWN_START = 0.27;

const TAU = Math.PI * 2;

export type Phase = 'nuit' | 'aube' | 'jour' | 'crépuscule';

/** Adoucit un passage de 0 à 1 entre deux bornes, sans angle. */
function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** L'heure, de 0 à 1 : 0 est minuit, 0,5 est midi. */
export function timeOfDay(steps: number): number {
  const t = (steps / STEPS_PER_DAY + DAWN_START) % 1;
  return t < 0 ? t + 1 : t;
}

/**
 * La hauteur du soleil, de −1 à +1.
 *
 * Sert de grandeur commune à la lumière, à la teinte et aux phases : les trois
 * changent ensemble parce qu'elles lisent le même nombre, et non parce qu'on a
 * pris soin d'accorder trois seuils.
 */
export function sunHeight(steps: number): number {
  return -cos(timeOfDay(steps) * TAU);
}

/**
 * La lumière du jour, de 0 (nuit noire) à 1 (plein midi).
 *
 * La bande de passage est large à dessein, et calibrée en comptant les pas :
 * la moitié du cycle en plein jour, trois dixièmes de nuit, le reste en aube
 * et crépuscule. Une bande étroite donnait onze heures de noir sur vingt-quatre
 * et un basculement qui claque — joli sur une courbe, injouable à l'écran.
 */
export function daylight(steps: number): number {
  return smoothstep(-0.85, 0.25, sunHeight(steps));
}

export function isNight(steps: number): boolean {
  return daylight(steps) < 0.25;
}

/**
 * L'embrasement de l'horizon, de 0 à 1.
 *
 * Culmine quand le soleil rase l'horizon, dans un sens ou dans l'autre. C'est
 * de lui que viennent l'orange du couchant *et* le nom de la phase : les deux
 * lisent le même nombre, donc ils ne peuvent pas se contredire.
 */
export function horizonGlow(steps: number): number {
  return Math.max(0, 1 - Math.abs(sunHeight(steps)) / 0.5);
}

/**
 * Le nom de l'heure. Une étiquette pour l'affichage, rien de plus.
 *
 * Elle ne commande rien : la teinte et la lumière se calculent sans elle. Un
 * nom qui pilotait les couleurs, c'était trois seuils à tenir accordés, et ils
 * ne l'étaient pas — la barre annonçait « jour » sur un ciel encore orange.
 */
export function phaseAt(steps: number): Phase {
  const light = daylight(steps);
  if (light < 0.15) return 'nuit';
  // Deux façons d'être entre chien et loup : il fait déjà sombre, ou le ciel
  // est encore orange. Ne regarder que l'embrasement annonçait « jour » à huit
  // heures du soir, parce que le soleil était trop bas pour l'embraser encore.
  if (light < 0.85 || horizonGlow(steps) > 0.3) {
    return timeOfDay(steps) < 0.5 ? 'aube' : 'crépuscule';
  }
  return 'jour';
}

export interface Tint {
  /** Couleur du voile posé sur le monde. */
  color: string;
  /** Son opacité, de 0 (rien) à 1. */
  alpha: number;
}

/** Bleu de nuit et orange de couchant, mêlés selon l'heure. */
const NIGHT_RGB = [11, 27, 58] as const;
const DAWN_RGB = [255, 176, 103] as const;
const DUSK_RGB = [255, 138, 76] as const;

/**
 * Le voile de lumière, à poser par-dessus le monde.
 *
 * Purement de l'affichage : la simulation ignore les couleurs. Les deux voiles
 * — le bleu de la nuit, l'orange de l'horizon — sont **mêlés** plutôt que
 * choisis. Un `if` entre les deux ferait claquer la couleur au moment précis
 * où l'on regarde le ciel ; ici tout est continu par construction.
 */
export function skyTint(steps: number): Tint {
  const light = daylight(steps);
  // L'orange n'a de sens que s'il reste de la lumière à colorer.
  const warm = horizonGlow(steps) * light;
  const dark = 1 - light;

  const fromNight = dark * 0.52;
  const fromHorizon = warm * 0.3;
  const alpha = fromNight + fromHorizon;
  if (alpha < 0.004) return { color: '#000000', alpha: 0 };

  const [wr, wg, wb] = timeOfDay(steps) < 0.5 ? DAWN_RGB : DUSK_RGB;
  const mix = (night: number, horizon: number): number =>
    Math.round((night * fromNight + horizon * fromHorizon) / alpha);

  const r = mix(NIGHT_RGB[0], wr);
  const g = mix(NIGHT_RGB[1], wg);
  const b = mix(NIGHT_RGB[2], wb);
  return { color: `rgb(${r} ${g} ${b})`, alpha };
}

/**
 * L'heure affichable, en heures et minutes.
 *
 * Le jeu ne s'en sert pas ; le joueur, si. Savoir qu'il est 19 h 40 dit ce que
 * « la lumière baisse » laisse deviner.
 */
export function clockLabel(steps: number): string {
  const minutes = Math.floor(timeOfDay(steps) * 24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
