import { createRandom } from '../core/random.ts';
import type { Message, Transport } from './protocol.ts';

/**
 * Un réseau en mémoire dégradable, avancé à la main.
 *
 * Sans lui, le netcode ne serait vérifiable qu'à l'œil et dans un navigateur.
 * Ici host et clients tournent dans le même processus, les paquets partent et
 * arrivent quand on le décide, et la convergence s'assert.
 *
 * Toutes les dégradations sont **tirées d'un générateur à graine** : une perte
 * de paquet qui fait échouer un test se reproduit à l'identique. Un banc dont
 * les échecs ne se reproduisent pas ne sert à rien.
 */
export interface NetworkConditions {
  /** Retard de base, en pas de simulation. */
  latencySteps?: number;
  /** Variation aléatoire du retard, en pas. Le jitter désordonne aussi l'arrivée. */
  jitterSteps?: number;
  /** Proportion de paquets perdus, de 0 à 1. */
  lossRate?: number;
  /** Proportion de paquets livrés deux fois. */
  duplicateRate?: number;
  /** Proportion de paquets délibérément retardés d'un pas de plus. */
  reorderRate?: number;
  seed?: number;
}

interface Parcel {
  from: MemoryTransport;
  message: Message;
  due: number;
  /** Rang d'émission : départage les paquets échus au même instant. */
  order: number;
}

export class MemoryNetwork {
  readonly conditions: Required<NetworkConditions>;
  private readonly endpoints: MemoryTransport[] = [];
  private queue: Parcel[] = [];
  private clock = 0;
  private sequence = 0;
  private readonly random: () => number;

  /** Compteurs, pour que le banc puisse rapporter ce qui s'est réellement passé. */
  sent = 0;
  delivered = 0;
  dropped = 0;
  duplicated = 0;
  /** Octets émis, mesurés sur la sérialisation — la bande passante du test. */
  bytesSent = 0;
  /** Le plus gros paquet émis. C'est lui qui dira quand l'état complet devra céder au delta. */
  largestMessageBytes = 0;

  /** Paquets à perdre d'office, indépendamment du taux. */
  dropNext = 0;

  constructor(conditions: NetworkConditions | number = {}) {
    // Un nombre seul reste accepté : c'est la latence, comme avant.
    const c = typeof conditions === 'number' ? { latencySteps: conditions } : conditions;
    this.conditions = {
      latencySteps: c.latencySteps ?? 0,
      jitterSteps: c.jitterSteps ?? 0,
      lossRate: c.lossRate ?? 0,
      duplicateRate: c.duplicateRate ?? 0,
      reorderRate: c.reorderRate ?? 0,
      seed: c.seed ?? 1234,
    };
    this.random = createRandom(this.conditions.seed);
  }

  get latencySteps(): number {
    return this.conditions.latencySteps;
  }

  connect(): Transport {
    const endpoint = new MemoryTransport(this);
    this.endpoints.push(endpoint);
    return endpoint;
  }

  disconnect(transport: Transport): void {
    const index = this.endpoints.indexOf(transport as MemoryTransport);
    if (index >= 0) this.endpoints.splice(index, 1);
  }

  /** Fait avancer le réseau d'un pas et livre ce qui est arrivé à échéance. */
  advance(): void {
    this.clock++;
    const due = this.queue.filter((p) => p.due <= this.clock).sort((a, b) => a.due - b.due || a.order - b.order);
    this.queue = this.queue.filter((p) => p.due > this.clock);

    for (const parcel of due) {
      this.delivered++;
      for (const endpoint of this.endpoints) {
        // Un message ne revient pas à son émetteur : c'est le comportement d'un
        // canal partagé, et s'en remettre à lui masquerait des bugs.
        if (endpoint !== parcel.from) endpoint.receive(parcel.message);
      }
    }
  }

  /** Livre tout ce qui traîne, quelle que soit l'échéance. */
  flush(): void {
    const horizon = this.conditions.latencySteps + this.conditions.jitterSteps + 2;
    for (let i = 0; i <= horizon; i++) this.advance();
  }

  get inFlight(): number {
    return this.queue.length;
  }

  publish(from: MemoryTransport, message: Message): void {
    this.sent++;
    const size = JSON.stringify(message).length;
    this.bytesSent += size;
    this.largestMessageBytes = Math.max(this.largestMessageBytes, size);

    if (this.dropNext > 0) {
      this.dropNext--;
      this.dropped++;
      return;
    }
    if (this.conditions.lossRate > 0 && this.random() < this.conditions.lossRate) {
      this.dropped++;
      return;
    }

    // Copie profonde : un pair ne doit jamais partager un objet avec un autre,
    // sinon une mutation locale se propagerait sans passer par le réseau.
    const copy = structuredClone(message);
    this.enqueue(from, copy, this.delay());

    if (this.conditions.duplicateRate > 0 && this.random() < this.conditions.duplicateRate) {
      this.duplicated++;
      this.enqueue(from, structuredClone(message), this.delay());
    }
  }

  private delay(): number {
    const { latencySteps, jitterSteps, reorderRate } = this.conditions;
    let delay = latencySteps;
    if (jitterSteps > 0) delay += Math.round((this.random() * 2 - 1) * jitterSteps);
    if (reorderRate > 0 && this.random() < reorderRate) delay += 1;
    return Math.max(0, delay);
  }

  private enqueue(from: MemoryTransport, message: Message, delay: number): void {
    this.queue.push({ from, message, due: this.clock + delay, order: this.sequence++ });
  }
}

class MemoryTransport implements Transport {
  private readonly network: MemoryNetwork;
  private handler: ((message: Message) => void) | null = null;
  private closed = false;

  constructor(network: MemoryNetwork) {
    this.network = network;
  }

  send(message: Message): void {
    if (this.closed) return;
    this.network.publish(this, message);
  }

  onMessage(handler: (message: Message) => void): void {
    this.handler = handler;
  }

  receive(message: Message): void {
    if (!this.closed) this.handler?.(message);
  }

  close(): void {
    this.closed = true;
    this.handler = null;
    this.network.disconnect(this);
  }
}

export { MemoryTransport };
