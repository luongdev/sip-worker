import { ClientManager } from "./client-manager";

export class MessageHandler {
  constructor(private readonly clientManager: ClientManager) {}

  handleClientInit(clientId: string, port: MessagePort): void {
    this.clientManager.registerClient(clientId, port);

    this.clientManager.sendToClient(clientId, {
      type: "WORKER_READY",
      timestamp: Date.now(),
      connectedClients: this.clientManager.getClientCount(),
    });

    this.notifyClientsAboutConnection(clientId);
  }

  handlePing(clientId: string): void {
    this.clientManager.sendToClient(clientId, {
      type: "PONG",
      timestamp: Date.now(),
    });
  }

  handleClientDisconnect(clientId: string): void {
    this.clientManager.unregisterClient(clientId);

    // Notify other clients about disconnection
    this.clientManager.broadcastToAllClients({
      type: "CLIENT_DISCONNECTED",
      clientId,
      totalClients: this.clientManager.getClientCount(),
      timestamp: Date.now(),
    });
  }

  private notifyClientsAboutConnection(clientId: string): void {
    this.clientManager.broadcastToAllClients({
      type: "CLIENT_CONNECTED",
      clientId,
      totalClients: this.clientManager.getClientCount(),
      timestamp: Date.now(),
    });
  }
}
