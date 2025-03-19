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
  // Quản lý client
  registerClient(clientId: string, port: MessagePort): void;
  unregisterClient(clientId: string): void;
  getClientPort(clientId: string): MessagePort | undefined;
  hasClient(clientId: string): boolean;
  getClientCount(): number;
  
  // Gửi tin nhắn
  sendToClient(clientId: string, message: WorkerMessage): boolean;
  broadcastToAllClients(message: WorkerMessage): void;
  getAllClientIds(): string[];
  
  // Xử lý request/response
  sendResponse(clientId: string, requestId: string, data: any, success?: boolean): boolean;
  sendErrorResponse(clientId: string, requestId: string, error: string | Error): boolean;
}

export interface WorkerSessionDescriptionHandlerOptions {
  clientId?: string;
  iceGatheringTimeout?: number;
  trickleCandidates?: boolean;
}

export interface CallManager {
  // Trạng thái cuộc gọi
  isCallInProgress(): boolean;
  hasIncomingCall(): boolean;
  
  // Quản lý dữ liệu cuộc gọi
  setActiveCall(callData: any): void;
  updateActiveCall(updates: any): boolean;
  getActiveCall(): any | null;
  clearActiveCall(): void;
  
  // Trạng thái
  getCurrentState(): any;
} 