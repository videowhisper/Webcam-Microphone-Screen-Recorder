import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MediaResult,
  RecorderConfig,
  RecorderDraft,
  RecorderError,
  RecorderPreviewAvailability,
  RecorderStateName,
  UploadAdapter,
  UploadProgress
} from "@videowhisper/recorder-types";
import { BrowserMediaRecorder, normalizeError } from "@videowhisper/recorder-core";
import { MockUploadAdapter, SimpleMultipartUploadAdapter } from "@videowhisper/recorder-upload";
import { modeLabels } from "@videowhisper/recorder-ui";

export interface VideoWhisperRecorderProps {
  config: RecorderConfig;
  uploadAdapter?: UploadAdapter;
}

export function VideoWhisperRecorder({ config, uploadAdapter }: VideoWhisperRecorderProps) {
  const adapter = useMemo(() => {
    if (uploadAdapter) {
      return uploadAdapter;
    }
    if (config.upload.enabled && config.upload.endpoint) {
      return new SimpleMultipartUploadAdapter();
    }
    return new MockUploadAdapter();
  }, [config.upload.enabled, config.upload.endpoint, uploadAdapter]);

  const recorder = useMemo(() => new BrowserMediaRecorder(config, adapter), [adapter, config]);
  const [state, setState] = useState<RecorderStateName>("closed");
  const [draft, setDraft] = useState<RecorderDraft | undefined>();
  const [results, setResults] = useState<MediaResult[]>([]);
  const [error, setError] = useState<RecorderError | undefined>();
  const [progress, setProgress] = useState<UploadProgress | undefined>();
  const [isSurfaceOpen, setIsSurfaceOpen] = useState(config.renderMode === "inline" || config.renderMode === "container" || config.renderMode === "page");
  const [surfaceRevision, setSurfaceRevision] = useState(0);
  const [startedAt, setStartedAt] = useState<number | undefined>();
  const freeDemoBadge = useMemo(createFreeDemoBadge, []);

  useEffect(() => {
    const offState = recorder.on("statechange", (payload) => {
      const next = payload as RecorderStateName;
      setState(next);
      if (next === "recording") {
        setStartedAt(Date.now());
      }
      if (next === "idle" || next === "preview" || next === "review" || next === "closed" || next === "error") {
        setStartedAt(undefined);
      }
      if (next !== "error") {
        setError(undefined);
      }
    });
    const offReview = recorder.on("review", (payload) => setDraft(payload as RecorderDraft));
    const offSaved = recorder.on("saved", () => {
      setResults(recorder.getResults());
      setDraft(undefined);
      setProgress(undefined);
      syncHiddenInput(config, recorder.getResults());
    });
    const offRemoved = recorder.on("removed", () => {
      setResults(recorder.getResults());
      syncHiddenInput(config, recorder.getResults());
    });
    const offError = recorder.on("error", (payload) => setError(payload as RecorderError));
    const offProgress = recorder.on("uploadprogress", (payload) => setProgress(payload as UploadProgress));
    void recorder.open();

    return () => {
      offState();
      offReview();
      offSaved();
      offRemoved();
      offError();
      offProgress();
      void recorder.destroy();
    };
  }, [config, recorder]);

  async function openSurface() {
    setError(undefined);
    setDraft(undefined);
    setProgress(undefined);
    setIsSurfaceOpen(true);
    setSurfaceRevision((revision) => revision + 1);
    // The preview video element belongs to the modal. Wait until React has
    // remounted it before preparing a new camera/screen stream.
    await nextPaint();
    await recorder.open();
    if (config.ui.skipPreparation) {
      await prepareCapture();
    }
  }

  async function closeSurface() {
    if (state === "recording" || state === "paused" || state === "uploading") {
      const confirmed = window.confirm("A recording or upload is active. Close it?");
      if (!confirmed) {
        return;
      }
    }
    await recorder.close();
    setIsSurfaceOpen(config.renderMode === "inline" || config.renderMode === "container" || config.renderMode === "page");
  }

  function runAction(action: () => Promise<unknown>): void {
    void action().catch((actionError) => setError(normalizeError(actionError)));
  }

  async function prepareCapture() {
    setError(undefined);
    setDraft(undefined);
    setProgress(undefined);
    await recorder.prepare();
    if (config.capture.autoStart) {
      await recorder.start();
    }
  }

  async function startCapture() {
    setError(undefined);
    await recorder.start();
  }

  async function cycleCamera() {
    setError(undefined);
    try {
      return await recorder.cycleVideoInput();
    } catch (cycleError) {
      setError(normalizeError(cycleError));
      throw cycleError;
    }
  }

  async function cycleMicrophone() {
    setError(undefined);
    try {
      return await recorder.cycleAudioInput();
    } catch (cycleError) {
      setError(normalizeError(cycleError));
      throw cycleError;
    }
  }

  async function stopCapture() {
    if (state !== "recording" && state !== "paused") {
      return;
    }
    await recorder.stop();
  }

  async function acceptDraft() {
    const result = await recorder.accept();
    if (config.completion.mode === "close-and-return") {
      await closeSurface();
    }
    if (config.completion.mode === "redirect" && config.completion.redirectUrl) {
      window.location.assign(config.completion.redirectUrl);
    }
    if (config.completion.mode === "submit-and-redirect") {
      submitCompletionForm(config);
    }
    return result;
  }

  async function discardAndRetry() {
    setError(undefined);
    setDraft(undefined);
    setProgress(undefined);
    await recorder.discard();
    await recorder.prepare();
  }

  async function removeResult(id: string) {
    try {
      await recorder.removeResult(id);
    } catch (removeError) {
      setError(normalizeError(removeError, "The recording could not be removed."));
      setIsSurfaceOpen(true);
    }
  }

  const launcher = (
    <Launcher
      config={config}
      results={results}
      onOpen={() => void openSurface()}
      onRemove={(id) => void removeResult(id)}
    />
  );

  const surface = (
    <RecorderSurface
      config={config}
      recorder={recorder}
      state={state}
      draft={draft}
      error={error}
      progress={progress}
      startedAt={startedAt}
      onPrepare={() => runAction(prepareCapture)}
      onStart={() => runAction(startCapture)}
      onStop={() => runAction(stopCapture)}
      onPause={() => runAction(() => recorder.pause())}
      onResume={() => runAction(() => recorder.resume())}
      onCycleCamera={cycleCamera}
      onCycleMicrophone={cycleMicrophone}
      onDiscard={() => runAction(() => recorder.discard())}
      onDiscardAndRetry={() => runAction(discardAndRetry)}
      onAccept={() => runAction(acceptDraft)}
      onClose={() => runAction(closeSurface)}
      freeDemoBadge={freeDemoBadge}
    />
  );

  if (config.renderMode === "button") {
    return (
      <div className="vwr" data-theme={config.ui.theme}>
        {launcher}
        {isSurfaceOpen ? <div className="vwr-modal-backdrop" key={surfaceRevision}>{surface}</div> : null}
      </div>
    );
  }

  if (config.renderMode === "modal") {
    return (
      <div className="vwr" data-theme={config.ui.theme}>
        {launcher}
        {isSurfaceOpen ? <div className="vwr-modal-backdrop" key={surfaceRevision}>{surface}</div> : null}
      </div>
    );
  }

  return (
    <div className="vwr" data-theme={config.ui.theme}>
      {surface}
      {results.length ? (
        <div className="vwr-body">
          <ResultList results={results} onRemove={(id) => void removeResult(id)} />
        </div>
      ) : null}
    </div>
  );
}

