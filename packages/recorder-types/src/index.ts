export type RecorderEdition = "free" | "pro";

export type RecorderMode =
  | "video"
  | "audio"
  | "screen"
  | "screen-microphone"
  | "screen-camera"
  | "photo"
  | "screenshot";

export type MediaResultType = "video" | "audio" | "screen" | "screen-camera" | "photo" | "screenshot";

export type RecorderRenderMode = "button" | "inline" | "modal" | "container" | "page";

export type RecorderCompletionMode =
  | "return-to-host"
  | "close-and-return"
  | "redirect"
  | "submit-and-redirect"
  | "stay-open";

export type RecorderStateName =
  | "closed"
  | "idle"
  | "preparing-permission"
  | "requesting-permission"
  | "preview"
  | "countdown"
  | "recording"
  | "paused"
  | "stopping"
  | "preparing-review"
  | "review"
  | "accepting"
  | "saving-local"
  | "uploading"
  | "processing"
  | "ready"
  | "error"
  | "destroyed";

export type RecorderEventName =
  | "open"
  | "close"
  | "statechange"
  | "capabilities"
  | "preview"
  | "recordingstart"
  | "recordingstop"
  | "review"
  | "uploadprogress"
  | "saved"
  | "removed"
  | "error";

export interface RecorderError {
  code:
    | "unsupported-browser"
    | "insecure-context"
    | "permission-denied"
    | "device-unavailable"
    | "screen-unavailable"
    | "mime-unsupported"
    | "recording-failed"
    | "upload-failed"
    | "invalid-state"
    | "file-too-large"
    | "time-limit-reached"
    | "unknown";
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown> | undefined;
  originalName?: string | undefined;
}

export interface CapabilityReport {
  schemaVersion: "1";
  secureContext: boolean;
  mediaDevices: boolean;
  getUserMedia: boolean;
  getDisplayMedia: boolean;
  mediaRecorder: boolean;
  pauseResume: boolean;
  imageCapture: boolean;
  canvasCapture: boolean;
  indexedDb: boolean;
  supportedConstraints: MediaTrackSupportedConstraints;
  supportedMimeTypes: string[];
  devices: {
    cameras: number;
    microphones: number;
    labelsAvailable: boolean;
  };
}

/** Availability of the inputs requested by the active preview. */
export interface RecorderPreviewAvailability {
  camera?: boolean;
  microphone?: boolean;
  screen?: boolean;
  warning?: string;
}

export interface RecorderLimits {
  maxDurationSeconds: number;
  maxItems: number;
  maxBytes?: number | undefined;
}

export interface RecorderUiConfig {
  launchLabel: string;
  mobileFullscreen: boolean;
  theme: "light" | "dark" | "auto";
  showLocalSave: boolean;
  showNevermind: boolean;
  /** Skip the explanatory permission screen and open the selected capture preview. */
  skipPreparation?: boolean | undefined;
  consentText?: string | undefined;
}

export interface RecorderCaptureConfig {
  video?: MediaTrackConstraints | boolean | undefined;
  audio?: MediaTrackConstraints | boolean | undefined;
  screen?: DisplayMediaStreamOptions | undefined;
  autoStart?: boolean | undefined;
  countdownSeconds?: number | undefined;
  mimeTypes?: string[] | undefined;
  thumbnail?: {
    width: number;
    height: number;
    format: "image/jpeg" | "image/webp" | "image/png";
    quality?: number | undefined;
  } | undefined;
}

export interface RecorderUploadConfig {
  enabled: boolean;
  endpoint?: string | undefined;
  /** Optional endpoint that deletes remote media before its result is removed. */
  deleteEndpoint?: string | undefined;
  fieldName: string;
  csrfToken?: string | undefined;
  ownerToken?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  headers?: Record<string, string> | undefined;
}

export interface RecorderCompletionConfig {
  mode: RecorderCompletionMode;
  redirectUrl?: string | null | undefined;
  form?: HTMLFormElement | string | null | undefined;
  hiddenInputName?: string | undefined;
}

export interface RecorderCallbacks {
  onOpen?: () => void;
  onClose?: () => void;
  onStateChange?: (state: RecorderStateName) => void;
  onRecordingStart?: () => void;
  onRecordingStop?: () => void;
  onReview?: (draft: RecorderDraft) => void;
  onUploadProgress?: (progress: UploadProgress) => void;
  onSaved?: (result: MediaResult) => void;
  onRemoved?: (resultId: string) => void;
  onError?: (error: RecorderError) => void;
}

