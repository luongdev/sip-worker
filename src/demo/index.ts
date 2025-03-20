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

          default:
            // Không xử lý các tin nhắn WebRTC ở đây nữa vì đã được xử lý trong SipClient
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

// Hàm khởi tạo PeerConnection không còn cần thiết nữa vì đã có PeerConnectionManager
// Thay đổi initializePeerConnection thành getOrInitializePeerConnection
function getOrInitializePeerConnection(
  iceServers: RTCIceServer[] = []
): RTCPeerConnection | null {
  if (!sipClient) {
    logger.error("SipClient not initialized");
    return null;
  }

  // Sử dụng PeerConnectionManager từ SipClient
  return sipClient.getPeerConnectionManager().initialize(iceServers);
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

        // Khi cuộc gọi đã kết nối, hiển thị luồng video/audio từ đối phương
        if (payload.state === "connected" && sipClient) {
          log("Call connected, getting remote stream");

          // Sử dụng phương thức getRemoteStream từ SipClient
          const remoteStream = sipClient.getRemoteStream();
          if (remoteStream) {
            const remoteAudio = document.getElementById(
              "remoteAudio"
            ) as HTMLAudioElement;
            if (remoteAudio) {
              remoteAudio.srcObject = remoteStream;
              remoteAudio
                .play()
                .catch((e) => console.error("Error playing remote audio:", e));
            }
          } else {
            log("No remote stream available");
          }
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
    log(`Calling ${target}...`);
    makeCallButton.disabled = true;

    // Lấy luồng âm thanh/video trước khi gọi
    if (sipClient) {
      log("Getting user media...");
      // Sử dụng phương thức setupCallMedia từ SipClient thay vì trực tiếp lấy getUserMedia
      localStream = await sipClient.setupCallMedia(activeCallId || "", {
        video: false,
      });

      // Cập nhật UI với luồng local
      const localAudio = document.getElementById(
        "localAudio"
      ) as HTMLAudioElement;
      if (localAudio) {
        localAudio.srcObject = localStream;
      }
    }

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
    if (!sipClient || !activeCallId) {
      log("No active call to mute/unmute");
      return;
    }

    // Đảo ngược trạng thái tắt tiếng hiện tại
    isMuted = !isMuted;

    // Cập nhật trạng thái tắt tiếng sử dụng SipClient.setMuted
    const result = await sipClient.setMuted(activeCallId, isMuted);

    log(`Call ${isMuted ? "muted" : "unmuted"}`);
    muteButton.textContent = isMuted ? "Unmute" : "Mute";
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
    // Gửi tín hiệu DTMF sử dụng SipClient.sendDtmf
    await sipClient.sendDtmf(activeCallId, tones);

    log(`Sent DTMF tones: ${tones}`);
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

// Initialize UI
updateConnectionStatus(false);
updateSipStatus(false, false, false);
