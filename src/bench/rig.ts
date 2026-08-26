import { Simulation } from '../core/simulation.ts';
import type { InputFrame, PlayerId } from '../core/simulation.ts';
import { MemoryNetwork } from '../net/memory-transport.ts';
import type { NetworkConditions } from '../net/memory-transport.ts';
import { Host } from '../net/host.ts';
import { Client } from '../net/client.ts';
import { STEPS_PER_SECOND, STEP_SECONDS } from '../core/simulation.ts';
import { sha256 } from './hash.ts';

/**
 * Un banc réseau complet, monté en mémoire.
 *
 * Un hôte, N clients, un canal dégradable entre eux, et une boucle qu'on
 * avance à la main. Aucune horloge murale ne pilote quoi que ce soit : le
 * temps du banc, c'est le nombre de pas.
 *
 * Les mesures prises ici — pas par seconde, octets, corrections, écart — sont
 * les seules réponses honnêtes aux questions « ça tient à huit ? » et « ça
 * tient à 500 ms ? ». Les deviner ne coûterait rien et ne prouverait rien.
 */

export const STILL: InputFrame = { x: 0, y: 0, build: false, harvest: false };
export const EAST: InputFrame = { x: 1, y: 0, build: false, harvest: false };
export const WEST: InputFrame = { x: -1, y: 0, build: false, harvest: false };
export const NORTH: InputFrame = { x: 0, y: -1, build: false, harvest: false };
export const SOUTH: InputFrame = { x: 0, y: 1, build: false, harvest: false };

/** Ce que chaque joueur demande à un pas donné. Pure : le banc doit se rejouer. */
export type Script = (player: PlayerId, step: number) => InputFrame;

export const idle: Script = () => STILL;

/**
 * Chacun part dans sa direction, récolte, puis bâtit.
 *
 * Un scénario de vie ordinaire, dérivé de l'identifiant du joueur : pas de
 * hasard, donc reproductible, et suffisamment varié pour que la réplication
 * ait quelque chose à répliquer.
 */
export function busy(player: PlayerId, step: number): InputFrame {
  const angle = player * 2.399963;
  const phase = (step + player * 37) % 240;
  if (phase < 140) {
    return { x: Math.cos(angle), y: Math.sin(angle), build: false, harvest: false };
  }
  if (phase < 200) return { x: 0, y: 0, build: false, harvest: true };
  return { x: 0, y: 0, build: true, harvest: false };
}

export interface RigOptions {
  seed?: number;
  /** Nombre total de joueurs, hôte compris. */
  players?: number;
  conditions?: NetworkConditions | number;
  stateEvery?: number;
  timeoutSteps?: number;
  lead?: number;
}

export interface RigMetrics {
  players: number;
  steps: number;
  /** Pas d'autorité par seconde de temps machine — le « tick serveur ». */
  hostStepsPerSecond: number;
  /**
   * Pas de prédiction par seconde et par client.
   *
   * Ce n'est pas un nombre d'images par seconde : le rendu n'existe pas ici.
   * C'est ce qu'un client peut simuler, donc le plafond au-dessus duquel
   * aucune boucle d'affichage ne pourra monter.
   */
  clientStepsPerSecond: number;
  latencyMs: number;
  corrections: number;
  selfCorrections: number;
  resyncs: number;
  packetsSent: number;
  packetsDropped: number;
  packetsDuplicated: number;
  bytesSent: number;
  /** Octets par seconde de temps simulé, tous pairs confondus. */
  bytesPerSecond: number;
  /** Entités répliquées, c'est-à-dire présentes dans l'état d'autorité. */
  replicatedEntities: number;
  /** Plus grand écart de position entre la vue de l'hôte et celle d'un client. */
  divergence: number;
}

export class Rig {
  readonly net: MemoryNetwork;
  readonly host: Host;
  readonly clients: Client[] = [];
  readonly seed: number;
  private readonly lead: number | undefined;
  private stepsRun = 0;
  private hostMillis = 0;
  private clientMillis = 0;

