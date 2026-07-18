import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RecorderApi, RecorderConfig, RecorderEventName, MediaResult } from "@videowhisper/recorder-types";
import { createFreeRecorderConfig } from "@videowhisper/recorder-free";
import { VideoWhisperRecorder } from "@videowhisper/recorder-react";
import "@videowhisper/recorder-ui/styles.css";

export interface MountedRecorder extends RecorderApi {
  unmount(): void;
}

const mounted = new WeakMap<HTMLElement, Root>();

export function mount(config: Partial<RecorderConfig> & { target: string | HTMLElement }): MountedRecorder {
  const target = resolveTarget(config.target);
  const finalConfig = createFreeRecorderConfig({ ...config, target });
  const callbacks = new Map<RecorderEventName, Set<(payload: unknown) => void>>();
  const results: MediaResult[] = [];
  const root = createRoot(target);

  const wrappedConfig: RecorderConfig = {
    ...finalConfig,
    callbacks: {
      ...finalConfig.callbacks,
      onOpen: () => {
        finalConfig.callbacks?.onOpen?.();
        emit(callbacks, "open");
      },
      onClose: () => {
        finalConfig.callbacks?.onClose?.();
        emit(callbacks, "close");
      },
      onSaved: (result) => {
        results.splice(0, results.length, result);
        finalConfig.callbacks?.onSaved?.(result);
        target.dispatchEvent(new CustomEvent("videowhisper-recorder:saved", { detail: result, bubbles: true }));
        emit(callbacks, "saved", result);
      },
      onRemoved: (id) => {
        const index = results.findIndex((result) => result.id === id);
        if (index >= 0) {
          results.splice(index, 1);
        }
        finalConfig.callbacks?.onRemoved?.(id);
        emit(callbacks, "removed", id);
      },
      onError: (error) => {
        finalConfig.callbacks?.onError?.(error);
        emit(callbacks, "error", error);
      }
    }
  };

  root.render(<VideoWhisperRecorder config={wrappedConfig} />);
  mounted.set(target, root);

  return {
    async open() {
      target.querySelector<HTMLButtonElement>(".vwr-launch-button")?.click();
    },
    async close() {
      target.querySelectorAll<HTMLButtonElement>(".vwr-header .vwr-button").forEach((button) => button.click());
    },
    async prepare() {
      target.querySelector<HTMLButtonElement>(".vwr-prep .vwr-button-primary")?.click();
    },
    async start() {
      const existingStart = findButtonByLabel(target, ["Start recording", "Take photo", "Take screenshot"]);
      if (existingStart) {
        existingStart.click();
        return;
      }

      target.querySelector<HTMLButtonElement>(".vwr-prep .vwr-button-primary")?.click();
      const startButton = await waitForStartButton(target);
      startButton?.click();
    },
    async pause() {
      clickButtonByText(target, "Pause");
    },
    async resume() {
      clickButtonByText(target, "Resume");
    },
    async stop() {
      target.querySelector<HTMLButtonElement>(".vwr-record-button")?.click();
    },
    async accept() {
      clickButtonByText(target, "Accept");
      return waitForSaved(callbacks);
    },
    async discard() {
      clickButtonByText(target, "Discard");
    },
    async retry() {
      clickButtonByText(target, "Try again");
    },
    async addAnother() {
      throw new Error("Only one recording can be kept at a time.");
    },
    getResults() {
      return [...results];
    },
    async removeResult(id: string) {
      const card = Array.from(target.querySelectorAll(".vwr-result-card")).find((node) => node.textContent?.includes(id));
      card?.querySelector<HTMLButtonElement>(".vwr-button-danger")?.click();
    },
    async submitSession() {
      return [...results];
    },
    async getCapabilities() {
      const { detectCapabilities } = await import("@videowhisper/recorder-core");
      return detectCapabilities();
    },
    async destroy() {
      root.unmount();
      mounted.delete(target);
    },
    on(eventName, handler) {
      const handlers = callbacks.get(eventName) ?? new Set();
      handlers.add(handler);
      callbacks.set(eventName, handlers);
      return () => handlers.delete(handler);
    },
    unmount() {
      root.unmount();
      mounted.delete(target);
    }
  };
}

export { createFreeRecorderConfig, VideoWhisperRecorder };

function resolveTarget(target: string | HTMLElement): HTMLElement {
  if (typeof target !== "string") {
    return target;
  }
  const element = document.querySelector<HTMLElement>(target);
  if (!element) {
    throw new Error(`Recorder target was not found: ${target}`);
  }
  return element;
}

function clickButtonByText(root: HTMLElement, text: string): void {
  Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes(text))?.click();
}

function findButtonByLabel(root: HTMLElement, labels: string[]): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
    const label = button.getAttribute("aria-label") ?? button.textContent ?? "";
    return labels.includes(label.trim());
  });
}

function waitForStartButton(root: HTMLElement): Promise<HTMLButtonElement | null> {
  const timeoutAt = Date.now() + 8000;
  return new Promise((resolve) => {
    const poll = () => {
      const start = findButtonByLabel(root, ["Start recording", "Take photo", "Take screenshot"]);
      if (start) {
        resolve(start);
        return;
      }
      if (findButtonByLabel(root, ["Stop recording"]) || Date.now() >= timeoutAt) {
        resolve(null);
        return;
      }
      window.setTimeout(poll, 50);
    };
    poll();
  });
}

function emit(callbacks: Map<RecorderEventName, Set<(payload: unknown) => void>>, eventName: RecorderEventName, payload?: unknown): void {
  callbacks.get(eventName)?.forEach((handler) => handler(payload));
}

function waitForSaved(callbacks: Map<RecorderEventName, Set<(payload: unknown) => void>>): Promise<MediaResult> {
  return new Promise((resolve) => {
    const off = addOnce(callbacks, "saved", (payload) => resolve(payload as MediaResult));
    window.setTimeout(() => off(), 30000);
  });
}

function addOnce(
  callbacks: Map<RecorderEventName, Set<(payload: unknown) => void>>,
  eventName: RecorderEventName,
  handler: (payload: unknown) => void
): () => void {
  const wrapped = (payload: unknown) => {
    off();
    handler(payload);
  };
  const handlers = callbacks.get(eventName) ?? new Set();
  const off = () => handlers.delete(wrapped);
  handlers.add(wrapped);
  callbacks.set(eventName, handlers);
  return off;
}

declare global {
  interface Window {
    VideoWhisperRecorder?: {
      mount: typeof mount;
      createFreeRecorderConfig: typeof createFreeRecorderConfig;
    };
  }
}

if (typeof window !== "undefined") {
  window.VideoWhisperRecorder = {
    mount,
    createFreeRecorderConfig
  };
}
