import React from "react";
import { createRoot } from "react-dom/client";
import type { MediaResult, RecorderConfig } from "@videowhisper/recorder-types";
import { createFreeRecorderConfig } from "@videowhisper/recorder-free";
import { VideoWhisperRecorder } from "@videowhisper/recorder-react";
import "@videowhisper/recorder-ui/styles.css";

export interface IframeInitMessage {
  schemaVersion: "1";
  type: "videowhisper-recorder:init";
  correlationId: string;
  config: Partial<RecorderConfig>;
  allowedParentOrigins: string[];
}

export interface IframeResultMessage {
  schemaVersion: "1";
  type: "videowhisper-recorder:saved";
  correlationId: string;
  result: MediaResult;
}

export function bootIframe(target: HTMLElement, init: IframeInitMessage): void {
  const parentOrigin = document.referrer ? new URL(document.referrer).origin : "";
  if (!init.allowedParentOrigins.includes(parentOrigin)) {
    target.textContent = "Recorder parent origin is not allowed.";
    return;
  }

  const config = createFreeRecorderConfig({
    ...init.config,
    target,
    renderMode: "page",
    callbacks: {
      ...init.config.callbacks,
      onSaved: (result) => {
        const message: IframeResultMessage = {
          schemaVersion: "1",
          type: "videowhisper-recorder:saved",
          correlationId: init.correlationId,
          result
        };
        window.parent.postMessage(message, parentOrigin);
      }
    }
  });

  createRoot(target).render(<VideoWhisperRecorder config={config} />);
}

if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent<IframeInitMessage>) => {
    if (!event.data || event.data.type !== "videowhisper-recorder:init") {
      return;
    }
    if (!event.data.allowedParentOrigins.includes(event.origin)) {
      return;
    }
    const target = document.getElementById("vwr-iframe-root") ?? document.body;
    bootIframe(target, event.data);
  });
}
