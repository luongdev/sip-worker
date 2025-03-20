import { SipClient } from "../client/sip-client";
import { LoggerFactory } from "../logger";
import { CallState, MessageType, SipConfig } from "../common/types";

// Tạo logger cho demo
const logger = LoggerFactory.getInstance().getLogger("Demo");

// DOM Elements
const connectButton = document.getElementById(
  "connectWorker"
) as HTMLButtonElement;
const requestButton = document.getElementById(
  "requestWorker"
) as HTMLButtonElement;
const disconnectButton = document.getElementById(
  "disconnectWorker"
) as HTMLButtonElement;
const logContainer = document.getElementById("logContainer") as HTMLDivElement;
const statusIndicator = document.getElementById(
  "connectionStatus"
) as HTMLDivElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;
const clientCountElement = document.getElementById(
  "clientCount"
) as HTMLSpanElement;

// SIP Config Elements
const sipUriInput = document.getElementById("sipUri") as HTMLInputElement;
const sipPasswordInput = document.getElementById(
  "sipPassword"
) as HTMLInputElement;
const sipWsServersInput = document.getElementById(
  "sipWsServers"
) as HTMLTextAreaElement;
const sipExpiresInput = document.getElementById(
  "sipExpires"
) as HTMLInputElement;

// SIP Status Elements
const sipInitStatus = document.getElementById(
  "sipInitStatus"
) as HTMLDivElement;
const sipConnectStatus = document.getElementById(
  "sipConnectStatus"
) as HTMLDivElement;
const sipRegisterStatus = document.getElementById(
  "sipRegisterStatus"
) as HTMLDivElement;

// SIP Action Buttons
const initSipButton = document.getElementById("initSip") as HTMLButtonElement;
const connectSipButton = document.getElementById(
  "connectSip"
) as HTMLButtonElement;
const registerSipButton = document.getElementById(
  "registerSip"
) as HTMLButtonElement;

// Call UI Elements
const targetUriInput = document.getElementById("targetUri") as HTMLInputElement;
const makeCallButton = document.getElementById("makeCall") as HTMLButtonElement;
const hangupCallButton = document.getElementById(
  "hangupCall"
) as HTMLButtonElement;
const answerCallButton = document.getElementById(
  "answerCall"
) as HTMLButtonElement;
const callStatusText = document.getElementById(
  "callStatusText"
) as HTMLSpanElement;
const callDurationElement = document.getElementById(
  "callDuration"
) as HTMLSpanElement;
const muteButton = document.getElementById("muteAudio") as HTMLButtonElement;
const sendDtmfButton = document.getElementById("sendDtmf") as HTMLButtonElement;
const dtmfInput = document.getElementById("dtmfInput") as HTMLInputElement;

// SIP Client instance
let sipClient: SipClient | null = null;

// Biến để lưu RTCPeerConnection
let peerConnection: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;

// Cuộc gọi hiện tại
let activeCallId: string | null = null;
let callStartTime: number | null = null;
let callDurationTimer: number | null = null;
let isMuted = false;

// Log function
function log(message: string) {
  const logEntry = document.createElement("div");
  logEntry.textContent = `[${new Date().toISOString()}] ${message}`;
  logContainer.appendChild(logEntry);
  logContainer.scrollTop = logContainer.scrollHeight;
  logger.info(message);
}

// Update UI connection status
function updateConnectionStatus(connected: boolean, clientCount: number = 0) {
  // Update status indicator
  statusIndicator.className = connected
    ? "status connected"
    : "status disconnected";
  statusText.textContent = connected ? "Connected" : "Disconnected";

  // Update client count
  clientCountElement.textContent = clientCount.toString();

  // Update buttons
  connectButton.disabled = connected;
  requestButton.disabled = !connected;
  disconnectButton.disabled = !connected;

  // Enable/disable SIP initialization button
  initSipButton.disabled = !connected;
}

