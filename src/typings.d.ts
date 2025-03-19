// Định nghĩa các kiểu cho SharedWorker
declare class SharedWorkerGlobalScope {
  onconnect: (event: MessageEvent) => void;
  readonly name: string;
  readonly self: SharedWorkerGlobalScope & typeof globalThis;
  close(): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
  dispatchEvent(event: Event): boolean;
}

// Định nghĩa ExtendableMessageEvent
interface ExtendableMessageEvent extends MessageEvent {
  readonly ports: ReadonlyArray<MessagePort>;
}

// Nếu đang chạy trong SharedWorker, ghi đè self
declare var self: SharedWorkerGlobalScope;
