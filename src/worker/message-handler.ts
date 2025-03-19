import { ClientManager } from "./client-manager";
import { LoggerFactory } from "../logger";
import { RequestMessage } from "../common/types";

// Tạo logger cho MessageHandler
const logger = LoggerFactory.getInstance().getLogger("MessageHandler");

export class MessageHandler {
  constructor(private readonly clientManager: ClientManager) {}

  handleClientInit(clientId: string, port: MessagePort): void {
    this.clientManager.registerClient(clientId, port);

    this.clientManager.sendToClient(clientId, {
      type: "STATE_UPDATE",
      payload: {
        hasActiveCall: false,
        activeCall: null,
        registration: { state: "none" }
      },
      timestamp: Date.now()
    });

    // Thông báo số lượng client đã kết nối
    this.notifyClientsAboutConnection(clientId);
  }

  handleClientDisconnect(clientId: string): void {
    this.clientManager.unregisterClient(clientId);

    // Thông báo cho các client khác về việc ngắt kết nối
    this.clientManager.broadcastToAllClients({
      type: "CLIENT_DISCONNECTED",
      payload: {
        clientId,
        totalClients: this.clientManager.getClientCount()
      },
      timestamp: Date.now()
    });
  }

  handleRequest(clientId: string, request: RequestMessage): void {
    logger.info(`Received request from client ${clientId}: ${request.action}`);
    const { requestId, action, payload } = request;

    try {
      let responseData;
      let success = true;

      switch (action) {
        case 'getConnectedClients':
          responseData = {
            clients: this.clientManager.getAllClientIds(),
            count: this.clientManager.getClientCount()
          };
          break;
        
        case 'echo':
          responseData = payload;
          break;
        
        // Thêm các actions khác ở đây
        
        default:
          success = false;
          this.clientManager.sendErrorResponse(
            clientId, 
            requestId, 
            `Unknown action: ${action}`
          );
          return;
      }

      this.clientManager.sendResponse(clientId, requestId, responseData, success);
    } catch (error) {
      logger.error(`Error handling request ${action}:`, error);
      // Chuyển đổi error sang string để đảm bảo kiểu
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.clientManager.sendErrorResponse(clientId, requestId, errorMessage);
    }
  }

  private notifyClientsAboutConnection(clientId: string): void {
    this.clientManager.broadcastToAllClients({
      type: "CLIENT_CONNECTED",
      payload: {
        clientId,
        totalClients: this.clientManager.getClientCount()
      },
      timestamp: Date.now()
    });
  }
} 