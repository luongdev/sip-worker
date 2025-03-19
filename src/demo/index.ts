import { SipClient } from "../client/sip-client";
import { LoggerFactory } from "../logger";
import { CallState, SipConfig } from "../common/types";

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
const sipPasswordInput = document.getElementById("sipPassword") as HTMLInputElement;
const sipWsServersInput = document.getElementById("sipWsServers") as HTMLTextAreaElement;
const sipExpiresInput = document.getElementById("sipExpires") as HTMLInputElement;

// SIP Status Elements
const sipInitStatus = document.getElementById("sipInitStatus") as HTMLDivElement;
const sipConnectStatus = document.getElementById("sipConnectStatus") as HTMLDivElement;
const sipRegisterStatus = document.getElementById("sipRegisterStatus") as HTMLDivElement;

// SIP Action Buttons
const initSipButton = document.getElementById("initSip") as HTMLButtonElement;
const connectSipButton = document.getElementById("connectSip") as HTMLButtonElement;
const registerSipButton = document.getElementById("registerSip") as HTMLButtonElement;

// SIP Client instance
let sipClient: SipClient | null = null;

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
function updateSipStatus(initialized: boolean, connected: boolean, registered: boolean) {
  // Update status indicators
  sipInitStatus.className = initialized ? "status connected" : "status disconnected";
  sipConnectStatus.className = connected ? "status connected" : "status disconnected";
  sipRegisterStatus.className = registered ? "status connected" : "status disconnected";
  
  // Update buttons
  initSipButton.disabled = !sipClient?.isConnected() || initialized;
  connectSipButton.disabled = !initialized || connected;
  registerSipButton.disabled = !connected || registered;
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
    const result = await sipClient.request<{count: number, clients: string[]}>('getConnectedClients');
    
    const endTime = performance.now();
    log(`Received response. Round-trip time: ${Math.round(endTime - startTime)}ms`);
    log(`Connected clients: ${result.count}`);
    log(`Client IDs: ${result.clients.join(", ")}`);
    
    // Echo test
    const echoResult = await sipClient.request<{message: string}>('echo', { message: "Hello Worker!" });
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
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
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
      enableLogs: true
    };
    
    log(`Initializing SIP with config: ${JSON.stringify(sipConfig, null, 2)}`);
    
    // Initialize SIP
    const result = await sipClient.initializeSip(sipConfig);
    log(`SIP initialization ${result ? "successful" : "failed"}`);
    
    // UI will be updated by the event handler
  } catch (error) {
    log(`SIP initialization error: ${error instanceof Error ? error.message : String(error)}`);
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
    log(`SIP connection error: ${error instanceof Error ? error.message : String(error)}`);
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
    log(`SIP registration error: ${error instanceof Error ? error.message : String(error)}`);
    updateSipStatus(true, true, false);
  }
});

// Initialize UI
updateConnectionStatus(false);
updateSipStatus(false, false, false); 