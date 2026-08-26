import type { Entity, World } from '../core/world.ts';
import type { Inventory, Stores, StructureKind } from '../core/components.ts';
import { transformAt } from '../core/components.ts';
import { biomeAt, isWater } from '../world/terrain.ts';
import { vectorLength } from '../core/trig.ts';

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

/** Portée de la lumière d'une torche, en unités du monde. */
export const TORCH_RADIUS = 190;

/**
 * Ce que coûte chaque construction.
 *
 * Le mur mange de la pierre, la torche du bois et de la fibre : les trois
 * matières ont un emploi, et aucune ne s'accumule pour rien. C'est ce qui fait
 * que le biome où l'on s'arrête décide de ce qu'on peut bâtir.
 */
export const BUILD_COST: Record<StructureKind, Partial<Inventory>> = {
  mur: { pierre: 2 },
  torche: { bois: 1, fibre: 1 },
};

/** Ce qui manque pour bâtir, ou `null` si tout est là. */
function missingFor(inventory: Inventory, kind: StructureKind): string | null {
  for (const [material, amount] of Object.entries(BUILD_COST[kind])) {
    if (inventory[material as keyof Inventory] < amount) return material;
  }
  return null;
}

export type BuildRefusal = 'attente' | 'sans ressource' | 'sur l eau' | 'place occupée';

export type BuildOutcome =
  | { placed: true; entity: Entity; kind: StructureKind; at: { x: number; y: number } }
  | { placed: false; reason: BuildRefusal; kind: StructureKind; missing?: string };

/** Où la pose atterrirait, sans rien modifier — l'aperçu s'en sert aussi. */
export function buildTarget(stores: Stores, builder: Entity): { x: number; y: number } | null {
  const transform = stores.transform.get(builder);
  const control = stores.controlled.get(builder);
  if (!transform || !control) return null;

  const length = vectorLength(control.facingX, control.facingY);
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
  kind: StructureKind = 'mur',
): BuildOutcome {
  const control = stores.controlled.get(builder);
  const inventory = stores.inventory.get(builder);
  const target = buildTarget(stores, builder);
  if (!control || !inventory || !target) return { placed: false, reason: 'attente', kind };

  if (control.buildCooldown > 0) return { placed: false, reason: 'attente', kind };

  const missing = missingFor(inventory, kind);
  if (missing) return { placed: false, reason: 'sans ressource', kind, missing };

  if (isWater(biomeAt(seed, target.x, target.y))) return { placed: false, reason: 'sur l eau', kind };

  for (const [entity] of stores.structure.entries()) {
    const other = stores.transform.get(entity);
    if (!other) continue;
    if (vectorLength(other.x - target.x, other.y - target.y) < BUILD_SIZE) {
      return { placed: false, reason: 'place occupée', kind };
    }
  }

  const entity = world.create();
  stores.transform.set(entity, transformAt(target.x, target.y));
  stores.structure.set(entity, { placedAtStep: atStep, kind });

  if (kind === 'torche') {
    // Une torche n'a pas de corps : on doit pouvoir passer à côté sans buter,
    // et l'entasser n'aurait pas de sens. Elle porte une lumière, c'est tout.
    stores.sprite.set(entity, { hue: 44 });
    stores.light.set(entity, { radius: TORCH_RADIUS });
  } else {
    stores.body.set(entity, { radius: BUILD_SIZE / 2, mass: 5000 });
    stores.sprite.set(entity, { hue: 32 });
  }

  for (const [material, amount] of Object.entries(BUILD_COST[kind])) {
    inventory[material as keyof Inventory] -= amount;
  }
  control.buildCooldown = BUILD_COOLDOWN_STEPS;
  return { placed: true, entity, kind, at: target };
}
