import { SipClient } from "../client/sip-client";
import { LoggerFactory } from "../logger";
import { CallState } from "../common/types";

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

    // Initialize connection
    const result = await sipClient.initialize();
    log("Successfully connected to SharedWorker");
    log(`Connected clients: ${result.connectedClients}`);

    // Update UI
    updateConnectionStatus(true, result.connectedClients);
  } catch (error) {
    log(
      `Connection error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    updateConnectionStatus(false);
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
  log("Disconnected from worker");
});

// Initialize UI
updateConnectionStatus(false); 