interface FreeDemoBadgeData {
  className: string;
  id: string;
  label: "Free" | "Demo";
  side: "left" | "right";
}

function FreeDemoBadge({ badge }: { badge: FreeDemoBadgeData }) {
  return (
    <a
      id={badge.id}
      className={badge.className}
      href="https://consult.videowhisper.com"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Free demo by VideoWhisper. Open consultation site in a new tab."
      style={{
        position: "absolute",
        bottom: "12px",
        [badge.side]: "14px",
        zIndex: 2147483647,
        display: "inline-flex",
        alignItems: "center",
        minHeight: "30px",
        padding: "6px 10px",
        border: "1px solid rgba(255,255,255,.55)",
        borderRadius: "999px",
        background: "rgba(28,27,25,.92)",
        boxShadow: "0 3px 14px rgba(0,0,0,.3)",
        color: "#fff",
        fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
        fontSize: "12px",
        fontWeight: 700,
        letterSpacing: ".02em",
        lineHeight: 1,
        textDecoration: "none"
      }}
    >
      {badge.label}
    </a>
  );
}

function createFreeDemoBadge(): FreeDemoBadgeData {
  const storageKey = "vwr-free-demo-badge-v2";
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null") as Partial<Pick<FreeDemoBadgeData, "label" | "side">> | null;
    if ((stored?.side === "left" || stored?.side === "right") && (stored.label === "Free" || stored.label === "Demo")) {
      return { className: randomBadgeName(), id: randomBadgeName(), side: stored.side, label: stored.label };
    }
    const side = Math.random() < 0.5 ? "left" : "right";
    const label = Math.random() < 0.5 ? "Free" : "Demo";
    window.sessionStorage.setItem(storageKey, JSON.stringify({ side, label }));
    return { className: randomBadgeName(), id: randomBadgeName(), side, label };
  } catch {
    return { className: randomBadgeName(), id: randomBadgeName(), side: Math.random() < 0.5 ? "left" : "right", label: Math.random() < 0.5 ? "Free" : "Demo" };
  }
}

