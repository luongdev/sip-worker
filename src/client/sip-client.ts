import {
  Message,
  InitializeResult,
  ResponseMessage,
  SipConfig,
  MessageType,
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
  maxReconnectAttempts: 3,
};

export class SipClient implements ISipClient {
  private worker?: SharedWorker;
  private port?: MessagePort;
  private connected: boolean = false;

  private readonly clientId: string;
  private readonly options: SipClientOptions;
  private readonly eventHandlers: Map<string, Set<Function>> = new Map();
  private readonly pendingRequests: Map<
    string,
    {
      resolve: Function;
      reject: Function;
      timeoutId?: number;
    }
  > = new Map();
  private requestCounter: number = 0;

  // SIP state
  private sipInitialized: boolean = false;
  private sipConnected: boolean = false;
  private sipRegistered: boolean = false;

  constructor(options?: SipClientOptions) {
    this.clientId = `client_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    this.options = { ...DefaultClientOptions, ...options };
  }

  // Event handling
  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)?.add(handler);
  }

  off(event: string, handler: Function): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  private emitEvent(event: string, ...args: any[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
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
            name: "sip-worker",
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
          type: MessageType.CLIENT_CONNECTED,
          clientId: this.clientId,
          timestamp: Date.now(),
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
          timeoutId: connectionTimeout as unknown as number,
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
        timestamp: message.timestamp || Date.now(),
      };

      this.port.postMessage(messageWithClientId);
      return true;
    } catch (error) {
      logger.error("Error sending message:", error);
      return false;
    }
  }

  // Request/Response
  request<T = any>(action: string, payload?: any, timeout = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.port) {
        reject(new Error("Not connected to worker"));
        return;
      }

      const requestId = `req_${this.clientId}_${Date.now()}_${++this
        .requestCounter}`;

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
        timeoutId: timeoutId as unknown as number,
      });

      // Gửi request
      this.sendMessage({
        type: MessageType.REQUEST,
        requestId,
        action,
        payload,
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

  // SIP Methods

  /**
   * Khởi tạo SIP với cấu hình
   * @param config Cấu hình SIP
   */
  initializeSip(config: SipConfig): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error("Not connected to worker"));
        return;
      }

      const requestId = `sip_init_${Date.now()}`;

      // Tăng timeout lên 30 giây vì khởi tạo SIP có thể mất nhiều thời gian
      const sipInitTimeout = 30000; // 30 seconds

      logger.debug(
        `Setting up SIP initialization with timeout ${sipInitTimeout}ms`
      );

      // Thiết lập timeout
      const timeoutId = setTimeout(() => {
        logger.error(`SIP initialization timed out after ${sipInitTimeout}ms`);
        this.pendingRequests.delete(requestId);
        reject(new Error("SIP initialization timed out"));
      }, sipInitTimeout);

      // Lưu promise
      this.pendingRequests.set(requestId, {
        resolve: (result: any) => {
          logger.debug(
            `SIP initialization successful: ${JSON.stringify(result)}`
          );
          clearTimeout(timeoutId);
          this.sipInitialized = result.success;
          resolve(result.success);
        },
        reject: (error: Error) => {
          logger.error(`SIP initialization failed: ${error.message}`);
          clearTimeout(timeoutId);
          this.sipInitialized = false;
          reject(error);
        },
        timeoutId: timeoutId as unknown as number,
      });

      logger.debug(
        `Sending REQUEST_SIP_INIT message with requestId: ${requestId}`
      );

      // Gửi tin nhắn khởi tạo SIP
      this.sendMessage({
        type: MessageType.REQUEST_SIP_INIT,
        requestId, // Thêm requestId vào message
        payload: config,
      });
    });
  }

  /**
   * Kết nối với SIP server
   */
  connectSip(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error("Not connected to worker"));
        return;
      }

      if (!this.sipInitialized) {
        reject(new Error("SIP not initialized"));
        return;
      }

      const requestId = `sip_connect_${Date.now()}`;

      // Tăng timeout lên 20 giây vì kết nối SIP có thể mất nhiều thời gian
      const connectTimeout = 20000; // 20 seconds

      // Thiết lập timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("SIP connection timed out"));
      }, connectTimeout);

      // Lưu promise
      this.pendingRequests.set(requestId, {
        resolve: (result: any) => {
          clearTimeout(timeoutId);
          this.sipConnected = result.success || result.state === "connected";
          resolve(this.sipConnected);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          this.sipConnected = false;
          reject(error);
        },
        timeoutId: timeoutId as unknown as number,
      });

      // Gửi tin nhắn kết nối SIP
      this.sendMessage({
        type: MessageType.REQUEST_CONNECT,
      });
    });
  }

  /**
   * Đăng ký với SIP server
   */
  registerSip(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error("Not connected to worker"));
        return;
      }

      if (!this.sipConnected) {
        reject(new Error("SIP not connected"));
        return;
      }

      const requestId = `sip_register_${Date.now()}`;

      // Thiết lập timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("SIP registration timed out"));
      }, this.options.connectTimeout || 5000);

      // Lưu promise
      this.pendingRequests.set(requestId, {
        resolve: (result: any) => {
          clearTimeout(timeoutId);
          this.sipRegistered = result.success;
          resolve(result.success);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          this.sipRegistered = false;
          reject(error);
        },
        timeoutId: timeoutId as unknown as number,
      });

      // Gửi tin nhắn đăng ký SIP
      this.sendMessage({
        type: MessageType.REQUEST_REGISTER,
      });
    });
  }

  /**
   * Melakukan panggilan SIP
   * @param target URI tujuan panggilan
   * @param options Opsi tambahan untuk panggilan
   * @returns True jika request berhasil dikirim
   */
  makeCall(target: string, options?: any): Promise<any> {
    if (!this.isConnected()) {
      return Promise.reject(new Error("Not connected to worker"));
    }

    if (!this.sipInitialized || !this.sipConnected || !this.sipRegistered) {
      return Promise.reject(
        new Error(
          "SIP not ready. Please initialize, connect, and register first"
        )
      );
    }

    logger.info(`Making call to ${target}`);

    return this.request("makeCall", {
      target,
      options,
    });
  }

  /**
   * Mengakhiri panggilan
   * @param callId ID panggilan yang akan diakhiri
   * @returns Promise yang diselesaikan saat permintaan berhasil dikirim
   */
  hangupCall(callId: string): Promise<any> {
    if (!this.isConnected()) {
      return Promise.reject(new Error("Not connected to worker"));
    }

    logger.info(`Hanging up call ${callId}`);

    return this.request("hangupCall", {
      callId,
    });
  }

  /**
   * Mengirim nada DTMF selama panggilan
   * @param callId ID panggilan yang aktif
   * @param tones Nada DTMF untuk dikirim
   * @returns Promise yang diselesaikan saat permintaan berhasil dikirim
   */
  sendDtmf(callId: string, tones: string): Promise<any> {
    if (!this.isConnected()) {
      return Promise.reject(new Error("Not connected to worker"));
    }

    logger.info(`Sending DTMF tones ${tones} for call ${callId}`);

    return this.request("sendDtmf", {
      callId,
      tones,
    });
  }

  /**
   * Mengatur status mute panggilan
   * @param callId ID panggilan
   * @param muted Status mute (true/false)
   * @returns Promise yang diselesaikan saat permintaan berhasil dikirim
   */
  setMuted(callId: string, muted: boolean): Promise<any> {
    if (!this.isConnected()) {
      return Promise.reject(new Error("Not connected to worker"));
    }

    logger.info(`Setting muted=${muted} for call ${callId}`);

    return this.request("setMuted", {
      callId,
      muted,
    });
  }

  /**
   * Menjawab panggilan masuk
   * @param callId ID panggilan yang akan dijawab
   * @param options Opsi tambahan untuk menjawab panggilan
   * @returns Promise yang diselesaikan saat permintaan berhasil dikirim
   */
  answerCall(callId: string, options?: any): Promise<any> {
    if (!this.isConnected()) {
      return Promise.reject(new Error("Not connected to worker"));
    }

    if (!this.sipInitialized || !this.sipConnected || !this.sipRegistered) {
      return Promise.reject(
        new Error(
          "SIP not ready. Please initialize, connect, and register first"
        )
      );
    }

    logger.info(`Answering call ${callId}`);

    return this.request("answerCall", {
      callId,
      options,
    });
  }

  // Đóng kết nối
  close(): void {
    if (this.port) {
      try {
        // Thông báo ngắt kết nối đến worker
        this.sendMessage({
          type: MessageType.CLIENT_DISCONNECTED,
        });

        // Đóng các request đang chờ
        this.pendingRequests.forEach((pending) => {
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
        const initPending = this.pendingRequests.get("initialize");
        if (initPending) {
          initPending.resolve({
            success: true,
            clientId: this.clientId,
            connectedClients: message.payload?.totalClients || 1,
          });
          this.pendingRequests.delete("initialize");
        }

        // Emit event
        this.emitEvent("stateUpdate", message.payload);
        break;

      case "RESPONSE":
        this.handleResponse(message as ResponseMessage);
        break;

      case "SIP_INIT_RESULT":
        // Xử lý kết quả khởi tạo SIP
        // Kiểm tra tất cả các pending requests có key bắt đầu bằng "sip_init_"
        for (const [key, pending] of this.pendingRequests.entries()) {
          if (key.startsWith("sip_init_")) {
            logger.debug(`Found pending SIP init request: ${key}`);
            if (message.payload?.success) {
              pending.resolve(message.payload);
            } else {
              pending.reject(
                new Error(message.payload?.error || "SIP initialization failed")
              );
            }
            this.pendingRequests.delete(key);
            break;
          }
        }

        // Emit event
        this.emitEvent("sipInitResult", message.payload);
        break;

      case "SIP_CONNECTION_UPDATE":
        // Xử lý kết quả kết nối SIP
        logger.debug(
          `Nhận được SIP_CONNECTION_UPDATE với payload: ${JSON.stringify(
            message.payload
          )}`
        );

        // Kiểm tra tất cả các pending requests có key bắt đầu bằng "sip_connect_"
        for (const [key, pending] of this.pendingRequests.entries()) {
          if (key.startsWith("sip_connect_")) {
            logger.debug(`Found pending SIP connect request: ${key}`);

            // Chỉ resolve nếu là trạng thái "connected" hoặc có success=true
            if (
              message.payload?.state === "connected" ||
              message.payload?.success === true
            ) {
              logger.debug(`Kết nối SIP thành công, giải quyết promise`);
              this.sipConnected = true;
              pending.resolve(message.payload);
              this.pendingRequests.delete(key);
              break;
            }
            // Reject nếu là trạng thái "failed" hoặc có lỗi
            else if (
              message.payload?.state === "failed" ||
              message.payload?.error
            ) {
              logger.debug(`Kết nối SIP thất bại, từ chối promise`);
              this.sipConnected = false;
              pending.reject(
                new Error(message.payload?.error || "SIP connection failed")
              );
              this.pendingRequests.delete(key);
              break;
            }
            // Nếu là trạng thái "connecting", không làm gì cả, chờ tin nhắn tiếp theo
            else if (message.payload?.state === "connecting") {
              logger.debug(`Đang kết nối SIP, chờ tin nhắn tiếp theo`);
              // KHÔNG xóa pending request và KHÔNG resolve/reject
            }
          }
        }

        // Emit event
        this.emitEvent("sipConnectionUpdate", message.payload);
        break;

      case "SIP_REGISTRATION_UPDATE":
        // Xử lý kết quả đăng ký SIP
        // Kiểm tra tất cả các pending requests có key bắt đầu bằng "sip_register_"
        for (const [key, pending] of this.pendingRequests.entries()) {
          if (key.startsWith("sip_register_")) {
            logger.debug(`Found pending SIP register request: ${key}`);
            if (
              message.payload?.state === "registered" ||
              message.payload?.success
            ) {
              this.sipRegistered = true;
              pending.resolve(message.payload);
            } else if (
              message.payload?.state === "failed" ||
              message.payload?.error
            ) {
              this.sipRegistered = false;
              pending.reject(
                new Error(message.payload?.error || "SIP registration failed")
              );
            }
            this.pendingRequests.delete(key);
            break;
          }
        }

        // Emit event
        this.emitEvent("sipRegistrationUpdate", message.payload);
        break;

      default:
        // Emit event using the message type as event name
        this.emitEvent("message", message);
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
