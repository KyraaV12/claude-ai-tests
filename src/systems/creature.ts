import type { Entity, World } from '../core/world.ts';
import type { Creature, Species, Stores } from '../core/components.ts';
import { transformAt } from '../core/components.ts';
import { hash2 } from '../world/noise.ts';
import { biomeAt, isWater } from '../world/terrain.ts';
import { isNight } from '../world/daynight.ts';
import { vectorLength, cos, sin } from '../core/trig.ts';

/**
 * Ce qui vit dans le monde.
 *
 * Une créature est une **entité**, donc de l'état : elle se sauvegarde, se
 * réplique, se rejoue. C'est l'inverse d'un arbre, qui se recalcule depuis la
 * graine — et la différence tient à une seule chose : un arbre est toujours là
 * où le générateur le met, une créature non.
 *
 * Aucune décision ne tire de `Math.random()`. Chacune vient d'un hachage de
 * (graine, entité, pas) : deux pairs qui comptent les mêmes pas prennent les
 * mêmes décisions, et un rejeu retrouve les mêmes trajets sans que rien n'ait
 * été enregistré.
 */

export interface Traits {
  speed: number;
  radius: number;
  mass: number;
  hue: number;
  /** Rayon de la lumière portée, ou 0 pour une espèce qui n'éclaire pas. */
  light: number;
  /**
   * Ce que l'espèce fait d'un joueur proche : +1 elle vient, −1 elle fuit,
   * 0 elle l'ignore.
   */
  towardPlayer: number;
  /** Distance à laquelle elle remarque un joueur. */
  notice: number;
  /** Le moment où elle est active. Le reste du temps, elle flâne. */
  awake: 'jour' | 'nuit' | 'toujours';
}

export const SPECIES: Record<Species, Traits> = {
  // Farouche : elle s'écarte dès qu'on approche, et de loin.
  cerf: { speed: 165, radius: 11, mass: 3, hue: 28, light: 0, towardPlayer: -1, notice: 260, awake: 'jour' },
  // Le seul danger du monde, et seulement la nuit.
  loup: { speed: 190, radius: 10, mass: 3, hue: 208, light: 0, towardPlayer: 1, notice: 340, awake: 'nuit' },
  // Elle n'a aucun avis sur les joueurs ; elle éclaire, c'est tout.
  luciole: { speed: 42, radius: 3, mass: 0.2, hue: 62, light: 95, towardPlayer: 0, notice: 0, awake: 'nuit' },
};

/** Pas entre deux changements de cap, quand rien n'attire ni n'effraie. */
const DECISION_STEPS = 48;
/** Au-delà de cette distance de son point d'attache, une créature revient. */
const LEASH = 700;

/** Un tirage reproductible, propre à une entité, un pas et une intention. */
function roll(seed: number, entity: Entity, steps: number, salt: number): number {
  return hash2(seed ^ salt, entity, steps);
}

/**
 * Fait vivre les créatures d'un pas.
 *
 * Appelé avant l'intégration, comme `applyControl` : ce système décide des
 * vitesses, il ne déplace rien lui-même.
 */
export function tickCreatures(stores: Stores, seed: number, steps: number): void {
  const night = isNight(steps);
  const players = playerPositions(stores);

  for (const [entity, creature] of stores.creature.entries()) {
    const transform = stores.transform.get(entity);
    const velocity = stores.velocity.get(entity);
    if (!transform || !velocity) continue;

    const traits = SPECIES[creature.species];
    const awake = traits.awake === 'toujours' || (traits.awake === 'nuit') === night;

    let dirX = creature.headingX;
    let dirY = creature.headingY;

    // Un joueur remarqué l'emporte sur la flânerie — mais seulement à l'heure
    // où l'espèce est éveillée. Un loup de midi n'est qu'un animal de plus.
    const target = awake && traits.towardPlayer !== 0 ? nearest(players, transform.x, transform.y, traits.notice) : null;
    if (target) {
      const dx = (target.x - transform.x) * traits.towardPlayer;
      const dy = (target.y - transform.y) * traits.towardPlayer;
      const length = vectorLength(dx, dy);
      if (length > 0) {
        dirX = dx / length;
        dirY = dy / length;
      }
    } else if (creature.decideIn <= 0) {
      const angle = roll(seed, entity, steps, 0x1b873593) * Math.PI * 2;
      dirX = cos(angle);
      dirY = sin(angle);
      creature.decideIn = DECISION_STEPS + Math.floor(roll(seed, entity, steps, 0xcc9e2d51) * DECISION_STEPS);
    }

    // La laisse : sans elle, une marche au hasard finit par emmener toute la
    // faune à l'infini, et le monde se vide derrière le joueur.
    const homeX = creature.homeX - transform.x;
    const homeY = creature.homeY - transform.y;
    const fromHome = vectorLength(homeX, homeY);
    if (fromHome > LEASH) {
      dirX = homeX / fromHome;
      dirY = homeY / fromHome;
    }

    creature.headingX = dirX;
    creature.headingY = dirY;
    creature.decideIn--;

    // Une espèce endormie traîne à petite allure : elle est là, elle ne dort
    // pas d'un sommeil de pierre, mais elle ne court pas non plus.
    const pace = traits.speed * (awake ? 1 : 0.35);
    velocity.x = dirX * pace;
    velocity.y = dirY * pace;
  }
}

