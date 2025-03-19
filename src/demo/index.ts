import { SipClient } from "@client/index";

// Elements
const connectButton = document.getElementById(
  "connectWorker"
) as HTMLButtonElement;
const pingButton = document.getElementById("pingWorker") as HTMLButtonElement;
const logContainer = document.getElementById("logContainer") as HTMLDivElement;

// Client instance
let sipClient: SipClient | null = null;

// Log function
function log(message: string) {
  const logEntry = document.createElement("div");
  logEntry.textContent = `[${new Date().toISOString()}] ${message}`;
  logContainer.appendChild(logEntry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Connect to worker
connectButton.addEventListener("click", async () => {
  try {
    log("Connecting to SharedWorker...");
    sipClient = new SipClient();
    await sipClient.initialize();
    log("Connected to SharedWorker successfully");
    connectButton.disabled = true;
    pingButton.disabled = false;
  } catch (error) {
    log(`Error connecting to worker: ${error}`);
  }
});

// Ping worker
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
    log(
      `Received PONG from worker. Round-trip time: ${Math.round(
        endTime - startTime
      )}ms`
    );
  } catch (error) {
    log(`Error pinging worker: ${error}`);
  }
});
