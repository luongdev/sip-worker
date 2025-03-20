import { ClientManager } from "./client-manager";
import { LoggerFactory } from "../logger";
import { Message, MessageType, RequestMessage } from "../common/types";

// Tạo logger cho MessageHandler
const logger = LoggerFactory.getInstance().getLogger("MessageHandler");

// Định nghĩa kiểu cho message handlers
type MessageHandlerFn = (message: Message) => void;
type RequestHandlerFn = (request: RequestMessage) => void;

export class MessageHandler {
  private readonly messageHandlers: Map<string, MessageHandlerFn[]> = new Map();

  constructor(private readonly clientManager: ClientManager) {}

  // Thêm handler cho một loại message cụ thể
  addHandler(messageType: MessageType, handler: MessageHandlerFn): void {
    const typeKey = messageType.toString();
    if (!this.messageHandlers.has(typeKey)) {
      this.messageHandlers.set(typeKey, []);
    }
    this.messageHandlers.get(typeKey)?.push(handler);
    logger.debug(`Added handler for message type: ${messageType}`);
  }

  // Xử lý message dựa vào type
  handleMessage(message: Message): void {
    const { type } = message;
    logger.debug(`Handling message of type: ${type}`);

    const typeKey = type.toString();
    const handlers = this.messageHandlers.get(typeKey);
    if (handlers && handlers.length > 0) {
      handlers.forEach((handler) => {
        try {
          handler(message);
        } catch (error) {
          logger.error(`Error in handler for message type ${type}:`, error);
        }
      });
    } else {
      logger.warn(`No handlers registered for message type: ${type}`);
    }
  }

  handleClientInit(clientId: string, port: MessagePort): void {
    this.clientManager.registerClient(clientId, port);

    this.clientManager.sendToClient(clientId, {
      type: MessageType.STATE_UPDATE,
      payload: {
        hasActiveCall: false,
        activeCall: null,
        registration: { state: "none" },
      },
      timestamp: Date.now(),
    });

    // Thông báo số lượng client đã kết nối
    this.notifyClientsAboutConnection(clientId);
  }

  handleClientDisconnect(clientId: string): void {
    this.clientManager.unregisterClient(clientId);

    // Thông báo cho các client khác về việc ngắt kết nối
    this.clientManager.broadcastToAllClients({
      type: MessageType.CLIENT_DISCONNECTED,
      payload: {
        clientId,
        totalClients: this.clientManager.getClientCount(),
      },
      timestamp: Date.now(),
    });
  }

  handleRequest(request: RequestMessage): void {
    const clientId = request.clientId as string;
    logger.info(`Received request from client ${clientId}: ${request.type}`);

    // Xử lý các loại requests
    const typeKey = request.type.toString();
    const handlers = this.messageHandlers.get(typeKey);
    if (handlers && handlers.length > 0) {
      handlers.forEach((handler) => {
        try {
          handler(request);
        } catch (error) {
          logger.error(
            `Error in handler for request type ${request.type}:`,
            error
          );
          this.clientManager.sendErrorResponse(
            clientId,
            request.requestId,
            error instanceof Error ? error.message : String(error)
          );
        }
      });
    } else {
      logger.warn(`No handlers registered for request type: ${request.type}`);
      this.clientManager.sendErrorResponse(
        clientId,
        request.requestId,
        `Không có handler cho request type: ${request.type}`
      );
    }
  }

  private notifyClientsAboutConnection(clientId: string): void {
    this.clientManager.broadcastToAllClients({
      type: MessageType.CLIENT_CONNECTED,
      payload: {
        clientId,
        totalClients: this.clientManager.getClientCount(),
      },
      timestamp: Date.now(),
    });
  }
}
