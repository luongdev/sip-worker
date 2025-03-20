import { ISipClient } from "./types";
import { MessageType } from "../common/types";
import { LoggerFactory } from "../logger";

// Tạo logger cho PeerConnectionManager
const logger = LoggerFactory.getInstance().getLogger("PeerConnectionManager");

export enum SdpRequestType {
  CREATE_OFFER = "createOffer",
  CREATE_ANSWER = "createAnswer",
  SET_LOCAL_DESCRIPTION = "setLocalDescription",
  SET_REMOTE_DESCRIPTION = "setRemoteDescription",
  GET_STATS = "getStats",
  ADD_ICE_CANDIDATE = "addIceCandidate",
  CLOSE = "close",
}

export interface RTCSessionDescriptionInit {
  sdp: string;
  type: "offer" | "answer" | "pranswer" | "rollback";
}

export class PeerConnectionManager {
  private peerConnection: RTCPeerConnection | null = null;
  private remoteStream: MediaStream | null = null;
  private localStream: MediaStream | null = null;
  private iceCandidates: RTCIceCandidate[] = [];
  private client: ISipClient;
  private dtmfSender: RTCDTMFSender | null = null;

  constructor(client: ISipClient) {
    this.client = client;
  }

  /**
   * Khởi tạo RTCPeerConnection với cấu hình ICE servers
   */
  public initialize(iceServers: RTCIceServer[] = []): RTCPeerConnection {
    logger.info("Initializing PeerConnection");

    if (this.peerConnection) {
      logger.info("Closing existing PeerConnection");
      this.peerConnection.close();
    }

    this.peerConnection = new RTCPeerConnection({
      iceServers:
        iceServers.length > 0
          ? iceServers
          : [{ urls: "stun:stun.l.google.com:19302" }],
      iceCandidatePoolSize: 10,
    });

    // Event handlers
    this.peerConnection.onicecandidate = this.handleIceCandidate.bind(this);
    this.peerConnection.ontrack = this.handleTrackEvent.bind(this);
    this.peerConnection.oniceconnectionstatechange =
      this.handleIceConnectionStateChange.bind(this);

    logger.info("PeerConnection initialized successfully");
    return this.peerConnection;
  }

