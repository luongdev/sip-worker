import {
  UserAgent,
  InviterOptions,
  SessionState,
  Inviter,
  Registerer,
  RegistererState,
  TransportState,
  URI,
} from "sip.js";
import { LoggerFactory } from "../logger";
import { SipConfig } from "../common/types";
import { Message, MessageType } from "../common/types";
import { IClientManager } from "./types";
import { WorkerSessionDescriptionHandlerFactory } from "./worker-sdh";

// Mở rộng interface SipConfig cho các thuộc tính mới
interface ExtendedSipConfig extends SipConfig {
  transportOnly?: boolean;
  authorizationUsername?: string;
}

// Tạo logger cho SipManager
const logger = LoggerFactory.getInstance().getLogger("SipManager");

// Interface cho callbacks cần thiết
interface SipCallbacks {
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
  private config?: ExtendedSipConfig;
  private callbacks: SipCallbacks = {};
  private initialized: boolean = false;
  private sdpHandlerFactory?: WorkerSessionDescriptionHandlerFactory;
  private clientManager?: IClientManager;

  constructor() {
    logger.info("SipManager initialized");
  }

  /**
   * Thiết lập client manager để khởi tạo SDH factory
   */
  public setClientManager(clientManager: IClientManager): void {
    this.clientManager = clientManager;

    // Tạo SessionDescriptionHandlerFactory nếu có client manager
    if (clientManager) {
      this.sdpHandlerFactory = new WorkerSessionDescriptionHandlerFactory(
        clientManager
      );
      logger.info("WorkerSessionDescriptionHandlerFactory created");
    }
  }