function randomBadgeName(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `vw${random.slice(0, 18)}`;
}

function Launcher({
  config,
  results,
  onOpen,
  onRemove
}: {
  config: RecorderConfig;
  results: MediaResult[];
  onOpen: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="vwr-launcher">
      <button className="vwr-launch-button" type="button" onClick={onOpen}>
        <span aria-hidden="true">+</span>
        {config.ui.launchLabel}
      </button>
      <ResultList results={results} onRemove={onRemove} />
    </div>
  );
}

function RecorderSurface({
  config,
  recorder,
  state,
  draft,
  error,
  progress,
  startedAt,
  onPrepare,
  onStart,
  onStop,
  onPause,
  onResume,
  onCycleCamera,
  onCycleMicrophone,
  onDiscard,
  onDiscardAndRetry,
  onAccept,
  onClose,
  freeDemoBadge
}: {
  config: RecorderConfig;
  recorder: BrowserMediaRecorder;
  state: RecorderStateName;
  draft: RecorderDraft | undefined;
  error: RecorderError | undefined;
  progress: UploadProgress | undefined;
  startedAt: number | undefined;
  onPrepare: () => void;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onCycleCamera: () => Promise<MediaDeviceInfo | undefined>;
  onCycleMicrophone: () => Promise<MediaDeviceInfo | undefined>;
  onDiscard: () => void;
  onDiscardAndRetry: () => void;
  onAccept: () => void;
  onClose: () => void;
  freeDemoBadge: FreeDemoBadgeData;
}) {
  const isPage = config.renderMode === "page";
  const isPreparing = state === "idle" || state === "closed" || state === "error";

  return (
    <section className={`vwr-shell ${isPage ? "vwr-page" : ""}`} aria-live="polite">
      <header className="vwr-header">
        <div className="vwr-brand">
          <span className="vwr-mark" aria-hidden="true" />
          <span className="vwr-title">VideoWhisper Recorder</span>
        </div>
        <button className="vwr-button vwr-button-secondary" type="button" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="vwr-body">
        {error ? <ErrorView error={error} onRetry={onPrepare} /> : null}
        {isPreparing && !draft ? <PermissionPrep config={config} onPrepare={onPrepare} /> : null}
        {state === "requesting-permission" || state === "preparing-permission" ? (
          <div className="vwr-prep">
            <h2>Waiting for browser permission</h2>
            <p>Your browser will ask for access. Recording has not started.</p>
          </div>
        ) : null}
        {state === "recording" || state === "paused" || state === "preview" || state === "countdown" || state === "stopping" || state === "preparing-review" ? (
          <CaptureView
            config={config}
            recorder={recorder}
            state={state}
            startedAt={startedAt}
            onRecord={onStart}
            onStop={onStop}
            onPause={onPause}
            onResume={onResume}
            onCycleCamera={onCycleCamera}
            onCycleMicrophone={onCycleMicrophone}
            onCancel={onDiscard}
            freeDemoBadge={freeDemoBadge}
          />
        ) : null}
        {draft && state === "review" ? (
          <ReviewView config={config} draft={draft} onDiscard={onDiscardAndRetry} onAccept={onAccept} />
        ) : null}
        {state === "uploading" || state === "processing" || state === "accepting" ? <UploadView progress={progress} /> : null}
      </div>
    </section>
  );
}

