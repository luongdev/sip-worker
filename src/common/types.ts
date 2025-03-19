export type MessageType =
  | "CLIENT_INIT"
  | "WORKER_READY"
  | "CLIENT_CONNECTED"
  | "CLIENT_DISCONNECTED"
  | "CLIENT_DISCONNECT"
  | "PING"
  | "PONG"
  | "ERROR"
  | "COMMAND"
  | "EVENT";

export interface Message {
  type: MessageType;
  timestamp?: number;
  [key: string]: any;
}

export interface Command extends Message {
  type: "COMMAND";
  payload: CommandPayload;
}

export interface CommandPayload {
  command: string;
  data: any;
}

export interface Event extends Message {
  type: "EVENT";
  payload: EventPayload;
}

export interface EventPayload {
  eventName: string;
  data: any;
}

export interface InitializeResult {
  success: boolean;
  clientId: string;
  connectedClients: number;
}

export type MessageHandlerCallback = (message: Message) => void;
