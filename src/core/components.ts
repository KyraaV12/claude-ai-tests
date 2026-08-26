import { ComponentStore } from './world.ts';
import type { World } from './world.ts';

/**
 * Le jeu de composants de la tranche T0. Chacun est une donnée pure, sans
 * méthode : le comportement vit dans les systèmes, jamais dans le composant.
 * C'est ce qui permettra de sérialiser l'état sans cas particulier.
 */

/** Position, plus la position du pas précédent — le rendu interpole entre les deux. */
export interface Transform {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
}

export interface Velocity {
  x: number;
  y: number;
}

export interface Sprite {
  radius: number;
  /** Teinte HSL, 0–360. La couleur exacte est décidée au rendu, selon le thème. */
  hue: number;
}

/** Marque une entité pilotée par la saisie du joueur. */
export interface Controlled {
  acceleration: number;
  maxSpeed: number;
  /** Freinage par seconde, appliqué quand aucune direction n'est demandée. */
  damping: number;
}

export interface Stores {
  transform: ComponentStore<Transform>;
  velocity: ComponentStore<Velocity>;
  sprite: ComponentStore<Sprite>;
  controlled: ComponentStore<Controlled>;
}

export function createStores(world: World): Stores {
  return {
    transform: world.register(new ComponentStore<Transform>('transform')),
    velocity: world.register(new ComponentStore<Velocity>('velocity')),
    sprite: world.register(new ComponentStore<Sprite>('sprite')),
    controlled: world.register(new ComponentStore<Controlled>('controlled')),
  };
}

export function transformAt(x: number, y: number): Transform {
  return { x, y, previousX: x, previousY: y };
}