function PermissionPrep({ config, onPrepare }: { config: RecorderConfig; onPrepare: () => void }) {
  const label = modeLabels[config.mode];
  return (
    <div className="vwr-prep">
      <span className="vwr-status">
        <span className="vwr-status-dot" />
        Ready
      </span>
      <h2>{label}</h2>
      <p>{config.ui.consentText ?? "Continue opens a live preview. Recording starts only after you press record, and nothing uploads until you accept the result."}</p>
      <p className="vwr-copy">{captureDescription(config)}</p>
      <div className="vwr-actions">
        <button className="vwr-button vwr-button-primary" type="button" onClick={onPrepare}>
          Continue
        </button>
      </div>
    </div>
  );
}

function captureDescription(config: RecorderConfig): string {
  switch (config.mode) {
    case "video":
      return `Free limit: requests webcam video within a 640px long edge (typically 640 × 360 landscape or 360 × 640 portrait) at up to 30 fps for a maximum of ${formatDuration(config.limits.maxDurationSeconds)}. Your browser may adjust the final quality.`;
    case "screen":
    case "screen-microphone":
      return `Free limit: requests up to 1280 × 720 screen video, with a maximum of ${formatDuration(config.limits.maxDurationSeconds)}. Your browser may retain the selected display's native resolution.`;
    case "photo":
      return "Free limit: webcam photos preserve their aspect ratio within a 1280px long edge. Your browser or camera may adjust the final quality.";
    case "screenshot":
      return "Free limit: screen snapshots preserve their aspect ratio within a 1280px long edge. Your browser may retain the selected display's native resolution.";
    case "audio":
      return `Free limit: microphone recordings have a maximum length of ${formatDuration(config.limits.maxDurationSeconds)}.`;
    default:
      return "Requested quality may be adjusted by your browser.";
  }
}

