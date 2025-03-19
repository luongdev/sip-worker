import { WorkerMessage, IClientManager } from "./types";
import { LoggerFactory } from "../logger";

// Tạo logger cho ClientManager
const logger = LoggerFactory.getInstance().getLogger("ClientManager");

export class ClientManager implements IClientManager {
  private readonly clients = new Map<string, MessagePort>();

  registerClient(clientId: string, port: MessagePort): void {
    this.clients.set(clientId, port);
    logger.info(`Client connected: ${clientId}`);
  }

  unregisterClient(clientId: string): void {
    if (this.hasClient(clientId)) {
      this.clients.delete(clientId);
      logger.info(`Client disconnected: ${clientId}`);
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
      logger.error(`Failed to send message to client ${clientId}:`, error);
      return false;
    }
  }

  broadcastToAllClients(message: WorkerMessage): void {
    this.clients.forEach((port, clientId) => {
      try {
        port.postMessage(message);
      } catch (error) {
        logger.error(`Failed to broadcast to client ${clientId}:`, error);
      }
    });
  }

  getAllClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  // Request/Response handling
  sendResponse(clientId: string, requestId: string, data: any, success: boolean = true): boolean {
    return this.sendToClient(clientId, {
      type: "RESPONSE",
      payload: {
        requestId,
        success,
        data
      },
      timestamp: Date.now()
    });
  }

  sendErrorResponse(clientId: string, requestId: string, error: string | Error): boolean {
    const errorMessage = error instanceof Error ? error.message : error;
    
    return this.sendToClient(clientId, {
      type: "RESPONSE",
      payload: {
        requestId,
        success: false,
        error: errorMessage
      },
      timestamp: Date.now()
    });
  }
} 