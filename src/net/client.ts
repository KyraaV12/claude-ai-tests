import { Simulation } from '../core/simulation.ts';
import type { InputFrame, PlayerId, Tick } from '../core/simulation.ts';
import { compare } from '../core/replay.ts';
import type { Entity } from '../core/world.ts';
import { Smoothing } from './smoothing.ts';
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

/**
 * Pas entre deux réannonces tant que l'hôte n'a pas confirmé notre présence.
 *
 * Un demi-seconde : assez rare pour ne pas encombrer le canal, assez fréquent
 * pour qu'une entrée en jeu ne se fasse pas attendre.
 */
const JOIN_RETRY_STEPS = 30;

export class Client {
  readonly transport: Transport;
  readonly player: PlayerId;
  readonly seed: number;
  simulation: Simulation;
  /** Demandes envoyées mais pas encore confirmées par l'hôte. */
  private unacked: Array<{ step: number; input: InputFrame }> = [];
  private localInput: InputFrame = { x: 0, y: 0, build: false, harvest: false, torch: false };
  private started = false;
  /** Pas restants avant de redemander son entrée. */
  private joinTimer = JOIN_RETRY_STEPS;
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
  /**
   * Corrections où le monde comptait d'autres entités que prévu.
   *
   * Une bête apparue, une bête oubliée : ce sont des décisions de l'autorité,
   * pas des erreurs du client. Il ne les prend pas, il ne peut donc pas les
   * deviner — au même titre qu'il ne devine pas les touches d'un autre joueur.
   */
  rosterChanges = 0;
  /**
   * Corrections qu'aucune apparition n'explique.
   *
   * C'est **la** mesure qui juge la prédiction. Sur un monde dont la liste
   * d'entités n'a pas bougé, le client doit tomber juste : s'il se trompe là,
   * c'est la chronologie ou le déterminisme qui sont cassés.
   */
  mispredictions = 0;
  /**
   * Dernière demande connue de chaque joueur, telle que l'hôte l'a appliquée.
   *
   * Sert à extrapoler les autres personnages entre deux états, avec les mêmes
   * forces que chez l'hôte. Sans elle ils glissent en ligne droite, sans
   * accélération ni freinage, et se font recaler d'un coup.
   */
  private readonly remoteInputs = new Map<PlayerId, InputFrame>();
  /** Décalages d'affichage qui absorbent les corrections. Hors simulation. */
  readonly smoothing = new Smoothing();

  constructor(seed: number, transport: Transport, player: PlayerId, options: ClientOptions = {}) {
    this.seed = seed;
    this.player = player;
    this.transport = transport;
    this.lead = options.lead ?? 6;
    // Aucun joueur au départ : les identités d'entités viennent de l'hôte. Et
    // pas d'autorité : un client reçoit la faune, il ne l'invente pas.
    this.simulation = new Simulation(seed, [], { authority: false });
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
    this.announce();
    if (!this.started) return;
    this.predictOne(this.localInput);
  }

  /**
   * Redemande son entrée tant qu'on ne se voit pas dans l'état d'autorité.
   *
   * Un seul `join`, envoyé au départ, suffisait tant que le canal ne perdait
   * rien. Dès 5 % de pertes, il s'évapore parfois — et le joueur reste dehors
   * pour toujours, sans que rien ne le rejoue. La demande est idempotente chez
   * l'hôte : la répéter ne coûte que le paquet.
   */
  private announce(): void {
    if (this.started && this.simulation.entityOf(this.player) !== null) return;
    if (this.joinTimer > 0) {
      this.joinTimer--;
      return;
    }
    this.joinTimer = JOIN_RETRY_STEPS;
    this.transport.send({ kind: 'join', player: this.player });
  }

  /** Simule un pas localement, en ayant d'abord annoncé la demande. */
  private predictOne(input: InputFrame): void {
    const step = this.simulation.stepCount + 1;
    const copy = { ...input };
    this.unacked.push({ step, input: copy });
    this.transport.send({ kind: 'input', player: this.player, step, input: copy });
    this.simulation.step(this.tickWith(copy));
  }

  /**
   * La demande du pas : la sienne, plus la dernière connue de chacun des autres.
   *
   * Seul le déplacement est extrapolé. Rejouer une pose ou une récolte ferait
   * apparaître chez le client une construction fantôme, effacée à l'état
   * suivant : un clignotement pour rien. Les actions attendent l'autorité,
   * le mouvement n'attend pas.
   */
  private tickWith(own: InputFrame): Tick {
    const tick: Tick = [{ player: this.player, ...own }];
    for (const [player, remote] of this.remoteInputs) {
      if (player === this.player) continue;
      tick.push({ player, x: remote.x, y: remote.y, build: false, harvest: false, torch: false });
    }
    return tick;
  }

  private receive(message: Message): void {
    if (message.kind !== 'state') return;

    // Un état plus ancien que celui déjà appliqué n'apprend rien.
    if (this.started && message.step < this.simulation.stepCount - this.unacked.length) return;

    const predicted = this.started ? this.simulation.snapshot() : null;
    const predictedSelf = this.started ? this.describeSelf() : null;
    const predictedStep = this.simulation.stepCount;
    // Où l'on croyait que se trouvaient les autres, juste avant la correction.
    const before = this.started ? this.positionsOfOthers() : null;

    this.simulation.restore(message.snapshot, message.step);
    this.started = true;

    this.remoteInputs.clear();
    for (const [player, input] of message.inputs) this.remoteInputs.set(player, input);

    const ackedForMe = message.acked.find(([player]) => player === this.player)?.[1] ?? 0;
    this.unacked = this.unacked.filter((entry) => entry.step > ackedForMe);

    // Rejeu des demandes non confirmées : le client revient là où il croyait
    // être, mais à partir d'un état dont l'hôte répond.
    const pending = [...this.unacked];
    this.unacked = [];
    for (const entry of pending) {
      this.unacked.push(entry);
      this.simulation.step(this.tickWith(entry.input));
    }

    // Reprise de l'avance : les pas manquants sont simulés avec la demande
    // courante, et annoncés comme les autres — l'hôte doit les recevoir, sinon
    // il rejouerait autre chose que ce que le client a prédit.
    while (this.simulation.stepCount < message.step + this.lead) {
      this.predictOne(this.localInput);
    }

    // Ce dont les autres personnages viennent de sauter sans avoir bougé :
    // encaissé dans un décalage d'affichage qui fondra en une fraction de
    // seconde. La simulation, elle, garde la position exacte.
    if (before) {
      const after = this.positionsOfOthers();
      for (const [entity, was] of before) {
        const now = after.get(entity);
        if (now) this.smoothing.record(entity, now.x - was.x, now.y - was.y);
      }
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

    const settled = this.simulation.snapshot();
    const result = compare(predicted, settled);
    this.lastCorrection = {
      step: message.step,
      differed: !result.identical,
      firstDifference: result.firstDifference,
    };
    if (!result.identical) {
      this.corrections++;
      const sameRoster = JSON.stringify(predicted.entities) === JSON.stringify(settled.entities);
      if (sameRoster) this.mispredictions++;
      else this.rosterChanges++;
    }
  }

  /** Les positions de tout ce que le client ne pilote pas. */
  private positionsOfOthers(): Map<Entity, { x: number; y: number }> {
    const own = this.simulation.entityOf(this.player);
    const positions = new Map<Entity, { x: number; y: number }>();
    for (const [entity, transform] of this.simulation.stores.transform.entries()) {
      if (entity === own) continue;
      positions.set(entity, { x: transform.x, y: transform.y });
    }
    return positions;
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