function CaptureView({
  config,
  recorder,
  state,
  startedAt,
  onRecord,
  onStop,
  onPause,
  onResume,
  onCycleCamera,
  onCycleMicrophone,
  onCancel,
  freeDemoBadge
}: {
  config: RecorderConfig;
  recorder: BrowserMediaRecorder;
  state: RecorderStateName;
  startedAt: number | undefined;
  onRecord: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onCycleCamera: () => Promise<MediaDeviceInfo | undefined>;
  onCycleMicrophone: () => Promise<MediaDeviceInfo | undefined>;
  onCancel: () => void;
  freeDemoBadge: FreeDemoBadgeData;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const elapsed = useElapsedSeconds(startedAt, state === "recording" || state === "paused");
  const isPreview = state === "preview";
  const isStill = config.mode === "photo" || config.mode === "screenshot";
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeInputIds, setActiveInputIds] = useState<{ video?: string; audio?: string }>({});
  const [switchingInput, setSwitchingInput] = useState<"video" | "audio" | undefined>();
  const [availability, setAvailability] = useState<RecorderPreviewAvailability>({});
  const statusLabel =
    state === "paused" ? "Paused" :
    state === "preview" ? "Preview ready" :
    state === "countdown" ? "Starting" :
    state === "preparing-review" || state === "stopping" ? "Saving" :
    "Recording";

  useEffect(() => {
    recorder.setPreviewVideo(videoRef.current ?? undefined);
  }, [recorder, state]);

  async function refreshInputDevices() {
    const devices = await recorder.getInputDevices();
    const stream = recorder.getPreviewStream();
    const videoId = stream?.getVideoTracks()[0]?.getSettings().deviceId;
    const audioId = stream?.getAudioTracks()[0]?.getSettings().deviceId;
    setInputDevices(devices);
    setAvailability(recorder.getPreviewAvailability());
    setActiveInputIds((current) => {
      const next = { ...current };
      if (videoId) next.video = videoId;
      if (audioId) next.audio = audioId;
      return next;
    });
  }

  useEffect(() => {
    if (!isPreview) {
      setInputDevices([]);
      return;
    }
    let cancelled = false;
    void refreshInputDevices().catch(() => {
      if (!cancelled) setInputDevices([]);
    });
    return () => { cancelled = true; };
  }, [isPreview, recorder]);

  async function cycleInput(kind: "video" | "audio") {
    setSwitchingInput(kind);
    try {
      const selected = kind === "video" ? await onCycleCamera() : await onCycleMicrophone();
      if (selected) {
        setActiveInputIds((current) => kind === "video"
          ? { ...current, video: selected.deviceId }
          : { ...current, audio: selected.deviceId });
      }
      await refreshInputDevices();
    } catch {
      // The parent stores a normalized error for the recorder surface.
    } finally {
      setSwitchingInput(undefined);
    }
  }

  const videoInputs = inputDevices.filter((device) => device.kind === "videoinput");
  const audioInputs = inputDevices.filter((device) => device.kind === "audioinput");
  const activeVideo = videoInputs.find((device) => device.deviceId === activeInputIds.video) ?? videoInputs[0];
  const activeAudio = audioInputs.find((device) => device.deviceId === activeInputIds.audio) ?? audioInputs[0];
  const showCameraSwitch = isPreview && (config.mode === "video" || config.mode === "photo") && videoInputs.length > 1;
  const showMicrophoneSwitch = isPreview && (config.mode === "video" || config.mode === "audio") && audioInputs.length > 1;

  return (
    <div className="vwr-recorder">
      <div className="vwr-recorder-top">
        <span className={`vwr-recording-chip ${isPreview ? "is-preview" : ""}`}>
          <span className="vwr-status-dot" />
          {statusLabel}
        </span>
        {!isStill ? (
          <span className="vwr-timer">
            {formatDuration(elapsed)}
          </span>
        ) : null}
        <CaptureAvailability config={config} availability={availability} />
      </div>
      {availability.warning ? <p className="vwr-capture-warning" role="status">{availability.warning}</p> : null}
      <div className="vwr-preview">
        <FreeDemoBadge badge={freeDemoBadge} />
        {config.mode === "audio" ? (
          <div className="vwr-audio-panel">
            <div className="vwr-audio-bars" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="vwr-preview-empty">{isPreview ? "Microphone preview ready" : "Microphone recording"}</div>
          </div>
        ) : (
          <video ref={videoRef} autoPlay muted playsInline />
        )}
      </div>
      <div className="vwr-controls">
        {isPreview ? (
          <>
            <button
              className="vwr-record-button"
              type="button"
              aria-label={config.mode === "photo" ? "Take photo" : config.mode === "screenshot" ? "Take screenshot" : "Start recording"}
              onClick={onRecord}
            />
            {showCameraSwitch ? (
              <DeviceCycleButton
                kind="camera"
                label={activeVideo?.label || "Camera"}
                disabled={switchingInput === "video"}
                onClick={() => void cycleInput("video")}
              />
            ) : null}
            {showMicrophoneSwitch ? (
              <DeviceCycleButton
                kind="microphone"
                label={activeAudio?.label || "Microphone"}
                disabled={switchingInput === "audio"}
                onClick={() => void cycleInput("audio")}
              />
            ) : null}
            <button className="vwr-button vwr-button-secondary" type="button" onClick={onCancel}>
              Cancel
            </button>
          </>
        ) : state === "recording" ? (
          <button className="vwr-button vwr-button-secondary" type="button" onClick={onPause}>
            Pause
          </button>
        ) : state === "paused" ? (
          <button className="vwr-button vwr-button-secondary" type="button" onClick={onResume}>
            Resume
          </button>
        ) : null}
        {state === "recording" || state === "paused" || state === "stopping" || state === "preparing-review" ? (
          <button className="vwr-record-button is-stop" type="button" aria-label="Stop recording" onClick={onStop} disabled={state === "stopping" || state === "preparing-review"} />
        ) : null}
      </div>
    </div>
  );
}

