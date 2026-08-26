import type { Entity, World } from '../core/world.ts';
import { ComponentStore } from '../core/world.ts';
import type { Stores } from '../core/components.ts';

/**
 * La logique de l'inspecteur, sans DOM.
 *
 * Tout ce qui décide — quelle entité est sous le curseur, quels champs sont
 * modifiables, ce qu'une écriture accepte — vit ici et se teste sans
 * navigateur. Le panneau ne fait que l'afficher.
 */

export interface FieldView {
  name: string;
  value: number;
}

export interface ComponentView {
  name: string;
  fields: FieldView[];
}

/** Les stockages vus comme un annuaire par nom, pour parcourir sans les nommer un à un. */
function directory(stores: Stores): Map<string, ComponentStore<unknown>> {
  const map = new Map<string, ComponentStore<unknown>>();
  for (const store of Object.values(stores)) {
    const typed = store as ComponentStore<unknown>;
    map.set(typed.name, typed);
  }
  return map;
}

export function listEntities(world: World): Entity[] {
  return world.entities();
}

/** Les noms des composants portés par une entité, dans l'ordre des stockages. */
export function componentsOf(stores: Stores, entity: Entity): string[] {
  const names: string[] = [];
  for (const [name, store] of directory(stores)) {
    if (store.has(entity)) names.push(name);
  }
  return names;
}

/**
 * L'état d'une entité, prêt à afficher.
 *
 * Seuls les champs numériques sont retenus : ce sont les seuls que l'inspecteur
 * sait écrire, et proposer un champ non modifiable serait mentir sur ce qu'il
 * sait faire.
 */
export function describeEntity(stores: Stores, entity: Entity): ComponentView[] {
  const views: ComponentView[] = [];
  for (const [name, store] of directory(stores)) {
    const component = store.get(entity);
    if (!component || typeof component !== 'object') continue;

    const fields: FieldView[] = [];
    for (const [key, value] of Object.entries(component as Record<string, unknown>)) {
      if (typeof value === 'number') fields.push({ name: key, value });
    }
    views.push({ name, fields });
  }
  return views;
}

/**
 * Ce que contient un champ de saisie.
 *
 * `Number('')` vaut zéro : sans cette distinction, vider un champ pour le
 * retaper écraserait la valeur par 0, silencieusement et de façon destructive.
 */
export type FieldInput =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'value'; value: number };

export function parseFieldInput(raw: string): FieldInput {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'empty' };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { kind: 'value', value } : { kind: 'invalid' };
}

/**
 * Écrit un champ numérique dans un composant.
 *
 * Refuse une valeur non finie plutôt que de l'écrire : un NaN glissé dans une
 * position contamine la simulation entière au pas suivant, et l'erreur se
 * manifesterait très loin de sa cause.
 */
export function setField(
  stores: Stores,
  entity: Entity,
  componentName: string,
  fieldName: string,
  value: number,
): boolean {
  if (!Number.isFinite(value)) return false;

  const store = directory(stores).get(componentName);
  const component = store?.get(entity);
  if (!component || typeof component !== 'object') return false;

  const record = component as Record<string, unknown>;
  if (typeof record[fieldName] !== 'number') return false;

  record[fieldName] = value;
  return true;
}

/** L'entité la plus proche d'un point du monde, ou `null` si aucune n'est assez près. */
export function findNearest(stores: Stores, x: number, y: number, tolerance = 24): Entity | null {
  let best: Entity | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [entity, transform] of stores.transform.entries()) {
    const distance = Math.hypot(transform.x - x, transform.y - y);

    // Le rayon du corps élargit la cible : on vise ce qu'on voit, pas un centre.
    const reach = (stores.body.get(entity)?.radius ?? 0) + tolerance;
    if (distance <= reach && distance < bestDistance) {
      best = entity;
      bestDistance = distance;
    }
  }
  return best;
}