  /**
   * Thiết lập callbacks cho các sự kiện SIP
   */
  public setCallbacks(callbacks: SipCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Lấy callbacks đã thiết lập
   */
  public getCallbacks(): SipCallbacks {
    return this.callbacks;
  }

  /**
   * Tạo URI từ chuỗi
   */
  private _createURI(uriString: string): URI {
    try {
      const uri = UserAgent.makeURI(uriString);
      if (!uri) {
        throw new Error("URI must start with 'sip:'");
      }

      return uri;
    } catch (error) {
      logger.error(`Error creating URI from ${uriString}:`, error);
      throw new Error(`Invalid SIP URI: ${uriString}`);
    }
  }

  /**
   * Khởi tạo SIP UserAgent với cấu hình cung cấp
   */
  public async initialize(config: ExtendedSipConfig): Promise<boolean> {
    logger.info(`Initializing SIP with URI: ${config.uri}`);

    if (this.userAgent) {
      logger.warn(
        "SIP UserAgent already initialized, stopping before reinitializing"
      );
      await this.userAgent.stop();
    }

    // Lưu trữ cấu hình
    this.config = config;

    try {
      if (config.transportOnly) {
        await this._createTransportOnlyUserAgent(config);
      } else {
        if (!this.sdpHandlerFactory) {
          if (!this.clientManager) {
            throw new Error(
              "Client manager is not set, cannot create SessionDescriptionHandlerFactory"
            );
          }
          this.sdpHandlerFactory = new WorkerSessionDescriptionHandlerFactory(
            this.clientManager
          );
        }

        // Tạo URI cho UserAgent
        const uri = this._createURI(config.uri);

        // Tạo User Agent với SessionDescriptionHandlerFactory
        this.userAgent = new UserAgent({
          uri: uri,
          authorizationUsername: config.authorizationUsername || uri.user,
          authorizationPassword: config.password,
          displayName: config.displayName,
          transportOptions: {
            server: Array.isArray(config.wsServers)
              ? config.wsServers[0]
              : config.wsServers,
          },
          // Sử dụng factory như một function
          sessionDescriptionHandlerFactory: (session, options) => {
            return this.sdpHandlerFactory!.create(session, options);
          },
          sessionDescriptionHandlerFactoryOptions: {
            iceGatheringTimeout: config.iceGatheringTimeout || 5000,
            peerConnectionOptions: {
              rtcConfiguration: {
                iceServers: this._getIceServers(config),
              },
            },
          },
        });

        // Đăng ký các callback cho UserAgent
        this._setupUserAgentListeners();
      }

      this.initialized = true;
      return true;
    } catch (error) {
      logger.error("Failed to initialize SIP UserAgent:", error);
      this.initialized = false;
      return false;
    }
  }

  /**
   * Tạo UserAgent chỉ có Transport (không có WebRTC)
   */
  private async _createTransportOnlyUserAgent(
    config: ExtendedSipConfig
  ): Promise<void> {
    logger.info("Creating transport-only UserAgent");

    // Tạo URI cho UserAgent
    const uri = this._createURI(config.uri);

    this.userAgent = new UserAgent({
      uri: uri,
      authorizationUsername: config.authorizationUsername || uri.user,
      authorizationPassword: config.password,
      displayName: config.displayName,
      transportOptions: {
        server: Array.isArray(config.wsServers)
          ? config.wsServers[0]
          : config.wsServers,
      },
      noAnswerTimeout: 60, // 60 seconds
    });

    // Đăng ký các callback cho UserAgent
    this._setupUserAgentListeners();
  }

  /**
   * Lấy danh sách ICE servers từ cấu hình
   */
  private _getIceServers(
    config: ExtendedSipConfig
  ): { urls: string | string[]; username?: string; credential?: string }[] {
    const iceServers = [];

    // Thêm STUN servers
    if (config.stunServers && config.stunServers.length > 0) {
      config.stunServers.forEach((server) => {
        iceServers.push({ urls: server });
      });
    } else {
      // Default STUN servers
      iceServers.push({ urls: "stun:stun.l.google.com:19302" });
    }

    // Thêm TURN servers
    if (config.turnServers && config.turnServers.length > 0) {
      config.turnServers.forEach((server) => {
        iceServers.push({
          urls: server.urls,
          username: server.username,
          credential: server.password,
        });
      });
    }

    return iceServers;
  }

  /**
   * Thiết lập các listeners cho UserAgent
   */
  private _setupUserAgentListeners(): void {
    if (!this.userAgent) return;

    this.userAgent.transport.stateChange.addListener((state) => {
      logger.info(`Transport state changed to: ${state}`);

      switch (state) {
        case TransportState.Connecting:
          this.callbacks.onConnecting?.();
          break;
        case TransportState.Connected:
          this.callbacks.onConnected?.();
          break;
        case TransportState.Disconnected:
          this.callbacks.onDisconnected?.();
          break;
        default:
          break;
      }
    });

    // Đăng ký xử lý cuộc gọi đến
    this.userAgent.delegate = {
      onInvite: (invitation) => {
        logger.info("Received incoming call");

        // Thông báo về cuộc gọi đến
        this.callbacks.onIncomingCall?.(invitation);
      },
    };
  }

  /**
   * Kết nối đến SIP server
   */
  public async connect(): Promise<boolean> {
    if (!this.userAgent) {
      logger.error("Cannot connect: SIP UserAgent not initialized");
      return false;
    }

    try {
      logger.info("Connecting to SIP server...");
      await this.userAgent.start();
      return true;
    } catch (error) {
      logger.error("Error connecting to SIP server:", error);
      return false;
    }
  }

  /**
   * Đăng ký với SIP server
   */
  public async register(credentials?: any): Promise<boolean> {
    if (!this.userAgent) {
      logger.error("Cannot register: SIP UserAgent not initialized");
      return false;
    }

    try {
      // Tạo registerer nếu chưa có
      if (!this.registerer) {
        this.registerer = new Registerer(this.userAgent);

        // Thiết lập các listeners
        this.registerer.stateChange.addListener((state) => {
          logger.info(`Registration state changed to: ${state}`);

          switch (state) {
            case RegistererState.Registered:
              this.callbacks.onRegistered?.();
              break;
            case RegistererState.Unregistered:
              this.callbacks.onUnregistered?.();
              break;
            default:
              break;
          }
        });
      }

      // Thực hiện đăng ký
      logger.info("Registering with SIP server...");
      await this.registerer.register();
      return true;
    } catch (error) {
      logger.error("Error registering with SIP server:", error);

      // Thông báo lỗi đăng ký
      if (this.callbacks.onRegistrationFailed) {
        const cause = error instanceof Error ? error.message : "Unknown error";
        this.callbacks.onRegistrationFailed(cause);
      }

      return false;
    }
  }

  /**
   * Hủy đăng ký với SIP server
   */
  public async unregister(): Promise<boolean> {
    if (!this.registerer) {
      logger.warn("Cannot unregister: Not registered");
      return false;
    }

    try {
      logger.info("Unregistering from SIP server...");
      await this.registerer.unregister();
      return true;
    } catch (error) {
      logger.error("Error unregistering from SIP server:", error);
      return false;
    }
  }

  /**
   * Thực hiện cuộc gọi đi
   */
  public async makeCall(target: string, options?: any): Promise<any> {
    if (!this.userAgent) {
      throw new Error("Cannot make call: SIP UserAgent not initialized");
    }

    // Tạo URI từ target
    const targetUri = this._createURI(target);

    // Tạo inviter
    const inviterOptions: InviterOptions = {
      sessionDescriptionHandlerOptions: {
        constraints: {
          audio: true,
          video: false,
        },
        ...options?.sessionDescriptionHandlerOptions,
      },
    };

    const inviter = new Inviter(this.userAgent, targetUri, inviterOptions);

    // Thiết lập các listeners
    inviter.stateChange.addListener((state) => {
      logger.info(`Call state changed to: ${state}`);

      switch (state) {
        case SessionState.Establishing:
          // Đang thiết lập cuộc gọi
          break;
        case SessionState.Established:
          // Cuộc gọi đã được thiết lập
          break;
        case SessionState.Terminated:
          // Cuộc gọi đã kết thúc
          break;
        default:
          break;
      }
    });

    // Bắt đầu cuộc gọi
    try {
      logger.info(`Making call to ${target}...`);
      await inviter.invite();
      return inviter;
    } catch (error) {
      logger.error(`Error making call to ${target}:`, error);
      throw error;
    }
  }

  /**
   * Kiểm tra đã khởi tạo UserAgent chưa
   */
  public isInitialized(): boolean {
    return this.initialized && !!this.userAgent;
  }

  /**
   * Xử lý các SDP message (SDP_RESPONSE, ICE_CANDIDATE, CONNECTION_STATE_CHANGE)
   */
  public handleSdpMessage(message: Message): void {
    if (!this.sdpHandlerFactory) {
      logger.error(
        "Cannot handle SDP message: SessionDescriptionHandlerFactory not initialized"
      );
      return;
    }

    const clientId = message.clientId as string;

    switch (message.type) {
      case MessageType.SDP_RESPONSE:
        // Xử lý SDP response
        this.sdpHandlerFactory.handleSdpResponse(message.payload, clientId);
        break;

      case MessageType.ICE_CANDIDATE:
        // Xử lý ICE candidate
        this.sdpHandlerFactory.handleIceCandidate(message.payload, clientId);
        break;

      case MessageType.CONNECTION_STATE_CHANGE:
        // Xử lý thay đổi trạng thái kết nối
        this.sdpHandlerFactory.handleConnectionStateChange(
          message.payload,
          clientId
        );
        break;

      default:
        logger.warn(`Unhandled SDP message type: ${message.type}`);
        break;
    }
  }
}
