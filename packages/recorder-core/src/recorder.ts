import type {
  CapabilityReport,
  MediaTechnicalInfo,
  MediaResult,
  RecorderApi,
  RecorderConfig,
  RecorderDraft,
  RecorderError,
  RecorderEventName,
  RecorderPreviewAvailability,
  RecorderStateName,
  UploadAdapter
} from "@videowhisper/recorder-types";
import { detectCapabilities, selectMimeType } from "./capabilities";
import { buildDisplayMediaOptions, buildUserMediaConstraints, captureWithFallback, mediaResultTypeForMode } from "./constraints";
import { RecorderEventBus } from "./events";
import { normalizeError, recorderError } from "./errors";
import { captureVideoFrame, createId, fitCaptureDimensions, formatExtension, parseMediaCodecs, readAudioMetadata, readVideoMetadata, revokeUrl, stopStream } from "./utils";

const ALLOWED_TRANSITIONS: Record<RecorderStateName, RecorderStateName[]> = {
  closed: ["idle", "destroyed"],
  idle: ["preparing-permission", "closed", "destroyed"],
  "preparing-permission": ["requesting-permission", "closed", "error", "destroyed"],
  "requesting-permission": ["preview", "error", "closed", "destroyed"],
  preview: ["idle", "countdown", "recording", "preparing-review", "closed", "error", "destroyed"],
  countdown: ["recording", "preparing-review", "closed", "error", "destroyed"],
  recording: ["paused", "stopping", "error", "destroyed"],
  paused: ["recording", "stopping", "error", "destroyed"],
  stopping: ["preparing-review", "review", "error", "destroyed"],
  "preparing-review": ["review", "error", "destroyed"],
  review: ["accepting", "idle", "closed", "destroyed"],
  accepting: ["saving-local", "uploading", "ready", "error", "destroyed"],
  "saving-local": ["ready", "error", "destroyed"],
  uploading: ["processing", "ready", "error", "destroyed"],
  processing: ["ready", "error", "destroyed"],
  ready: ["idle", "closed", "destroyed"],
  error: ["idle", "closed", "destroyed"],
  destroyed: []
};

export class BrowserMediaRecorder implements RecorderApi {
  private readonly bus = new RecorderEventBus();
  private readonly sessionId = createId("vwrs");
  private readonly chunks: Blob[] = [];
  private state: RecorderStateName = "closed";
  private capabilities?: CapabilityReport;
  private previewStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private startedAt = 0;
  private timerId: number | undefined;
  private currentDraft: RecorderDraft | undefined;
  private results: MediaResult[] = [];
  private previewVideo: HTMLVideoElement | undefined;
  private selectedVideoInputId: string | undefined;
  private selectedAudioInputId: string | undefined;
  private previewWarning: string | undefined;
  private previewMicrophoneAvailable: boolean | undefined;

  constructor(
    private readonly config: RecorderConfig,
    private readonly uploadAdapter?: UploadAdapter
  ) {}

  on(eventName: RecorderEventName, handler: (payload: unknown) => void): () => void {
    return this.bus.on(eventName, handler);
  }

  async open(): Promise<void> {
    this.assertNotDestroyed();
    if (this.state === "closed") {
      this.transition("idle");
    }
    this.config.callbacks?.onOpen?.();
    this.bus.emit("open");
  }

  async close(): Promise<void> {
    if (this.state === "destroyed") {
      return;
    }
    this.cleanupCapture();
    this.transition("closed");
    this.config.callbacks?.onClose?.();
    this.bus.emit("close");
  }