  constructor(options: RigOptions = {}) {
    const players = options.players ?? 2;
    this.seed = options.seed ?? 20260826;
    this.lead = options.lead;
    this.net = new MemoryNetwork(options.conditions ?? {});
    this.host = new Host(this.seed, this.net.connect(), 1, {
      stateEvery: options.stateEvery ?? 6,
      timeoutSteps: options.timeoutSteps ?? 180,
    });
    for (let player = 2; player <= players; player++) this.join(player);
  }

  /** Fait entrer un client. Utilisé au montage comme à la reconnexion. */
  join(player: PlayerId): Client {
    const client = new Client(this.seed, this.net.connect(), player, this.lead ? { lead: this.lead } : {});
    this.clients.push(client);
    return client;
  }

  clientOf(player: PlayerId): Client | undefined {
    return this.clients.find((c) => c.player === player);
  }

  /**
   * Coupe un client.
   *
   * `annonce` distingue les deux vraies façons de partir : refermer la fenêtre,
   * qui prévient, et perdre le réseau, qui ne prévient pas. L'hôte doit tenir
   * les deux — la seconde ne se découvre que par le silence.
   */
  disconnect(player: PlayerId, announce = true): void {
    const client = this.clientOf(player);
    if (!client) return;
    // Le message de départ est déjà en vol : fermer le point d'accès ne le
    // reprend pas, il sera livré aux autres comme n'importe quel paquet.
    if (announce) client.leave();
    client.transport.close();
    this.clients.splice(this.clients.indexOf(client), 1);
  }

  /** Un pas : livraison réseau, prédiction des clients, pas d'autorité. */
  step(script: Script): void {
    this.net.advance();
    const step = this.host.simulation.stepCount + 1;

    this.host.setLocalInput(script(this.host.localPlayer, step));
    for (const client of this.clients) client.setLocalInput(script(client.player, step));

    const beforeClients = performance.now();
    for (const client of this.clients) client.advance();
    // Une image par pas : le lissage d'affichage fond au même rythme que dans
    // le navigateur à soixante images par seconde.
    for (const client of this.clients) client.smoothing.decay(STEP_SECONDS);
    const betweenHalves = performance.now();
    this.host.advance();
    const afterHost = performance.now();

    this.clientMillis += betweenHalves - beforeClients;
    this.hostMillis += afterHost - betweenHalves;
    this.stepsRun++;
  }

  run(steps: number, script: Script = idle): void {
    for (let i = 0; i < steps; i++) this.step(script);
  }

  /**
   * Laisse tout se poser : plus rien en vol, plus personne en mouvement.
   *
   * Un nombre fixe de pas ne suffirait pas. Le client prédit toujours quelques
   * pas devant l'hôte ; tant qu'un personnage bouge encore, cette avance se lit
   * comme un écart de position — et l'écart mesuré dépendrait alors de la durée
   * choisie plutôt que de l'état du réseau. On attend donc l'arrêt réel.
   */
  settle(maxSteps = 400): void {
    for (let i = 0; i < maxSteps; i++) {
      this.step(idle);
      if (i > 30 && this.fastestPlayer() < 1) break;
    }
    this.net.flush();
    this.run(6, idle);
  }

  /** La plus grande vitesse parmi les personnages, chez l'hôte. */
  private fastestPlayer(): number {
    let fastest = 0;
    for (const player of this.host.simulation.players()) {
      const entity = this.host.simulation.entityOf(player);
      if (entity === null) continue;
      const v = this.host.simulation.stores.velocity.get(entity);
      if (v) fastest = Math.max(fastest, Math.hypot(v.x, v.y));
    }
    return fastest;
  }

