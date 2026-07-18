import type { RecorderCaptureConfig, RecorderMode } from "@videowhisper/recorder-types";

export function mediaResultTypeForMode(mode: RecorderMode) {
  if (mode === "screen-microphone") {
    return "screen" as const;
  }
  return mode;
}

export function buildUserMediaConstraints(mode: RecorderMode, capture: RecorderCaptureConfig): MediaStreamConstraints {
  if (mode === "audio") {
    return { audio: capture.audio ?? true, video: false };
  }

  if (mode === "photo" || mode === "video") {
    return {
      audio: mode === "video" ? capture.audio ?? true : false,
      video: capture.video ?? {
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 24, max: 30 },
        facingMode: "user"
      }
    };
  }

  return { audio: false, video: false };
}

export function buildDisplayMediaOptions(mode: RecorderMode, capture: RecorderCaptureConfig): DisplayMediaStreamOptions {
  const base = capture.screen ?? {
    video: {
      frameRate: { ideal: 24, max: 30 }
    },
    audio: mode === "screen-microphone"
  };

  return {
    ...base,
    video: base.video ?? true,
    audio: mode === "screen-microphone" ? base.audio ?? true : base.audio ?? false
  };
}

export async function captureWithFallback(
  constraints: MediaStreamConstraints,
  getStream: (constraints: MediaStreamConstraints) => Promise<MediaStream>
): Promise<MediaStream> {
  const attempts = buildConstraintAttempts(constraints);
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      return await getStream(attempt);
    } catch (error) {
      lastError = error;
      if (!(error instanceof DOMException) || error.name !== "OverconstrainedError") {
        throw error;
      }
    }
  }

  throw lastError;
}

function buildConstraintAttempts(constraints: MediaStreamConstraints): MediaStreamConstraints[] {
  const attempts: MediaStreamConstraints[] = [constraints];
  const audio = constraints.audio ?? false;
  const preferredVideo = typeof constraints.video === "object" ? constraints.video : undefined;
  const portrait = preferredVideo && idealConstraintValue(preferredVideo.height) > idealConstraintValue(preferredVideo.width);

  if (constraints.video) {
    attempts.push({
      audio,
      video: portrait ? {
        width: { ideal: 360, max: 640 },
        height: { ideal: 640, max: 640 },
        aspectRatio: { ideal: 9 / 16 },
        frameRate: { ideal: 24, max: 30 }
      } : {
        width: { ideal: 640, max: 640 },
        height: { ideal: 360, max: 640 },
        aspectRatio: { ideal: 16 / 9 },
        frameRate: { ideal: 24, max: 30 }
      }
    });
    attempts.push({
      audio,
      video: {
        width: { ideal: 320 },
        height: { ideal: 240 },
        frameRate: { ideal: 15, max: 24 }
      }
    });
  }

  attempts.push({
    audio,
    video: Boolean(constraints.video)
  });

  return attempts;
}

function idealConstraintValue(constraint: ConstrainULong | undefined): number {
  if (typeof constraint === "number") {
    return constraint;
  }
  return typeof constraint?.ideal === "number" ? constraint.ideal : 0;
}
