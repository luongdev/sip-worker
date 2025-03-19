const workerScope: SharedWorkerGlobalScope = self as any;

console.log("SIP SharedWorker starting...");

// Lưu trữ các client đang kết nối
const connectedClients = new Map<string, MessagePort>();

// Handle client connections
workerScope.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];

  port.onmessage = (e) => {
    const data = e.data;

    if (data && data.type === "CLIENT_INIT") {
      // Lưu trữ kết nối của client
      if (data.clientId) {
        connectedClients.set(data.clientId, port);
        console.log(`Client connected: ${data.clientId}`);
      }

      port.postMessage({
        type: "WORKER_READY",
      });
    } else if (data && data.type === "PING") {
      port.postMessage({
        type: "PONG",
        timestamp: Date.now(),
      });
    } else if (data && data.type === "CLIENT_DISCONNECT") {
      if (data.clientId) {
        connectedClients.delete(data.clientId);
        console.log(`Client disconnected: ${data.clientId}`);
      }
    }
  };

  port.start();
};
