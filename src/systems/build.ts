import type { Entity, World } from '../core/world.ts';
import type { Stores } from '../core/components.ts';
import { transformAt } from '../core/components.ts';
import { biomeAt, isWater } from '../world/terrain.ts';

/**
 * Pose de constructions.
 *
 * Une construction est une entité : de l'état, sauvegardé et un jour répliqué.
 * C'est l'inverse du terrain, qui se recalcule depuis la graine. Ce système est
 * l'endroit où les deux se rencontrent — et la règle y est nette : **la
 * simulation lit le monde dérivé, elle ne l'écrit jamais**. On refuse de bâtir
 * sur l'eau en interrogeant `biomeAt`, une fonction pure : le déterminisme et
 * le rejeu n'en souffrent pas.
 */

export const BUILD_REACH = 46;
export const BUILD_SIZE = 22;
/** Pas d'attente entre deux poses. Sans quoi maintenir la touche en sèmerait soixante par seconde. */
export const BUILD_COOLDOWN_STEPS = 12;

export type BuildRefusal = 'attente' | 'sans ressource' | 'sur l eau' | 'place occupée';

export type BuildOutcome =
  | { placed: true; entity: Entity; at: { x: number; y: number } }
  | { placed: false; reason: BuildRefusal };

/** Où la pose atterrirait, sans rien modifier — l'aperçu s'en sert aussi. */
export function buildTarget(stores: Stores, builder: Entity): { x: number; y: number } | null {
  const transform = stores.transform.get(builder);
  const control = stores.controlled.get(builder);
  if (!transform || !control) return null;

  const length = Math.hypot(control.facingX, control.facingY);
  // Direction jamais renseignée : on pose devant soi, vers le bas par défaut,
  // plutôt que de diviser par zéro ou de refuser sans raison lisible.
  const dirX = length > 0 ? control.facingX / length : 0;
  const dirY = length > 0 ? control.facingY / length : 1;

  return { x: transform.x + dirX * BUILD_REACH, y: transform.y + dirY * BUILD_REACH };
}

/** Décompte les temps d'attente. Appelé à chaque pas, avant toute pose. */
export function tickBuildCooldowns(stores: Stores): void {
  for (const [, control] of stores.controlled.entries()) {
    if (control.buildCooldown > 0) control.buildCooldown--;
  }
}

/**
 * Tente une pose et dit pourquoi elle échoue.
 *
 * Un booléen suffirait à la simulation, mais pas au joueur : « sans ressource »
 * et « sur l'eau » demandent des gestes différents.
 */
export function tryBuild(
  world: World,
  stores: Stores,
  seed: number,
  builder: Entity,
  atStep: number,
): BuildOutcome {
  const control = stores.controlled.get(builder);
  const inventory = stores.inventory.get(builder);
  const target = buildTarget(stores, builder);
  if (!control || !inventory || !target) return { placed: false, reason: 'attente' };

  if (control.buildCooldown > 0) return { placed: false, reason: 'attente' };
  if (inventory.blocs <= 0) return { placed: false, reason: 'sans ressource' };
  if (isWater(biomeAt(seed, target.x, target.y))) return { placed: false, reason: 'sur l eau' };

  for (const [entity] of stores.structure.entries()) {
    const other = stores.transform.get(entity);
    if (!other) continue;
    if (Math.hypot(other.x - target.x, other.y - target.y) < BUILD_SIZE) {
      return { placed: false, reason: 'place occupée' };
    }
  }

  const entity = world.create();
  stores.transform.set(entity, transformAt(target.x, target.y));
  stores.body.set(entity, { radius: BUILD_SIZE / 2, mass: 5000 });
  stores.sprite.set(entity, { hue: 32 });
  stores.structure.set(entity, { placedAtStep: atStep });

  inventory.blocs--;
  control.buildCooldown = BUILD_COOLDOWN_STEPS;
  return { placed: true, entity, at: target };
}
