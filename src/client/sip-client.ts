import {
  InitializeResult,
  Message,
  MessageHandlerCallback,
} from "../common/types";
import { ISipClient, SipClientOptions } from "./types";

export const DefaultClientOptions: SipClientOptions = {
  connectTimeout: 5000,
  pingInterval: 10000,
  pingTimeout: 3000,
};

export class SipClient implements ISipClient {
  private worker?: SharedWorker;
  private port?: MessagePort;
  private _onMessage?: MessageHandlerCallback;

  private readonly clientId: string;
  private readonly options: SipClientOptions;
  constructor(options?: SipClientOptions) {
    this.clientId = `client_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    this.options = { ...DefaultClientOptions, ...options };
  }

  set onMessage(handler: MessageHandlerCallback) {
    this._onMessage = handler;
  }

  initialize(): Promise<InitializeResult> {
    return new Promise((resolve, reject) => {
      try {
        // Create SharedWorker
        this.worker = new SharedWorker(
          new URL("../worker/index.ts", import.meta.url),
          {
            type: "module",
            name: "sip-worker",
          }
        );

        this.port = this.worker.port;

        // Setup timeout
        const connectionTimeout = setTimeout(() => {
          reject(new Error("Connection to worker timed out"));
        }, this.options.connectTimeout);

        // Handle messages from worker
        this.port.onmessage = (event) => {
          const data = event.data as Message;

          if (data.type === "WORKER_READY") {
            clearTimeout(connectionTimeout);

            resolve({
              success: true,
              clientId: this.clientId,
              connectedClients: data.connectedClients || 1,
            });
          } else if (this._onMessage) {
            this._onMessage(data);
          }
        };

        // Handle errors
        this.port.onmessageerror = (event) => {
          console.error("Message port error:", event);
          reject(new Error("Connection error"));
        };

        // Start listening and send initialization
        this.port.start();
        this.port.postMessage({
          type: "CLIENT_INIT",
          clientId: this.clientId,
          timestamp: Date.now(),
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  ping(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.port) {
        reject(new Error("Not connected to worker"));
        return;
      }

      const pingTimeout = setTimeout(() => {
        reject(new Error("Ping timed out"));
      }, this.options.pingTimeout);

      const pongHandler = (event: MessageEvent) => {
        const data = event.data as Message;

        if (data.type === "PONG") {
          clearTimeout(pingTimeout);

          if (this.port) {
            this.port.removeEventListener("message", pongHandler);
          }

          resolve();
        }
      };

      if (this.port) {
        this.port.addEventListener("message", pongHandler);

        this.port.postMessage({
          type: "PING",
          clientId: this.clientId,
          timestamp: Date.now(),
        });
      }
    });
  }

  close(): void {
    if (this.port) {
      try {
        this.port.postMessage({
          type: "CLIENT_DISCONNECT",
          clientId: this.clientId,
          timestamp: Date.now(),
        });

        this.port.close();
        this.port = undefined;
        this.worker = undefined;
      } catch (error) {
        console.error("Error closing connection:", error);
      }
    }
  }
}
