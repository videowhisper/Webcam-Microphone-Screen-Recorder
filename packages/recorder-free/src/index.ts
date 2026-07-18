import type { RecorderConfig, RecorderMode } from "@videowhisper/recorder-types";

export const DEFAULT_CAPTURE_BOUNDS = {
  maxDurationSeconds: 300,
  maxScreenDurationSeconds: 60,
  maxItems: 1,
  maxBytes: 100 * 1024 * 1024
} as const;

export function createFreeRecorderConfig(overrides: Partial<RecorderConfig> & { target?: string | HTMLElement; mode?: RecorderMode } = {}): RecorderConfig {
  const mode = overrides.mode ?? "video";
  const target = overrides.target;
  const capture: RecorderConfig["capture"] = {
    video: overrides.capture?.video ?? (mode === "photo" ? {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 24, max: 30 },
      facingMode: "user"
    } : defaultWebcamVideoConstraints()),
    audio: overrides.capture?.audio ?? (mode !== "photo" && mode !== "screenshot"),
    autoStart: overrides.capture?.autoStart ?? false,
    countdownSeconds: overrides.capture?.countdownSeconds ?? 0,
    thumbnail: overrides.capture?.thumbnail ?? {
      // Still captures preserve aspect ratio within a 1280px long edge:
      // typically 1280 × 720 landscape or 720 × 1280 portrait.
      width: 1280,
      height: 1280,
      format: "image/jpeg",
      quality: 0.82
    }
  };
  if (mode === "screen" || mode === "screen-microphone" || mode === "screenshot") {
    capture.screen = overrides.capture?.screen ?? {
      // Browsers retain final control of the chosen display source and may
      // ignore these preferred values. The capture duration guard keeps a
      // full-resolution capture bounded when that happens.
      video: {
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 24, max: 30 }
      },
      audio: mode === "screen-microphone"
    };
  } else if (overrides.capture?.screen) {
    capture.screen = overrides.capture.screen;
  }
  if (overrides.capture?.mimeTypes) {
    capture.mimeTypes = overrides.capture.mimeTypes;
  }

  const upload: RecorderConfig["upload"] = {
    enabled: overrides.upload?.enabled ?? false,
    fieldName: overrides.upload?.fieldName ?? "media"
  };
  if (overrides.upload?.endpoint) {
    upload.endpoint = overrides.upload.endpoint;
  }
  if (overrides.upload?.deleteEndpoint) {
    upload.deleteEndpoint = overrides.upload.deleteEndpoint;
  }
  if (overrides.upload?.csrfToken) {
    upload.csrfToken = overrides.upload.csrfToken;
  }
  if (overrides.upload?.ownerToken) {
    upload.ownerToken = overrides.upload.ownerToken;
  }
  if (overrides.upload?.metadata) {
    upload.metadata = overrides.upload.metadata;
  }
  if (overrides.upload?.headers) {
    upload.headers = overrides.upload.headers;
  }

  const completion: RecorderConfig["completion"] = {
    mode: overrides.completion?.mode ?? "return-to-host",
    redirectUrl: overrides.completion?.redirectUrl ?? null,
    form: overrides.completion?.form ?? null
  };
  if (overrides.completion?.hiddenInputName) {
    completion.hiddenInputName = overrides.completion.hiddenInputName;
  }

  return {
    ...(target ? { target } : {}),
    mode,
    renderMode: overrides.renderMode ?? "button",
    edition: "free",
    ui: {
      launchLabel: overrides.ui?.launchLabel ?? launchLabelForMode(mode),
      mobileFullscreen: overrides.ui?.mobileFullscreen ?? true,
      theme: overrides.ui?.theme ?? "auto",
      showLocalSave: overrides.ui?.showLocalSave ?? false,
      showNevermind: overrides.ui?.showNevermind ?? true,
      skipPreparation: overrides.ui?.skipPreparation ?? false,
      ...(overrides.ui?.consentText ? { consentText: overrides.ui.consentText } : {})
    },
    limits: {
      maxDurationSeconds: clamp(
        overrides.limits?.maxDurationSeconds ?? (isScreenRecordingMode(mode) ? DEFAULT_CAPTURE_BOUNDS.maxScreenDurationSeconds : DEFAULT_CAPTURE_BOUNDS.maxDurationSeconds),
		1,
		isScreenRecordingMode(mode) ? DEFAULT_CAPTURE_BOUNDS.maxScreenDurationSeconds : DEFAULT_CAPTURE_BOUNDS.maxDurationSeconds
      ),
      maxItems: 1,
		maxBytes: Math.min(overrides.limits?.maxBytes ?? DEFAULT_CAPTURE_BOUNDS.maxBytes, DEFAULT_CAPTURE_BOUNDS.maxBytes)
    },
    capture,
    upload,
    completion,
    callbacks: overrides.callbacks,
    metadata: overrides.metadata,
    allowedParentOrigins: overrides.allowedParentOrigins
  };
}

function defaultWebcamVideoConstraints(): MediaTrackConstraints {
  // Choose the natural presentation orientation before opening the camera.
  // Both dimensions retain the 640px maximum long edge, but an aspect-ratio
  // preference prevents browsers from treating the default as a square 640px
  // request. Integrations can still supply capture.video to take full control.
  const portrait = typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(orientation: portrait)").matches;

  return portrait ? {
    width: { ideal: 360, max: 640 },
    height: { ideal: 640, max: 640 },
    aspectRatio: { ideal: 9 / 16 },
    frameRate: { ideal: 24, max: 30 },
    facingMode: "user"
  } : {
    width: { ideal: 640, max: 640 },
    height: { ideal: 360, max: 640 },
    aspectRatio: { ideal: 16 / 9 },
    frameRate: { ideal: 24, max: 30 },
    facingMode: "user"
  };
}

function isScreenRecordingMode(mode: RecorderMode): boolean {
  return mode === "screen" || mode === "screen-microphone" || mode === "screen-camera";
}

function launchLabelForMode(mode: RecorderMode): string {
  switch (mode) {
    case "audio":
      return "Add Audio";
    case "screen":
    case "screen-microphone":
      return "Add Screen Recording";
    case "photo":
      return "Add Photo";
    case "screenshot":
      return "Add Screenshot";
    default:
      return "Add Video";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