export interface RecorderConfig {
  target?: string | HTMLElement | undefined;
  mode: RecorderMode;
  renderMode: RecorderRenderMode;
  edition: RecorderEdition;
  ui: RecorderUiConfig;
  limits: RecorderLimits;
  capture: RecorderCaptureConfig;
  upload: RecorderUploadConfig;
  completion: RecorderCompletionConfig;
  callbacks?: RecorderCallbacks | undefined;
  metadata?: Record<string, unknown> | undefined;
  allowedParentOrigins?: string[] | undefined;
}

export interface MediaVideoInfo {
  width?: number | undefined;
  height?: number | undefined;
  frameRate?: number | undefined;
  aspectRatio?: number | undefined;
  rotationDegrees?: number | undefined;
  facingMode?: string | undefined;
  resizeMode?: string | undefined;
  displaySurface?: string | undefined;
}

export interface MediaAudioInfo {
  present: boolean;
  channelCount?: number | undefined;
  sampleRate?: number | undefined;
  sampleSize?: number | undefined;
  echoCancellation?: boolean | undefined;
  noiseSuppression?: boolean | undefined;
  autoGainControl?: boolean | undefined;
}

export interface MediaEncodingInfo {
  videoBitsPerSecond?: number | undefined;
  audioBitsPerSecond?: number | undefined;
}

/**
 * Browser-reported technical information. Optional values are omitted when the
 * browser or selected capture mode does not expose them.
 */
export interface MediaTechnicalInfo {
  schemaVersion: "1";
  containerMimeType: string;
  codecs: string[];
  videoCodec?: string | undefined;
  audioCodec?: string | undefined;
  durationSeconds?: number | undefined;
  video?: MediaVideoInfo | undefined;
  audio: MediaAudioInfo;
  encoding?: MediaEncodingInfo | undefined;
  image?: {
    width: number;
    height: number;
    format: string;
    quality?: number | undefined;
  } | undefined;
}

export interface RecorderDraft {
  schemaVersion: "1";
  id: string;
  sessionId: string;
  type: MediaResultType;
  blob: Blob;
  localUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  frameRate?: number | undefined;
  audioPresent?: boolean | undefined;
  mediaInfo?: MediaTechnicalInfo | undefined;
  thumbnailBlob?: Blob | undefined;
  thumbnailUrl?: string | undefined;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface MediaResult {
  schemaVersion: "1";
  id: string;
  sessionId: string;
  type: MediaResultType;
  status: "local" | "uploading" | "uploaded" | "processing" | "ready" | "error";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  frameRate?: number | undefined;
  audioPresent?: boolean | undefined;
  mediaInfo?: MediaTechnicalInfo | undefined;
  localUrl?: string | undefined;
  remoteUrl?: string | undefined;
  playbackUrl?: string | undefined;
  thumbnailUrl?: string | undefined;
  uploadId?: string | undefined;
  serverMediaId?: string | undefined;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface UploadInput {
  draft: RecorderDraft;
  config: RecorderUploadConfig;
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: UploadProgress) => void) | undefined;
}

export interface UploadProgress {
  uploadId?: string;
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  stage: "preparing" | "uploading" | "processing" | "ready" | "error";
}

export interface UploadResult {
  uploadId?: string | undefined;
  serverMediaId?: string | undefined;
  remoteUrl?: string | undefined;
  playbackUrl?: string | undefined;
  thumbnailUrl?: string | undefined;
  status: MediaResult["status"];
  metadata?: Record<string, unknown> | undefined;
}

export interface RemoveInput {
  result: MediaResult;
  config: RecorderUploadConfig;
  signal?: AbortSignal | undefined;
}

export interface ProcessingResult {
  serverMediaId: string;
  status: "processing" | "ready" | "error";
  playbackUrl?: string | undefined;
  thumbnailUrl?: string | undefined;
  message?: string | undefined;
}

export interface UploadAdapter {
  upload(input: UploadInput): Promise<UploadResult>;
  remove?(input: RemoveInput): Promise<void>;
  cancel?(uploadId: string): Promise<void>;
  retry?(uploadId: string): Promise<UploadResult>;
  getStatus?(serverMediaId: string): Promise<ProcessingResult>;
}

export interface RecorderApi {
  open(): Promise<void>;
  close(): Promise<void>;
  prepare(): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  accept(): Promise<MediaResult>;
  discard(): Promise<void>;
  retry(): Promise<void>;
  addAnother(): Promise<void>;
  getResults(): MediaResult[];
  removeResult(id: string): Promise<void>;
  submitSession(): Promise<MediaResult[]>;
  getCapabilities(): Promise<CapabilityReport>;
  destroy(): Promise<void>;
  on(eventName: RecorderEventName, handler: (payload: unknown) => void): () => void;
}
