import type { Message, Transport } from './protocol.ts';

/**
 * Un réseau en mémoire, avec une latence qu'on avance à la main.
 *
 * Sans lui, le netcode ne serait vérifiable qu'à l'œil et dans un navigateur.
 * Ici, host et client tournent dans le même processus, les paquets partent et
 * arrivent quand on le décide, et la convergence s'assert.
 */
export class MemoryNetwork {
  readonly latencySteps: number;
  private readonly endpoints: MemoryTransport[] = [];
  private queue: Array<{ from: MemoryTransport; message: Message; due: number }> = [];
  private clock = 0;
  /** Paquets délibérément perdus, pour éprouver la robustesse. */
  dropNext = 0;

  constructor(latencySteps = 0) {
    this.latencySteps = latencySteps;
  }

  connect(): Transport {
    const endpoint = new MemoryTransport(this);
    this.endpoints.push(endpoint);
    return endpoint;
  }

  /** Fait avancer le réseau d'un pas et livre ce qui est arrivé à échéance. */
  advance(): void {
    this.clock++;
    const due = this.queue.filter((item) => item.due <= this.clock);
    this.queue = this.queue.filter((item) => item.due > this.clock);
    for (const item of due) {
      for (const endpoint of this.endpoints) {
        // Un message ne revient pas à son émetteur : c'est le comportement
        // d'un canal partagé, et s'en remettre à lui masquerait des bugs.
        if (endpoint !== item.from) endpoint.receive(item.message);
      }
    }
  }

  /** Livre tout ce qui traîne, quelle que soit l'échéance. */
  flush(): void {
    for (let i = 0; i <= this.latencySteps + 1; i++) this.advance();
  }

  get inFlight(): number {
    return this.queue.length;
  }

  publish(from: MemoryTransport, message: Message): void {
    if (this.dropNext > 0) {
      this.dropNext--;
      return;
    }
    // Copie profonde : un pair ne doit jamais partager un objet avec un autre,
    // sinon une mutation locale se propagerait sans passer par le réseau.
    this.queue.push({ from, message: structuredClone(message), due: this.clock + this.latencySteps });
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
  }
}
