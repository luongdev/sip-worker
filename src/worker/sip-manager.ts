import { LoggerFactory } from "../logger";
import {
  UserAgent,
  UserAgentOptions,
  URI,
  Registerer,
  RegistererState,
} from "sip.js";
import { SipConfig, SipCredentials } from "../common/types";
import { v4 as uuidv4 } from "uuid";

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
  private credentials?: SipCredentials;
  private callbacks: SipManagerCallbacks = {};
  private _isInitialized: boolean = false;
  private isConnected: boolean = false;
  private isRegistered: boolean = false;

  constructor() {
    logger.info("SipManager created");
  }

  /**
   * Khởi tạo SIP UserAgent với cấu hình cơ bản cho transport
   */
  async initialize(config: SipConfig): Promise<boolean> {
    try {
      logger.info("Initializing SIP with basic config");

      this.config = config;

      // Khởi tạo UA chỉ để kiểm tra transport
      await this._createTransportOnlyUserAgent();

      this._isInitialized = true;
      logger.info("SIP UserAgent initialized for transport testing");
      return true;
    } catch (error) {
      logger.error("Error initializing SIP UserAgent:", error);
      return false;
    }
  }

  /**
   * Tạo UserAgent chỉ để kiểm tra kết nối transport
   */
  private async _createTransportOnlyUserAgent(): Promise<void> {
    // Nếu có UA cũ, dừng lại trước
    if (this.userAgent) {
      try {
        await this.userAgent.stop();
      } catch (error) {
        logger.warn("Error stopping previous UserAgent:", error);
      }
      this.userAgent = undefined;
    }

    // Tạo URI ẩn danh
    const anonymousUri = UserAgent.makeURI(
      `sip:anonymous@${this._getDomain()}`
    );
    if (!anonymousUri) {
      throw new Error("Invalid domain for SIP URI");
    }

    // Tạo cấu hình cơ bản cho UA
    const userAgentOptions: UserAgentOptions = {
      uri: anonymousUri,
      transportOptions: {
        server: Array.isArray(this.config?.wsServers)
          ? this.config?.wsServers[0]
          : this.config?.wsServers,
        traceSip: this.config?.traceSip || false,
        connectionTimeout: this.config?.connectionTimeout || 20000,
      },
      logLevel: this.config?.enableLogs ? "debug" : "error",
      sessionDescriptionHandlerFactoryOptions: {
        peerConnectionConfiguration: {
          iceServers: [
            ...(this.config?.stunServers
              ? this.config?.stunServers.map((server) => ({ urls: server }))
              : []),
            ...(this.config?.turnServers || []),
          ],
        },
      },
    };

    // Bật logs nếu cần
    if (this.config?.enableLogs) {
      this._configureLogging(userAgentOptions);
    }

    logger.info("Creating transport-only UserAgent");

    // Khởi tạo UserAgent
    this.userAgent = new UserAgent(userAgentOptions);

    // Thiết lập các sự kiện cho transport
    this._setupUserAgentListeners();
  }

  /**
   * Kết nối transport với SIP server
   */
  async connect(): Promise<boolean> {
    if (!this.userAgent || !this.isInitialized()) {
      logger.error("Cannot connect: UserAgent not initialized");
      return false;
    }

    try {
      logger.info("Connecting to SIP server (testing transport)...");

      // Gọi callback onConnecting nếu có
      if (this.callbacks.onConnecting) {
        this.callbacks.onConnecting();
      }

      // Thiết lập timeout và theo dõi kết nối
      const connectionTimeout = this.config?.connectionTimeout || 20000;
      let connectionResolved = false;

      // Tạo promise để theo dõi kết nối
      const connectionPromise = new Promise<boolean>((resolve) => {
        // Tạo một callback tạm thời cho transport.onConnect
        const originalOnConnect = this.userAgent!.transport.onConnect;

        this.userAgent!.transport.onConnect = () => {
          if (!connectionResolved) {
            connectionResolved = true;
            // Gọi callback gốc nếu có
            if (originalOnConnect) {
              originalOnConnect.call(this.userAgent!.transport);
            }
            this.isConnected = true;
            logger.info("SIP transport connected successfully");
            resolve(true);
          }
        };

        // Đặt timeout
        setTimeout(() => {
          if (!connectionResolved) {
            connectionResolved = true;
            logger.error(`Connection timeout after ${connectionTimeout}ms`);
            resolve(false);
          }
        }, connectionTimeout);
      });

      // Bắt đầu UserAgent để kết nối transport
      await this.userAgent.start();
      logger.debug("UserAgent started, waiting for transport connection");

      // Đợi kết nối hoặc timeout
      return await connectionPromise;
    } catch (error) {
      logger.error("Error connecting to SIP server:", error);
      return false;
    }
  }

  /**
   * Đăng ký với SIP server bằng credentials
   */
  async register(credentials?: SipCredentials): Promise<boolean> {
    if (!this.userAgent || !this.isConnected) {
      logger.error("Cannot register: UserAgent not connected");
      return false;
    }

    try {
      // Lưu credentials nếu được cung cấp
      if (credentials) {
        this.credentials = credentials;
      } else if (!this.credentials) {
        // Nếu không có credentials, thử lấy từ config
        if (!this.config || !this.config.uri || !this.config.password) {
          logger.error("Cannot register: No credentials provided");
          return false;
        }
        // Tạo credentials từ config
        const username = this.config.uri.split(":")[1]?.split("@")[0];
        if (!username) {
          logger.error("Cannot extract username from SIP URI");
          return false;
        }
        this.credentials = {
          username,
          password: this.config.password,
        };
      }

      logger.info("Creating full UserAgent with credentials");

      // Tạo UserAgent mới với credentials đầy đủ
      await this._createFullUserAgent();

      logger.info("Registering with SIP server...");

      // Tạo registerer với call ID tùy chỉnh
      const registerOptions: any = {
        expires: this.config?.registerExpires || 3600,
        refreshFrequency: 90,
        requestOptions: {
          extraHeaders: this.config?.extraHeaders
            ? Object.entries(this.config.extraHeaders).map(
                ([key, value]) => `${key}: ${value}`
              )
            : undefined,
        },
      };

      // Thiết lập call ID tùy chỉnh
      if (!registerOptions.params) {
        registerOptions.params = {};
      }
      registerOptions.params.callId = uuidv4();

      this.registerer = new Registerer(this.userAgent, registerOptions);
      this._setupRegistererListeners();

      // Thực hiện đăng ký
      await this.registerer.register();

      logger.info("Registered with SIP server successfully");
      return true;
    } catch (error) {
      logger.error("Error registering with SIP server:", error);
      return false;
    }
  }

  /**
   * Tạo UserAgent đầy đủ với credentials
   */
  private async _createFullUserAgent(): Promise<void> {
    if (!this.credentials) {
      throw new Error("No credentials available");
    }

    // Nếu có UA cũ, dừng lại trước
    if (this.userAgent) {
      try {
        await this.userAgent.stop();
      } catch (error) {
        logger.warn("Error stopping previous UserAgent:", error);
      }
      this.userAgent = undefined;
    }

    // Tạo URI với username từ credentials
    const domain = this._getDomain();
    const uri = UserAgent.makeURI(`sip:${this.credentials.username}@${domain}`);
    if (!uri) {
      throw new Error(
        `Invalid SIP URI with username ${this.credentials.username}`
      );
    }

    // Tạo cấu hình đầy đủ cho UA
    const userAgentOptions: UserAgentOptions = {
      uri,
      authorizationUsername:
        this.credentials.authorizationName || this.credentials.username,
      authorizationPassword: this.credentials.password,
      displayName: this.config?.displayName,
      transportOptions: {
        server: Array.isArray(this.config?.wsServers)
          ? this.config?.wsServers[0]
          : this.config?.wsServers,
        traceSip: this.config?.traceSip || false,
        connectionTimeout: this.config?.connectionTimeout || 20000,
      },
      contactName: this.credentials.username, // Set contactName to avoid random generation
      viaHost: domain, // Set viaHost for consistency
      logLevel: this.config?.enableLogs ? "debug" : "error",
      sessionDescriptionHandlerFactoryOptions: {
        iceGatheringTimeout: this.config?.iceGatheringTimeout || 5000,
        peerConnectionConfiguration: {
          iceServers: [
            ...(this.config?.stunServers
              ? this.config?.stunServers.map((server) => ({ urls: server }))
              : []),
            ...(this.config?.turnServers || []),
          ],
        },
      },
    };

    // Bật logs nếu cần
    if (this.config?.enableLogs) {
      this._configureLogging(userAgentOptions);
    }

    logger.info(
      "Creating full UserAgent with credentials for",
      this.credentials.username
    );

    // Khởi tạo UserAgent mới
    this.userAgent = new UserAgent(userAgentOptions);

    // Thiết lập các sự kiện
    this._setupUserAgentListeners();

    // Start UA để kết nối
    await this.userAgent.start();
  }

  /**
   * Lấy domain từ cấu hình
   */
  private _getDomain(): string {
    if (!this.config) {
      throw new Error("No config available");
    }

    // Thử lấy domain từ URI
    if (this.config.uri) {
      const domainMatch = this.config.uri.match(/@([^:]+)(?::|$)/);
      if (domainMatch && domainMatch[1]) {
        return domainMatch[1];
      }
    }

    // Thử lấy domain từ wsServers
    if (typeof this.config.wsServers === "string") {
      const wsMatch = this.config.wsServers.match(/\/\/([^:/]+)/);
      if (wsMatch && wsMatch[1]) {
        return wsMatch[1];
      }
    }

    throw new Error("Could not determine domain from config");
  }

  /**
   * Cấu hình logging cho UserAgent
   */
  private _configureLogging(userAgentOptions: any): void {
    try {
      userAgentOptions.logConfiguration = {
        builtinEnabled: true,
        level: this.config?.logLevel || "debug",
        connector: (
          level: string,
          category: string,
          label: string,
          content: string
        ) => {
          const prefix = label ? `[${label}] ` : "";
          switch (level) {
            case "debug":
              logger.debug(`SIP ${category}: ${prefix}${content}`);
              break;
            case "log":
              logger.info(`SIP ${category}: ${prefix}${content}`);
              break;
            case "warn":
              logger.warn(`SIP ${category}: ${prefix}${content}`);
              break;
            case "error":
              logger.error(`SIP ${category}: ${prefix}${content}`);
              break;
            default:
              logger.info(`SIP ${category}: ${prefix}${content}`);
              break;
          }
        },
      };
    } catch (error) {
      logger.warn("Could not set SIP.js custom logger:", error);
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
      this.isConnected = false;

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
      if (this.callbacks.onConnected) this.callbacks.onConnected();
    };

    this.userAgent.transport.onDisconnect = () => {
      const wasConnected = this.isConnected;
      this.isConnected = false;
      this.isRegistered = false;
      logger.info("SIP transport disconnected");
      if (this.callbacks.onDisconnected) this.callbacks.onDisconnected();

      // Thử kết nối lại nếu bị mất kết nối đột ngột
      if (wasConnected && this.config?.autoReconnect) {
        logger.info("Attempting to reconnect...");
        // Thử kết nối lại sau 5 giây
        setTimeout(() => {
          if (this.userAgent && !this.isConnected) {
            logger.debug("Attempting to reconnect after 5 seconds...");
            this.userAgent.start().catch((err) => {
              logger.error("Reconnection failed:", err);
            });
          }
        }, 5000);
      }
    };

    // Xử lý sự kiện trạng thái transport khi thay đổi
    this.userAgent.transport.stateChange.addListener((state) => {
      logger.info(`SIP transport state changed to: ${state}`);

      // Thông báo cho client về trạng thái kết nối
      if (this.callbacks.onTransportStateChange) {
        this.callbacks.onTransportStateChange(state);
      }
    });

    // Xử lý cuộc gọi đến
    this.userAgent.delegate = {
      onInvite: (invitation) => {
        logger.info("Incoming call received");
        if (this.callbacks.onIncomingCall)
          this.callbacks.onIncomingCall(invitation);
      },
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
          if (this.callbacks.onRegistrationFailed)
            this.callbacks.onRegistrationFailed("Registration terminated");
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
