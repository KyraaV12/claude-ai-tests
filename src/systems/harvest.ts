import type { Entity, World } from '../core/world.ts';
import type { Stores } from '../core/components.ts';
import { CHUNK_SIZE, chunkCoordOf, generateChunk } from '../world/chunk.ts';
import type { Prop, PropKind } from '../world/chunk.ts';

/**
 * Récolte du décor.
 *
 * Le générateur reste intact : abattre un arbre n'écrit rien dans le monde
 * dérivé, cela ajoute une **exception**. Le monde visible se lit comme *le
 * généré moins les exceptions* — et un test vérifie que le générateur produit
 * toujours l'arbre abattu, sans quoi la frontière serait franchie.
 *
 * Une exception coûte une entité, comme une construction. C'est le prix de
 * l'état, et il ne se paie que pour ce qu'on a réellement changé.
 */

export const HARVEST_REACH = 70;
export const HARVEST_COOLDOWN_STEPS = 15;

/** Ce que rapporte chaque type d'élément. */
export const YIELD: Record<PropKind, number> = { arbre: 3, rocher: 2 };

export type HarvestRefusal = 'attente' | 'rien à portée';

export type HarvestOutcome =
  | { harvested: true; kind: PropKind; gained: number; at: { x: number; y: number } }
  | { harvested: false; reason: HarvestRefusal };

/** Identité d'un élément de décor : son morceau et son rang de génération. */
export function propKey(cx: number, cy: number, index: number): string {
  return `${cx},${cy},${index}`;
}

/**
 * L'ensemble des exceptions, reconstruit depuis l'état.
 *
 * Reconstruit à la demande plutôt que maintenu : la liste est petite — une
 * entrée par élément réellement récolté — et la dériver évite un index à tenir
 * synchronisé avec les instantanés et les restaurations.
 */
export function harvestedKeys(stores: Stores): Set<string> {
  const keys = new Set<string>();
  for (const [, mark] of stores.harvested.entries()) {
    keys.add(propKey(mark.cx, mark.cy, mark.index));
  }
  return keys;
}

interface Located {
  prop: Prop;
  cx: number;
  cy: number;
  index: number;
  distance: number;
}

/**
 * L'élément récoltable le plus proche d'un point, exceptions déduites.
 *
 * Les morceaux sont recalculés ici plutôt que lus dans le cache du rendu : la
 * simulation ne doit rien devoir à l'affichage. `generateChunk` étant pure, le
 * résultat est le même et le déterminisme intact.
 */
export function nearestProp(
  stores: Stores,
  seed: number,
  x: number,
  y: number,
  reach = HARVEST_REACH,
): Located | null {
  const removed = harvestedKeys(stores);
  const centreX = chunkCoordOf(x);
  const centreY = chunkCoordOf(y);
  // Un anneau de morceaux suffit tant que la portée reste sous la taille d'un
  // morceau, ce qu'une assertion de test verrouille.
  const span = Math.ceil(reach / CHUNK_SIZE);

  let best: Located | null = null;
  for (let cy = centreY - span; cy <= centreY + span; cy++) {
    for (let cx = centreX - span; cx <= centreX + span; cx++) {
      const chunk = generateChunk(seed, cx, cy);
      for (let index = 0; index < chunk.props.length; index++) {
        if (removed.has(propKey(cx, cy, index))) continue;
        const prop = chunk.props[index]!;
        const distance = Math.hypot(prop.x - x, prop.y - y);
        if (distance > reach + prop.radius) continue;
        if (!best || distance < best.distance) best = { prop, cx, cy, index, distance };
      }
    }
  }
  return best;
}

export function tickHarvestCooldowns(stores: Stores): void {
  for (const [, control] of stores.controlled.entries()) {
    if (control.harvestCooldown > 0) control.harvestCooldown--;
  }
}

export function tryHarvest(
  world: World,
  stores: Stores,
  seed: number,
  gatherer: Entity,
): HarvestOutcome {
  const control = stores.controlled.get(gatherer);
  const inventory = stores.inventory.get(gatherer);
  const transform = stores.transform.get(gatherer);
  if (!control || !inventory || !transform) return { harvested: false, reason: 'attente' };
  if (control.harvestCooldown > 0) return { harvested: false, reason: 'attente' };

  const found = nearestProp(stores, seed, transform.x, transform.y);
  if (!found) return { harvested: false, reason: 'rien à portée' };

  const mark = world.create();
  stores.harvested.set(mark, { cx: found.cx, cy: found.cy, index: found.index });

  const gained = YIELD[found.prop.kind];
  inventory.blocs += gained;
  control.harvestCooldown = HARVEST_COOLDOWN_STEPS;

  return { harvested: true, kind: found.prop.kind, gained, at: { x: found.prop.x, y: found.prop.y } };
}
