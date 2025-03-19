interface SharedWorkerGlobalScope {
  readonly name: string;
  onconnect: (event: MessageEvent) => void;
  close: () => void;
}

declare var self: SharedWorkerGlobalScope;
