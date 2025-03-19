import { LoggerFactory } from "../logger";
import { UserAgent, UserAgentOptions, URI, Registerer, RegistererState } from "sip.js";
import { SipConfig } from "../common/types";

// Tạo logger cho SipManager
const logger = LoggerFactory.getInstance().getLogger("SipManager");

export interface SipManagerCallbacks {
  onConnecting?: () => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onRegistered?: () => void;
  onUnregistered?: () => void;
  onRegistrationFailed?: (cause: string) => void;
  onIncomingCall?: (session: any) => void;
}

export class SipManager {
  private userAgent?: UserAgent;
  private registerer?: Registerer;
  private config?: SipConfig;
  private callbacks: SipManagerCallbacks = {};
  private isInitialized: boolean = false;
  private isConnected: boolean = false;
  private isRegistered: boolean = false;

  constructor() {
    logger.info("SipManager created");
  }

  /**
   * Khởi tạo SIP UserAgent với cấu hình
   */
  async initialize(config: SipConfig): Promise<boolean> {
    try {
      logger.info("Initializing SIP with URI:", config.uri);
      
      this.config = config;

      // Tạo URI
      const uri = UserAgent.makeURI(config.uri);
      if (!uri) {
        throw new Error("Invalid SIP URI");
      }

      // Tạo cấu hình cho UserAgent
      const userAgentOptions: UserAgentOptions = {
        uri,
        authorizationUsername: config.uri.split('@')[0].split(':')[1],
        authorizationPassword: config.password,
        displayName: config.displayName,
        transportOptions: {
          server: Array.isArray(config.wsServers) ? config.wsServers[0] : config.wsServers
        },
        sessionDescriptionHandlerFactoryOptions: {
          iceGatheringTimeout: config.iceGatheringTimeout || 5000,
          peerConnectionConfiguration: {
            iceServers: [
              ...(config.stunServers ? config.stunServers.map(server => ({ urls: server })) : []),
              ...(config.turnServers || [])
            ]
          }
        }
      };

      // Tạo UserAgent
      this.userAgent = new UserAgent(userAgentOptions);

      // Thiết lập các sự kiện
      this._setupUserAgentListeners();

      this.isInitialized = true;
      logger.info("SIP UserAgent initialized successfully");
      return true;
    } catch (error) {
      logger.error("Error initializing SIP UserAgent:", error);
      return false;
    }
  }

  /**
   * Kết nối với SIP server
   */
  async connect(): Promise<boolean> {
    if (!this.userAgent || !this.isInitialized) {
      logger.error("Cannot connect: UserAgent not initialized");
      return false;
    }

    try {
      logger.info("Connecting to SIP server...");
      
      // Bắt đầu UserAgent để kết nối với SIP server
      await this.userAgent.start();
      
      logger.info("Connected to SIP server successfully");
      return true;
    } catch (error) {
      logger.error("Error connecting to SIP server:", error);
      return false;
    }
  }

  /**
   * Đăng ký với SIP server
   */
  async register(): Promise<boolean> {
    if (!this.userAgent || !this.isConnected) {
      logger.error("Cannot register: UserAgent not connected");
      return false;
    }

    try {
      logger.info("Registering with SIP server...");
      
      // Tạo registerer nếu chưa có
      if (!this.registerer) {
        this.registerer = new Registerer(this.userAgent);
        this._setupRegistererListeners();
      }
      
      // Đăng ký với SIP server
      await this.registerer.register({
        // Sử dụng cách gọi API đúng theo RegistererRegisterOptions
        requestOptions: {
          extraHeaders: this.config?.extraHeaders ? Object.entries(this.config.extraHeaders).map(([key, value]) => `${key}: ${value}`) : undefined
        }
      });
      
      logger.info("Registered with SIP server successfully");
      return true;
    } catch (error) {
      logger.error("Error registering with SIP server:", error);
      return false;
    }
  }

  /**
   * Ngắt đăng ký khỏi SIP server
   */
  async unregister(): Promise<boolean> {
    if (!this.registerer || !this.isRegistered) {
      logger.warn("Cannot unregister: Not registered");
      return false;
    }

    try {
      logger.info("Unregistering from SIP server...");
      
      // Hủy đăng ký với SIP server
      await this.registerer.unregister();
      
      logger.info("Unregistered from SIP server successfully");
      return true;
    } catch (error) {
      logger.error("Error unregistering from SIP server:", error);
      return false;
    }
  }

  /**
   * Đóng kết nối với SIP server
   */
  async disconnect(): Promise<boolean> {
    if (!this.userAgent || !this.isConnected) {
      logger.warn("Cannot disconnect: UserAgent not connected");
      return false;
    }

    try {
      logger.info("Disconnecting from SIP server...");
      
      // Ngắt đăng ký trước nếu đã đăng ký
      if (this.isRegistered && this.registerer) {
        await this.unregister();
      }
      
      // Dừng UserAgent
      await this.userAgent.stop();
      
      logger.info("Disconnected from SIP server successfully");
      return true;
    } catch (error) {
      logger.error("Error disconnecting from SIP server:", error);
      return false;
    }
  }

  /**
   * Cài đặt các callbacks
   */
  setCallbacks(callbacks: SipManagerCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Cài đặt các listeners cho UserAgent
   */
  private _setupUserAgentListeners(): void {
    if (!this.userAgent) return;

    // Xử lý các sự kiện transport
    this.userAgent.transport.onConnect = () => {
      this.isConnected = true;
      logger.info("SIP transport connected");
      if (this.callbacks.onConnected) this.callbacks.onConnected();
    };

    this.userAgent.transport.onDisconnect = () => {
      this.isConnected = false;
      this.isRegistered = false;
      logger.info("SIP transport disconnected");
      if (this.callbacks.onDisconnected) this.callbacks.onDisconnected();
    };

    // Xử lý cuộc gọi đến
    this.userAgent.delegate = {
      onInvite: (invitation) => {
        logger.info("Incoming call received");
        if (this.callbacks.onIncomingCall) this.callbacks.onIncomingCall(invitation);
      }
    };
  }

  /**
   * Cài đặt listeners cho Registerer
   */
  private _setupRegistererListeners(): void {
    if (!this.registerer) return;

    this.registerer.stateChange.addListener((state: RegistererState) => {
      switch (state) {
        case RegistererState.Registered:
          this.isRegistered = true;
          logger.info("SIP registered successfully");
          if (this.callbacks.onRegistered) this.callbacks.onRegistered();
          break;
        case RegistererState.Unregistered:
          this.isRegistered = false;
          logger.info("SIP unregistered");
          if (this.callbacks.onUnregistered) this.callbacks.onUnregistered();
          break;
        case RegistererState.Terminated:
          this.isRegistered = false;
          logger.error("SIP registration terminated");
          if (this.callbacks.onRegistrationFailed) this.callbacks.onRegistrationFailed("Registration terminated");
          break;
      }
    });
  }

  /**
   * Lấy trạng thái đăng ký hiện tại
   */
  getRegistrationState(): string {
    if (!this.isInitialized) return "not_initialized";
    if (!this.isConnected) return "not_connected";
    if (this.isRegistered) return "registered";
    return "not_registered";
  }

  /**
   * Kiểm tra xem đã kết nối và đăng ký thành công chưa
   */
  isReady(): boolean {
    return this.isInitialized && this.isConnected && this.isRegistered;
  }
} 