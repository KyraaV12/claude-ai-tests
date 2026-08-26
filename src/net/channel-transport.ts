import type { Message, Transport } from './protocol.ts';

/**
 * Transport par `BroadcastChannel` : deux onglets du même navigateur.
 *
 * C'est un vrai transport — asynchrone, sans retour à l'émetteur, sujet aux
 * ordres d'arrivée — mais il ne franchit pas la machine. Il tient lieu de
 * banc d'essai du netcode sur un site statique, où aucun serveur ne peut
 * vivre. Un WebSocket ou un WebRTC se substitue ici sans toucher au reste :
 * c'est tout l'intérêt d'avoir passé le netcode par cette interface.
 */
export class ChannelTransport implements Transport {
  private readonly channel: BroadcastChannel;

  constructor(name = 'claude-ai-tests/monde') {
    this.channel = new BroadcastChannel(name);
  }

  send(message: Message): void {
    this.channel.postMessage(message);
  }

  onMessage(handler: (message: Message) => void): void {
    this.channel.onmessage = (event: MessageEvent) => handler(event.data as Message);
  }

  close(): void {
    this.channel.onmessage = null;
    this.channel.close();
  }
}
