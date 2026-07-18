import type { RecorderEventName } from "@videowhisper/recorder-types";

export class RecorderEventBus {
  private readonly handlers = new Map<RecorderEventName, Set<(payload: unknown) => void>>();

  on(eventName: RecorderEventName, handler: (payload: unknown) => void): () => void {
    const handlers = this.handlers.get(eventName) ?? new Set();
    handlers.add(handler);
    this.handlers.set(eventName, handlers);

    return () => {
      handlers.delete(handler);
    };
  }

  emit(eventName: RecorderEventName, payload?: unknown): void {
    this.handlers.get(eventName)?.forEach((handler) => handler(payload));
  }

  clear(): void {
    this.handlers.clear();
  }
}
