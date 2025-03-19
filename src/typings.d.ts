declare interface SharedWorkerGlobalScope {
  onconnect: (event: MessageEvent) => void;
}