function CaptureAvailability({ config, availability }: { config: RecorderConfig; availability: RecorderPreviewAvailability }) {
  const requested = config.mode === "video"
    ? [{ name: "Camera", icon: "◉", available: availability.camera }, { name: "Microphone", icon: "♪", available: availability.microphone }]
    : config.mode === "audio"
      ? [{ name: "Microphone", icon: "♪", available: availability.microphone }]
      : config.mode === "photo"
        ? [{ name: "Camera", icon: "◉", available: availability.camera }]
        : config.mode === "screen-microphone"
          ? [{ name: "Screen", icon: "▣", available: availability.screen }, { name: "Microphone", icon: "♪", available: availability.microphone }]
          : [{ name: "Screen", icon: "▣", available: availability.screen }];

  return (
    <span className="vwr-capture-availability" aria-label="Capture input availability">
      {requested.map((input) => (
        <span
          className={`vwr-capture-input ${input.available ? "" : "is-unavailable"}`}
          key={input.name}
          title={`${input.name}: ${input.available ? "available" : "unavailable"}`}
          aria-label={`${input.name}: ${input.available ? "available" : "unavailable"}`}
        >
          <span aria-hidden="true">{input.icon}</span>
          {!input.available ? <span className="vwr-capture-input-cut" aria-hidden="true">╱</span> : null}
        </span>
      ))}
    </span>
  );
}

