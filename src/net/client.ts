import { Simulation } from '../core/simulation.ts';
import type { InputFrame, PlayerId, Tick } from '../core/simulation.ts';
import { compare } from '../core/replay.ts';
import type { Message, Transport } from './protocol.ts';

/**
 * Le client : il prédit, puis se corrige.
 *
 * Attendre la réponse de l'hôte rendrait le jeu injouable — une aller-retour
 * de latence à chaque touche. Le client simule donc immédiatement ses propres
 * demandes, et garde celles que l'hôte n'a pas encore confirmées.
 *
 * Quand un état d'autorité arrive, il reprend cet état puis **rejoue** ses
 * demandes non confirmées. C'est exactement ce que rendent possibles le pas
 * fixe, la sérialisation complète et le déterminisme construits plus tôt :
 * sans eux, cette réconciliation ne serait pas écrivable.
 */
export interface Correction {
  step: number;
  /** Vrai si l'état d'autorité différait de ce que le client avait prédit. */
  differed: boolean;
  firstDifference: string;
}

export interface ClientOptions {
  /**
   * Pas d'avance du client sur le dernier état reçu.
   *
   * Sans avance, une demande datée du pas courant arrive chez l'hôte alors
   * qu'il a déjà joué ce pas : elle est rejetée, et la prédiction ne peut
   * jamais tomber juste. Le client doit donc viser un peu dans le futur de
   * l'hôte. La bonne valeur dépend de la latence ; l'estimer en continu est
   * l'étape suivante, elle n'est pas faite ici.
   */
  lead?: number;
}

export class Client {
  readonly transport: Transport;
  readonly player: PlayerId;
  readonly seed: number;
  simulation: Simulation;
  /** Demandes envoyées mais pas encore confirmées par l'hôte. */
  private unacked: Array<{ step: number; input: InputFrame }> = [];
  private localInput: InputFrame = { x: 0, y: 0, build: false, harvest: false };
  private started = false;
  private readonly lead: number;
  lastCorrection: Correction | null = null;
  /** Écarts sur l'état complet — les autres joueurs en font partie. */
  corrections = 0;
  /**
   * Écarts sur sa propre entité.
   *
   * C'est la mesure qui juge la prédiction : un client ne connaît que ses
   * demandes, il ne peut pas deviner celles des autres. Voir bouger un autre
   * joueur autrement que prévu est normal ; se voir soi-même corrigé ne l'est
   * pas, et signale une chronologie ou un déterminisme cassés.
   */
  selfCorrections = 0;
  /** Recalages d'horloge : l'avance a changé, il n'y a rien à comparer. */
  resyncs = 0;

  constructor(seed: number, transport: Transport, player: PlayerId, options: ClientOptions = {}) {
    this.seed = seed;
    this.player = player;
    this.transport = transport;
    this.lead = options.lead ?? 6;
    // Aucun joueur au départ : les identités d'entités viennent de l'hôte.
    this.simulation = new Simulation(seed, []);
    transport.onMessage((message) => this.receive(message));
    transport.send({ kind: 'join', player });
  }

  /** Vrai dès qu'un état d'autorité a été reçu ; avant, il n'y a rien à prédire. */
  get ready(): boolean {
    return this.started;
  }

  setLocalInput(input: InputFrame): void {
    this.localInput = input;
  }

  /** Prédit un pas et envoie la demande correspondante. */
  advance(): void {
    if (!this.started) return;
    this.predictOne(this.localInput);
  }

  /** Simule un pas localement, en ayant d'abord annoncé la demande. */
  private predictOne(input: InputFrame): void {
    const step = this.simulation.stepCount + 1;
    const copy = { ...input };
    this.unacked.push({ step, input: copy });
    this.transport.send({ kind: 'input', player: this.player, step, input: copy });
    this.simulation.step([{ player: this.player, ...copy }]);
  }

  private receive(message: Message): void {
    if (message.kind !== 'state') return;

    // Un état plus ancien que celui déjà appliqué n'apprend rien.
    if (this.started && message.step < this.simulation.stepCount - this.unacked.length) return;

    const predicted = this.started ? this.simulation.snapshot() : null;
    const predictedSelf = this.started ? this.describeSelf() : null;
    const predictedStep = this.simulation.stepCount;

    this.simulation.restore(message.snapshot, message.step);
    this.started = true;

    const ackedForMe = message.acked.find(([player]) => player === this.player)?.[1] ?? 0;
    this.unacked = this.unacked.filter((entry) => entry.step > ackedForMe);

    // Rejeu des demandes non confirmées : le client revient là où il croyait
    // être, mais à partir d'un état dont l'hôte répond.
    const pending = [...this.unacked];
    this.unacked = [];
    for (const entry of pending) {
      this.unacked.push(entry);
      this.simulation.step([{ player: this.player, ...entry.input }] as Tick);
    }

    // Reprise de l'avance : les pas manquants sont simulés avec la demande
    // courante, et annoncés comme les autres — l'hôte doit les recevoir, sinon
    // il rejouerait autre chose que ce que le client a prédit.
    while (this.simulation.stepCount < message.step + this.lead) {
      this.predictOne(this.localInput);
    }

    if (!predicted) return;

    if (this.simulation.stepCount !== predictedStep) {
      // L'avance a changé : les deux états ne sont pas au même instant, et les
      // comparer dirait n'importe quoi.
      this.resyncs++;
      this.lastCorrection = { step: message.step, differed: false, firstDifference: '' };
      return;
    }

    if (predictedSelf !== null && predictedSelf !== this.describeSelf()) this.selfCorrections++;

    const result = compare(predicted, this.simulation.snapshot());
    this.lastCorrection = {
      step: message.step,
      differed: !result.identical,
      firstDifference: result.firstDifference,
    };
    if (!result.identical) this.corrections++;
  }

  /** L'état de sa propre entité, réduit à ce qui bouge. */
  private describeSelf(): string | null {
    const entity = this.simulation.entityOf(this.player);
    if (entity === null) return null;
    return JSON.stringify([
      this.simulation.stores.transform.get(entity),
      this.simulation.stores.velocity.get(entity),
      this.simulation.stores.inventory.get(entity),
    ]);
  }

  leave(): void {
    this.transport.send({ kind: 'leave', player: this.player });
  }
}
