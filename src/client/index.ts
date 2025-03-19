export class SipClient {
  private worker: SharedWorker | null = null;
  private port: MessagePort | null = null;
  private clientId: string;

  constructor() {
    this.clientId = `client-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Create a random ID for this client
        this.worker = new SharedWorker(
          new URL("../worker/index.ts", import.meta.url),
          {
            type: "module",
            name: "sip-worker",
          }
        );

        this.port = this.worker.port;

        // Set up message handling
        this.port.onmessage = (event) => {
          const data = event.data;

          if (data && data.type === "WORKER_READY") {
            resolve();
          }
        };

        // Start the worker and send initialization
        this.port.start();
        this.port.postMessage({
          type: "CLIENT_INIT",
          clientId: this.clientId,
        });

        // Set timeout for connection
        setTimeout(() => {
          reject(new Error("Worker connection timeout"));
        }, 5000);
      } catch (error) {
        reject(error);
      }
    });
  }

  async ping(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.port) {
        reject(new Error("Not connected to worker"));
        return;
      }

      const messageHandler = (event: MessageEvent) => {
        const data = event.data;
        if (data && data.type === "PONG") {
          this.port?.removeEventListener("message", messageHandler);
          resolve();
        }
      };

      this.port.addEventListener("message", messageHandler);

      this.port.postMessage({
        type: "PING",
        clientId: this.clientId,
      });

      // Set timeout
      setTimeout(() => {
        this.port?.removeEventListener("message", messageHandler);
        reject(new Error("Ping timeout"));
      }, 5000);
    });
  }

  close(): void {
    if (this.port) {
      this.port.postMessage({
        type: "CLIENT_DISCONNECT",
        clientId: this.clientId,
      });
      this.port.close();
      this.port = null;
    }

    this.worker = null;
  }
}
