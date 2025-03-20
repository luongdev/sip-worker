/// <reference lib="webworker" />

import { ClientManager } from "./client-manager";
import { MessageHandler } from "./message-handler";
import { SipManager } from "./sip-manager";
import { LoggerFactory } from "../logger";
import { Message, MessageType, RequestMessage } from "../common/types";
import { SessionState } from "sip.js";
import { v7 as uuidv7 } from "uuid";

// Tạo logger cho Worker
const logger = LoggerFactory.getInstance().getLogger("SipWorker");

logger.info("SIP Worker initializing...");

// Khởi tạo ClientManager, MessageHandler, và SipManager
const clientManager = new ClientManager();
const messageHandler = new MessageHandler(clientManager);
const sipManager = new SipManager();

// Thiết lập handlers cho các request actions cụ thể
messageHandler.addHandler(MessageType.REQUEST, (message: Message) => {
  if (!isRequestMessage(message)) return;

  const request = message as RequestMessage;
  const clientId = request.clientId as string;
  const action = request.action;

  logger.debug(`Handling REQUEST action: ${action}`);

  switch (action) {
    case "getConnectedClients":
      // Handle getConnectedClients request
      clientManager.sendResponse(clientId, request.requestId, {
        count: clientManager.getClientCount(),
        clients: clientManager.getAllClientIds(),
      });
      break;

    case "echo":
      // Simple echo functionality
      clientManager.sendResponse(clientId, request.requestId, {
        message: request.payload?.message || "Echo response",
      });
      break;

    case "makeCall":
      // Handle makeCall request
      if (request.payload && request.payload.target) {
        handleMakeCall(clientId, request.payload);
      } else {
        clientManager.sendErrorResponse(
          clientId,
          request.requestId,
          "Invalid make call request: missing target"
        );
      }
      break;

    case "hangupCall":
      // Handle hangupCall request
      if (request.payload?.callId) {
        // Implement hangup call logic here
        clientManager.sendResponse(clientId, request.requestId, {
          success: true,
          message: `Call ${request.payload.callId} hungup successfully`,
        });
      } else {
        clientManager.sendErrorResponse(
          clientId,
          request.requestId,
          "No callId provided"
        );
      }
      break;

    case "answerCall":
      // Handle answerCall request
      if (request.payload?.callId) {
        // Implement answer call logic here
        clientManager.sendResponse(clientId, request.requestId, {
          success: true,
          message: `Call ${request.payload.callId} answered successfully`,
        });
      } else {
        clientManager.sendErrorResponse(
          clientId,
          request.requestId,
          "No callId provided"
        );
      }
      break;

    case "sendDtmf":
      // Handle sendDtmf request
      if (request.payload?.callId && request.payload?.tones) {
        // Implement DTMF sending logic here
        clientManager.sendResponse(clientId, request.requestId, {
          success: true,
          message: `DTMF tones sent to call ${request.payload.callId}`,
        });
      } else {
        clientManager.sendErrorResponse(
          clientId,
          request.requestId,
          "Missing callId or tones"
        );
      }
      break;

    case "setMuted":
      // Handle setMuted request
      if (
        request.payload?.callId !== undefined &&
        request.payload?.muted !== undefined
      ) {
        // Implement mute/unmute logic here
        clientManager.sendResponse(clientId, request.requestId, {
          success: true,
          message: `Call ${request.payload.callId} ${
            request.payload.muted ? "muted" : "unmuted"
          }`,
        });
      } else {
        clientManager.sendErrorResponse(
          clientId,
          request.requestId,
          "Missing callId or muted state"
        );
      }
      break;

    default:
      clientManager.sendErrorResponse(
        clientId,
        request.requestId,
        `Unknown request action: ${action}`
      );
      break;
  }
});

// Thiết lập callbacks cho SipManager
sipManager.setCallbacks({
  onConnecting: () => {
    broadcastSipConnectionUpdate("connecting");
  },
  onConnected: () => {
    broadcastSipConnectionUpdate("connected");
  },
  onDisconnected: () => {
    broadcastSipConnectionUpdate("disconnected");
  },
  onRegistered: () => {
    broadcastSipRegistrationUpdate("registered");
  },
  onUnregistered: () => {
    broadcastSipRegistrationUpdate("unregistered");
  },
  onRegistrationFailed: (cause) => {
    broadcastSipRegistrationUpdate("failed", { cause });
  },
  onIncomingCall: (session) => {
    handleIncomingCall(session);
  },
});

