import { World } from './world.ts';
import type { Entity, Snapshot } from './world.ts';
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

export type PlayerId = number;

/**
 * Ce qu'un joueur demande pour un pas.
 *
 * Toute action doit passer par ici : un geste qui n'y figure pas ne serait ni
 * enregistré ni transmis, et rejeu comme réplication divergeraient sans qu'on
 * sache pourquoi.
 */
export interface InputFrame {
  x: number;
  y: number;
  build: boolean;
  harvest: boolean;
}

export interface PlayerInput extends InputFrame {
  player: PlayerId;
}

/** Les demandes de tous les joueurs pour un pas. */
export type Tick = PlayerInput[];

export const STEPS_PER_SECOND = 60;
export const STEP_SECONDS = 1 / STEPS_PER_SECOND;
/** Le joueur local par défaut, hors réseau. */
export const PLAYER: PlayerId = 1;

export function idleInput(player: PlayerId): PlayerInput {
  return { player, x: 0, y: 0, build: false, harvest: false };
}

/**
 * Un pas de simulation, et rien d'autre.
 *
 * Seul endroit où le monde avance. La boucle du navigateur, le rejeu hors
 * écran et l'hôte réseau appellent tous `step()` : un chemin de code différent
 * quelque part et la réplication ne prouverait plus rien.
 *
 * `step()` ne lit ni l'horloge, ni `Math.random()`, ni la caméra, ni le réseau.
 * Les demandes sont triées par identifiant de joueur avant d'être appliquées :
 * l'ordre d'arrivée des paquets ne doit pas changer le résultat.
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

  constructor(seed: number, players: PlayerId[] = [PLAYER]) {
    this.seed = seed;
    this.world = new World();
    this.stores = createStores(this.world);
    this.spawn = findSpawn(seed);
    this.populate();
    for (const player of players) this.addPlayer(player);
  }

  get stepCount(): number {
    return this.steps;
  }

  /** Temps logique écoulé, en secondes. Sans rapport avec l'horloge murale. */
  get elapsedSeconds(): number {
    return this.steps * STEP_SECONDS;
  }

  /** L'entité pilotée par ce joueur, ou `null` s'il n'en a pas. */
  entityOf(player: PlayerId): Entity | null {
    for (const [entity, control] of this.stores.controlled.entries()) {
      if (control.player === player) return entity;
    }
    return null;
  }

  players(): PlayerId[] {
    const found: PlayerId[] = [];
    for (const [, control] of this.stores.controlled.entries()) found.push(control.player);
    return found.sort((a, b) => a - b);
  }

  /**
   * Fait entrer un joueur.
   *
   * La position de départ dérive de son identifiant : deux hôtes qui font
   * entrer les mêmes joueurs dans le même ordre obtiennent le même monde.
   */
  addPlayer(player: PlayerId): Entity {
    const existing = this.entityOf(player);
    if (existing !== null) return existing;

    const angle = player * 2.399963; // angle d'or, pour écarter sans se répéter
    const entity = this.world.create();
    this.stores.transform.set(
      entity,
      transformAt(this.spawn.x + Math.cos(angle) * 60, this.spawn.y + Math.sin(angle) * 60),
    );
    this.stores.velocity.set(entity, { x: 0, y: 0 });
    this.stores.body.set(entity, { radius: 16, mass: 4 });
    this.stores.sprite.set(entity, { hue: (212 + player * 47) % 360 });
    this.stores.controlled.set(entity, {
      player,
      acceleration: 1100,
      maxSpeed: 380,
      damping: 2.4,
      facingX: 0,
      facingY: 1,
      buildCooldown: 0,
      harvestCooldown: 0,
    });
    this.stores.inventory.set(entity, { blocs: 8 });
    return entity;
  }

  removePlayer(player: PlayerId): void {
    const entity = this.entityOf(player);
    if (entity !== null) this.world.destroy(entity);
  }

  step(tick: Tick): void {
    tickBuildCooldowns(this.stores);
    tickHarvestCooldowns(this.stores);

    // Tri par joueur : deux hôtes recevant les mêmes paquets dans un ordre
    // différent doivent aboutir au même état.
    for (const input of [...tick].sort((a, b) => a.player - b.player)) {
      const entity = this.entityOf(input.player);
      if (entity === null) continue;

      applyControl(this.stores, entity, input, STEP_SECONDS);
      if (input.harvest) this.lastHarvest = tryHarvest(this.world, this.stores, this.seed, entity);
      if (input.build) this.lastBuild = tryBuild(this.world, this.stores, this.seed, entity, this.steps);
    }

    integrate(this.stores, STEP_SECONDS);
    resolveCollisions(this.stores);
    this.steps++;
  }

  snapshot(): Snapshot {
    return this.world.snapshot();
  }

  /** Reprend un état reçu, en réinitialisant l'horloge logique. */
  restore(snapshot: Snapshot, atStep: number): void {
    this.world.restore(snapshot);
    this.steps = atStep;
  }

  private populate(): void {
    const { world, stores, spawn } = this;
    const random = createRandom(this.seed);

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
