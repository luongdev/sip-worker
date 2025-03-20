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
  onTransportStateChange?: (state: string) => void;
}

export class SipManager {
  private userAgent?: UserAgent;
  private registerer?: Registerer;
  private config?: SipConfig;
  private callbacks: SipManagerCallbacks = {};
  private _isInitialized: boolean = false;
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

      // Bật log cho SIP.js nếu enableLogs được bật
      if (config.enableLogs) {
        // Đặt log level của SIP.js để xem network logs
        console.info("Enabling SIP.js logs");
        (globalThis as any).sipjsLogLevel = "debug";
      }

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
          server: Array.isArray(config.wsServers) ? config.wsServers[0] : config.wsServers,
          // Thêm cấu hình để bật log cho transport
          traceSip: true,
          // Thêm timeout dài hơn
          connectionTimeout: 20000
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

      // Kích hoạt SIP.js logs bên ngoài cấu hình chính
      if (config.enableLogs) {
        try {
          // @ts-ignore - Custom log configuration
          userAgentOptions.logConfiguration = {
            builtinEnabled: true,
            level: 'debug',
            connector: (level: string, category: string, label: string, content: string) => {
              const prefix = label ? `[${label}] ` : '';
              switch (level) {
                case 'debug':
                  logger.debug(`SIP ${category}: ${prefix}${content}`);
                  break;
                case 'log':
                  logger.info(`SIP ${category}: ${prefix}${content}`);
                  break;
                case 'warn':
                  logger.warn(`SIP ${category}: ${prefix}${content}`);
                  break;
                case 'error':
                  logger.error(`SIP ${category}: ${prefix}${content}`);
                  break;
                default:
                  logger.info(`SIP ${category}: ${prefix}${content}`);
                  break;
              }
            }
          };
        } catch (error) {
          logger.warn("Could not set SIP.js custom logger:", error);
        }
      }

      logger.info("Creating UserAgent with options:", JSON.stringify({
        uri: uri.toString(),
        transportServer: userAgentOptions.transportOptions?.server,
        authUsername: userAgentOptions.authorizationUsername,
        iceServers: userAgentOptions.sessionDescriptionHandlerFactoryOptions?.peerConnectionConfiguration?.iceServers
      }, null, 2));

      // Tạo UserAgent
      this.userAgent = new UserAgent(userAgentOptions);

      // Thiết lập các sự kiện
      this._setupUserAgentListeners();

      this._isInitialized = true;
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
    if (!this.userAgent || !this.isInitialized()) {
      logger.error("Cannot connect: UserAgent not initialized");
      return false;
    }

    try {
      logger.info("Connecting to SIP server...");
      
      // Gọi callback onConnecting nếu có
      if (this.callbacks.onConnecting) {
        this.callbacks.onConnecting();
      }
      
      // Bắt đầu UserAgent để kết nối với SIP server
      logger.debug("Starting UserAgent...");
      
      // Thiết lập một biến flag để theo dõi kết nối thành công
      let connectionResolved = false;
      
      // Tạo một temporary callback cho transport.onConnect
      const originalOnConnect = this.userAgent.transport.onConnect;
      
      // Đặt timeout cho kết nối
      const connectionTimeout = this.config?.connectionTimeout || 20000;
      
      // Trả về kết quả dựa trên Promise - đợi kết nối hoặc timeout
      const connectionPromise = new Promise<boolean>((resolve) => {
        // Override onConnect tạm thời
        this.userAgent!.transport.onConnect = () => {
          if (!connectionResolved) {
            connectionResolved = true;
            // Gọi callback gốc nếu có
            if (originalOnConnect) {
              originalOnConnect.call(this.userAgent!.transport);
            }
            this.isConnected = true;
            logger.info("SIP transport connected");
            if (this.callbacks.onConnected) {
              this.callbacks.onConnected();
            }
            resolve(true);
          }
        };
        
        // Đặt timeout
        setTimeout(() => {
          if (!connectionResolved) {
            connectionResolved = true;
            logger.error(`Connection timeout after ${connectionTimeout}ms`);
            
            // Khôi phục callback gốc
            this.userAgent!.transport.onConnect = originalOnConnect;
            
            resolve(false);
          }
        }, connectionTimeout);
      });
      
      // Bắt đầu UserAgent
      await this.userAgent.start();
      logger.debug("UserAgent started, waiting for transport connection");
      
      // Đợi kết nối thành công hoặc timeout
      return await connectionPromise;
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
   * Lấy các callbacks hiện tại
   */
  getCallbacks(): SipManagerCallbacks {
    return this.callbacks;
  }

  /**
   * Cài đặt các listeners cho UserAgent
   */
  private _setupUserAgentListeners(): void {
    if (!this.userAgent) return;

    // Xử lý các sự kiện transport
    this.userAgent.transport.onConnect = () => {
      this.isConnected = true;
      logger.info("SIP transport connected successfully");
      logger.debug("Transport connected, địa chỉ máy chủ: " + 
        // @ts-ignore - server property exists but not in type definition
        this.userAgent?.transport?.server);
      if (this.callbacks.onConnected) this.callbacks.onConnected();
    };

    this.userAgent.transport.onDisconnect = () => {
      const wasConnected = this.isConnected;
      this.isConnected = false;
      this.isRegistered = false;
      logger.info("SIP transport disconnected");
      logger.debug("Transport disconnected, trạng thái trước đó: " + (wasConnected ? "connected" : "disconnected"));
      if (this.callbacks.onDisconnected) this.callbacks.onDisconnected();
      
      // Thử kết nối lại nếu bị mất kết nối đột ngột
      if (wasConnected && this.config?.autoReconnect) {
        logger.info("Attempting to reconnect...");
        // Thử kết nối lại sau 5 giây
        setTimeout(() => {
          if (this.userAgent && !this.isConnected) {
            logger.debug("Đang thử kết nối lại sau 5 giây...");
            this.userAgent.start().catch(err => {
              logger.error("Reconnection failed:", err);
            });
          }
        }, 5000);
      }
    };
    
    // Xử lý sự kiện trạng thái transport khi thay đổi
    this.userAgent.transport.stateChange.addListener((state) => {
      logger.info(`SIP transport state changed to: ${state}`);
      logger.debug(`Chi tiết trạng thái transport: ${state}, isConnected=${this.isConnected}`);
      
      // Thông báo cho client về trạng thái kết nối
      if (this.callbacks.onTransportStateChange) {
        this.callbacks.onTransportStateChange(state);
      }
    });

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
    if (!this.isInitialized()) return "not_initialized";
    if (!this.isConnected) return "not_connected";
    if (this.isRegistered) return "registered";
    return "not_registered";
  }

  /**
   * Kiểm tra xem đã kết nối và đăng ký thành công chưa
   */
  isReady(): boolean {
    return this.isInitialized() && this.isConnected && this.isRegistered;
  }

  /**
   * Kiểm tra xem đã khởi tạo thành công chưa
   */
  isInitialized(): boolean {
    return this._isInitialized;
  }
} 