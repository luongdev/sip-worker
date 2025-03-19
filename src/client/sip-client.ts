import {
  Message,
  MessageHandlerCallback,
  InitializeResult,
  RequestMessage,
  ResponseMessage
} from "../common/types";
import { ISipClient, SipClientOptions, ClientMessage } from "./types";
import { LoggerFactory } from "../logger";

// Tạo logger cho SipClient
const logger = LoggerFactory.getInstance().getLogger("SipClient");

export const DefaultClientOptions: SipClientOptions = {
  connectTimeout: 5000,
  pingInterval: 10000,
  pingTimeout: 3000,
  autoReconnect: true,
  reconnectInterval: 5000,
  maxReconnectAttempts: 3
};

export class SipClient implements ISipClient {
  private worker?: SharedWorker;
  private port?: MessagePort;
  private _eventHandlers: Map<string, Set<Function>> = new Map();
  
  private readonly clientId: string;
  private readonly options: SipClientOptions;
  private connected: boolean = false;
  private pendingRequests: Map<string, { 
    resolve: Function, 
    reject: Function, 
    timeoutId?: number 
  }> = new Map();
  private requestCounter: number = 0;

  constructor(options?: SipClientOptions) {
    this.clientId = `client_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    this.options = { ...DefaultClientOptions, ...options };
  }

  // Event handling
  on(event: string, handler: Function): void {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event)?.add(handler);
  }

  off(event: string, handler: Function): void {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this._eventHandlers.delete(event);
      }
    }
  }

  private emitEvent(event: string, ...args: any[]): void {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(...args);
        } catch (error) {
          logger.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  // Phương thức cốt lõi
  initialize(): Promise<InitializeResult> {
    return new Promise((resolve, reject) => {
      try {
        logger.info("Initializing SIP Client...");
        
        // Tạo SharedWorker
        this.worker = new SharedWorker(
          new URL("../worker/index.ts", import.meta.url),
          {
            type: "module",
            name: "sip-worker"
          }
        );

        this.port = this.worker.port;

        // Thiết lập timeout
        const connectionTimeout = setTimeout(() => {
          reject(new Error("Connection to worker timed out"));
        }, this.options.connectTimeout);

        // Xử lý messages từ worker
        this.port.onmessage = this.handleWorkerMessage.bind(this);

        // Bắt đầu lắng nghe và gửi thông tin khởi tạo
        this.port.start();
        this.port.postMessage({
          type: "CLIENT_CONNECTED",
          clientId: this.clientId,
          timestamp: Date.now()
        });

        // Lưu promise để resolve sau khi STATE_UPDATE được nhận
        this.pendingRequests.set("initialize", {
          resolve: (result: InitializeResult) => {
            clearTimeout(connectionTimeout);
            this.connected = true;
            resolve(result);
          },
          reject: (error: Error) => {
            clearTimeout(connectionTimeout);
            this.connected = false;
            reject(error);
          },
          timeoutId: connectionTimeout as unknown as number
        });
      } catch (error) {
        logger.error("Error initializing client:", error);
        reject(error);
      }
    });
  }

  connect(): Promise<void> {
    if (this.connected) {
      return Promise.resolve();
    }
    return this.initialize().then(() => {});
  }

  sendMessage(message: ClientMessage): boolean {
    if (!this.port || !this.connected) {
      logger.error("Cannot send message: client not connected");
      return false;
    }

    try {
      // Đảm bảo mọi message đều có clientId
      const messageWithClientId = {
        ...message,
        clientId: this.clientId,
        timestamp: message.timestamp || Date.now()
      };

      this.port.postMessage(messageWithClientId);
      return true;
    } catch (error) {
      logger.error("Error sending message:", error);
      return false;
    }
  }

  // Request/Response
  request<T = any>(action: string, payload?: any, timeout: number = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.port) {
        reject(new Error("Not connected to worker"));
        return;
      }

      const requestId = `req_${this.clientId}_${Date.now()}_${++this.requestCounter}`;
      
      // Thiết lập timeout
      const timeoutId = setTimeout(() => {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          pending.reject(new Error(`Request timed out: ${action}`));
          this.pendingRequests.delete(requestId);
        }
      }, timeout);

      // Lưu promise và resolvers
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeoutId: timeoutId as unknown as number
      });

      // Gửi request
      this.sendMessage({
        type: "REQUEST",
        requestId,
        action,
        payload
      });
    });
  }

  // Kiểm tra trạng thái
  getClientId(): string {
    return this.clientId;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // Quản lý cuộc gọi
  makeCall(target: string, options?: any): boolean {
    return this.sendMessage({
      type: "MAKE_CALL",
      payload: {
        target,
        options
      }
    });
  }

  answerCall(options?: any): boolean {
    return this.sendMessage({
      type: "ANSWER_CALL",
      payload: {
        options
      }
    });
  }

  endCall(): boolean {
    return this.sendMessage({
      type: "END_CALL"
    });
  }

  // Đóng kết nối
  close(): void {
    if (this.port) {
      try {
        // Thông báo ngắt kết nối đến worker
        this.sendMessage({
          type: "CLIENT_DISCONNECTED"
        });

        // Đóng các request đang chờ
        this.pendingRequests.forEach((pending, key) => {
          if (pending.timeoutId) {
            clearTimeout(pending.timeoutId);
          }
          pending.reject(new Error("Connection closed"));
        });
        this.pendingRequests.clear();

        // Đóng port
        this.port.close();
        this.port = undefined;
        this.worker = undefined;
        this.connected = false;

        logger.info("Client disconnected from worker");
      } catch (error) {
        logger.error("Error closing connection:", error);
      }
    }
  }

  // Xử lý messages từ worker
  private handleWorkerMessage(event: MessageEvent): void {
    const message = event.data as Message;
    
    if (!message || !message.type) {
      logger.error("Received invalid message from worker:", event.data);
      return;
    }

    logger.debug(`Received message from worker: ${message.type}`);

    switch (message.type) {
      case "STATE_UPDATE":
        // Khởi tạo hoàn tất
        const pending = this.pendingRequests.get("initialize");
        if (pending) {
          pending.resolve({
            success: true,
            clientId: this.clientId,
            connectedClients: message.payload?.totalClients || 1
          });
          this.pendingRequests.delete("initialize");
        }
        
        // Emit event
        this.emitEvent("stateUpdate", message.payload);
        break;

      case "RESPONSE":
        this.handleResponse(message as ResponseMessage);
        break;

      default:
        // Emit event cho các loại tin nhắn khác
        this.emitEvent(message.type.toLowerCase(), message.payload);
        break;
    }
  }

  private handleResponse(response: ResponseMessage): void {
    if (!response.payload) {
      logger.error("Received invalid response format:", response);
      return;
    }
    
    const { requestId, success, data, error } = response.payload;
    
    // Kiểm tra requestId hợp lệ
    if (!requestId) {
      logger.error("Response missing requestId:", response);
      return;
    }
    
    const pending = this.pendingRequests.get(requestId);

    if (pending) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }

      if (success) {
        pending.resolve(data);
      } else {
        pending.reject(new Error(error || "Unknown error"));
      }

      this.pendingRequests.delete(requestId);
    } else {
      logger.warn(`Received response for unknown request: ${requestId}`);
    }
  }
} 