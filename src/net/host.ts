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
  /**
   * Pas sans nouvelle d'un joueur avant de le déclarer absent.
   *
   * 180 pas ≈ trois secondes. En deçà, une rafale de paquets perdus
   * suffirait à éjecter quelqu'un qui joue.
   */
  timeoutSteps?: number;
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
  /** Dernier pas où l'on a eu des nouvelles de chaque joueur. */
  private readonly lastSeen = new Map<PlayerId, number>();
  private readonly absent = new Set<PlayerId>();
  private readonly timeoutSteps: number;

  constructor(seed: number, transport: Transport, localPlayer: PlayerId = 1, options: HostOptions = {}) {
    this.simulation = new Simulation(seed, [localPlayer]);
    this.transport = transport;
    this.localPlayer = localPlayer;
    this.stateEvery = options.stateEvery ?? 6;
    this.timeoutSteps = options.timeoutSteps ?? 180;
    this.acked.set(localPlayer, 0);
    this.lastSeen.set(localPlayer, 0);
    transport.onMessage((message) => this.receive(message));
  }

  setLocalInput(input: InputFrame): void {
    this.remember(this.localPlayer, this.simulation.stepCount + 1, input);
    this.lastSeen.set(this.localPlayer, this.simulation.stepCount);
    this.absent.delete(this.localPlayer);
  }

  /** Les joueurs dont on n'a plus de nouvelles. Leur personnage reste en place. */
  absentPlayers(): PlayerId[] {
    return [...this.absent].sort((a, b) => a - b);
  }

  connectedPlayers(): PlayerId[] {
    return this.simulation.players().filter((p) => !this.absent.has(p));
  }

  /** Un pas d'autorité. */
  advance(): void {
    const step = this.simulation.stepCount + 1;
    this.detectTimeouts(step);
    const tick: Tick = [];

    for (const player of this.simulation.players()) {
      // Un joueur absent ne pilote plus rien, mais son personnage doit
      // s'arrêter. Sans aucune demande, aucun freinage ne lui est appliqué et
      // il file tout droit à l'infini : une demande vide, c'est exactement
      // « lâcher les touches ». Il reste au monde, et son inventaire, ses
      // constructions et ce qu'il a récolté demeurent — ce sont des entités
      // comme les autres.
      if (this.absent.has(player)) {
        tick.push({ player, x: 0, y: 0, build: false, harvest: false });
        continue;
      }

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

  /**
   * Déclare absents ceux dont on n'a plus de nouvelles.
   *
   * On efface leur dernière demande connue plutôt que de la répéter : sans ça,
   * un joueur déconnecté en pleine course continuerait tout droit à jamais.
   */
  private detectTimeouts(step: number): void {
    for (const player of this.simulation.players()) {
      if (this.absent.has(player)) continue;
      const seen = this.lastSeen.get(player);
      if (seen === undefined || step - seen <= this.timeoutSteps) continue;
      this.absent.add(player);
      this.lastApplied.delete(player);
      this.buffered.delete(player);
    }
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
        // Retrouvailles ou première venue, même chemin : addPlayer rend
        // l'entité existante si elle est là. Un revenant récupère donc son
        // personnage, son inventaire et tout ce qu'il avait bâti.
        this.simulation.addPlayer(message.player);
        if (!this.acked.has(message.player)) this.acked.set(message.player, 0);
        this.absent.delete(message.player);
        this.lastSeen.set(message.player, this.simulation.stepCount);
        this.broadcastState();
        break;

      case 'leave':
        // Partir n'est pas disparaître : le personnage reste au monde. Le
        // détruire ferait s'évaporer un inventaire et rendrait toute
        // reconnexion inutile.
        this.absent.add(message.player);
        this.lastApplied.delete(message.player);
        this.buffered.delete(message.player);
        break;

      case 'input':
        // Un paquet dont le pas est déjà passé n'a plus de place dans
        // l'histoire : le retenir ferait reculer le joueur. On le laisse.
        this.lastSeen.set(message.player, this.simulation.stepCount);
        this.absent.delete(message.player);
        if (message.step <= this.simulation.stepCount) return;
        this.remember(message.player, message.step, message.input);
        break;

      default:
        break;
    }
  }
}
