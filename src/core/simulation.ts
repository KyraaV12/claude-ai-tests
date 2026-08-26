import { World } from './world.ts';
import type { Snapshot } from './world.ts';
import { createStores, transformAt } from './components.ts';
import type { Stores } from './components.ts';
import { createRandom } from './random.ts';
import { applyControl, integrate } from '../systems/movement.ts';
import { resolveCollisions } from '../systems/collision.ts';
import { tickBuildCooldowns, tryBuild } from '../systems/build.ts';
import type { BuildOutcome } from '../systems/build.ts';
import { tickHarvestCooldowns, tryHarvest } from '../systems/harvest.ts';
import type { HarvestOutcome } from '../systems/harvest.ts';
import { findSpawn } from '../world/terrain.ts';

/**
 * Ce que le joueur demande pour un pas.
 *
 * Toute action doit passer par ici : un geste qui n'y figure pas ne serait pas
 * enregistré, et le rejeu divergerait sans qu'on sache pourquoi.
 */
export interface InputFrame {
  x: number;
  y: number;
  build: boolean;
  harvest: boolean;
}

/** L'entité pilotée. Sa création en premier lui donne un identifiant stable. */
export const PLAYER: number = 1;

export const STEPS_PER_SECOND = 60;
export const STEP_SECONDS = 1 / STEPS_PER_SECOND;

/**
 * Un pas de simulation, et rien d'autre.
 *
 * C'est le seul endroit où le monde avance. La boucle du navigateur et le
 * rejeu hors écran appellent tous deux `step()` : si le rejeu empruntait un
 * autre chemin de code, il ne prouverait rien sur le jeu réel.
 *
 * `step()` ne lit ni l'horloge, ni `Math.random()`, ni la caméra. C'est ce qui
 * rend un enregistrement d'entrées suffisant pour reproduire une partie.
 *
 * Le terrain n'entre pas ici : il est dérivé de la graine, pas simulé. Seules
 * les entités constituent l'état.
 */
export class Simulation {
  readonly world: World;
  readonly stores: Stores;
  readonly seed: number;
  readonly spawn: { x: number; y: number };
  private steps = 0;
  /** Résultats des dernières tentatives, pour l'affichage. Hors état du monde. */
  lastBuild: BuildOutcome | null = null;
  lastHarvest: HarvestOutcome | null = null;

  constructor(seed: number) {
    this.seed = seed;
    this.world = new World();
    this.stores = createStores(this.world);
    this.spawn = findSpawn(seed);
    this.populate();
  }

  get stepCount(): number {
    return this.steps;
  }

  /** Temps logique écoulé, en secondes. Sans rapport avec l'horloge murale. */
  get elapsedSeconds(): number {
    return this.steps * STEP_SECONDS;
  }

  step(input: InputFrame): void {
    tickBuildCooldowns(this.stores);
    tickHarvestCooldowns(this.stores);
    applyControl(this.stores, input, STEP_SECONDS);
    if (input.harvest) {
      this.lastHarvest = tryHarvest(this.world, this.stores, this.seed, PLAYER);
    }
    if (input.build) {
      this.lastBuild = tryBuild(this.world, this.stores, this.seed, PLAYER, this.steps);
    }
    integrate(this.stores, STEP_SECONDS);
    resolveCollisions(this.stores);
    this.steps++;
  }

  snapshot(): Snapshot {
    return this.world.snapshot();
  }

  private populate(): void {
    const { world, stores, spawn } = this;
    const random = createRandom(this.seed);

    const player = world.create();
    stores.transform.set(player, transformAt(spawn.x, spawn.y));
    stores.velocity.set(player, { x: 0, y: 0 });
    stores.body.set(player, { radius: 16, mass: 4 });
    stores.sprite.set(player, { hue: 212 });
    stores.controlled.set(player, {
      acceleration: 1100,
      maxSpeed: 380,
      damping: 2.4,
      facingX: 0,
      facingY: 1,
      buildCooldown: 0,
      harvestCooldown: 0,
    });
    // Peu de blocs au départ : bâtir doit obliger à récolter, sinon la
    // ressource ne serait qu'un compteur décoratif.
    stores.inventory.set(player, { blocs: 8 });

    // Quelques compagnons autour du départ. Ce sont des entités, donc de l'état
    // sauvegardé et répliqué — à l'inverse du décor, qui se recalcule.
    for (let i = 0; i < 12; i++) {
      const radius = 7 + random() * 9;
      const entity = world.create();
      stores.transform.set(
        entity,
        transformAt(spawn.x + (random() - 0.5) * 900, spawn.y + (random() - 0.5) * 900),
      );
      stores.velocity.set(entity, { x: (random() - 0.5) * 110, y: (random() - 0.5) * 110 });
      stores.body.set(entity, { radius, mass: radius * radius * 0.02 });
      stores.sprite.set(entity, { hue: 20 + random() * 40 });
    }
  }
}