  async prepare(): Promise<void> {
    this.assertState(["closed", "idle", "preview", "review", "error"]);
    if (this.state === "closed") {
      this.transition("idle");
    }
    if (this.state === "preview") {
      return;
    }

    if (this.state === "review" || this.state === "error") {
      this.cleanupCapture();
      this.discardDraft();
      this.transition("idle");
    }

    this.currentDraft && this.discardDraft();
    this.chunks.length = 0;
    this.transition("preparing-permission");

    const capabilities = await this.getCapabilities();
    this.validateSupported(capabilities);
    this.transition("requesting-permission");

    try {
      this.previewStream = await this.createStream();
      this.transition("preview");
      if (this.previewVideo) {
        this.previewVideo.srcObject = this.previewStream;
      }
      this.bus.emit("preview", this.previewStream);
    } catch (error) {
      this.fail(error);
      throw normalizeError(error);
    }
  }

  async start(): Promise<void> {
    this.assertState(["closed", "idle", "preview", "review", "error"]);
    if (this.state !== "preview") {
      await this.prepare();
    }

    try {
      const countdown = this.config.capture.countdownSeconds ?? 0;
      if (countdown > 0) {
        this.transition("countdown");
        await new Promise((resolve) => window.setTimeout(resolve, countdown * 1000));
      }

      if (this.config.mode === "photo" || this.config.mode === "screenshot") {
        await this.createStillDraft();
        return;
      }

      this.startMediaRecorder();
    } catch (error) {
      this.fail(error);
      throw normalizeError(error);
    }
  }

  async pause(): Promise<void> {
    this.assertState(["recording"]);
    if (this.recorder && this.recorder.state === "recording" && "pause" in this.recorder) {
      this.recorder.pause();
      this.transition("paused");
    }
  }

  async resume(): Promise<void> {
    this.assertState(["paused"]);
    if (this.recorder && this.recorder.state === "paused" && "resume" in this.recorder) {
      this.recorder.resume();
      this.transition("recording");
    }
  }

  async stop(): Promise<void> {
    this.assertState(["recording", "paused"]);
    this.transition("stopping");

    await new Promise<void>((resolve) => {
      if (!this.recorder || this.recorder.state === "inactive") {
        resolve();
        return;
      }
      this.recorder.addEventListener("stop", () => resolve(), { once: true });
      this.recorder.stop();
    });
  }

  async accept(): Promise<MediaResult> {
    this.assertState(["review"]);
    if (!this.currentDraft) {
      throw recorderError("invalid-state", "No recording is ready for acceptance.", true);
    }

    this.transition("accepting");
    const draft = this.currentDraft;

    if (!this.config.upload.enabled) {
      const result = this.draftToResult(draft, "local");
      this.results = [result];
      this.transition("ready");
      this.config.callbacks?.onSaved?.(result);
      this.bus.emit("saved", result);
      return result;
    }

    if (!this.uploadAdapter) {
      this.fail(recorderError("upload-failed", "Upload is enabled but no upload adapter is configured.", true));
      throw recorderError("upload-failed", "Upload is enabled but no upload adapter is configured.", true);
    }

    this.transition("uploading");
    try {
      const upload = await this.uploadAdapter.upload({
        draft,
        config: this.config.upload,
        onProgress: (progress) => {
          this.config.callbacks?.onUploadProgress?.(progress);
          this.bus.emit("uploadprogress", progress);
        }
      });
      const result = {
        ...this.draftToResult(draft, upload.status),
        ...(upload.uploadId ? { uploadId: upload.uploadId } : {}),
        ...(upload.serverMediaId ? { serverMediaId: upload.serverMediaId } : {}),
        ...(upload.remoteUrl ? { remoteUrl: upload.remoteUrl } : {}),
        ...(upload.playbackUrl ? { playbackUrl: upload.playbackUrl } : {}),
        ...(upload.thumbnailUrl ? { thumbnailUrl: upload.thumbnailUrl } : {}),
        metadata: {
          ...draft.metadata,
          ...(upload.metadata ?? {})
        }
      };
      this.results = [result];
      this.transition(upload.status === "processing" ? "processing" : "ready");
      if (this.state === "processing") {
        this.transition("ready");
      }
      this.config.callbacks?.onSaved?.(result);
      this.bus.emit("saved", result);
      return result;
    } catch (error) {
      const normalized = normalizeError(error, "Upload failed.");
      this.fail({ ...normalized, code: "upload-failed" });
      throw normalized;
    }
  }