function DeviceCycleButton({
  kind,
  label,
  disabled,
  onClick
}: {
  kind: "camera" | "microphone";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const deviceName = kind === "camera" ? "camera" : "microphone";
  return (
    <button
      className="vwr-device-cycle-button"
      type="button"
      aria-label={`Switch ${deviceName}. Current: ${label}`}
      title={`Switch ${deviceName}. Current: ${label}`}
      disabled={disabled}
      onClick={onClick}
    >
      {kind === "camera" ? <CameraSwitchIcon /> : <MicrophoneSwitchIcon />}
    </button>
  );
}

function CameraSwitchIcon() {
  return (
    <svg className="vwr-device-cycle-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7.5h3l1.35-2h7.3l1.35 2h3A1.5 1.5 0 0 1 21.5 9v8A1.5 1.5 0 0 1 20 18.5H4A1.5 1.5 0 0 1 2.5 17V9A1.5 1.5 0 0 1 4 7.5Z" />
      <circle cx="12" cy="13" r="3.25" />
    </svg>
  );
}

function MicrophoneSwitchIcon() {
  return (
    <svg className="vwr-device-cycle-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="3" width="8" height="12" rx="4" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" />
    </svg>
  );
}

function ReviewView({
  config,
  draft,
  onDiscard,
  onAccept
}: {
  config: RecorderConfig;
  draft: RecorderDraft;
  onDiscard: () => void;
  onAccept: () => void;
}) {
  return (
    <div className="vwr-review">
      <h2>Review before sending</h2>
      <div className="vwr-review-media">
        {draft.type === "audio" ? (
          <audio controls src={draft.localUrl} />
        ) : draft.type === "photo" || draft.type === "screenshot" ? (
          <img src={draft.localUrl} alt="Captured preview" />
        ) : (
          <video controls src={draft.localUrl} />
        )}
      </div>
      <Metadata draft={draft} />
      <div className="vwr-actions">
        <button className="vwr-button vwr-button-primary" type="button" onClick={onAccept}>
          {config.upload.enabled ? "Accept and send" : "Accept"}
        </button>
        {config.ui.showLocalSave ? (
          <a className="vwr-button vwr-button-secondary" href={draft.localUrl} download={draft.fileName}>
            Save locally
          </a>
        ) : null}
        <button className="vwr-button vwr-button-danger" type="button" onClick={onDiscard}>
          Discard and retry
        </button>
      </div>
    </div>
  );
}

function Metadata({ draft }: { draft: RecorderDraft }) {
  return (
    <div className="vwr-meta">
      <Meta label="Type" value={draft.type} />
      <Meta label="Duration" value={draft.durationSeconds ? formatDuration(draft.durationSeconds) : "Still image"} />
      <Meta label="Size" value={formatBytes(draft.sizeBytes)} />
      <Meta label="Format" value={draft.mimeType || "Unknown"} />
      <Meta label="Resolution" value={draft.width && draft.height ? `${draft.width} x ${draft.height}` : "n/a"} />
      <Meta label="Audio" value={draft.audioPresent ? "Present" : "None"} />
      <Meta label="Status" value="Local review" />
      <Meta label="Created" value={new Date(draft.createdAt).toLocaleString()} />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="vwr-meta-item">
      <span className="vwr-meta-label">{label}</span>
      <span className="vwr-meta-value">{value}</span>
    </div>
  );
}

function UploadView({ progress }: { progress: UploadProgress | undefined }) {
  const percent = progress?.percent ?? 0;
  return (
    <div className="vwr-prep">
      <h2>{progress?.stage === "processing" ? "Processing" : "Uploading"}</h2>
      <p>Keep this window open until the recording is ready.</p>
      <div className="vwr-progress" aria-label={`Upload progress ${percent}%`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="vwr-copy">{percent}%</p>
    </div>
  );
}

function ErrorView({ error, onRetry }: { error: RecorderError; onRetry: () => void }) {
  return (
    <div className="vwr-error">
      <strong>{error.message}</strong>
      {error.code === "permission-denied" ? (
        <p className="vwr-copy">Allow the requested camera, microphone, or screen permission in your browser, then try again. Webcam video can continue without audio when camera access is available.</p>
      ) : null}
      {error.code === "device-unavailable" ? (
        <p className="vwr-copy">Check that the requested camera or microphone is connected and not in use by another application, then try again.</p>
      ) : null}
      <div className="vwr-actions" style={{ marginTop: 10 }}>
        {error.recoverable ? (
          <button className="vwr-button vwr-button-secondary" type="button" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ResultList({ results, onRemove }: { results: MediaResult[]; onRemove: (id: string) => void }) {
  if (!results.length) {
    return null;
  }

  return (
    <div className="vwr-result-list">
      {results.map((result) => (
        <div className="vwr-result-card" key={result.id}>
          <div className="vwr-thumb">
            {result.thumbnailUrl ? <img src={result.thumbnailUrl} alt="" /> : result.type}
          </div>
          <div>
            <strong>{result.fileName}</strong>
            <p className="vwr-copy">
              {result.type} · {result.durationSeconds ? formatDuration(result.durationSeconds) : "still image"} · {result.status}
            </p>
            {mediaLibraryUrl(result) ? (
              <p className="vwr-copy" role="status">
                Added to the WordPress Media Library.
              </p>
            ) : null}
          </div>
          <div className="vwr-actions">
            {result.playbackUrl || result.localUrl ? (
              <a className="vwr-button vwr-button-secondary" href={result.playbackUrl ?? result.localUrl} target="_blank" rel="noreferrer">
                Preview
              </a>
            ) : null}
            {mediaLibraryUrl(result) ? (
              <a className="vwr-button vwr-button-secondary" href={mediaLibraryUrl(result) ?? undefined}>
                Open in Media Library
              </a>
            ) : null}
            <button className="vwr-button vwr-button-danger" type="button" onClick={() => onRemove(result.id)}>
              Remove from Media Library
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function mediaLibraryUrl(result: MediaResult): string | undefined {
  const value = result.metadata.mediaLibraryUrl;
  return typeof value === "string" && value ? value : undefined;
}

function useElapsedSeconds(startedAt: number | undefined, active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [active]);

  return startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60).toString();
  const secs = (safe % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function syncHiddenInput(config: RecorderConfig, results: MediaResult[]): void {
  const name = config.completion.hiddenInputName;
  if (!name || !config.target) {
    return;
  }
  const target = typeof config.target === "string" ? document.querySelector(config.target) : config.target;
  const root = target?.closest("form") ?? document;
  let input = root.querySelector<HTMLInputElement>(`input[type="hidden"][name="${CSS.escape(name)}"]`);
  if (!input) {
    input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    target?.appendChild(input);
  }
  input.value = JSON.stringify(results);
}

function submitCompletionForm(config: RecorderConfig): void {
  const form = typeof config.completion.form === "string"
    ? document.querySelector<HTMLFormElement>(config.completion.form)
    : config.completion.form;
  if (form) {
    form.submit();
  } else if (config.completion.redirectUrl) {
    window.location.assign(config.completion.redirectUrl);
  }
}
