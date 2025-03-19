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
  | "RESPONSE";

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