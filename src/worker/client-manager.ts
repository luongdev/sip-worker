import { WorkerMessage, IClientManager } from "./types";

export class ClientManager implements IClientManager {
  private readonly clients = new Map<string, MessagePort>();

  registerClient(clientId: string, port: MessagePort): void {
    this.clients.set(clientId, port);
    console.log(`Client connected: ${clientId}`);
  }

  unregisterClient(clientId: string): void {
    if (this.hasClient(clientId)) {
      this.clients.delete(clientId);
      console.log(`Client disconnected: ${clientId}`);
    }
  }

  getClientPort(clientId: string): MessagePort | undefined {
    return this.clients.get(clientId);
  }

  hasClient(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  getClientCount(): number {
    return this.clients.size;
  }

  sendToClient(clientId: string, message: WorkerMessage): boolean {
    const port = this.getClientPort(clientId);
    if (!port) return false;

    try {
      port.postMessage(message);
      return true;
    } catch (error) {
      console.error(`Failed to send message to client ${clientId}:`, error);
      return false;
    }
  }

  broadcastToAllClients(message: WorkerMessage): void {
    this.clients.forEach((port, clientId) => {
      try {
        port.postMessage(message);
      } catch (error) {
        console.error(`Failed to broadcast to client ${clientId}:`, error);
      }
    });
  }

  getAllClientIds(): string[] {
    return Array.from(this.clients.keys());
  }
}
