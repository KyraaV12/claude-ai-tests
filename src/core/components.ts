import { ComponentStore } from './world.ts';
import type { World } from './world.ts';

/**
 * Le jeu de composants du moteur. Chacun est une donnée pure, sans méthode :
 * le comportement vit dans les systèmes. C'est ce qui permet de sérialiser
 * l'état sans cas particulier, et de le rejouer à l'identique.
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

/** Ce qui donne une présence physique : rayon et masse. Rien de visuel ici. */
export interface Body {
  radius: number;
  mass: number;
}

/** Ce qui donne une apparence. Séparé de Body : un corps peut être invisible. */
export interface Sprite {
  /** Teinte HSL, 0–360. La couleur exacte est décidée au rendu, selon le thème. */
  hue: number;
}

/** Marque une entité pilotée par un joueur, désigné par son identifiant. */
export interface Controlled {
  /** À qui obéit cette entité. Un monde peut en compter plusieurs. */
  player: number;
  acceleration: number;
  maxSpeed: number;
  /** Freinage par seconde, appliqué quand aucune direction n'est demandée. */
  damping: number;
  /**
   * Dernière direction demandée, vecteur unitaire. Conservée quand la saisie
   * cesse : sans elle, on ne saurait plus où poser une construction dès que le
   * joueur s'arrête. C'est de l'état, donc sérialisé et rejoué.
   */
  facingX: number;
  facingY: number;
  /** Pas restants avant de pouvoir reposer. Empêche la pose en rafale. */
  buildCooldown: number;
  /** Pas restants avant de pouvoir récolter à nouveau. */
  harvestCooldown: number;
}

/**
 * Les matières du monde.
 *
 * Trois, et chacune a un emploi — c'est la règle qu'on se donne ici. Une
 * quatrième ressource qu'on ramasse sans jamais s'en servir n'enrichit pas le
 * jeu, elle allonge une liste.
 */
export type Material = 'bois' | 'pierre' | 'fibre';

export const MATERIALS: readonly Material[] = ['bois', 'pierre', 'fibre'] as const;

/** Ce que porte une entité. Un compte par matière, jamais de champ absent. */
export type Inventory = Record<Material, number>;

export function emptyInventory(): Inventory {
  return { bois: 0, pierre: 0, fibre: 0 };
}

export type StructureKind = 'mur' | 'torche';

/**
 * Une construction posée par le joueur.
 *
 * C'est de l'état, pas du décor : contrairement au terrain, elle ne se
 * recalcule pas depuis la graine et doit donc être sauvegardée et transmise.
 */
export interface Structure {
  placedAtStep: number;
  kind: StructureKind;
}

/**
 * Ce qui éclaire autour de soi.
 *
 * Séparé de `Structure` : la lumière n'est pas une propriété du bâti. Une
 * créature luminescente ou un feu de camp la porteraient aussi bien, sans
 * qu'il faille les déclarer constructions.
 */
export interface Light {
  /** Portée de l'éclairage, en unités du monde. */
  radius: number;
}

/**
 * L'exception qui retire un élément de décor du monde généré.
 *
 * Le générateur n'est pas touché : il continue de produire cet arbre à cet
 * endroit, pour toujours. Ce qui change, c'est la lecture — le monde visible
 * est *le généré moins les exceptions*. C'est ce qui permet à un monde infini
 * de garder une mémoire de ce qu'on lui a pris sans rien stocker du reste.
 *
 * L'identité d'un élément est sa place dans l'ordre de génération de son
 * morceau : déterministe, donc suffisante et minuscule.
 */
export interface Harvested {
  cx: number;
  cy: number;
  index: number;
}

export type Species = 'cerf' | 'loup' | 'luciole';

/**
 * Ce qui fait qu'une entité est vivante plutôt que posée.
 *
 * Tout y est de la donnée pure, donc sérialisable : le cap courant, le compte
 * à rebours de la prochaine décision, et le point d'attache. Aucune fonction,
 * aucune référence — sinon l'état ne pourrait ni se sauvegarder ni se
 * transmettre, et une créature ne se rejouerait pas.
 */
export interface Creature {
  species: Species;
  /** Cap courant, vecteur unitaire. */
  headingX: number;
  headingY: number;
  /** Pas restants avant de choisir un nouveau cap. */
  decideIn: number;
  /** Point d'attache : elle y revient plutôt que de partir à l'infini. */
  homeX: number;
  homeY: number;
}

export interface Stores {
  transform: ComponentStore<Transform>;
  velocity: ComponentStore<Velocity>;
  body: ComponentStore<Body>;
  sprite: ComponentStore<Sprite>;
  controlled: ComponentStore<Controlled>;
  inventory: ComponentStore<Inventory>;
  structure: ComponentStore<Structure>;
  harvested: ComponentStore<Harvested>;
  light: ComponentStore<Light>;
  creature: ComponentStore<Creature>;
}

export function createStores(world: World): Stores {
  return {
    transform: world.register(new ComponentStore<Transform>('transform')),
    velocity: world.register(new ComponentStore<Velocity>('velocity')),
    body: world.register(new ComponentStore<Body>('body')),
    sprite: world.register(new ComponentStore<Sprite>('sprite')),
    controlled: world.register(new ComponentStore<Controlled>('controlled')),
    inventory: world.register(new ComponentStore<Inventory>('inventory')),
    structure: world.register(new ComponentStore<Structure>('structure')),
    harvested: world.register(new ComponentStore<Harvested>('harvested')),
    light: world.register(new ComponentStore<Light>('light')),
    creature: world.register(new ComponentStore<Creature>('creature')),
  };
}

export function transformAt(x: number, y: number): Transform {
  return { x, y, previousX: x, previousY: y };
}