// Thiết lập client manager cho SipManager
sipManager.setClientManager(clientManager);

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
    if (!clientId && message.type !== MessageType.CLIENT_CONNECTED) {
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
  logger.debug(
    `Received message: ${message.type} from client: ${message.clientId}`
  );

  // Client mới kết nối
  if (message.type === MessageType.CLIENT_CONNECTED) {
    const clientId =
      message.clientId ||
      `client_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
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
    case MessageType.CLIENT_DISCONNECTED:
      messageHandler.handleClientDisconnect(clientId);
      break;

    // Xử lý request/response
    case MessageType.REQUEST:
      messageHandler.handleRequest(message as RequestMessage);
      break;

    // SIP Initialization
    case MessageType.REQUEST_SIP_INIT:
      handleSipInitialization(clientId, message.payload);
      break;

    // SIP Connect
    case MessageType.REQUEST_CONNECT:
      handleSipConnect(clientId);
      break;

    // SIP Register
    case MessageType.REQUEST_REGISTER:
      handleSipRegister(clientId, message.payload?.credentials);
      break;

    // Thêm handlers cho SDP messages
    case MessageType.SDP_RESPONSE:
      handleSdpResponse(message);
      break;

    case MessageType.ICE_CANDIDATE:
      handleIceCandidate(message);
      break;

    case MessageType.CONNECTION_STATE_CHANGE:
      handleConnectionStateChange(message);
      break;

    // Xử lý tin nhắn REQUEST_MAKE_CALL từ client
    case MessageType.REQUEST_MAKE_CALL:
      handleMakeCall(clientId, message);
      break;

    // Xử lý các loại message khác theo thiết kế
    // TO-DO: Triển khai xử lý các loại message khác

    default:
      logger.warn(
        `Unhandled message type: ${message.type} from client: ${clientId}`
      );
      break;
  }
}

// Hàm broadcast trạng thái kết nối SIP
function broadcastSipConnectionUpdate(state: string, details?: any): void {
  clientManager.broadcastToAllClients({
    type: MessageType.SIP_CONNECTION_UPDATE,
    payload: {
      state,
      ...details,
    },
  });
}

// Hàm broadcast trạng thái đăng ký SIP
function broadcastSipRegistrationUpdate(state: string, details?: any): void {
  clientManager.broadcastToAllClients({
    type: MessageType.SIP_REGISTRATION_UPDATE,
    payload: {
      state,
      ...details,
    },
  });
}

// Hàm xử lý cuộc gọi đến
function handleIncomingCall(session: any): void {
  // TODO: Xử lý cuộc gọi đến
  logger.info("Incoming call received, implementation pending");
}

// Thiết lập các handlers cho message-handler
messageHandler.addHandler(MessageType.REQUEST_SIP_INIT, (message: Message) => {
  if (isRequestMessage(message)) {
    handleSipInitialization(message.clientId as string, message.payload);
  }
});

messageHandler.addHandler(MessageType.REQUEST_CONNECT, (message: Message) => {
  if (isRequestMessage(message)) {
    handleSipConnect(message.clientId as string);
  }
});

messageHandler.addHandler(MessageType.REQUEST_REGISTER, (message: Message) => {
  if (isRequestMessage(message)) {
    handleSipRegister(message.clientId as string, message.payload?.credentials);
  }
});

// Hàm kiểm tra nếu một message là RequestMessage
function isRequestMessage(message: Message): message is RequestMessage {
  return message.requestId !== undefined;
}

// Thêm handlers cho SDP messages
messageHandler.addHandler(MessageType.SDP_RESPONSE, (message: Message) => {
  handleSdpResponse(message);
});

messageHandler.addHandler(MessageType.ICE_CANDIDATE, (message: Message) => {
  handleIceCandidate(message);
});

messageHandler.addHandler(
  MessageType.CONNECTION_STATE_CHANGE,
  (message: Message) => {
    handleConnectionStateChange(message);
  }
);

// Xử lý tin nhắn SDP response từ client
function handleSdpResponse(message: Message): void {
  logger.debug(`Received SDP_RESPONSE from client: ${message.clientId}`);
  sipManager.handleSdpMessage(message);
}

// Xử lý tin nhắn ICE candidate từ client
function handleIceCandidate(message: Message): void {
  logger.debug(`Received ICE_CANDIDATE from client: ${message.clientId}`);
  sipManager.handleSdpMessage(message);
}

// Xử lý thay đổi trạng thái kết nối từ client
function handleConnectionStateChange(message: Message): void {
  logger.debug(
    `Received CONNECTION_STATE_CHANGE from client: ${message.clientId}`
  );
  sipManager.handleSdpMessage(message);
}

// Xử lý tin nhắn REQUEST_SIP_INIT
async function handleSipInitialization(
  clientId: string,
  config: any
): Promise<void> {
  logger.info(`Processing SIP init request from client ${clientId}`);

  try {
    // Kiểm tra có đủ thông tin không
    if (!config || !config.uri || !config.password || !config.wsServers) {
      throw new Error("Missing required SIP configuration");
    }

    // Khởi tạo SipManager
    const success = await sipManager.initialize(config);

    // Gửi kết quả về client - Sửa đổi loại message
    clientManager.sendToClient(clientId, {
      type: MessageType.SIP_INIT_RESULT,
      payload: {
        success,
        state: success ? "initialized" : "failed",
        error: success ? undefined : "Failed to initialize SIP UserAgent",
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error("Error in SIP initialization:", error);

    // Gửi thông báo lỗi
    clientManager.sendToClient(clientId, {
      type: MessageType.SIP_INIT_RESULT,
      payload: {
        success: false,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
      timestamp: Date.now(),
    });
  }
}

// Xử lý tin nhắn REQUEST_CONNECT
async function handleSipConnect(clientId: string): Promise<void> {
  logger.info(`Processing SIP connect request from client ${clientId}`);

  try {
    // Kiểm tra đã khởi tạo chưa
    if (!sipManager.isInitialized()) {
      throw new Error(
        "SIP UserAgent not initialized. Please initialize first."
      );
    }

    // Gửi thông báo về trạng thái đang kết nối
    clientManager.sendToClient(clientId, {
      type: MessageType.SIP_CONNECTION_UPDATE,
      payload: {
        state: "connecting",
        message: "Connecting to SIP server...",
      },
      timestamp: Date.now(),
    });

    // Lưu timestamp bắt đầu kết nối để lưu trữ trong timeout handler
    const connectStartTime = Date.now();

    // Đăng ký callback khi kết nối thành công
    sipManager.setCallbacks({
      ...sipManager.getCallbacks(),
      onConnected: () => {
        logger.info(`SIP Connected, client ${clientId} requesting connection`);
        // Gửi thông báo kết nối thành công đến client với đầy đủ thông tin
        clientManager.sendToClient(clientId, {
          type: MessageType.SIP_CONNECTION_UPDATE,
          payload: {
            success: true,
            state: "connected",
            message: "Successfully connected to SIP server",
            connectTime: Date.now() - connectStartTime,
          },
          timestamp: Date.now(),
        });
      },
    });

    // Kết nối đến SIP server
    const success = await sipManager.connect();

    // Nếu không thành công, gửi thông báo lỗi
    if (!success) {
      logger.warn("SIP connection failed or timed out");
      clientManager.sendToClient(clientId, {
        type: MessageType.SIP_CONNECTION_UPDATE,
        payload: {
          success: false,
          state: "failed",
          error: "Failed to connect to SIP server",
        },
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    logger.error("Error in SIP connection:", error);

    // Gửi thông báo lỗi
    clientManager.sendToClient(clientId, {
      type: MessageType.SIP_CONNECTION_UPDATE,
      payload: {
        success: false,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
      timestamp: Date.now(),
    });
  }
}

// Xử lý tin nhắn REQUEST_REGISTER
async function handleSipRegister(
  clientId: string,
  credentials?: any
): Promise<void> {
  logger.info(`Processing SIP register request from client ${clientId}`);

  try {
    // Đăng ký với SIP server
    const success = await sipManager.register(credentials);

    // Gửi kết quả về client
    clientManager.sendToClient(clientId, {
      type: MessageType.SIP_REGISTRATION_UPDATE,
      payload: {
        success,
        state: success ? "registering" : "failed",
        error: success ? undefined : "Failed to register with SIP server",
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error("Error in SIP registration:", error);

    // Gửi thông báo lỗi
    clientManager.sendToClient(clientId, {
      type: MessageType.SIP_REGISTRATION_UPDATE,
      payload: {
        success: false,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      },
      timestamp: Date.now(),
    });
  }
}

// Xử lý tin nhắn REQUEST_MAKE_CALL từ client
async function handleMakeCall(clientId: string, payload: any): Promise<void> {
  logger.info(`Processing make call request from client ${clientId}`);

  // Kiểm tra payload
  if (!payload || !payload.target) {
    logger.error(`Invalid make call request: missing target`);
    clientManager.sendToClient(clientId, {
      type: MessageType.CALL_ERROR,
      payload: {
        error: "Thiếu thông tin đích gọi (target)",
        code: "INVALID_TARGET",
      },
      clientId,
    });
    return;
  }

  try {
    // Kiểm tra SipManager đã được khởi tạo
    if (!sipManager.isInitialized()) {
      throw new Error(
        "SIP chưa được khởi tạo. Vui lòng khởi tạo SIP trước khi thực hiện cuộc gọi."
      );
    }

    // Thông báo trạng thái cuộc gọi: đang tạo
    const callId = uuidv7();

    clientManager.sendToClient(clientId, {
      type: MessageType.CALL_UPDATE,
      payload: {
        state: "creating",
        callId,
        target: payload.target,
      },
      clientId,
    });

    // Lưu thông tin client gọi để đảm bảo SDP được gửi đến client này
    // Thiết lập client ID vào cấu hình cuộc gọi
    const callOptions = {
      ...payload.options,
      sessionDescriptionHandlerOptions: {
        ...payload.options?.sessionDescriptionHandlerOptions,
        clientId,
      },
    };

    // Thông báo trạng thái: đang gọi
    clientManager.sendToClient(clientId, {
      type: MessageType.CALL_UPDATE,
      payload: {
        state: "calling",
        callId,
        target: payload.target,
      },
      clientId,
    });

    // Thực hiện cuộc gọi
    logger.info(`Making call to ${payload.target}`);
    const session = await sipManager.makeCall(payload.target, callOptions);

    // Theo dõi trạng thái cuộc gọi
    session.stateChange.addListener((state: string) => {
      logger.info(`Call to ${payload.target} state changed to: ${state}`);

      let callState = "";
      switch (state) {
        case SessionState.Establishing:
          callState = "establishing";
          break;
        case SessionState.Established:
          callState = "connected";
          break;
        case SessionState.Terminated:
          callState = "ended";
          break;
        default:
          callState = state.toLowerCase();
      }

      // Gửi cập nhật trạng thái cuộc gọi đến client
      clientManager.sendToClient(clientId, {
        type: MessageType.CALL_UPDATE,
        payload: {
          state: callState,
          callId,
          target: payload.target,
        },
        clientId,
      });
    });

    // Lưu thông tin phiên hiện tại vào MessageHandler để sử dụng sau này

    // Phản hồi thành công
    clientManager.sendToClient(clientId, {
      type: MessageType.REQUEST_RESULT,
      payload: {
        success: true,
        callId,
        message: "Cuộc gọi đang được thực hiện",
      },
      clientId,
      requestId: payload.requestId,
    });
  } catch (error) {
    logger.error(`Error making call: ${error}`);

    // Gửi thông báo lỗi
    clientManager.sendToClient(clientId, {
      type: MessageType.CALL_ERROR,
      payload: {
        error:
          error instanceof Error
            ? error.message
            : "Lỗi không xác định khi thực hiện cuộc gọi",
        code: "CALL_FAILED",
      },
      clientId,
      requestId: payload.requestId,
    });
  }
}

// Thêm handler cho tin nhắn REQUEST_MAKE_CALL
messageHandler.addHandler(MessageType.REQUEST_MAKE_CALL, (message: Message) => {
  if (isRequestMessage(message)) {
    handleMakeCall(message.clientId as string, message.payload);
  }
});

logger.info("SIP Worker initialized and ready to accept connections");
