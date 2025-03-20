// Định nghĩa các loại tin nhắn cơ bản
export type MessageType =
  | "CLIENT_CONNECTED"
  | "CLIENT_DISCONNECTED"
  | "INITIALIZE"
  | "REGISTER"
  | "MAKE_CALL"
  | "ANSWER_CALL"
  | "END_CALL"
  | "INITIALIZE_PUSH"
  | "ADD_POLLING_TASK"
  | "STATE_UPDATE"
  | "REGISTRATION_SUCCESS"
  | "REGISTRATION_FAILED"
  | "INCOMING_CALL"
  | "CALL_CONNECTING"
  | "CALL_CONNECTED"
  | "CALL_ENDED"
  | "CUSTOM_EVENT"
  | "POLL_DATA_UPDATED"
  | "REQUEST"
  | "RESPONSE"
  | "REQUEST_SIP_INIT"
  | "SIP_INIT_RESULT"
  | "REQUEST_CONNECT"
  | "REQUEST_REGISTER"
  | "SIP_CONNECTION_UPDATE"
  | "SIP_REGISTRATION_UPDATE";

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
  logLevel?: 'debug' | 'log' | 'warn' | 'error';
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
  type: 'RESPONSE';
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
  state: 'incoming' | 'connecting' | 'connected' | 'ended';
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