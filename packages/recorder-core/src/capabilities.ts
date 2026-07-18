import type { CapabilityReport } from "@videowhisper/recorder-types";

export const DEFAULT_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4"
];

export async function detectCapabilities(): Promise<CapabilityReport> {
  const mediaDevices = Boolean(navigator.mediaDevices);
  const devices = mediaDevices && navigator.mediaDevices.enumerateDevices
    ? await navigator.mediaDevices.enumerateDevices().catch(() => [])
    : [];

  const supportedMimeTypes = typeof MediaRecorder !== "undefined" && "isTypeSupported" in MediaRecorder
    ? DEFAULT_MIME_CANDIDATES.filter((candidate) => MediaRecorder.isTypeSupported(candidate))
    : [];

  const canvas = document.createElement("canvas");
  const canvasCapture = typeof canvas.captureStream === "function";

  return {
    schemaVersion: "1",
    secureContext: window.isSecureContext,
    mediaDevices,
    getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
    getDisplayMedia: Boolean(navigator.mediaDevices?.getDisplayMedia),
    mediaRecorder: typeof MediaRecorder !== "undefined",
    pauseResume: typeof MediaRecorder !== "undefined" && "pause" in MediaRecorder.prototype,
    imageCapture: typeof window !== "undefined" && "ImageCapture" in window,
    canvasCapture,
    indexedDb: typeof indexedDB !== "undefined",
    supportedConstraints: navigator.mediaDevices?.getSupportedConstraints?.() ?? {},
    supportedMimeTypes,
    devices: {
      cameras: devices.filter((device) => device.kind === "videoinput").length,
      microphones: devices.filter((device) => device.kind === "audioinput").length,
      labelsAvailable: devices.some((device) => device.label.length > 0)
    }
  };
}

export function selectMimeType(candidates: string[] | undefined, mediaType: "audio" | "video"): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  const list = candidates?.length ? candidates : DEFAULT_MIME_CANDIDATES;
  const filtered = list.filter((candidate) => candidate.startsWith(`${mediaType}/`));
  return filtered.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}