  /**
   * Xử lý các yêu cầu SDP từ worker
   */
  public async handleSdpRequest(payload: any): Promise<any> {
    const { operation, requestId, data, options } = payload;

    logger.debug(`Handling SDP request: ${operation}`);

    try {
      switch (operation) {
        case SdpRequestType.CREATE_OFFER:
          return await this.createOffer(options);

        case SdpRequestType.CREATE_ANSWER:
          return await this.createAnswer(options);

        case SdpRequestType.SET_LOCAL_DESCRIPTION:
          await this.setLocalDescription(data);
          return { success: true };

        case SdpRequestType.SET_REMOTE_DESCRIPTION:
          await this.setRemoteDescription(data);
          return { success: true };

        case SdpRequestType.GET_STATS:
          return await this.getCompleteSdp();

        case SdpRequestType.ADD_ICE_CANDIDATE:
          await this.addIceCandidate(data);
          return { success: true };

        case SdpRequestType.CLOSE:
          this.close();
          return { success: true };

        default:
          throw new Error(`Unknown SDP operation: ${operation}`);
      }
    } catch (error) {
      logger.error(
        `Error handling SDP request: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Thiết lập stream media local
   */
  public async setLocalStream(
    constraints: MediaStreamConstraints
  ): Promise<MediaStream> {
    try {
      logger.info("Getting user media with constraints:", constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.localStream = stream;

      if (this.peerConnection) {
        stream.getTracks().forEach((track) => {
          logger.debug(`Adding ${track.kind} track to PeerConnection`);
          this.peerConnection?.addTrack(track, stream);

          // Thiết lập DTMF sender cho track audio
          if (track.kind === "audio" && !this.dtmfSender) {
            this.dtmfSender = this.peerConnection?.createDTMFSender(track);
          }
        });
      }

      return stream;
    } catch (error) {
      logger.error(
        `Error getting user media: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Tạo SDP offer
   */
  private async createOffer(
    options?: RTCOfferOptions
  ): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      logger.error("Cannot create offer: PeerConnection is null");
      throw new Error("PeerConnection is null");
    }

    try {
      const offer = await this.peerConnection.createOffer(options);
      await this.peerConnection.setLocalDescription(offer);

      return {
        sdp: offer.sdp,
        type: offer.type,
      };
    } catch (error) {
      logger.error(
        `Error creating offer: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Tạo SDP answer
   */
  private async createAnswer(
    options?: RTCAnswerOptions
  ): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      logger.error("Cannot create answer: PeerConnection is null");
      throw new Error("PeerConnection is null");
    }

    try {
      const answer = await this.peerConnection.createAnswer(options);
      await this.peerConnection.setLocalDescription(answer);

      return {
        sdp: answer.sdp,
        type: answer.type,
      };
    } catch (error) {
      logger.error(
        `Error creating answer: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Thiết lập local description
   */
  private async setLocalDescription(
    data: RTCSessionDescriptionInit
  ): Promise<void> {
    if (!this.peerConnection) {
      logger.error("Cannot set local description: PeerConnection is null");
      throw new Error("PeerConnection is null");
    }

    try {
      await this.peerConnection.setLocalDescription(
        new RTCSessionDescription(data)
      );
    } catch (error) {
      logger.error(
        `Error setting local description: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Thiết lập remote description
   */
  private async setRemoteDescription(
    data: RTCSessionDescriptionInit
  ): Promise<void> {
    if (!this.peerConnection) {
      logger.error("Cannot set remote description: PeerConnection is null");
      throw new Error("PeerConnection is null");
    }

    try {
      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(data)
      );
    } catch (error) {
      logger.error(
        `Error setting remote description: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Lấy local SDP hiện tại
   */
  private async getCompleteSdp(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      logger.error("Cannot get complete SDP: PeerConnection is null");
      throw new Error("PeerConnection is null");
    }

    return {
      sdp: this.peerConnection.localDescription?.sdp || "",
      type: this.peerConnection.localDescription?.type as
        | "offer"
        | "answer"
        | "pranswer"
        | "rollback",
    };
  }

  /**
   * Đóng kết nối PeerConnection và giải phóng tài nguyên
   */
  public close(): void {
    logger.info("Closing PeerConnection and releasing resources");

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.remoteStream = null;
    this.iceCandidates = [];
    this.dtmfSender = null;
  }

  /**
   * Xử lý ICE candidate
   */
  private handleIceCandidate(event: RTCPeerConnectionIceEvent): void {
    if (event.candidate) {
      logger.debug(`New ICE candidate: ${event.candidate.candidate}`);
      this.iceCandidates.push(event.candidate);

      // Chuyển đổi RTCIceCandidate sang dữ liệu serializable
      const serializedCandidate = {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        usernameFragment: event.candidate.usernameFragment,
      };

      // Gửi candidate đến worker
      this.client.sendMessage({
        type: MessageType.ICE_CANDIDATE,
        payload: {
          candidate: serializedCandidate,
        },
      });
    }
  }

  /**
   * Thêm ICE candidate
   */
  public async addIceCandidate(candidateData: any): Promise<void> {
    if (!this.peerConnection) {
      logger.error("Cannot add ICE candidate: PeerConnection not initialized");
      throw new Error("PeerConnection not initialized");
    }

    try {
      // Tạo RTCIceCandidate từ dữ liệu serialized
      const candidate = new RTCIceCandidate({
        candidate: candidateData.candidate,
        sdpMid: candidateData.sdpMid,
        sdpMLineIndex: candidateData.sdpMLineIndex,
        usernameFragment: candidateData.usernameFragment,
      });

      logger.debug(`Adding ICE candidate: ${candidate.candidate}`);
      await this.peerConnection.addIceCandidate(candidate);
    } catch (error) {
      logger.error(
        `Error adding ICE candidate: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Xử lý sự kiện track
   */
  private handleTrackEvent(event: RTCTrackEvent): void {
    if (event.streams && event.streams[0]) {
      logger.info(`Received ${event.track.kind} track from remote peer`);
      this.remoteStream = event.streams[0];

      // Khởi tạo DTMF sender nếu là audio track
      if (event.track.kind === "audio") {
        this.dtmfSender = this.peerConnection?.createDTMFSender(event.track);
      }
    }
  }

  /**
   * Xử lý thay đổi trạng thái kết nối ICE
   */
  private handleIceConnectionStateChange(): void {
    if (!this.peerConnection) return;

    logger.info(
      `ICE connection state changed: ${this.peerConnection.iceConnectionState}`
    );

    // Thông báo cho worker về thay đổi trạng thái kết nối
    this.client.sendMessage({
      type: MessageType.CONNECTION_STATE_CHANGE,
      payload: {
        type: "ice",
        state: this.peerConnection.iceConnectionState,
      },
    });
  }

  /**
   * Gửi DTMF tones
   */
  public sendDtmf(
    tones: string,
    options?: { duration?: number; interToneGap?: number }
  ): boolean {
    if (!this.dtmfSender) {
      logger.error("No DTMF sender available");
      return false;
    }

    try {
      const duration = options?.duration || 100;
      const interToneGap = options?.interToneGap || 70;

      logger.info(`Sending DTMF tones: ${tones}`);
      this.dtmfSender.insertDTMF(tones, duration, interToneGap);
      return true;
    } catch (error) {
      logger.error(
        `Error sending DTMF: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  /**
   * Lấy remote stream
   */
  public getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  /**
   * Lấy local stream
   */
  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  /**
   * Đổi trạng thái tắt tiếng (mute/unmute)
   */
  public setMuted(muted: boolean): boolean {
    if (!this.localStream) {
      logger.error("No local stream available");
      return false;
    }

    try {
      const audioTracks = this.localStream.getAudioTracks();
      if (audioTracks.length === 0) {
        logger.warn("No audio tracks found in local stream");
        return false;
      }

      audioTracks.forEach((track) => {
        track.enabled = !muted;
      });

      logger.info(`Audio ${muted ? "muted" : "unmuted"} successfully`);
      return true;
    } catch (error) {
      logger.error(
        `Error setting muted state: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }
}