  async discard(): Promise<void> {
    this.assertState(["review", "error", "preview", "idle"]);
    this.cleanupCapture();
    this.discardDraft();
    this.transition("idle");
  }

  async retry(): Promise<void> {
    await this.discard();
    await this.prepare();
  }

	async addAnother(): Promise<void> {
		throw recorderError("invalid-state", "Only one recording can be kept at a time.", true);
	}

  getResults(): MediaResult[] {
    return [...this.results];
  }

  async removeResult(id: string): Promise<void> {
    const result = this.results.find((item) => item.id === id);
    if (!result) {
      return;
    }

    if (result.serverMediaId && this.config.upload.deleteEndpoint && this.uploadAdapter?.remove) {
      await this.uploadAdapter.remove({ result, config: this.config.upload });
    }

    revokeUrl(result.localUrl);
    revokeUrl(result.thumbnailUrl);
    this.results = this.results.filter((item) => item.id !== id);
    this.config.callbacks?.onRemoved?.(id);
    this.bus.emit("removed", id);
  }

  async submitSession(): Promise<MediaResult[]> {
    return this.getResults();
  }

  async getCapabilities(): Promise<CapabilityReport> {
    if (!this.capabilities) {
      this.capabilities = await detectCapabilities();
      this.bus.emit("capabilities", this.capabilities);
    }
    return this.capabilities;
  }

  async destroy(): Promise<void> {
    this.cleanupCapture();
    this.discardDraft();
    this.bus.clear();
    this.transition("destroyed");
  }

  getState(): RecorderStateName {
    return this.state;
  }

  setPreviewVideo(video: HTMLVideoElement | undefined): void {
    this.previewVideo = video;
    if (video && this.previewStream) {
      video.srcObject = this.previewStream;
    }
  }

  getPreviewStream(): MediaStream | null {
    return this.previewStream;
  }

  getPreviewAvailability(): RecorderPreviewAvailability {
    const hasVideo = Boolean(this.previewStream?.getVideoTracks().length);
    const hasAudio = Boolean(this.previewStream?.getAudioTracks().length);
    const warning = this.previewWarning ? { warning: this.previewWarning } : {};
    switch (this.config.mode) {
      case "video":
        return { camera: hasVideo, microphone: this.previewMicrophoneAvailable ?? hasAudio, ...warning };
      case "audio":
        return { microphone: this.previewMicrophoneAvailable ?? hasAudio, ...warning };
      case "photo":
        return { camera: hasVideo, ...warning };
      case "screen":
      case "screenshot":
        return { screen: hasVideo, ...warning };
      case "screen-microphone":
        return { screen: hasVideo, microphone: this.previewMicrophoneAvailable ?? false, ...warning };
      default:
        return warning;
    }
  }

  getDraft(): RecorderDraft | undefined {
    return this.currentDraft;
  }

