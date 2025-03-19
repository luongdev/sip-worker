import { Message } from "../common/types";

export interface WorkerMessage extends Message {
  clientId?: string;
}

export interface ClientConnection {
  port: MessagePort;
  id: string;
  connected: boolean;
}

export interface IClientManager {
  registerClient(clientId: string, port: MessagePort): void;
  unregisterClient(clientId: string): void;
  getClientPort(clientId: string): MessagePort | undefined;
  hasClient(clientId: string): boolean;
  getClientCount(): number;
  sendToClient(clientId: string, message: WorkerMessage): boolean;
  broadcastToAllClients(message: WorkerMessage): void;
  getAllClientIds(): string[];
}
