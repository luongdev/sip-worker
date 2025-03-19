import {
  Message,
  MessageHandlerCallback,
  InitializeResult,
  CallData,
  CallState,
  SipConfig
} from "../common/types";

export interface ClientMessage extends Message {
  clientId?: string;
  requestId?: string;
  action?: string;
}

export interface SipClientOptions {
  connectTimeout?: number;
  pingInterval?: number;
  pingTimeout?: number;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export interface ISipClient {
  // Quản lý sự kiện
  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
  
  // Phương thức cốt lõi
  initialize(): Promise<InitializeResult>;
  connect(): Promise<void>;
  sendMessage(message: ClientMessage): boolean;
  
  // Kiểm tra trạng thái
  getClientId(): string;
  isConnected(): boolean;
  
  // Phương thức SIP
  initializeSip(config: SipConfig): Promise<boolean>;
  connectSip(): Promise<boolean>;
  registerSip(): Promise<boolean>;
  
  // Quản lý cuộc gọi
  makeCall(target: string, options?: CallOptions): boolean;
  answerCall(options?: CallOptions): boolean;
  endCall(): boolean;
  
  // Yêu cầu/Phản hồi
  request<T = any>(action: string, payload?: any, timeout?: number): Promise<T>;
  
  // Đóng kết nối
  close(): void;
}

export interface CallOptions {
  video?: boolean;
  audioConstraints?: MediaTrackConstraints;
  videoConstraints?: MediaTrackConstraints;
}

export interface MediaOptions {
  video?: boolean;
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
}

export interface MediaHandler {
  // Thiết lập/dọn dẹp cuộc gọi
  setupCall(session: any, options?: MediaOptions): Promise<MediaStream>;
  cleanupCall(): void;
  
  // Truy cập stream
  getLocalStream(): MediaStream | null;
  getRemoteStream(): MediaStream | null;
  
  // Điều khiển media
  setMuted(muted: boolean): boolean;
  setVideoEnabled(enabled: boolean): boolean;
} 