  /** Input labels become available after the browser has granted capture permission. */
  async getInputDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    return devices.filter((device) => device.kind === "videoinput" || device.kind === "audioinput");
  }

  /** Cycles the active camera while a camera/photo preview is open. */
  async cycleVideoInput(): Promise<MediaDeviceInfo | undefined> {
    return this.cycleInput("videoinput");
  }

  /** Cycles the active microphone while a microphone preview is open. */
  async cycleAudioInput(): Promise<MediaDeviceInfo | undefined> {
    return this.cycleInput("audioinput");
  }

  private validateSupported(capabilities: CapabilityReport): void {
    if (!capabilities.secureContext) {
      throw recorderError("insecure-context", "Camera, microphone, and screen capture require HTTPS or localhost.", true);
    }
    if (!capabilities.mediaDevices) {
      throw recorderError("unsupported-browser", "This browser does not support MediaRecorder capture.", false);
    }
    if (this.config.mode !== "photo" && this.config.mode !== "screenshot" && !capabilities.mediaRecorder) {
      throw recorderError("unsupported-browser", "This browser does not support MediaRecorder capture.", false);
    }
    if ((this.config.mode === "screen" || this.config.mode === "screen-microphone" || this.config.mode === "screenshot") && !capabilities.getDisplayMedia) {
      throw recorderError("screen-unavailable", "Screen capture is not available in this browser.", true);
    }
    if ((this.config.mode === "video" || this.config.mode === "audio" || this.config.mode === "photo") && !capabilities.getUserMedia) {
      throw recorderError("device-unavailable", "Camera or microphone capture is not available in this browser.", true);
    }
  }

  private async createStream(): Promise<MediaStream> {
    this.previewWarning = undefined;
    this.previewMicrophoneAvailable = undefined;
    if (this.config.mode === "screen" || this.config.mode === "screen-microphone" || this.config.mode === "screenshot") {
      const displayStream = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaOptions(this.config.mode, this.config.capture));

      displayStream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (this.state === "recording" || this.state === "paused") {
            void this.stop();
          }
        });
      });

      if (this.config.mode === "screen-microphone") {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: this.config.capture.audio ?? true, video: false });
          mic.getAudioTracks().forEach((track) => displayStream.addTrack(track));
          this.previewMicrophoneAvailable = mic.getAudioTracks().length > 0;
        } catch {
          this.previewMicrophoneAvailable = false;
          this.previewWarning = "Microphone access is unavailable. Screen video will continue without microphone audio.";
        }
      }

      return displayStream;
    }

    try {
      const stream = await this.createUserMediaStream();
      if (this.config.mode === "video" || this.config.mode === "audio") {
        this.previewMicrophoneAvailable = stream.getAudioTracks().length > 0;
      }
      return stream;
    } catch (error) {
      if (this.config.mode !== "video" || this.config.capture.audio === false) {
        throw error;
      }
      const cameraOnly = this.userMediaConstraints();
      cameraOnly.audio = false;
      try {
        const stream = await this.createUserMediaStream(true, cameraOnly);
        this.previewMicrophoneAvailable = false;
        this.previewWarning = "Microphone access is unavailable. Webcam video will continue without audio.";
        return stream;
      } catch {
        throw error;
      }
    }
  }

  private async createUserMediaStream(allowFallback = true, constraints = this.userMediaConstraints()): Promise<MediaStream> {
    if (!allowFallback) {
      return navigator.mediaDevices.getUserMedia(constraints);
    }
    return captureWithFallback(constraints, (attempt) => navigator.mediaDevices.getUserMedia(attempt));
  }

  private userMediaConstraints(): MediaStreamConstraints {
    const constraints = buildUserMediaConstraints(this.config.mode, this.config.capture);
    if (this.selectedVideoInputId && constraints.video && typeof constraints.video === "object") {
      constraints.video = { ...constraints.video, deviceId: { exact: this.selectedVideoInputId } };
    }
    if (this.selectedAudioInputId && constraints.audio) {
      constraints.audio = typeof constraints.audio === "object"
        ? { ...constraints.audio, deviceId: { exact: this.selectedAudioInputId } }
        : { deviceId: { exact: this.selectedAudioInputId } };
    }
    return constraints;
  }

  private async cycleInput(kind: "videoinput" | "audioinput"): Promise<MediaDeviceInfo | undefined> {
    this.assertState(["preview"]);
    const canSwitchVideo = kind === "videoinput" && (this.config.mode === "video" || this.config.mode === "photo");
    const canSwitchAudio = kind === "audioinput" && (this.config.mode === "video" || this.config.mode === "audio");
    if (!canSwitchVideo && !canSwitchAudio) {
      return undefined;
    }

    const devices = (await this.getInputDevices()).filter((device) => device.kind === kind);
    if (devices.length < 2) {
      return undefined;
    }

    const activeTrack = kind === "videoinput" ? this.previewStream?.getVideoTracks()[0] : this.previewStream?.getAudioTracks()[0];
    const activeId = kind === "videoinput"
      ? this.selectedVideoInputId ?? activeTrack?.getSettings().deviceId
      : this.selectedAudioInputId ?? activeTrack?.getSettings().deviceId;
    const activeIndex = devices.findIndex((device) => device.deviceId === activeId);
    const next = devices[(activeIndex + 1 + devices.length) % devices.length]!;
    const previousVideoInputId = this.selectedVideoInputId;
    const previousAudioInputId = this.selectedAudioInputId;
    if (kind === "videoinput") {
      this.selectedVideoInputId = next.deviceId;
    } else {
      this.selectedAudioInputId = next.deviceId;
    }

    let nextStream: MediaStream;
    try {
      // Device cycling must not silently fall back to another input: the UI
      // identifies the selected device, so retain the old preview on failure.
      nextStream = await this.createUserMediaStream(false);
    } catch (error) {
      this.selectedVideoInputId = previousVideoInputId;
      this.selectedAudioInputId = previousAudioInputId;
      throw error;
    }
    const previousStream = this.previewStream;
    this.previewStream = nextStream;
    if (this.previewVideo) {
      this.previewVideo.srcObject = nextStream;
    }
    stopStream(previousStream);
    return next;
  }

  private startMediaRecorder(): void {
    if (!this.previewStream) {
      throw recorderError("invalid-state", "No media stream is available.", true);
    }

    const mediaType = this.config.mode === "audio" ? "audio" : "video";
    const mimeType = selectMimeType(this.config.capture.mimeTypes, mediaType);
    if (!mimeType) {
      throw recorderError("mime-unsupported", "No supported recording format was found.", false);
    }

    this.recorder = new MediaRecorder(this.previewStream, { mimeType });
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });
    this.recorder.addEventListener("stop", () => {
      void this.createRecordingDraft(mimeType);
    });
    this.recorder.addEventListener("error", (event) => {
      this.fail(event.error ?? recorderError("recording-failed", "Recording failed.", true));
    });

    this.startedAt = performance.now();
    this.recorder.start(1000);
    this.transition("recording");
    this.config.callbacks?.onRecordingStart?.();
    this.bus.emit("recordingstart");
    this.startLimitTimer();
  }

  private async createRecordingDraft(mimeType: string): Promise<void> {
    this.transition("preparing-review");
    window.clearTimeout(this.timerId);
    const actualMimeType = this.recorder?.mimeType || mimeType;
    const blob = new Blob(this.chunks, { type: actualMimeType });
    const localUrl = URL.createObjectURL(blob);
    const type = mediaResultTypeForMode(this.config.mode);
    const durationSeconds = Math.max(0, (performance.now() - this.startedAt) / 1000);
    const trackSettings = this.previewStream?.getVideoTracks()[0]?.getSettings();
    const audioSettings = this.previewStream?.getAudioTracks()[0]?.getSettings();
    const mediaMetadata: { durationSeconds?: number; width?: number; height?: number } =
      type === "audio" ? await readAudioMetadata(localUrl) : await readVideoMetadata(localUrl);
    const measuredDuration = mediaMetadata.durationSeconds ?? durationSeconds;
    const mediaInfo = buildMediaInfo({
      mimeType: actualMimeType,
      durationSeconds: measuredDuration,
      videoSettings: trackSettings,
      audioSettings,
      videoWidth: mediaMetadata.width,
      videoHeight: mediaMetadata.height,
      recorder: this.recorder
    });
    const thumbnail = type === "audio" ? undefined : await this.createThumbnailFromUrl(localUrl);
    const createdAt = new Date().toISOString();
    const id = createId("vwrm");

    this.currentDraft = {
      schemaVersion: "1",
      id,
      sessionId: this.sessionId,
      type,
      blob,
      localUrl,
      fileName: `${id}.${formatExtension(actualMimeType)}`,
      mimeType: actualMimeType,
      sizeBytes: blob.size,
      durationSeconds: measuredDuration,
      ...(mediaMetadata.width ? { width: mediaMetadata.width } : {}),
      ...(mediaMetadata.height ? { height: mediaMetadata.height } : {}),
      ...(trackSettings?.frameRate ? { frameRate: trackSettings.frameRate } : {}),
      audioPresent: Boolean(this.previewStream?.getAudioTracks().length),
      mediaInfo,
      ...(thumbnail?.blob ? { thumbnailBlob: thumbnail.blob } : {}),
      ...(thumbnail?.url ? { thumbnailUrl: thumbnail.url } : {}),
      createdAt,
      metadata: {
        ...(this.config.metadata ?? {}),
        mode: this.config.mode,
        actualVideoSettings: mediaInfo.video ?? null,
        actualAudioSettings: mediaInfo.audio
      }
    };

    this.cleanupCapture();
    this.transition("review");
    this.config.callbacks?.onRecordingStop?.();
    this.config.callbacks?.onReview?.(this.currentDraft);
    this.bus.emit("recordingstop");
    this.bus.emit("review", this.currentDraft);
  }

  private async createStillDraft(): Promise<void> {
    this.transition("preparing-review");
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.previewStream;
    await video.play().catch(() => undefined);
    await waitForVideoFrame(video);

    const thumbnailConfig = this.config.capture.thumbnail ?? {
      width: 640,
      height: 640,
      format: "image/jpeg" as const,
      quality: 0.86
    };
    const imageDimensions = fitCaptureDimensions(video.videoWidth, video.videoHeight, thumbnailConfig.width, thumbnailConfig.height);
    const blob = await captureVideoFrame(
      video,
      thumbnailConfig.width,
      thumbnailConfig.height,
      thumbnailConfig.format,
      thumbnailConfig.quality
    );

    if (!blob) {
      this.fail(recorderError("recording-failed", `${this.config.mode === "screenshot" ? "Screenshot" : "Photo"} capture failed.`, true));
      return;
    }

    const isScreenshot = this.config.mode === "screenshot";
    const id = createId(isScreenshot ? "vwrs" : "vwrp");
    const localUrl = URL.createObjectURL(blob);
    const settings = this.previewStream?.getVideoTracks()[0]?.getSettings();
    const mediaInfo = buildMediaInfo({
      mimeType: blob.type,
      videoSettings: settings,
      image: {
        width: imageDimensions.width,
        height: imageDimensions.height,
        format: blob.type,
        ...(thumbnailConfig.quality !== undefined ? { quality: thumbnailConfig.quality } : {})
      }
    });
    this.currentDraft = {
      schemaVersion: "1",
      id,
      sessionId: this.sessionId,
      type: isScreenshot ? "screenshot" : "photo",
      blob,
      localUrl,
      fileName: `${id}.${formatExtension(blob.type)}`,
      mimeType: blob.type,
      sizeBytes: blob.size,
      width: imageDimensions.width,
      height: imageDimensions.height,
      audioPresent: false,
      mediaInfo,
      thumbnailBlob: blob,
      thumbnailUrl: localUrl,
      createdAt: new Date().toISOString(),
      metadata: {
        ...(this.config.metadata ?? {}),
        mode: this.config.mode,
        actualVideoSettings: mediaInfo.video ?? null
      }
    };

    this.cleanupCapture();
    this.transition("review");
    this.config.callbacks?.onReview?.(this.currentDraft);
    this.bus.emit("review", this.currentDraft);
  }

  private async createThumbnailFromUrl(url: string): Promise<{ blob?: Blob; url?: string }> {
    const config = this.config.capture.thumbnail ?? {
      width: 480,
      height: 270,
      format: "image/jpeg" as const,
      quality: 0.8
    };
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    return new Promise((resolve) => {
      video.onloadeddata = () => {
        video.currentTime = Math.min(1, Number.isFinite(video.duration) ? video.duration / 3 : 1);
      };
      video.onseeked = () => {
        captureVideoFrame(video, config.width, config.height, config.format, config.quality)
          .then((blob) => resolve(blob ? { blob, url: URL.createObjectURL(blob) } : {}))
          .catch(() => resolve({}));
      };
      video.onerror = () => resolve({});
    });
  }

  private startLimitTimer(): void {
    const maxDurationSeconds = this.config.limits.maxDurationSeconds;
    if (!maxDurationSeconds) {
      return;
    }
    this.timerId = window.setTimeout(() => {
      if (this.state === "recording" || this.state === "paused") {
        void this.stop();
      }
    }, maxDurationSeconds * 1000);
  }

  private draftToResult(draft: RecorderDraft, status: MediaResult["status"]): MediaResult {
    return {
      schemaVersion: "1",
      id: draft.id,
      sessionId: draft.sessionId,
      type: draft.type,
      status,
      fileName: draft.fileName,
      mimeType: draft.mimeType,
      sizeBytes: draft.sizeBytes,
      ...(draft.durationSeconds ? { durationSeconds: draft.durationSeconds } : {}),
      ...(draft.width ? { width: draft.width } : {}),
      ...(draft.height ? { height: draft.height } : {}),
      ...(draft.frameRate ? { frameRate: draft.frameRate } : {}),
      audioPresent: Boolean(draft.audioPresent),
      ...(draft.mediaInfo ? { mediaInfo: draft.mediaInfo } : {}),
      localUrl: draft.localUrl,
      ...(draft.thumbnailUrl ? { thumbnailUrl: draft.thumbnailUrl } : {}),
      createdAt: draft.createdAt,
      metadata: draft.metadata
    };
  }

  private cleanupCapture(): void {
    window.clearTimeout(this.timerId);
    this.timerId = undefined;
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        // Stopping is best-effort during destroy/close.
      }
    }
    this.recorder = null;
    stopStream(this.previewStream);
    this.previewStream = null;
    this.previewWarning = undefined;
    this.previewMicrophoneAvailable = undefined;
    if (this.previewVideo) {
      this.previewVideo.srcObject = null;
    }
  }

  private discardDraft(): void {
    revokeUrl(this.currentDraft?.localUrl);
    revokeUrl(this.currentDraft?.thumbnailUrl);
    this.currentDraft = undefined;
  }

  private transition(next: RecorderStateName): void {
    if (this.state === next) {
      return;
    }
    const allowed = ALLOWED_TRANSITIONS[this.state];
    if (!allowed.includes(next)) {
      throw recorderError("invalid-state", `Invalid recorder transition from ${this.state} to ${next}.`, true);
    }
    this.state = next;
    this.config.callbacks?.onStateChange?.(next);
    this.bus.emit("statechange", next);
  }

  private fail(error: unknown): void {
    const normalized = normalizeError(error);
    try {
      this.transition("error");
    } catch {
      this.state = "error";
    }
    this.config.callbacks?.onError?.(normalized);
    this.bus.emit("error", normalized);
  }

  private assertState(states: RecorderStateName[]): void {
    this.assertNotDestroyed();
    if (!states.includes(this.state)) {
      throw recorderError("invalid-state", `Recorder is ${this.state}; expected ${states.join(", ")}.`, true);
    }
  }

  private assertNotDestroyed(): void {
    if (this.state === "destroyed") {
      throw recorderError("invalid-state", "Recorder has been destroyed.", false);
    }
  }
}

