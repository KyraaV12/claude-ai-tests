import { Simulation } from '../core/simulation.ts';
import type { InputFrame, PlayerId, Tick } from '../core/simulation.ts';
import type { Message, Transport } from './protocol.ts';

/**
 * L'hôte : la seule simulation qui fasse autorité.
 *
 * Il n'y a pas de vote ni de consensus. Un pair décide, les autres suivent —
 * c'est ce qui rend l'état convergent sans échange de messages sans fin.
 *
 * L'hôte ne fait rien que les autres ne pourraient faire : il appelle le même
 * `Simulation.step()`. C'est ce qui permet à un client de prédire juste.
 */
export interface HostOptions {
  /** Un état est diffusé tous les N pas. Six pas ≈ dix fois par seconde. */
  stateEvery?: number;
}

export class Host {
  readonly simulation: Simulation;
  readonly transport: Transport;
  readonly localPlayer: PlayerId;
  private readonly stateEvery: number;
  /**
   * Demandes reçues, rangées par joueur puis par pas.
   *
   * Une demande est appliquée **au pas qu'elle porte**, jamais à celui où son
   * paquet arrive : sinon la chronologie de l'hôte serait décalée de celle du
   * client, et aucune prédiction ne pourrait tomber juste.
   */
  private readonly buffered = new Map<PlayerId, Map<number, InputFrame>>();
  /** Dernière demande appliquée, reprise quand celle du pas manque à l'appel. */
  private readonly lastApplied = new Map<PlayerId, InputFrame>();
  private readonly acked = new Map<PlayerId, number>();
  /** Les demandes appliquées au dernier pas — de quoi les enregistrer. */
  lastTick: Tick = [];

  constructor(seed: number, transport: Transport, localPlayer: PlayerId = 1, options: HostOptions = {}) {
    this.simulation = new Simulation(seed, [localPlayer]);
    this.transport = transport;
    this.localPlayer = localPlayer;
    this.stateEvery = options.stateEvery ?? 6;
    this.acked.set(localPlayer, 0);
    transport.onMessage((message) => this.receive(message));
  }

  setLocalInput(input: InputFrame): void {
    this.remember(this.localPlayer, this.simulation.stepCount + 1, input);
  }

  /** Un pas d'autorité. */
  advance(): void {
    const step = this.simulation.stepCount + 1;
    const tick: Tick = [];

    for (const player of this.simulation.players()) {
      const byStep = this.buffered.get(player);
      const exact = byStep?.get(step);

      if (exact) {
        // La demande du pas est arrivée à temps : on l'applique et on le dit.
        this.lastApplied.set(player, exact);
        this.acked.set(player, step);
      }
      // Sinon on reprend la dernière connue — un paquet perdu ne doit pas
      // figer le joueur — mais sans accuser réception : le client garde sa
      // demande et la rejouera, sans quoi elle serait perdue des deux côtés.
      const input = exact ?? this.lastApplied.get(player);
      if (input) tick.push({ player, ...input });

      byStep?.delete(step);
      if (byStep) for (const pending of byStep.keys()) if (pending < step) byStep.delete(pending);
    }

    this.lastTick = tick;
    this.simulation.step(tick);
    if (this.simulation.stepCount % this.stateEvery === 0) this.broadcastState();
  }

  private remember(player: PlayerId, step: number, input: InputFrame): void {
    let byStep = this.buffered.get(player);
    if (!byStep) {
      byStep = new Map();
      this.buffered.set(player, byStep);
    }
    byStep.set(step, input);
  }

  broadcastState(): void {
    this.transport.send({
      kind: 'state',
      step: this.simulation.stepCount,
      snapshot: this.simulation.snapshot(),
      acked: [...this.acked.entries()].sort((a, b) => a[0] - b[0]),
    });
  }

  private receive(message: Message): void {
    switch (message.kind) {
      case 'hello':
        // Un arrivant demande l'état ; on lui répond sans attendre le prochain
        // envoi périodique, sinon il resterait aveugle jusqu'à une centaine de
        // millisecondes.
        this.broadcastState();
        break;

      case 'join':
        this.simulation.addPlayer(message.player);
        if (!this.acked.has(message.player)) this.acked.set(message.player, 0);
        this.broadcastState();
        break;

      case 'leave':
        this.simulation.removePlayer(message.player);
        this.buffered.delete(message.player);
        this.lastApplied.delete(message.player);
        this.acked.delete(message.player);
        break;

      case 'input':
        // Un paquet dont le pas est déjà passé n'a plus de place dans
        // l'histoire : le retenir ferait reculer le joueur. On le laisse.
        if (message.step <= this.simulation.stepCount) return;
        this.remember(message.player, message.step, message.input);
        break;

      default:
        break;
    }
  }
}