function playerPositions(stores: Stores): Array<{ x: number; y: number }> {
  const found: Array<{ x: number; y: number }> = [];
  for (const [entity] of stores.controlled.entries()) {
    const transform = stores.transform.get(entity);
    if (transform) found.push({ x: transform.x, y: transform.y });
  }
  return found;
}

function nearest(
  points: Array<{ x: number; y: number }>,
  x: number,
  y: number,
  within: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDistance = within;
  for (const point of points) {
    const distance = vectorLength(point.x - x, point.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

// ─────────────────────────────────────────────── peuplement et dépeuplement

/** Pas entre deux tentatives de peuplement. Un tiers de seconde. */
export const SPAWN_EVERY = 20;
/** Créatures visées autour de chaque joueur. */
export const POPULATION = 7;
/** Anneau où l'on fait apparaître : assez loin pour ne pas surgir sous le nez. */
const SPAWN_MIN = 420;
const SPAWN_MAX = 860;
/** Au-delà, plus personne ne la regarde : elle s'efface. */
const FORGET = 1400;
/**
 * Distance à partir de laquelle une bête hors de ses heures s'en va.
 *
 * Un loup surpris par l'aube ne disparaît pas sous les yeux du joueur — cela se
 * verrait — mais il ne traîne pas non plus toute la journée. Passé cette
 * distance, il rentre : c'est l'exode de l'aube, et il se joue hors champ.
 */
const OFF_HOURS_FORGET = 700;

/** Ce qui peut apparaître, selon l'heure. */
function speciesFor(night: boolean, pick: number): Species {
  if (night) return pick < 0.55 ? 'luciole' : 'loup';
  return pick < 0.85 ? 'cerf' : 'luciole';
}

/**
 * Fait apparaître et disparaître la faune autour des joueurs.
 *
 * **Réservé à la simulation qui fait autorité.** Un client qui devinerait les
 * apparitions verrait des bêtes surgir puis s'évaporer au premier état reçu :
 * c'est la même raison qui lui interdit de rejouer la pose d'un autre joueur.
 * Il les reçoit, il ne les invente pas.
 */
export function repopulate(world: World, stores: Stores, seed: number, steps: number): void {
  if (steps % SPAWN_EVERY !== 0) return;

  const players = playerPositions(stores);
  if (players.length === 0) return;

  const night = isNight(steps);
  forget(world, stores, players, night);
  for (let index = 0; index < players.length; index++) {
    const player = players[index]!;
    if (countNear(stores, player, SPAWN_MAX) >= POPULATION) continue;

    const angle = roll(seed, index + 1, steps, 0x2545f491) * Math.PI * 2;
    const distance = SPAWN_MIN + roll(seed, index + 1, steps, 0x9e3779b1) * (SPAWN_MAX - SPAWN_MIN);
    const x = player.x + cos(angle) * distance;
    const y = player.y + sin(angle) * distance;

    // Rien n'apparaît dans l'eau. On n'insiste pas : la tentative suivante
    // arrive dans un tiers de seconde, et forcer un point sec coûterait une
    // recherche à chaque pas.
    if (isWater(biomeAt(seed, x, y))) continue;

    spawn(world, stores, speciesFor(night, roll(seed, index + 1, steps, 0x85ebca77)), x, y);
  }
}

export function spawn(world: World, stores: Stores, species: Species, x: number, y: number): Entity {
  const traits = SPECIES[species];
  const entity = world.create();
  stores.transform.set(entity, transformAt(x, y));
  stores.velocity.set(entity, { x: 0, y: 0 });
  stores.body.set(entity, { radius: traits.radius, mass: traits.mass });
  stores.sprite.set(entity, { hue: traits.hue });
  stores.creature.set(entity, {
    species,
    headingX: 0,
    headingY: 1,
    decideIn: 0,
    homeX: x,
    homeY: y,
  });
  if (traits.light > 0) stores.light.set(entity, { radius: traits.light });
  return entity;
}

/**
 * Efface les créatures que plus personne ne voit.
 *
 * Sans cela, un monde exploré longtemps accumule des milliers de bêtes qui
 * pèsent sur chaque pas et sur chaque état transmis. Seules les créatures
 * s'effacent : une construction ou une récolte, elles, sont ce que le joueur a
 * fait — les oublier serait lui reprendre son travail.
 */
function forget(
  world: World,
  stores: Stores,
  players: Array<{ x: number; y: number }>,
  night: boolean,
): void {
  const doomed: Entity[] = [];
  for (const [entity, creature] of stores.creature.entries()) {
    const transform = stores.transform.get(entity);
    if (!transform) continue;

    const awake = SPECIES[creature.species].awake;
    const offHours = awake !== 'toujours' && (awake === 'nuit') !== night;
    const range = offHours ? OFF_HOURS_FORGET : FORGET;
    if (nearest(players, transform.x, transform.y, range) === null) doomed.push(entity);
  }
  for (const entity of doomed) world.destroy(entity);
}

function countNear(stores: Stores, player: { x: number; y: number }, within: number): number {
  let count = 0;
  for (const [entity] of stores.creature.entries()) {
    const transform = stores.transform.get(entity);
    if (!transform) continue;
    if (vectorLength(transform.x - player.x, transform.y - player.y) < within) count++;
  }
  return count;
}

export type { Creature };
