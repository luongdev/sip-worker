import {
  Message,
  MessageHandlerCallback,
  InitializeResult,
} from "../common/types";

export interface ClientMessage extends Message {
  clientId?: string;
}

export interface ISipClient {
  onMessage: MessageHandlerCallback | null;
  initialize(): Promise<InitializeResult>;
  ping(): Promise<void>;
  close(): void;
}

export type SipClientOptions = {
  connectTimeout?: number;
  pingInterval?: number;
  pingTimeout?: number;
};
