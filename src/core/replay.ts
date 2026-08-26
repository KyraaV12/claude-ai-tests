import { Simulation } from './simulation.ts';
import type { PlayerId, Tick } from './simulation.ts';
import type { Snapshot } from './world.ts';

/**
 * Une partie enregistrée : une graine, et la suite des entrées pas à pas.
 *
 * C'est tout ce qu'il faut pour reproduire une session entière. Pas de
 * positions, pas d'horodatages — l'état se recalcule. Un enregistrement d'une
 * minute pèse quelques kilo-octets là où une suite d'instantanés en pèserait
 * des centaines.
 */
export interface Recording {
  seed: number;
  /** Les joueurs présents, dans l'ordre où ils sont entrés. */
  players: PlayerId[];
  /** Une entrée par pas : les demandes de tous les joueurs pour ce pas. */
  frames: Tick[];
}

export class Recorder {
  readonly seed: number;
  readonly players: PlayerId[];
  private readonly frames: Tick[] = [];

  constructor(seed: number, players: PlayerId[]) {
    this.seed = seed;
    this.players = [...players];
  }

  /** Copie les demandes du pas : les garder par référence les ferait muter sous nos pieds. */
  capture(tick: Tick): void {
    this.frames.push(
      tick.map((input) => ({
        player: input.player,
        x: input.x,
        y: input.y,
        build: input.build,
        harvest: input.harvest,
        torch: input.torch,
      })),
    );
  }

  get frameCount(): number {
    return this.frames.length;
  }

  finish(): Recording {
    return { seed: this.seed, players: [...this.players], frames: [...this.frames] };
  }
}

/** Rejoue un enregistrement depuis un monde neuf et rend l'état final. */
export function replay(recording: Recording): Snapshot {
  const simulation = new Simulation(recording.seed, recording.players);
  for (const frame of recording.frames) simulation.step(frame);
  return simulation.snapshot();
}

export interface Comparison {
  identical: boolean;
  /** Chemin du premier écart trouvé, vide si les deux états coïncident. */
  firstDifference: string;
}

/**
 * Compare deux états et situe le premier écart.
 *
 * Un booléen suffirait à valider, mais pas à diagnostiquer : quand une
 * divergence apparaîtra, savoir « composant transform, entité 7, champ x »
 * vaut mieux que « ce n'est pas pareil ».
 */
export function compare(expected: Snapshot, actual: Snapshot): Comparison {
  const walk = (a: unknown, b: unknown, path: string): string => {
    if (Object.is(a, b)) return '';
    if (typeof a !== typeof b || a === null || b === null) return path;
    if (typeof a !== 'object') return path;

    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b)) return path;
      if (a.length !== b.length) return `${path}.length`;
      for (let i = 0; i < a.length; i++) {
        const found = walk(a[i], b[i], `${path}[${i}]`);
        if (found) return found;
      }
      return '';
    }

    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const key of keys) {
      const found = walk(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      );
      if (found) return found;
    }
    return '';
  };

  const firstDifference = walk(expected, actual, '');
  return { identical: firstDifference === '', firstDifference };
}
