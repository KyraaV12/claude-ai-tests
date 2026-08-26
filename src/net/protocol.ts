import type { Snapshot } from '../core/world.ts';
import type { InputFrame, PlayerId } from '../core/simulation.ts';

/**
 * Ce qui circule entre les pairs.
 *
 * Rien de plus : pas de terrain, pas de décor. Le monde se recalcule depuis la
 * graine chez chacun — c'est ce que la frontière posée en T3 achète ici.
 */
export type Message =
  | { kind: 'hello' }
  | { kind: 'welcome'; seed: number; step: number; snapshot: Snapshot }
  | { kind: 'join'; player: PlayerId }
  | { kind: 'leave'; player: PlayerId }
  | { kind: 'input'; player: PlayerId; step: number; input: InputFrame }
  | {
      kind: 'state';
      step: number;
      snapshot: Snapshot;
      /** Dernier pas d'entrée pris en compte pour chaque joueur. */
      acked: Array<[PlayerId, number]>;
    };

export interface Transport {
  send(message: Message): void;
  onMessage(handler: (message: Message) => void): void;
  close(): void;
}
