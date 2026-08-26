import { World } from './world.ts';
import type { Snapshot } from './world.ts';
import { createStores, transformAt } from './components.ts';
import type { Stores } from './components.ts';
import { createRandom } from './random.ts';
import { applyControl, integrate } from '../systems/movement.ts';
import type { Bounds } from '../systems/movement.ts';
import { resolveCollisions } from '../systems/collision.ts';

/** La direction demandée pour un pas de simulation. */
export interface InputFrame {
  x: number;
  y: number;
}

export const WORLD_BOUNDS: Bounds = { width: 1000, height: 600 };
export const STEPS_PER_SECOND = 60;
export const STEP_SECONDS = 1 / STEPS_PER_SECOND;

/**
 * Un pas de simulation, et rien d'autre.
 *
 * C'est le seul endroit où le monde avance. La boucle du navigateur et le
 * rejeu hors écran appellent tous deux `step()` : si le rejeu empruntait un
 * autre chemin de code, il ne prouverait rien sur le jeu réel.
 *
 * `step()` ne lit ni l'horloge, ni `Math.random()`, ni quoi que ce soit hors
 * de son argument. C'est ce qui rend un enregistrement d'entrées suffisant
 * pour reproduire une partie entière.
 */
export class Simulation {
  readonly world: World;
  readonly stores: Stores;
  readonly bounds: Bounds;
  readonly seed: number;
  private steps = 0;

  constructor(seed: number, bounds: Bounds = WORLD_BOUNDS) {
    this.seed = seed;
    this.bounds = bounds;
    this.world = new World();
    this.stores = createStores(this.world);
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
    applyControl(this.stores, input, STEP_SECONDS);
    integrate(this.stores, STEP_SECONDS, this.bounds);
    resolveCollisions(this.stores, this.bounds);
    this.steps++;
  }

  snapshot(): Snapshot {
    return this.world.snapshot();
  }

  private populate(): void {
    const { world, stores, bounds } = this;
    const random = createRandom(this.seed);

    const player = world.create();
    stores.transform.set(player, transformAt(bounds.width / 2, bounds.height / 2));
    stores.velocity.set(player, { x: 0, y: 0 });
    stores.body.set(player, { radius: 16, mass: 4 });
    stores.sprite.set(player, { hue: 212 });
    stores.controlled.set(player, { acceleration: 900, maxSpeed: 320, damping: 2.4 });

    for (let i = 0; i < 24; i++) {
      const radius = 6 + random() * 10;
      const entity = world.create();
      stores.transform.set(entity, transformAt(random() * bounds.width, random() * bounds.height));
      stores.velocity.set(entity, { x: (random() - 0.5) * 120, y: (random() - 0.5) * 120 });
      // Masse proportionnelle à la surface : les gros poussent les petits.
      stores.body.set(entity, { radius, mass: radius * radius * 0.02 });
      stores.sprite.set(entity, { hue: 150 + random() * 60 });
    }
  }
}