interface BuildMediaInfoInput {
  mimeType: string;
  durationSeconds?: number | undefined;
  videoSettings?: MediaTrackSettings | undefined;
  audioSettings?: MediaTrackSettings | undefined;
  videoWidth?: number | undefined;
  videoHeight?: number | undefined;
  recorder?: MediaRecorder | null | undefined;
  image?: NonNullable<MediaTechnicalInfo["image"]> | undefined;
}

function buildMediaInfo(input: BuildMediaInfoInput): MediaTechnicalInfo {
  const codecInfo = parseMediaCodecs(input.mimeType);
  const video = buildVideoInfo(input.videoSettings, input.videoWidth, input.videoHeight);
  const audioSettings = input.audioSettings;
  const audio: MediaTechnicalInfo["audio"] = {
    present: Boolean(audioSettings),
    ...(audioSettings?.channelCount ? { channelCount: audioSettings.channelCount } : {}),
    ...(audioSettings?.sampleRate ? { sampleRate: audioSettings.sampleRate } : {}),
    ...(audioSettings?.sampleSize ? { sampleSize: audioSettings.sampleSize } : {}),
    ...(typeof audioSettings?.echoCancellation === "boolean" ? { echoCancellation: audioSettings.echoCancellation } : {}),
    ...(typeof audioSettings?.noiseSuppression === "boolean" ? { noiseSuppression: audioSettings.noiseSuppression } : {}),
    ...(typeof audioSettings?.autoGainControl === "boolean" ? { autoGainControl: audioSettings.autoGainControl } : {})
  };
  const videoBitsPerSecond = positiveNumber(input.recorder?.videoBitsPerSecond);
  const audioBitsPerSecond = positiveNumber(input.recorder?.audioBitsPerSecond);
  const encoding = videoBitsPerSecond || audioBitsPerSecond
    ? {
        ...(videoBitsPerSecond ? { videoBitsPerSecond } : {}),
        ...(audioBitsPerSecond ? { audioBitsPerSecond } : {})
      }
    : undefined;

  return {
    schemaVersion: "1",
    ...codecInfo,
    ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
    ...(video ? { video } : {}),
    audio,
    ...(encoding ? { encoding } : {}),
    ...(input.image ? { image: input.image } : {})
  };
}

