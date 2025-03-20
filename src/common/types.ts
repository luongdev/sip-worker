// Định nghĩa các loại tin nhắn cơ bản
export enum MessageType {
  // Tin nhắn quản lý client
  CLIENT_CONNECTED = "CLIENT_CONNECTED",
  CLIENT_DISCONNECTED = "CLIENT_DISCONNECTED",
  INITIALIZE = "INITIALIZE",
  INITIALIZED = "INITIALIZED",
  STATE_UPDATE = "STATE_UPDATE",

  // Tin nhắn request/response
  REQUEST = "REQUEST",
  RESPONSE = "RESPONSE",
  ERROR = "ERROR",

  // Tin nhắn SIP
  SIP_CONNECTION_UPDATE = "SIP_CONNECTION_UPDATE",
  SIP_REGISTRATION_UPDATE = "SIP_REGISTRATION_UPDATE",
  SIP_CALL_UPDATE = "SIP_CALL_UPDATE",
  SIP_INIT_RESULT = "SIP_INIT_RESULT",

  // Request SIP
  REQUEST_SIP_INIT = "REQUEST_SIP_INIT",
  REQUEST_CONNECT = "REQUEST_CONNECT",
  REQUEST_REGISTER = "REQUEST_REGISTER",
  REQUEST_UNREGISTER = "REQUEST_UNREGISTER",

  // Cuộc gọi
  REQUEST_MAKE_CALL = "REQUEST_MAKE_CALL",
  REQUEST_ANSWER_CALL = "REQUEST_ANSWER_CALL",
  REQUEST_HANGUP = "REQUEST_HANGUP",
  INCOMING_CALL = "INCOMING_CALL",
  CALL_UPDATE = "CALL_UPDATE",
  CALL_CLAIMED = "CALL_CLAIMED",

  // Tin nhắn SDP
  SDP_REQUEST = "SDP_REQUEST",
  SDP_RESPONSE = "SDP_RESPONSE",
  ICE_CANDIDATE = "ICE_CANDIDATE",
  CONNECTION_STATE_CHANGE = "CONNECTION_STATE_CHANGE",
  MEDIA_CONTROL = "MEDIA_CONTROL",

  // New message types
  CALL_ERROR = "CALL_ERROR",
  REQUEST_END_CALL = "REQUEST_END_CALL",
  REQUEST_RESULT = "REQUEST_RESULT",
}

/**
 * Thông tin đăng nhập SIP
 */
export interface SipCredentials {
  /**
   * Tên người dùng SIP
   */
  username: string;

  /**
   * Mật khẩu
   */
  password: string;

  /**
   * Tên xác thực (nếu khác username)
   */
  authorizationName?: string;
}

/**
 * Cấu hình SIP
 */
export interface SipConfig {
  /**
   * URI cho SIP, ví dụ: 'sip:username@domain.com'
   */
  uri: string;

  /**
   * Mật khẩu cho tài khoản SIP
   */
  password: string;

  /**
   * Tên hiển thị (tùy chọn)
   */
  displayName?: string;

  /**
   * Danh sách các máy chủ WebSocket SIP
   */
  wsServers: string | string[];

  /**
   * Chuỗi User-Agent (tùy chọn)
   */
  userAgentString?: string;

  /**
   * Thời gian hết hạn đăng ký (giây)
   */
  registerExpires?: number;

  /**
   * Tự động đăng ký
   */
  autoRegister?: boolean;

  /**
   * Tự động kết nối lại khi mất kết nối
   */
  autoReconnect?: boolean;

  /**
   * Thời gian hết hạn của session timers
   */
  sessionTimersExpires?: number;

  /**
   * Thời gian chờ ICE gathering (ms)
   */
  iceGatheringTimeout?: number;

  /**
   * Thời gian chờ kết nối (ms)
   */
  connectionTimeout?: number;

  /**
   * Bật trace SIP traffic
   */
  traceSip?: boolean;

  /**
   * Danh sách máy chủ STUN
   */
  stunServers?: string[];

  /**
   * Danh sách các máy chủ TURN
   */
  turnServers?: Array<{
    urls: string | string[];
    username?: string;
    password?: string;
  }>;

  /**
   * Danh sách các máy chủ outbound proxy (tùy chọn)
   */
  outboundProxy?: string[];

  /**
   * Headers bổ sung (tùy chọn)
   */
  extraHeaders?: Record<string, string>;

  /**
   * Logs bật/tắt
   */
  enableLogs?: boolean;

  /**
   * Log level (debug, log, warn, error)
   */
  logLevel?: "debug" | "log" | "warn" | "error";
}

// Interface cơ bản cho tin nhắn
export interface Message {
  type: MessageType;
  payload?: any;
  clientId?: string;
  timestamp?: number;
  requestId?: string;
  action?: string;
}

// Interface cho kết quả khởi tạo
export interface InitializeResult {
  success: boolean;
  clientId: string;
  connectedClients: number;
}

// Callback xử lý tin nhắn
export type MessageHandlerCallback = (message: Message) => void;

// Interface cho yêu cầu (request)
export interface RequestMessage extends Message {
  requestId: string;
  action: string;
  payload?: any;
}

// Interface cho phản hồi (response)
export interface ResponseMessage extends Message {
  type: MessageType.RESPONSE;
  payload: {
    requestId: string;
    success: boolean;
    data?: any;
    error?: string;
  };
}

// Interface cơ bản cho trạng thái cuộc gọi
export interface CallState {
  hasActiveCall: boolean;
  activeCall: CallData | null;
  registration: { state: string };
}

// Dữ liệu cuộc gọi
export interface CallData {
  id: string;
  state: "incoming" | "connecting" | "connected" | "ended";
  target?: string;
  from?: string;
  displayName?: string;
  startTime?: number;
  connectTime?: number;
  endTime?: number;
  duration?: number;
  initiatedBy?: string;
  answeredBy?: string;
  endReason?: string;
}
