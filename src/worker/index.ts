/// <reference lib="webworker" />

import { ClientManager } from "./client-manager";
import { MessageHandler } from "./message-handler";
import { LoggerFactory } from "../logger";
import { Message, RequestMessage } from "../common/types";

// Tạo logger cho Worker
const logger = LoggerFactory.getInstance().getLogger("SipWorker");

logger.info("SIP Worker initializing...");

// Khởi tạo ClientManager và MessageHandler
const clientManager = new ClientManager();
const messageHandler = new MessageHandler(clientManager);

// Xử lý kết nối mới từ client
self.addEventListener("connect", (event: any) => {
  const port = event.ports[0];
  logger.info("New client connection received");

  // Thiết lập xử lý message từ client
  port.addEventListener("message", (event: MessageEvent) => {
    const message = event.data as Message;
    
    if (!message || !message.type) {
      logger.error("Received invalid message format:", event.data);
      return;
    }

    // Có clientId trong message không?
    const clientId = message.clientId;
    if (!clientId && message.type !== "CLIENT_CONNECTED") {
      logger.error("Received message without clientId:", message);
      return;
    }

    // Xử lý từng loại message
    handleMessage(message, port);
  });

  // Bắt đầu lắng nghe messages
  port.start();
});

// Hàm xử lý messages từ client
function handleMessage(message: Message, port: MessagePort): void {
  logger.debug(`Received message: ${message.type} from client: ${message.clientId}`);

  // Client mới kết nối
  if (message.type === "CLIENT_CONNECTED") {
    const clientId = message.clientId || `client_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    messageHandler.handleClientInit(clientId, port);
    return;
  }

  // Đảm bảo clientId tồn tại
  const clientId = message.clientId as string;
  if (!clientManager.hasClient(clientId)) {
    logger.error(`Received message from unknown client: ${clientId}`);
    return;
  }

  // Xử lý các loại message
  switch (message.type) {
    // Client ngắt kết nối
    case "CLIENT_DISCONNECTED":
      messageHandler.handleClientDisconnect(clientId);
      break;
    
    // Xử lý request/response
    case "REQUEST":
      messageHandler.handleRequest(clientId, message as RequestMessage);
      break;
    
    // Xử lý các loại message khác theo thiết kế
    // TO-DO: Triển khai xử lý các loại message khác
    
    default:
      logger.warn(`Unhandled message type: ${message.type} from client: ${clientId}`);
      break;
  }
}

logger.info("SIP Worker initialized and ready to accept connections"); 