function buildVideoInfo(
  settings: MediaTrackSettings | undefined,
  measuredWidth: number | undefined,
  measuredHeight: number | undefined
): NonNullable<MediaTechnicalInfo["video"]> | undefined {
  const width = positiveNumber(measuredWidth) ?? positiveNumber(settings?.width);
  const height = positiveNumber(measuredHeight) ?? positiveNumber(settings?.height);
  const rotationDegrees = readRotation(settings);
  const rawSettings = settings as unknown as Record<string, unknown> | undefined;
  const resizeMode = typeof rawSettings?.resizeMode === "string" ? rawSettings.resizeMode : undefined;
  if (!settings && !width && !height) {
    return undefined;
  }

  return {
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(positiveNumber(settings?.frameRate) ? { frameRate: settings?.frameRate } : {}),
    ...(positiveNumber(settings?.aspectRatio) ? { aspectRatio: settings?.aspectRatio } : {}),
    ...(rotationDegrees !== undefined ? { rotationDegrees } : {}),
    ...(settings?.facingMode ? { facingMode: settings.facingMode } : {}),
    ...(resizeMode ? { resizeMode } : {}),
    ...(settings?.displaySurface ? { displaySurface: settings.displaySurface } : {})
  };
}

function readRotation(settings: MediaTrackSettings | undefined): number | undefined {
  if (!settings) {
    return undefined;
  }
  const values = settings as unknown as Record<string, unknown>;
  const rotation = values.rotationDegrees ?? values.rotation;
  return typeof rotation === "number" && Number.isFinite(rotation) ? rotation : undefined;
}

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function waitForVideoFrame(video: HTMLVideoElement, timeoutMilliseconds = 1500): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", finish);
      video.removeEventListener("canplay", finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, timeoutMilliseconds);
    video.addEventListener("loadeddata", finish, { once: true });
    video.addEventListener("canplay", finish, { once: true });
  });
}

export type { RecorderError };
