import { ClientManager } from "./client-manager";
import { MessageHandler } from "./message-handler";
import { WorkerMessage } from "./types";

const workerScope: SharedWorkerGlobalScope = self as any;
const clientManager = new ClientManager();
const messageHandler = new MessageHandler(clientManager);

workerScope.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];

  // Start listening for messages
  port.start();

  // Handle messages from client
  port.onmessage = (e) => {
    const data = e.data as WorkerMessage;

    if (!data || !data.type) {
      console.error("Invalid message received");
      return;
    }

    try {
      if (data.type === "CLIENT_INIT") {
        if (!data.clientId) {
          console.error("CLIENT_INIT missing clientId");
          port.postMessage({
            type: "ERROR",
            error: "MISSING_CLIENT_ID",
            message: "Client ID is required for initialization",
          });
          return;
        }

        messageHandler.handleClientInit(data.clientId, port);
      } else if (data.type === "PING" && data.clientId) {
        messageHandler.handlePing(data.clientId);
      } else if (data.type === "CLIENT_DISCONNECT" && data.clientId) {
        messageHandler.handleClientDisconnect(data.clientId);
      }
    } catch (error) {
      console.error("Error processing message:", error);

      port.postMessage({
        type: "ERROR",
        error: "MESSAGE_PROCESSING_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
        timestamp: Date.now(),
      });
    }
  };

  // Handle message port errors
  port.onmessageerror = (error) => {
    console.error("Message port error:", error);
  };
};