  /** Le plus grand écart de position entre l'hôte et la vue qu'en ont les clients. */
  divergence(only?: PlayerId): number {
    let worst = 0;
    for (const client of this.clients) {
      for (const player of this.host.simulation.players()) {
        if (only !== undefined && player !== only) continue;
        const here = this.host.simulation.entityOf(player);
        const there = client.simulation.entityOf(player);
        if (here === null || there === null) continue;
        const a = this.host.simulation.stores.transform.get(here);
        const b = client.simulation.stores.transform.get(there);
        if (!a || !b) continue;
        worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    return worst;
  }

  metrics(): RigMetrics {
    const seconds = this.stepsRun / STEPS_PER_SECOND;
    const clients = Math.max(1, this.clients.length);
    return {
      players: this.host.simulation.players().length,
      steps: this.stepsRun,
      hostStepsPerSecond: this.hostMillis > 0 ? Math.round(this.stepsRun / (this.hostMillis / 1000)) : 0,
      clientStepsPerSecond:
        this.clientMillis > 0 ? Math.round(this.stepsRun / (this.clientMillis / clients / 1000)) : 0,
      latencyMs: Math.round((this.net.conditions.latencySteps / STEPS_PER_SECOND) * 1000),
      corrections: this.clients.reduce((sum, c) => sum + c.corrections, 0),
      selfCorrections: this.clients.reduce((sum, c) => sum + c.selfCorrections, 0),
      resyncs: this.clients.reduce((sum, c) => sum + c.resyncs, 0),
      packetsSent: this.net.sent,
      packetsDropped: this.net.dropped,
      packetsDuplicated: this.net.duplicated,
      bytesSent: this.net.bytesSent,
      bytesPerSecond: seconds > 0 ? Math.round(this.net.bytesSent / seconds) : 0,
      replicatedEntities: this.host.simulation.world.entityCount,
      divergence: this.divergence(),
    };
  }
}

/**
 * Où un client *dessine* un personnage : la simulation, plus son décalage.
 *
 * C'est cette position-là que voit le joueur, et donc la seule où mesurer la
 * fluidité. La position simulée, elle, encaisse les recalages d'horloge du
 * réseau — elle est exacte, pas continue.
 */
export function displayedPosition(client: Client, player: PlayerId): { x: number; y: number } | null {
  const entity = client.simulation.entityOf(player);
  if (entity === null) return null;
  const transform = client.simulation.stores.transform.get(entity);
  if (!transform) return null;
  const offset = client.smoothing.offsetOf(entity);
  return { x: transform.x + (offset?.x ?? 0), y: transform.y + (offset?.y ?? 0) };
}

/**
 * L'empreinte de ce qui ne doit jamais diverger.
 *
 * Positions et vitesses bougent en permanence : un client qui prédit est
 * toujours quelques pas devant l'hôte, et exiger l'égalité stricte reviendrait
 * à interdire la prédiction. Restent l'inventaire, les constructions et les
 * récoltes — de l'état discret, acquis, que rien ne doit altérer. C'est là que
 * se juge une resynchronisation.
 */
export function stableDigest(simulation: Simulation): string {
  const structures = [...simulation.stores.structure.entries()]
    .map(([entity, structure]) => {
      const t = simulation.stores.transform.get(entity);
      // Une case de huit unités : bien plus grossière que toute dérive de
      // collision, bien plus fine que l'espacement des constructions.
      return `${Math.round((t?.x ?? 0) / 8)},${Math.round((t?.y ?? 0) / 8)}@${structure.placedAtStep}`;
    })
    .sort();

  const harvested = [...simulation.stores.harvested.entries()]
    .map(([, mark]) => `${mark.cx},${mark.cy},${mark.index}`)
    .sort();

  const inventories = simulation
    .players()
    .map((player) => {
      const entity = simulation.entityOf(player);
      return `${player}:${entity === null ? '-' : (simulation.stores.inventory.get(entity)?.blocs ?? '-')}`;
    })
    .sort();

  return sha256(JSON.stringify({ structures, harvested, inventories }));
}
