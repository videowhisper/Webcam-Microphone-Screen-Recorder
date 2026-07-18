import type { RecorderError } from "@videowhisper/recorder-types";

export function normalizeError(error: unknown, fallbackMessage = "Recorder failed."): RecorderError {
  if (isRecorderError(error)) {
    return error;
  }

  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return {
        code: "permission-denied",
        message: "Permission was denied or dismissed.",
        recoverable: true,
        originalName: error.name
      };
    }

    if (error.name === "NotFoundError" || error.name === "NotReadableError") {
      return {
        code: "device-unavailable",
        message: "The requested camera, microphone, or screen source is unavailable.",
        recoverable: true,
        originalName: error.name
      };
    }

    if (error.name === "OverconstrainedError") {
      return {
        code: "device-unavailable",
        message: "The requested quality is not available on this device.",
        recoverable: true,
        originalName: error.name
      };
    }
  }

  if (error instanceof Error) {
    return {
      code: "unknown",
      message: error.message || fallbackMessage,
      recoverable: true,
      originalName: error.name
    };
  }

  return {
    code: "unknown",
    message: fallbackMessage,
    recoverable: true
  };
}

export function recorderError(
  code: RecorderError["code"],
  message: string,
  recoverable = true,
  details?: Record<string, unknown>
): RecorderError {
  return {
    code,
    message,
    recoverable,
    ...(details ? { details } : {})
  };
}

function isRecorderError(error: unknown): error is RecorderError {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      "message" in error
  );
}