// Update SIP status
function updateSipStatus(
  initialized: boolean,
  connected: boolean,
  registered: boolean
) {
  // Update status indicators
  sipInitStatus.className = initialized
    ? "status connected"
    : "status disconnected";
  sipConnectStatus.className = connected
    ? "status connected"
    : "status disconnected";
  sipRegisterStatus.className = registered
    ? "status connected"
    : "status disconnected";

  // Update buttons
  initSipButton.disabled = !sipClient?.isConnected() || initialized;
  connectSipButton.disabled = !initialized || connected;
  registerSipButton.disabled = !connected || registered;

  // Cập nhật nút thực hiện cuộc gọi
  makeCallButton.disabled = !registered;
}

// Interfaces cho demo
interface ClientEvent {
  clientId: string;
  totalClients: number;
}

// Connect button handler
connectButton.addEventListener("click", async () => {
  try {
    log("Connecting to SharedWorker...");
    sipClient = new SipClient();

    // Setup event handlers
    sipClient.on("stateUpdate", (state: CallState) => {
      log(`State updated: ${JSON.stringify(state)}`);
    });

    sipClient.on("clientConnected", (data: ClientEvent) => {
      log(`New client connected: ${data.clientId}`);
      updateConnectionStatus(true, data.totalClients);
    });

    sipClient.on("clientDisconnected", (data: ClientEvent) => {
      log(`Client disconnected: ${data.clientId}`);
      updateConnectionStatus(true, data.totalClients);
    });

    // SIP event handlers
    sipClient.on("sipInitResult", (data: any) => {
      log(`SIP initialization result: ${JSON.stringify(data)}`);
      updateSipStatus(data.success, false, false);
    });

    sipClient.on("sipConnectionUpdate", (data: any) => {
      log(`SIP connection update: ${JSON.stringify(data)}`);
      updateSipStatus(true, data.state === "connected", false);
    });

    sipClient.on("sipRegistrationUpdate", (data: any) => {
      log(`SIP registration update: ${JSON.stringify(data)}`);
      updateSipStatus(true, true, data.state === "registered");
    });

    // Đăng ký xử lý các tin nhắn cho WebRTC
    sipClient.on("message", (message: any) => {
      try {
        const { type, payload } = message;
        log(`Received message from worker: ${type}`);
        logger.debug(`Message details: ${JSON.stringify(message, null, 2)}`);

        switch (type) {
          case MessageType.CALL_UPDATE:
            handleCallState(payload);
            break;

          case MessageType.SIP_CONNECTION_UPDATE:
          case MessageType.SIP_REGISTRATION_UPDATE:
            handleSipState(payload);
            break;

          case MessageType.SDP_REQUEST:
            // Xử lý các yêu cầu SDP
            logger.info(
              `Received SDP_REQUEST with payload: ${JSON.stringify(
                payload,
                null,
                2
              )}`
            );
            handleSdpRequest(payload);
            break;

          case MessageType.ICE_CANDIDATE:
            // Xử lý ICE candidate
            logger.debug(
              `Received ICE_CANDIDATE: ${JSON.stringify(payload, null, 2)}`
            );
            if (payload && payload.candidate) {
              handleAddIceCandidate({
                requestId: payload.requestId,
                candidateData: payload.candidate,
              });
            }
            break;

          default:
            // Gửi event đến các handlers đã đăng ký
            logger.debug(`Unhandled message type: ${type}`);
            break;
        }
      } catch (error) {
        logger.error(
          `Error handling message: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error
        );
      }
    });

    // Initialize connection
    const result = await sipClient.initialize();
    log("Successfully connected to SharedWorker");
    log(`Connected clients: ${result.connectedClients}`);

    // Update UI
    updateConnectionStatus(true, result.connectedClients);
    updateSipStatus(false, false, false);
  } catch (error) {
    log(
      `Connection error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    updateConnectionStatus(false);
    updateSipStatus(false, false, false);
  }
});

// Request button handler
requestButton.addEventListener("click", async () => {
  if (!sipClient) {
    log("SIP Client not initialized");
    return;
  }

  try {
    log("Sending request to worker...");
    const startTime = performance.now();

    // Sử dụng method request để gọi lên worker
    const result = await sipClient.request<{
      count: number;
      clients: string[];
    }>("getConnectedClients");

    const endTime = performance.now();
    log(
      `Received response. Round-trip time: ${Math.round(endTime - startTime)}ms`
    );
    log(`Connected clients: ${result.count}`);
    log(`Client IDs: ${result.clients.join(", ")}`);

    // Echo test
    const echoResult = await sipClient.request<{ message: string }>("echo", {
      message: "Hello Worker!",
    });
    log(`Echo response: ${JSON.stringify(echoResult)}`);
  } catch (error) {
    log(
      `Request error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

// Disconnect button handler
disconnectButton.addEventListener("click", () => {
  if (!sipClient) {
    log("SIP Client not initialized");
    return;
  }

  log("Disconnecting from worker...");
  sipClient.close();
  sipClient = null;

  // Update UI
  updateConnectionStatus(false);
  updateSipStatus(false, false, false);
  log("Disconnected from worker");
});

// Initialize SIP button handler
initSipButton.addEventListener("click", async () => {
  if (!sipClient) {
    log("SIP Client not initialized");
    return;
  }

  try {
    // Validate inputs
    const uri = sipUriInput.value.trim();
    const password = sipPasswordInput.value.trim();
    const wsServersText = sipWsServersInput.value.trim();
    const expires = parseInt(sipExpiresInput.value.trim(), 10);

    if (!uri) {
      log("Error: SIP URI is required");
      return;
    }

    if (!password) {
      log("Error: SIP password is required");
      return;
    }

    if (!wsServersText) {
      log("Error: At least one WebSocket server is required");
      return;
    }

    // Parse WebSocket servers
    const wsServers = wsServersText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (wsServers.length === 0) {
      log("Error: At least one WebSocket server is required");
      return;
    }

    // Create SIP configuration
    const sipConfig: SipConfig = {
      uri,
      password,
      wsServers,
      registerExpires: expires,
      enableLogs: true,
      logLevel: "debug",
      traceSip: true,
      connectionTimeout: 30000,
      iceGatheringTimeout: 5000,
      autoReconnect: true,
      stunServers: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
      ],
    };

    log(`Initializing SIP with config: ${JSON.stringify(sipConfig, null, 2)}`);

    // Initialize SIP
    const result = await sipClient.initializeSip(sipConfig);
    log(`SIP initialization ${result ? "successful" : "failed"}`);

    // UI will be updated by the event handler
  } catch (error) {
    log(
      `SIP initialization error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    updateSipStatus(false, false, false);
  }
});

// Connect SIP button handler
connectSipButton.addEventListener("click", async () => {
  if (!sipClient) {
    log("SIP Client not initialized");
    return;
  }

  try {
    log("Connecting to SIP server...");

    // Connect to SIP
    const result = await sipClient.connectSip();
    log(`SIP connection ${result ? "successful" : "failed"}`);

    // UI will be updated by the event handler
  } catch (error) {
    log(
      `SIP connection error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    updateSipStatus(true, false, false);
  }
});

// Register SIP button handler
registerSipButton.addEventListener("click", async () => {
  if (!sipClient) {
    log("SIP Client not initialized");
    return;
  }

  try {
    log("Registering with SIP server...");

    // Register with SIP
    const result = await sipClient.registerSip();
    log(`SIP registration ${result ? "successful" : "failed"}`);

    // UI will be updated by the event handler
  } catch (error) {
    log(
      `SIP registration error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    updateSipStatus(true, true, false);
  }
});

// Khởi tạo peer connection với các ice servers từ cấu hình
function initializePeerConnection(iceServers: RTCIceServer[]) {
  // Đảm bảo đóng kết nối cũ nếu có
  if (peerConnection) {
    peerConnection.close();
  }

  // Tạo peer connection mới
  peerConnection = new RTCPeerConnection({
    iceServers:
      iceServers.length > 0
        ? iceServers
        : [{ urls: "stun:stun.l.google.com:19302" }],
  });

  // Thiết lập các handlers
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      // Gửi ice candidate đến worker khi được tạo
      const candidateData = {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        usernameFragment: event.candidate.usernameFragment,
      };

      sipClient?.sendMessage({
        type: MessageType.ICE_CANDIDATE,
        payload: {
          candidate: candidateData,
        },
      });

      log(`ICE candidate sent: ${candidateData.candidate}`);
    } else {
      log("ICE gathering complete");
    }
  };

  peerConnection.ontrack = (event) => {
    log(`Remote track received: ${event.track.kind}`);

    // Kết nối remote audio track với audio element
    if (event.track.kind === "audio" && event.streams && event.streams[0]) {
      const remoteAudio = document.getElementById(
        "remoteAudio"
      ) as HTMLAudioElement;
      if (remoteAudio) {
        remoteAudio.srcObject = event.streams[0];
        log("Remote audio connected to audio element");
      }
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    log(`ICE connection state changed: ${peerConnection?.iceConnectionState}`);

    // Gửi thông báo về trạng thái kết nối ICE
    sipClient?.sendMessage({
      type: MessageType.CONNECTION_STATE_CHANGE,
      payload: {
        state: peerConnection?.iceConnectionState,
        type: "ice",
      },
    });
  };

  // Thêm các event listeners khác
  return peerConnection;
}

// Xử lý trạng thái cuộc gọi
function handleCallState(payload: any) {
  log(`Call state update: ${JSON.stringify(payload)}`);

  if (!payload) return;

  const callData = payload.activeCall;
  const hasActiveCall = payload.hasActiveCall;

  callStatusText.textContent = hasActiveCall
    ? `${callData.state} ${
        callData.from ? "from " + callData.from : "to " + callData.target
      }`
    : "No active call";

  // Lưu thông tin ID cuộc gọi
  activeCallId = hasActiveCall ? callData.id : null;

  // Cập nhật UI dựa trên trạng thái cuộc gọi
  if (hasActiveCall) {
    switch (callData.state) {
      case "incoming":
        makeCallButton.disabled = true;
        hangupCallButton.disabled = false;
        answerCallButton.disabled = false;
        muteButton.disabled = true;
        sendDtmfButton.disabled = true;
        dtmfInput.disabled = true;
        break;

      case "connecting":
        makeCallButton.disabled = true;
        hangupCallButton.disabled = false;
        answerCallButton.disabled = true;
        muteButton.disabled = true;
        sendDtmfButton.disabled = true;
        dtmfInput.disabled = true;
        break;

      case "connected":
        makeCallButton.disabled = true;
        hangupCallButton.disabled = false;
        answerCallButton.disabled = true;
        muteButton.disabled = false;
        sendDtmfButton.disabled = false;
        dtmfInput.disabled = false;

        // Bắt đầu đếm thời gian cuộc gọi
        if (!callStartTime) {
          callStartTime = Date.now();
          startCallDurationTimer();
        }
        break;

      case "ended":
        resetCallUI();
        break;
    }
  } else {
    resetCallUI();
  }
}

// Đặt lại UI cuộc gọi về trạng thái ban đầu
function resetCallUI() {
  makeCallButton.disabled = false;
  hangupCallButton.disabled = true;
  answerCallButton.disabled = true;
  muteButton.disabled = true;
  sendDtmfButton.disabled = true;
  dtmfInput.disabled = true;
  callStatusText.textContent = "No active call";

  // Dừng đếm thời gian
  if (callDurationTimer) {
    window.clearInterval(callDurationTimer);
    callDurationTimer = null;
  }

  callStartTime = null;
  callDurationElement.textContent = "0:00";
  activeCallId = null;

  // Đặt lại trạng thái tắt tiếng
  isMuted = false;
  muteButton.textContent = "Mute";
}

// Bắt đầu timer hiển thị thời gian cuộc gọi
function startCallDurationTimer() {
  if (callDurationTimer) {
    window.clearInterval(callDurationTimer);
  }

  callDurationTimer = window.setInterval(() => {
    if (!callStartTime) return;

    const duration = Math.floor((Date.now() - callStartTime) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;

    callDurationElement.textContent = `${minutes}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }, 1000);
}

// Sự kiện thực hiện cuộc gọi
makeCallButton.addEventListener("click", async () => {
  if (!sipClient) {
    log("SIP Client not initialized");
    return;
  }

  const target = targetUriInput.value.trim();
  if (!target) {
    log("Call target is required");
    return;
  }

  try {
    log(`Initiating call to ${target}...`);
    makeCallButton.disabled = true;

    const result = await sipClient.makeCall(target);
    log(`Call initiated: ${JSON.stringify(result)}`);

    // UI sẽ được cập nhật từ xử lý sự kiện trạng thái cuộc gọi
  } catch (error) {
    log(
      `Call error: ${error instanceof Error ? error.message : String(error)}`
    );
    makeCallButton.disabled = false;
  }
});

// Sự kiện kết thúc cuộc gọi
hangupCallButton.addEventListener("click", async () => {
  if (!sipClient || !activeCallId) {
    log("No active call to hang up");
    return;
  }

  try {
    log(`Hanging up call ${activeCallId}...`);
    const result = await sipClient.hangupCall(activeCallId);
    log(`Call hungup: ${JSON.stringify(result)}`);

    // UI sẽ được cập nhật từ xử lý sự kiện trạng thái cuộc gọi
  } catch (error) {
    log(
      `Hangup error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

// Sự kiện trả lời cuộc gọi
answerCallButton.addEventListener("click", async () => {
  if (!sipClient || !activeCallId) {
    log("No incoming call to answer");
    return;
  }

  try {
    log(`Answering call ${activeCallId}...`);
    answerCallButton.disabled = true;

    const result = await sipClient.answerCall(activeCallId);
    log(`Call answered: ${JSON.stringify(result)}`);

    // UI sẽ được cập nhật từ xử lý sự kiện trạng thái cuộc gọi
  } catch (error) {
    log(
      `Answer error: ${error instanceof Error ? error.message : String(error)}`
    );
    answerCallButton.disabled = false;
  }
});

// Sự kiện tắt/bật tiếng
muteButton.addEventListener("click", async () => {
  if (!sipClient || !activeCallId) {
    log("No active call to mute/unmute");
    return;
  }

  try {
    isMuted = !isMuted;
    log(`${isMuted ? "Muting" : "Unmuting"} call ${activeCallId}...`);

    await sipClient.setMuted(activeCallId, isMuted);
    muteButton.textContent = isMuted ? "Unmute" : "Mute";

    log(`Call ${isMuted ? "muted" : "unmuted"}`);
  } catch (error) {
    log(
      `Mute/unmute error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
});

// Sự kiện gửi DTMF
sendDtmfButton.addEventListener("click", async () => {
  if (!sipClient || !activeCallId) {
    log("No active call to send DTMF");
    return;
  }

  const tones = dtmfInput.value.trim();
  if (!tones) {
    log("No DTMF tones to send");
    return;
  }

  try {
    log(`Sending DTMF tones ${tones} to call ${activeCallId}...`);

    await sipClient.sendDtmf(activeCallId, tones);
    log(`DTMF tones ${tones} sent`);

    // Xóa input sau khi gửi
    dtmfInput.value = "";
  } catch (error) {
    log(
      `DTMF error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

// Hàm xử lý trạng thái SIP
function handleSipState(payload: any) {
  log(`SIP state update: ${JSON.stringify(payload)}`);
  // TODO: Cập nhật UI hiển thị trạng thái SIP
}

// Hàm xử lý SDP request từ worker
async function handleSdpRequest(payload: any) {
  try {
    // Đảm bảo payload và request tồn tại
    if (!payload || !payload.request) {
      logger.error("Invalid SDP payload, missing request:", payload);
      return;
    }

    const { requestId, operation, options, data } = payload.request;

    logger.debug(`Received SDP request: ${operation}, requestId: ${requestId}`);

    // Đảm bảo đã có peer connection
    if (!peerConnection) {
      logger.info("Initializing new PeerConnection for SDP request");
      peerConnection = initializePeerConnection([]);
    }

    log(`Processing SDP request: ${operation}`);

    // Xử lý dựa trên loại operation
    let result: any;
    switch (operation) {
      case "createOffer":
        // Lấy luồng audio từ microphone
        if (!localStream) {
          logger.info("Acquiring local media stream for createOffer");
          try {
            localStream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: false,
            });

            // Thêm tracks vào peer connection
            localStream.getTracks().forEach((track) => {
              if (peerConnection) {
                logger.debug(`Adding ${track.kind} track to PeerConnection`);
                peerConnection.addTrack(track, localStream!);
              }
            });

            log("Local audio stream acquired and added to peer connection");
          } catch (error) {
            logger.error("Error acquiring media stream:", error);
            throw new Error(
              `Failed to acquire media: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        // Tạo offer
        if (peerConnection) {
          logger.debug("Creating SDP offer with options:", options);
          const offer = await peerConnection.createOffer(options);
          await peerConnection.setLocalDescription(offer);

          result = {
            type: offer.type,
            sdp: offer.sdp,
          };
          logger.debug("SDP offer created successfully");
        } else {
          throw new Error("PeerConnection is null");
        }
        break;

      case "createAnswer":
        // Tạo answer
        if (peerConnection) {
          logger.debug("Creating SDP answer with options:", options);
          const answer = await peerConnection.createAnswer(options);
          await peerConnection.setLocalDescription(answer);

          result = {
            type: answer.type,
            sdp: answer.sdp,
          };
          logger.debug("SDP answer created successfully");
        } else {
          throw new Error("PeerConnection is null");
        }
        break;

      case "setLocalDescription":
        // Set local description
        if (peerConnection) {
          logger.debug("Setting local description");
          await peerConnection.setLocalDescription(
            new RTCSessionDescription(data)
          );
          result = { success: true };
        } else {
          throw new Error("PeerConnection is null");
        }
        break;

      case "setRemoteDescription":
        // Set remote description
        if (peerConnection) {
          logger.debug("Setting remote description");
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(data)
          );
          result = { success: true };
        } else {
          throw new Error("PeerConnection is null");
        }
        break;

      case "getCompleteSdp":
        // Lấy SDP đầy đủ với ice candidates
        if (peerConnection) {
          result = {
            sdp: peerConnection.localDescription?.sdp || "",
          };
        } else {
          throw new Error("PeerConnection is null");
        }
        break;

      case "close":
        // Đóng peer connection
        if (peerConnection) {
          peerConnection.close();
          peerConnection = null;
        }

        // Dừng các luồng nếu có
        if (localStream) {
          localStream.getTracks().forEach((track) => track.stop());
          localStream = null;
        }

        result = { success: true };
        break;

      default:
        throw new Error(`Unknown SDP operation: ${operation}`);
    }

    // Phản hồi kết quả
    logger.debug(
      `Sending SDP response for ${operation}, requestId: ${requestId}`
    );
    sipClient?.sendMessage({
      type: MessageType.SDP_RESPONSE,
      payload: {
        requestId,
        result,
      },
    });

    log(`SDP response sent for ${operation}`);
  } catch (error) {
    let requestId = payload?.request?.requestId;
    logger.error(
      `Error handling SDP request: ${
        error instanceof Error ? error.message : String(error)
      }, requestId: ${requestId}`
    );

    // Phản hồi lỗi
    if (requestId) {
      sipClient?.sendMessage({
        type: MessageType.SDP_RESPONSE,
        payload: {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      log(`SDP error response sent for requestId: ${requestId}`);
    } else {
      log(`Could not send SDP error response: missing requestId`);
    }
  }
}

// Hàm xử lý thêm ICE candidate
async function handleAddIceCandidate(payload: any) {
  try {
    const { requestId, candidateData } = payload;

    if (!peerConnection) {
      throw new Error("PeerConnection not initialized");
    }

    // Tạo RTCIceCandidate từ dữ liệu
    const candidate = new RTCIceCandidate({
      candidate: candidateData.candidate,
      sdpMid: candidateData.sdpMid,
      sdpMLineIndex: candidateData.sdpMLineIndex,
      usernameFragment: candidateData.usernameFragment,
    });

    // Thêm candidate vào peer connection
    await peerConnection.addIceCandidate(candidate);

    log(`ICE candidate added: ${candidateData.candidate}`);

    // Phản hồi thành công
    sipClient?.sendMessage({
      type: MessageType.SDP_RESPONSE,
      payload: {
        requestId,
        result: { success: true },
      },
    });
  } catch (error) {
    log(
      `Error adding ICE candidate: ${
        error instanceof Error ? error.message : String(error)
      }`
    );

    // Phản hồi lỗi
    sipClient?.sendMessage({
      type: MessageType.SDP_RESPONSE,
      payload: {
        requestId: payload.requestId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

// Initialize UI
updateConnectionStatus(false);
updateSipStatus(false, false, false);
