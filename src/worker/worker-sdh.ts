/**
 * WorkerSessionDescriptionHandler
 *
 * Triển khai SessionDescriptionHandler cho SharedWorker với WebRTC
 *
 * LƯU Ý QUAN TRỌNG:
 * Worker làm nhiệm vụ proxy cho WebRTC API
 * - SharedWorker không có quyền truy cập trực tiếp vào WebRTC APIs
 * - Mọi thao tác liên quan đến RTCPeerConnection phải được chuyển tiếp đến client browser
 * - Worker chỉ lưu trữ trạng thái và chuyển tiếp các yêu cầu/phản hồi
 * - Client browser thực sự tạo và quản lý RTCPeerConnection
 */

import { LoggerFactory } from "../logger";
import { v4 as uuidv4 } from "uuid";
import { IClientManager } from "./types";
import { WorkerSessionDescriptionHandlerOptions } from "./types";
import { SessionDescriptionHandler } from "sip.js";
import { MessageType } from "../common/types";

// Tạo logger
const logger = LoggerFactory.getInstance().getLogger("WorkerSDH");

/**
 * Định nghĩa các loại tin nhắn giao tiếp với client
 */
export enum SdpRequestType {
  CREATE_OFFER = "createOffer",
  CREATE_ANSWER = "createAnswer",
  SET_REMOTE_DESCRIPTION = "setRemoteDescription",
  SET_LOCAL_DESCRIPTION = "setLocalDescription",
  GET_COMPLETE_SDP = "getCompleteSdp",
  ADD_ICE_CANDIDATE = "addIceCandidate",
  GET_STATS = "getStats",
  CLOSE = "close",
  SEND_DTMF = "sendDtmf",
}

/**
 * Interface mô tả session description tương tự như RTCSessionDescriptionInit
 * nhưng không phụ thuộc vào DOM APIs.
 * Đây là cấu trúc serialize/deserialize để chuyển giữa worker và client.
 */
export interface SessionDescriptionInit {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp: string;
}

/**
 * Interface mô tả ice candidate để trao đổi với client
 */
export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
}

/**
 * Interface mô tả request gửi từ Worker đến Client
 */
interface SdpRequest {
  operation: SdpRequestType;
  requestId: string;
  data?: any;
  options?: any;
}

/**
 * Interface mô tả response gửi từ Client đến Worker
 */
interface SdpResponse {
  requestId: string;
  result: any;
  error?: string;
}

/**
 * Interface cho delegate events từ SIP.js
 * Trong worker, chúng ta chỉ lưu trữ các handlers này
 * và gọi lại chúng khi nhận được event từ client
 */
export interface PeerConnectionDelegate {
  ontrack: (event: any) => void;
  onicecandidate: (candidate: IceCandidate | null) => void;
  oniceconnectionstatechange: (state: string) => void;
}

/**
 * WorkerSessionDescriptionHandler implement SessionDescriptionHandler interface
 * để giao tiếp với SIP.js
 *
 * Class này là một proxy chuyển tiếp yêu cầu từ SIP.js đến client browser
 * và chuyển tiếp kết quả từ browser trở lại SIP.js
 */
