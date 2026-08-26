import { Simulation } from '../core/simulation.ts';
import type { PlayerId, Tick } from '../core/simulation.ts';
import { sha256 } from './hash.ts';

/**
 * Un scénario : une graine, des joueurs, une suite d'actions datées.
 *
 * Rien d'autre. L'état final s'en déduit, et son empreinte le résume en
 * soixante-quatre caractères. Deux moteurs qui rendent la même empreinte pour
 * le même scénario se comportent identiquement — c'est tout ce qu'il faut pour
 * détecter une régression, et c'est bien moins fragile qu'une liste
 * d'assertions sur des positions.
 */

export type ActionKind = 'move' | 'harvest' | 'build' | 'idle';

export interface ScenarioAction {
  /** Pas auquel l'action commence. */
  atStep: number;
  player: PlayerId;
  kind: ActionKind;
  /** Direction, pour `move`. Normalisée à l'exécution. */
  dx?: number;
  dy?: number;
  /** Nombre de pas pendant lesquels l'action reste tenue. */
  holdSteps?: number;
}

export interface Scenario {
  id: string;
  seed: number;
  players: PlayerId[];
  steps: number;
  actions: ScenarioAction[];
  /** Empreinte attendue, si on l'a déjà figée. */
  expectedHash?: string;
  expectedEntities?: number;
}

export interface ScenarioResult {
  id: string;
  hash: string;
  entities: number;
  steps: number;
  /** Deux exécutions du même scénario ont-elles donné la même empreinte ? */
  deterministic: boolean;
  /** `null` quand le scénario ne fige encore aucune attente. */
  matchesExpected: boolean | null;
  expectedHash: string | undefined;
  expectedEntities: number | undefined;
  actualEntities: number;
  durationMs: number;
}

/** L'empreinte d'un état. L'instantané est déjà canonique : ordre d'insertion stable. */
export function hashSimulation(simulation: Simulation): string {
  return sha256(JSON.stringify(simulation.snapshot()));
}

/**
 * Déplie les actions en une demande par joueur et par pas.
 *
 * Une action tenue vaut pour toute sa durée : c'est ainsi qu'un joueur joue,
 * et exiger une entrée par pas dans le scénario le rendrait illisible.
 */
export function expand(scenario: Scenario): Tick[] {
  const frames: Tick[] = [];
  for (let step = 1; step <= scenario.steps; step++) {
    const tick: Tick = [];
    for (const player of scenario.players) {
      const active = scenario.actions.filter(
        (a) => a.player === player && step >= a.atStep && step < a.atStep + (a.holdSteps ?? 1),
      );
      // La dernière action déclarée l'emporte : un scénario qui se contredit
      // doit rester déterministe plutôt que d'échouer sur un détail d'ordre.
      const action = active[active.length - 1];
      const length = action?.kind === 'move' ? Math.hypot(action.dx ?? 0, action.dy ?? 0) : 0;
      tick.push({
        player,
        x: action?.kind === 'move' && length > 0 ? (action.dx ?? 0) / length : 0,
        y: action?.kind === 'move' && length > 0 ? (action.dy ?? 0) / length : 0,
        build: action?.kind === 'build',
        harvest: action?.kind === 'harvest',
      });
    }
    frames.push(tick);
  }
  return frames;
}

function play(scenario: Scenario, frames: Tick[]): Simulation {
  const simulation = new Simulation(scenario.seed, scenario.players);
  for (const tick of frames) simulation.step(tick);
  return simulation;
}

/**
 * Exécute un scénario deux fois et compare.
 *
 * Deux fois, parce qu'une empreinte seule ne dit pas si le moteur est
 * déterministe — seulement ce qu'il a produit cette fois-ci.
 */
export function runScenario(scenario: Scenario): ScenarioResult {
  const frames = expand(scenario);
  const started = Date.now();

  const first = play(scenario, frames);
  const second = play(scenario, frames);

  const hash = hashSimulation(first);
  const entities = first.world.entityCount;

  return {
    id: scenario.id,
    hash,
    entities,
    steps: scenario.steps,
    deterministic: hash === hashSimulation(second),
    matchesExpected: scenario.expectedHash === undefined ? null : scenario.expectedHash === hash,
    expectedHash: scenario.expectedHash,
    expectedEntities: scenario.expectedEntities,
    actualEntities: entities,
    durationMs: Date.now() - started,
  };
}

/** Le scénario de référence : quatre joueurs, déplacements, récoltes, constructions. */
export const SCENARIO_018: Scenario = {
  id: 'scenario-018',
  seed: 847291,
  players: [1, 2, 3, 4],
  steps: 900,
  actions: [
    { atStep: 1, player: 1, kind: 'move', dx: 1, dy: 0, holdSteps: 120 },
    { atStep: 120, player: 2, kind: 'harvest', holdSteps: 60 },
    { atStep: 240, player: 1, kind: 'build', holdSteps: 30 },
    { atStep: 300, player: 3, kind: 'move', dx: 0, dy: -1, holdSteps: 200 },
    { atStep: 420, player: 2, kind: 'harvest', holdSteps: 120 },
    { atStep: 540, player: 4, kind: 'build', holdSteps: 60 },
    { atStep: 600, player: 1, kind: 'move', dx: -1, dy: 1, holdSteps: 180 },
    { atStep: 700, player: 3, kind: 'harvest', holdSteps: 100 },
    { atStep: 780, player: 4, kind: 'move', dx: 1, dy: 1, holdSteps: 120 },
  ],
  // Figé le 26 août 2026, mesuré et non deviné. Toute modification du moteur
  // qui change le monde produit ici un rouge, avec le nombre d'entités pour
  // dire de quel côté la régression penche. Si le changement est voulu, on
  // remesure et l'on remplace ces deux lignes — délibérément, jamais par
  // habitude.
  expectedHash: '38e4810dd6dd4138661bcb0d720abf789216fd867ec5b99af30f942038780e2d',
  expectedEntities: 24,
};
