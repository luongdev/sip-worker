import { Message } from "../common/types";
import { SipClient } from "../client/sip-client";

// DOM Elements
const connectButton = document.getElementById(
  "connectWorker"
) as HTMLButtonElement;
const pingButton = document.getElementById("pingWorker") as HTMLButtonElement;
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
  pingButton.disabled = !connected;
  disconnectButton.disabled = !connected;
}

// Connect button handler
connectButton.addEventListener("click", async () => {
  try {
    log("Connecting to SharedWorker...");
    sipClient = new SipClient();

    // Setup message handler
    sipClient.onMessage = (message: Message) => {
      if (message.type === "CLIENT_CONNECTED") {
        log(`New client connected: ${message.clientId}`);
        updateConnectionStatus(true, message.totalClients);
      } else if (message.type === "CLIENT_DISCONNECTED") {
        log(`Client disconnected: ${message.clientId}`);
        updateConnectionStatus(true, message.totalClients);
      }
    };

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

// Ping button handler
pingButton.addEventListener("click", async () => {
  if (!sipClient) {
    log("SIP Client not initialized");
    return;
  }

  try {
    log("Sending PING to worker...");
    const startTime = performance.now();
    await sipClient.ping();
    const endTime = performance.now();
    log(`Received PONG. Round-trip time: ${Math.round(endTime - startTime)}ms`);
  } catch (error) {
    log(
      `Ping error: ${error instanceof Error ? error.message : String(error)}`
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