export class WorkerSessionDescriptionHandler
  implements SessionDescriptionHandler
{
  private clientManager: IClientManager;
  private clientId?: string;
  private sessionId: string;
  private iceGatheringTimeout: number;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timer?: any;
    }
  >;
  private localDescription?: SessionDescriptionInit;
  private remoteDescription?: SessionDescriptionInit;
  private connectionState: string = "new";
  private iceCandidates: IceCandidate[] = [];
  private iceGatheringState: string = "new";
  private trickleCandidates: boolean;
  private requestTimeout: number = 30000; // 30 giây timeout mặc định
  private closed: boolean = false;

  // Delegate từ SIP.js để xử lý events từ PeerConnection
  public peerConnectionDelegate: PeerConnectionDelegate = {
    ontrack: (event) => {
      logger.debug("ontrack delegate called, but no handler registered");
    },
    onicecandidate: (candidate) => {
      logger.debug(
        `onicecandidate delegate called: ${JSON.stringify(candidate)}`
      );
      if (candidate) {
        this.iceCandidates.push(candidate);
      }
    },
    oniceconnectionstatechange: (state) => {
      logger.debug(`oniceconnectionstatechange delegate called: ${state}`);
      this.connectionState = state;
    },
  };

  /**
   * WorkerSessionDescriptionHandler constructor
   */
  constructor(
    clientManager: IClientManager,
    options?: WorkerSessionDescriptionHandlerOptions
  ) {
    this.clientManager = clientManager;
    this.clientId = options?.clientId;
    this.sessionId = uuidv4();
    this.iceGatheringTimeout = options?.iceGatheringTimeout || 5000;
    this.trickleCandidates = options?.trickleCandidates !== false; // Mặc định là true
    this.pendingRequests = new Map();

    logger.info(
      `New WorkerSessionDescriptionHandler created, sessionId=${this.sessionId}, clientId=${this.clientId}`
    );
  }

  /**
   * Lấy description hiện tại (local SDP) - Được gọi bởi SIP.js
   * Chuyển tiếp yêu cầu tạo SDP đến client, lưu trữ và trả về kết quả
   */
  public getDescription(options?: any): Promise<any> {
    logger.debug(`getDescription called, options=${JSON.stringify(options)}`);

    if (this.closed) {
      return Promise.reject(new Error("SessionDescriptionHandler closed"));
    }

    // Xác định xem tạo offer hay answer
    const isOffer = !this.remoteDescription;
    const operation = isOffer
      ? SdpRequestType.CREATE_OFFER
      : SdpRequestType.CREATE_ANSWER;

    return new Promise<any>(async (resolve, reject) => {
      try {
        // Tạo SDP từ client - client sẽ tạo offer/answer thông qua RTCPeerConnection
        const sdp = await this._sendSdpRequest({
          operation,
          options: {
            iceGatheringTimeout: this.iceGatheringTimeout,
            trickleCandidates: this.trickleCandidates,
            ...options,
          },
        });

        // Lưu local description trong worker
        this.localDescription = {
          type: isOffer ? "offer" : "answer",
          sdp: sdp.sdp,
        };

        // Set localDescription trên client nếu cần (client đặt trên PeerConnection)
        if (!this.trickleCandidates) {
          await this._sendSdpRequest({
            operation: SdpRequestType.SET_LOCAL_DESCRIPTION,
            data: this.localDescription,
          });

          // Chờ ICE gathering hoàn tất để có SDP đầy đủ
          await this._waitForIceGathering();

          // Lấy SDP hoàn chỉnh với ICE candidates
          const completeSdp = await this._sendSdpRequest({
            operation: SdpRequestType.GET_COMPLETE_SDP,
          });

          // Cập nhật local description với SDP đầy đủ
          this.localDescription = {
            type: isOffer ? "offer" : "answer",
            sdp: completeSdp.sdp,
          };
        } else {
          // Set localDescription trên client để bắt đầu ICE gathering
          await this._sendSdpRequest({
            operation: SdpRequestType.SET_LOCAL_DESCRIPTION,
            data: this.localDescription,
          });
        }

        // Trả về kết quả cho SIP.js
        resolve({
          body: this.localDescription.sdp,
          contentType: "application/sdp",
        });
      } catch (error) {
        logger.error(`getDescription failed: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * Thiết lập description từ remote (remote SDP) - Được gọi bởi SIP.js
   * Lưu trữ SDP và chuyển tiếp đến client để thiết lập trên PeerConnection
   */
  public setDescription(
    sessionDescription: string,
    options?: any
  ): Promise<void> {
    logger.debug(
      `setDescription called, type=${
        this.remoteDescription ? "answer" : "offer"
      }`
    );

    if (this.closed) {
      return Promise.reject(new Error("SessionDescriptionHandler closed"));
    }

    // Xác định loại SDP (offer hoặc answer)
    const type = this.remoteDescription ? "answer" : "offer";

    // Lưu remote description trong worker
    this.remoteDescription = {
      type,
      sdp: sessionDescription,
    };

    // Reset ICE candidates khi nhận remote offer mới
    if (type === "offer") {
      this.iceCandidates = [];
      this.iceGatheringState = "new";
    }

    // Gửi tới client để set remote description trên RTCPeerConnection
    return this._sendSdpRequest({
      operation: SdpRequestType.SET_REMOTE_DESCRIPTION,
      data: this.remoteDescription,
    });
  }

  /**
   * Gửi DTMF - Được gọi bởi SIP.js
   * Chuyển tiếp yêu cầu gửi DTMF đến client
   */
  public sendDtmf(tones: string, options?: any): boolean {
    if (this.closed) {
      logger.error("Cannot send DTMF: SessionDescriptionHandler is closed");
      return false;
    }

    logger.debug(`sendDtmf called, tones=${tones}`);

    // Gửi yêu cầu DTMF đến client (không đợi Promise)
    this._sendSdpRequest({
      operation: SdpRequestType.SEND_DTMF,
      data: { tones, options },
    }).catch((error) => {
      logger.error(`Failed to send DTMF: ${error}`);
    });

    return true;
  }

  /**
   * Có hỗ trợ DTMF hay không - Được gọi bởi SIP.js
   */
  public hasDescription(contentType: string): boolean {
    return (
      contentType === "application/sdp" && this.localDescription !== undefined
    );
  }

  /**
   * Đóng kết nối - Được gọi bởi SIP.js
   * Dọn dẹp tài nguyên và thông báo cho client đóng PeerConnection
   */
  public close(): void {
    logger.debug(`close called`);

    if (this.closed) {
      return;
    }

    this.closed = true;

    // Hủy tất cả pending requests
    this.pendingRequests.forEach((request, requestId) => {
      if (request.timer) {
        clearTimeout(request.timer);
      }
      request.reject(new Error("SessionDescriptionHandler closed"));
    });

    this.pendingRequests.clear();

    // Gửi lệnh đóng kết nối đến client
    this._sendSdpRequest({
      operation: SdpRequestType.CLOSE,
    }).catch((error) => {
      logger.error(`Error closing connection: ${error}`);
    });

    // Xóa mọi tham chiếu
    this.iceCandidates = [];
    this.localDescription = undefined;
    this.remoteDescription = undefined;
  }

  /**
   * Lấy ID của session
   */
  public getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Lấy ID của client
   */
  public getClientId(): string | undefined {
    return this.clientId;
  }

  /**
   * Xử lý tin nhắn phản hồi từ client
   * @param response Phản hồi từ client
   */
  public handleClientMessage(response: SdpResponse): void {
    const { requestId, result, error } = response;

    logger.debug(`Received response for requestId=${requestId}`);

    // Tìm request đang chờ
    const pendingRequest = this.pendingRequests.get(requestId);
    if (!pendingRequest) {
      logger.warn(`No pending request found for requestId=${requestId}`);
      return;
    }

    // Xóa request khỏi danh sách chờ
    this.pendingRequests.delete(requestId);

    // Hủy timer nếu có
    if (pendingRequest.timer) {
      clearTimeout(pendingRequest.timer);
    }

    // Xử lý kết quả
    if (error) {
      logger.error(`Request ${requestId} failed: ${error}`);
      pendingRequest.reject(new Error(error));
    } else {
      logger.debug(`Request ${requestId} completed successfully`);
      pendingRequest.resolve(result);
    }
  }

  /**
   * Xử lý ICE candidate từ client
   * @param candidate ICE candidate
   */
  public handleIceCandidate(candidate: IceCandidate | null): void {
    logger.debug(`Received ICE candidate: ${JSON.stringify(candidate)}`);

    if (candidate) {
      // Thêm candidate vào danh sách
      this.iceCandidates.push(candidate);

      // Gọi delegate nếu đang ở trickle mode
      if (
        this.trickleCandidates &&
        typeof this.peerConnectionDelegate.onicecandidate === "function"
      ) {
        this.peerConnectionDelegate.onicecandidate(candidate);
      }

      // Nếu đang ở non-trickle mode, thì gửi candidate đến client để thêm vào PeerConnection
      if (!this.trickleCandidates) {
        this._sendSdpRequest({
          operation: SdpRequestType.ADD_ICE_CANDIDATE,
          data: candidate,
        }).catch((error) => {
          logger.error(`Error adding ICE candidate: ${error}`);
        });
      }
    } else {
      // null candidate đánh dấu kết thúc quá trình thu thập ICE
      this.iceGatheringState = "complete";

      // Gọi delegate với candidate null nếu đang ở trickle mode
      if (
        this.trickleCandidates &&
        typeof this.peerConnectionDelegate.onicecandidate === "function"
      ) {
        this.peerConnectionDelegate.onicecandidate(null);
      }
    }
  }

  /**
   * Xử lý thay đổi trạng thái kết nối từ client
   * @param state Trạng thái kết nối mới
   */
  public handleConnectionStateChange(state: string): void {
    logger.debug(`Connection state changed to: ${state}`);

    // Cập nhật trạng thái
    this.connectionState = state;

    // Gọi delegate nếu được đăng ký
    if (
      typeof this.peerConnectionDelegate.oniceconnectionstatechange ===
      "function"
    ) {
      this.peerConnectionDelegate.oniceconnectionstatechange(state);
    }
  }

  /**
   * Xử lý thay đổi trạng thái ICE gathering từ client
   * @param state Trạng thái ice gathering mới
   */
  public handleIceGatheringStateChange(state: string): void {
    logger.debug(`ICE gathering state changed to: ${state}`);
    this.iceGatheringState = state;
  }

  /**
   * Chờ cho quá trình ICE gathering hoàn tất
   * Được sử dụng khi không dùng trickle ICE
   */
  private async _waitForIceGathering(): Promise<void> {
    // Nếu đã hoàn tất, trả về ngay
    if (this.iceGatheringState === "complete") {
      return;
    }

    logger.debug(`Waiting for ICE gathering completion...`);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        logger.warn(
          `ICE gathering timeout after ${this.iceGatheringTimeout}ms`
        );
        resolve(); // Vẫn resolve để tiếp tục process
      }, this.iceGatheringTimeout);

      // Tạo hàm kiểm tra trạng thái định kỳ
      const checkState = () => {
        if (this.iceGatheringState === "complete") {
          clearTimeout(timeout);
          resolve();
          return;
        }

        setTimeout(checkState, 50); // Kiểm tra mỗi 50ms
      };

      checkState();
    });
  }

  /**
   * Gửi SDP request đến client và chờ phản hồi
   * Đây là phương thức chính để giao tiếp với client browser
   */
  private _sendSdpRequest(
    request: Partial<SdpRequest>,
    timeout: number = this.requestTimeout
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      // Kiểm tra xem có client ID không
      if (!this.clientId) {
        // Nếu không có client ID, thử lấy client ID đầu tiên trong danh sách
        const clientIds = this.clientManager.getAllClientIds();
        if (clientIds.length > 0) {
          this.clientId = clientIds[0];
          logger.info(`Auto-selected client: ${this.clientId}`);
        } else {
          return reject(new Error("No clients connected"));
        }
      }

      // Tạo ID cho request
      const requestId = uuidv4();

      // Tạo request đầy đủ
      const fullRequest: SdpRequest = {
        operation: request.operation as SdpRequestType,
        requestId,
        data: request.data,
        options: request.options,
      };

      logger.debug(
        `Creating SDP request: ${fullRequest.operation}, requestId: ${requestId}`
      );

      // Lưu promise callback vào map
      const timer = setTimeout(() => {
        // Xóa request khỏi map nếu timeout
        if (this.pendingRequests.has(requestId)) {
          const pendingRequest = this.pendingRequests.get(requestId);
          this.pendingRequests.delete(requestId);

          logger.error(
            `Request timeout after ${timeout}ms: ${fullRequest.operation}, requestId: ${requestId}`
          );

          // Reject promise với lỗi timeout
          pendingRequest?.reject(
            new Error(
              `Request timeout after ${timeout}ms: ${fullRequest.operation}`
            )
          );
        }
      }, timeout);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      // Chuẩn bị payload cho message - đảm bảo client nhận được đúng cấu trúc
      const messagePayload = {
        sessionId: this.sessionId,
        request: fullRequest, // Sử dụng fullRequest thay vì truyền trực tiếp các thuộc tính
      };

      logger.debug(
        `Sending SDP request to client ${this.clientId}: ${JSON.stringify(
          messagePayload,
          null,
          2
        )}`
      );

      // Gửi tin nhắn đến client thông qua ClientManager
      // Client sẽ thực hiện thao tác trên RTCPeerConnection thực tế
      const sent = this.clientManager.sendToClient(this.clientId, {
        type: MessageType.SDP_REQUEST,
        payload: messagePayload,
        clientId: this.clientId,
      });

      // Nếu không gửi được, reject promise
      if (!sent) {
        logger.error(`Failed to send request to client: ${this.clientId}`);
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new Error(`Failed to send request to client: ${this.clientId}`));
      } else {
        logger.debug(
          `SDP request sent successfully: ${fullRequest.operation}, requestId: ${requestId}`
        );
      }
    });
  }

  /**
   * Đặt active client
   */
  public setClientId(clientId: string): void {
    if (this.clientId !== clientId) {
      logger.info(
        `Changing active client from ${this.clientId} to ${clientId}`
      );
      this.clientId = clientId;
    }
  }

  /**
   * Lấy trạng thái kết nối
   */
  public getConnectionState(): string {
    return this.connectionState;
  }
}

/**
 * Factory tạo WorkerSessionDescriptionHandler
 *
 * Quản lý các session handler và luồng thông điệp SDP
 * Đóng vai trò trung gian giữa SIP.js và client browser.
 */
export class WorkerSessionDescriptionHandlerFactory {
  private clientManager: IClientManager;
  private options: WorkerSessionDescriptionHandlerOptions;
  private activeSessions: Map<
    string,
    Map<string, WorkerSessionDescriptionHandler>
  > = new Map();

  constructor(
    clientManager: IClientManager,
    options?: WorkerSessionDescriptionHandlerOptions
  ) {
    this.clientManager = clientManager;
    this.options = {
      iceGatheringTimeout: 5000,
      trickleCandidates: true,
      ...options,
    };

    logger.info(
      `SessionDescriptionHandlerFactory created, iceGatheringTimeout=${this.options.iceGatheringTimeout}`
    );
  }

  /**
   * Tạo mới một SessionDescriptionHandler - Được gọi bởi SIP.js
   * Phương thức này yêu cầu bởi SIP.js SessionDescriptionHandlerFactory interface
   */
  public create(session: any, options?: any): WorkerSessionDescriptionHandler {
    // Merge options từ factory và session
    const mergedOptions = {
      ...this.options,
      ...options,
    };

    // Lấy clientId từ options hoặc từ session nếu có
    if (session?.userAgent?.configuration?.sdpHandlerClientId) {
      mergedOptions.clientId =
        session.userAgent.configuration.sdpHandlerClientId;
    }

    // Tạo instance mới
    const handler = new WorkerSessionDescriptionHandler(
      this.clientManager,
      mergedOptions
    );

    // Thiết lập delegate callbacks để session có thể nhận events từ PeerConnection
    if (session) {
      // Gán delegates từ session vào handler nếu tồn tại
      if (session.delegate?.onTrack) {
        handler.peerConnectionDelegate.ontrack = session.delegate.onTrack.bind(
          session.delegate
        );
      }

      if (session.delegate?.onIceCandidate) {
        handler.peerConnectionDelegate.onicecandidate =
          session.delegate.onIceCandidate.bind(session.delegate);
      }

      if (session.delegate?.onIceConnectionStateChange) {
        handler.peerConnectionDelegate.oniceconnectionstatechange =
          session.delegate.onIceConnectionStateChange.bind(session.delegate);
      }
    }

    // Lưu sesssion
    const sessionId = handler.getSessionId();
    const clientId = handler.getClientId() || "default";

    // Khởi tạo map cho client nếu chưa có
    if (!this.activeSessions.has(clientId)) {
      this.activeSessions.set(clientId, new Map());
    }

    // Lưu handler vào map
    this.activeSessions.get(clientId)?.set(sessionId, handler);

    logger.debug(
      `Created new WorkerSessionDescriptionHandler for session=${sessionId}, client=${clientId}`
    );

    return handler;
  }

  /**
   * Kiểm tra xem sdh có hỗ trợ đặc tính nào đó không
   * Phương thức này có thể được yêu cầu bởi SIP.js SessionDescriptionHandlerFactory interface
   */
  public hasDescription(contentType: string): boolean {
    return contentType === "application/sdp";
  }

  /**
   * Xử lý SDP response từ client
   * Tìm handler tương ứng và chuyển tiếp phản hồi
   * @param payload Dữ liệu response
   * @param clientId ID của client
   */
  public handleSdpResponse(payload: any, clientId: string): void {
    if (!payload || !payload.sessionId) {
      logger.error(
        `Invalid SDP response from client ${clientId}, missing sessionId`
      );
      return;
    }

    const { sessionId, response } = payload;

    // Tìm session tương ứng
    const sessions = this.activeSessions.get(clientId);
    const handler = sessions?.get(sessionId);

    if (!handler) {
      logger.warn(
        `No handler found for sessionId=${sessionId}, clientId=${clientId}`
      );
      return;
    }

    // Chuyển tiếp đến handler
    handler.handleClientMessage(response);
  }

  /**
   * Xử lý ICE candidate từ client
   * Tìm handler tương ứng và chuyển tiếp sự kiện
   * @param payload Dữ liệu ICE candidate
   * @param clientId ID của client
   */
  public handleIceCandidate(payload: any, clientId: string): void {
    if (!payload || !payload.sessionId) {
      logger.error(
        `Invalid ICE candidate from client ${clientId}, missing sessionId`
      );
      return;
    }

    const { sessionId, candidate } = payload;

    // Tìm session tương ứng
    const sessions = this.activeSessions.get(clientId);
    const handler = sessions?.get(sessionId);

    if (!handler) {
      logger.warn(
        `No handler found for sessionId=${sessionId}, clientId=${clientId}`
      );
      return;
    }

    // Xử lý ICE candidate trong handler
    handler.handleIceCandidate(candidate);
  }

  /**
   * Xử lý thay đổi trạng thái kết nối từ client
   * Tìm handler tương ứng và chuyển tiếp sự kiện
   * @param payload Dữ liệu trạng thái kết nối
   * @param clientId ID của client
   */
  public handleConnectionStateChange(payload: any, clientId: string): void {
    if (!payload || !payload.sessionId) {
      logger.error(
        `Invalid connection state change from client ${clientId}, missing sessionId`
      );
      return;
    }

    const { sessionId, state } = payload;

    // Tìm session tương ứng
    const sessions = this.activeSessions.get(clientId);
    const handler = sessions?.get(sessionId);

    if (!handler) {
      logger.warn(
        `No handler found for sessionId=${sessionId}, clientId=${clientId}`
      );
      return;
    }

    // Xử lý thay đổi trạng thái trong handler
    handler.handleConnectionStateChange(state);
  }

  /**
   * Xử lý thay đổi trạng thái ICE gathering từ client
   * @param payload Dữ liệu trạng thái ICE gathering
   * @param clientId ID của client
   */
  public handleIceGatheringStateChange(payload: any, clientId: string): void {
    if (!payload || !payload.sessionId) {
      logger.error(
        `Invalid ICE gathering state change from client ${clientId}, missing sessionId`
      );
      return;
    }

    const { sessionId, state } = payload;

    // Tìm session tương ứng
    const sessions = this.activeSessions.get(clientId);
    const handler = sessions?.get(sessionId);

    if (!handler) {
      logger.warn(
        `No handler found for sessionId=${sessionId}, clientId=${clientId}`
      );
      return;
    }

    // Xử lý thay đổi trạng thái trong handler
    handler.handleIceGatheringStateChange(state);
  }

  /**
   * Xóa session khi đã kết thúc
   * @param sessionId ID của session
   * @param clientId ID của client
   */
  public removeSession(sessionId: string, clientId?: string): void {
    if (clientId) {
      // Xóa session cụ thể nếu biết clientId
      const sessions = this.activeSessions.get(clientId);
      if (sessions && sessions.has(sessionId)) {
        sessions.delete(sessionId);
        logger.debug(`Removed session ${sessionId} for client ${clientId}`);
      }
    } else {
      // Tìm session trong tất cả clients nếu không biết clientId
      this.activeSessions.forEach((sessions, cId) => {
        if (sessions.has(sessionId)) {
          sessions.delete(sessionId);
          logger.debug(`Removed session ${sessionId} for client ${cId}`);
        }
      });
    }
  }
}
