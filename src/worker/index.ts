/// <reference lib="webworker" />

import { ClientManager } from "./client-manager";
import { MessageHandler } from "./message-handler";
import { SipManager } from "./sip-manager";
import { LoggerFactory } from "../logger";
import { Message, RequestMessage } from "../common/types";

// Tạo logger cho Worker
const logger = LoggerFactory.getInstance().getLogger("SipWorker");

logger.info("SIP Worker initializing...");

// Khởi tạo ClientManager, MessageHandler, và SipManager
const clientManager = new ClientManager();
const messageHandler = new MessageHandler(clientManager);
const sipManager = new SipManager();

// Thiết lập callbacks cho SipManager
sipManager.setCallbacks({
  onConnected: () => {
    logger.info("SIP Connected, notifying all clients");
    clientManager.broadcastToAllClients({
      type: "SIP_CONNECTION_UPDATE",
      payload: {
        state: "connected"
      },
      timestamp: Date.now()
    });
  },
  onDisconnected: () => {
    logger.info("SIP Disconnected, notifying all clients");
    clientManager.broadcastToAllClients({
      type: "SIP_CONNECTION_UPDATE",
      payload: {
        state: "disconnected"
      },
      timestamp: Date.now()
    });
  },
  onRegistered: () => {
    logger.info("SIP Registered, notifying all clients");
    clientManager.broadcastToAllClients({
      type: "SIP_REGISTRATION_UPDATE",
      payload: {
        state: "registered"
      },
      timestamp: Date.now()
    });
  },
  onUnregistered: () => {
    logger.info("SIP Unregistered, notifying all clients");
    clientManager.broadcastToAllClients({
      type: "SIP_REGISTRATION_UPDATE",
      payload: {
        state: "unregistered"
      },
      timestamp: Date.now()
    });
  },
  onRegistrationFailed: (cause) => {
    logger.error("SIP Registration failed, notifying all clients:", cause);
    clientManager.broadcastToAllClients({
      type: "SIP_REGISTRATION_UPDATE",
      payload: {
        state: "failed",
        error: cause
      },
      timestamp: Date.now()
    });
  },
  onIncomingCall: (session) => {
    logger.info("Incoming call received, handling in message handler");
    // TO-DO: Xử lý cuộc gọi đến ở giai đoạn sau
  }
});

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

    // SIP Initialization
    case "REQUEST_SIP_INIT":
      handleSipInitialization(clientId, message.payload);
      break;

    // SIP Connect
    case "REQUEST_CONNECT":
      handleSipConnect(clientId);
      break;

    // SIP Register
    case "REQUEST_REGISTER":
      handleSipRegister(clientId);
      break;

    // Xử lý các loại message khác theo thiết kế
    // TO-DO: Triển khai xử lý các loại message khác

    default:
      logger.warn(`Unhandled message type: ${message.type} from client: ${clientId}`);
      break;
  }
}

// Xử lý tin nhắn REQUEST_SIP_INIT
async function handleSipInitialization(clientId: string, config: any): Promise<void> {
  logger.info(`Processing SIP init request from client ${clientId}`);

  try {
    // Kiểm tra có đủ thông tin không
    if (!config || !config.uri || !config.password || !config.wsServers) {
      throw new Error("Missing required SIP configuration");
    }

    // Khởi tạo SipManager
    const success = await sipManager.initialize(config);

    // Gửi kết quả về client
    clientManager.sendToClient(clientId, {
      type: "SIP_INIT_RESULT",
      payload: {
        success,
        state: success ? "initialized" : "failed",
        error: success ? undefined : "Failed to initialize SIP UserAgent"
      },
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error("Error in SIP initialization:", error);

    // Gửi thông báo lỗi
    clientManager.sendToClient(clientId, {
      type: "SIP_INIT_RESULT",
      payload: {
        success: false,
        state: "failed",
        error: error instanceof Error ? error.message : String(error)
      },
      timestamp: Date.now()
    });
  }
}

// Xử lý tin nhắn REQUEST_CONNECT
async function handleSipConnect(clientId: string): Promise<void> {
  logger.info(`Processing SIP connect request from client ${clientId}`);

  try {
    // Kết nối đến SIP server
    const success = await sipManager.connect();

    // Gửi kết quả về client
    clientManager.sendToClient(clientId, {
      type: "SIP_CONNECTION_UPDATE",
      payload: {
        success,
        state: success ? "connecting" : "failed",
        error: success ? undefined : "Failed to connect to SIP server"
      },
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error("Error in SIP connection:", error);

    // Gửi thông báo lỗi
    clientManager.sendToClient(clientId, {
      type: "SIP_CONNECTION_UPDATE",
      payload: {
        success: false,
        state: "failed",
        error: error instanceof Error ? error.message : String(error)
      },
      timestamp: Date.now()
    });
  }
}

// Xử lý tin nhắn REQUEST_REGISTER
async function handleSipRegister(clientId: string): Promise<void> {
  logger.info(`Processing SIP register request from client ${clientId}`);

  try {
    // Đăng ký với SIP server
    const success = await sipManager.register();

    // Gửi kết quả về client
    clientManager.sendToClient(clientId, {
      type: "SIP_REGISTRATION_UPDATE",
      payload: {
        success,
        state: success ? "registering" : "failed",
        error: success ? undefined : "Failed to register with SIP server"
      },
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error("Error in SIP registration:", error);

    // Gửi thông báo lỗi
    clientManager.sendToClient(clientId, {
      type: "SIP_REGISTRATION_UPDATE",
      payload: {
        success: false,
        state: "failed",
        error: error instanceof Error ? error.message : String(error)
      },
      timestamp: Date.now()
    });
  }
}

logger.info("SIP Worker initialized and ready to accept connections"); 