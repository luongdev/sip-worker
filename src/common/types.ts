export type MessageType =
  | "CLIENT_INIT"
  | "WORKER_READY"
  | "CLIENT_CONNECTED"
  | "CLIENT_DISCONNECTED"
  | "CLIENT_DISCONNECT"
  | "PING"
  | "PONG"
  | "ERROR";

export interface Message {
  type: MessageType;
  timestamp?: number;
  [key: string]: any;
}

export interface InitializeResult {
  success: boolean;
  clientId: string;
  connectedClients: number;
}

export type MessageHandlerCallback = (message: Message) => void;
