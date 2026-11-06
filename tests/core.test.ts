import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecorderConfig } from "../packages/recorder-free/src";
import { BrowserMediaRecorder, detectCapabilities, fitCaptureDimensions, normalizeError, parseMediaCodecs, selectMimeType } from "../packages/recorder-core/src";
import { MockUploadAdapter, ResumableUploadAdapter, SimpleMultipartUploadAdapter } from "../packages/recorder-upload/src";
import type { RecorderDraft } from "../packages/recorder-types/src";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function draft(overrides: Partial<RecorderDraft> = {}): RecorderDraft {
  return {
    schemaVersion: "1",
    id: "draft",
    sessionId: "session",
    type: "video",
    blob: new Blob(["test"], { type: "video/webm" }),
    localUrl: "blob:test",
    fileName: "draft.webm",
    mimeType: "video/webm",
    sizeBytes: 4,
    audioPresent: true,
    mediaInfo: {
      schemaVersion: "1",
      containerMimeType: "video/webm",
      codecs: ["vp9", "opus"],
      videoCodec: "vp9",
      audioCodec: "opus",
      audio: { present: true }
    },
    createdAt: new Date("2026-06-18T00:00:00Z").toISOString(),
    metadata: {},
    ...overrides
  };
}

describe("recorder configuration", () => {
  it("preserves published Free ceilings against larger requests", () => {
    const config = createRecorderConfig({
      limits: {
        maxDurationSeconds: 9999,
        maxItems: 99,
        maxBytes: 999999999
      }
    });

    expect(config.limits.maxDurationSeconds).toBe(300);
    expect(config.limits.maxItems).toBe(1);
    expect(config.limits.maxBytes).toBe(100 * 1024 * 1024);
  });

  it("sets mode-specific launch labels and upload defaults", () => {
    expect(createRecorderConfig({ mode: "audio" }).ui.launchLabel).toBe("Add Audio");
    expect(createRecorderConfig({ mode: "photo" }).ui.launchLabel).toBe("Add Photo");
    expect(createRecorderConfig({ mode: "photo" }).capture.video).toMatchObject({
      width: { ideal: 1280 },
      height: { ideal: 720 }
    });
    expect(createRecorderConfig({ mode: "video" }).capture.video).toMatchObject({
      width: { ideal: 640, max: 640 },
      height: { ideal: 360, max: 640 },
      aspectRatio: { ideal: 16 / 9 }
    });
    expect(createRecorderConfig({ mode: "screenshot" }).ui.launchLabel).toBe("Add Screenshot");
    expect(createRecorderConfig({ mode: "screenshot" }).capture.audio).toBe(false);
    expect(createRecorderConfig({ mode: "screen-microphone" }).ui.launchLabel).toBe("Add Screen Recording");
    expect(createRecorderConfig().upload.fieldName).toBe("media");
    expect(createRecorderConfig().completion.mode).toBe("return-to-host");
    expect(createRecorderConfig().capture.autoStart).toBe(false);
    expect(createRecorderConfig().capture.thumbnail).toMatchObject({ width: 1280, height: 1280 });
    expect(createRecorderConfig({ capture: { autoStart: true } }).capture.autoStart).toBe(true);
  });

  it("prefers a portrait webcam constraint on a portrait viewport", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({ matches: true }))
    });

    expect(createRecorderConfig({ mode: "video" }).capture.video).toMatchObject({
      width: { ideal: 360, max: 640 },
      height: { ideal: 640, max: 640 },
      aspectRatio: { ideal: 9 / 16 }
    });
  });

  it("preserves a configured successful-upload redirect", () => {
    const config = createRecorderConfig({
      completion: { mode: "redirect", redirectUrl: "/my-video-list/" }
    });

    expect(config.completion).toMatchObject({ mode: "redirect", redirectUrl: "/my-video-list/" });
  });

  it("retains the screen ceiling without changing constraints", () => {
    const config = createRecorderConfig({
      mode: "screen",
      limits: { maxDurationSeconds: 300 }
    });

    expect(config.limits.maxDurationSeconds).toBe(60);
    expect(config.capture.screen).toMatchObject({
      video: {
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 }
      }
    });
  });

  it("retains a screen ceiling when the host omits limits", () => {
    const config = createRecorderConfig({
      mode: "screen",
      limits: {}
    });

    expect(config.limits.maxDurationSeconds).toBe(60);
  });
});

describe("Free contract regression", () => {
  it("accepts stricter host limits while retaining one item", () => {
    expect(createRecorderConfig({ limits: { maxDurationSeconds: 12, maxBytes: 2048, maxItems: 99 } }).limits).toEqual({ maxDurationSeconds: 12, maxBytes: 2048, maxItems: 1 });
    expect(createRecorderConfig({ mode: "screen-microphone", limits: { maxDurationSeconds: 20 } }).limits.maxDurationSeconds).toBe(20);
  });
  it("invalid or missing values do not remove Free ceilings", () => {
    for (const value of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(createRecorderConfig({ limits: { maxDurationSeconds: value, maxBytes: value } }).limits).toEqual({ maxDurationSeconds: 300, maxBytes: 100 * 1024 * 1024, maxItems: 1 });
      expect(createRecorderConfig({ mode: "screen", limits: { maxDurationSeconds: value } }).limits.maxDurationSeconds).toBe(60);
    }
  });
});

describe("still image sizing", () => {
  it("preserves the source aspect ratio within the configured 1280px maximum dimension", () => {
    expect(fitCaptureDimensions(1920, 1080, 1280, 1280)).toEqual({ width: 1280, height: 720 });
    expect(fitCaptureDimensions(1080, 1920, 1280, 1280)).toEqual({ width: 720, height: 1280 });
    expect(fitCaptureDimensions(1920, 1080, 640, 640)).toEqual({ width: 640, height: 360 });
    expect(fitCaptureDimensions(1080, 1920, 640, 640)).toEqual({ width: 360, height: 640 });
    expect(fitCaptureDimensions(320, 240, 640, 640)).toEqual({ width: 320, height: 240 });
  });
});

describe("error normalization", () => {
  it("maps browser permission errors", () => {
    const error = normalizeError(new DOMException("Denied", "NotAllowedError"));
    expect(error.code).toBe("permission-denied");
    expect(error.recoverable).toBe(true);
  });

  it("does not mistake native DOMException numeric code for recorder errors", () => {
    const error = normalizeError(new DOMException("Missing", "NotFoundError"));
    expect(error.code).toBe("device-unavailable");
  });
});

describe("upload limits", () => {
  it("blocks an over-limit draft before an upload begins and keeps it available for retry", async () => {
    const upload = { upload: vi.fn() };
    const recorder = new BrowserMediaRecorder(
      createRecorderConfig({
        mode: "video",
        limits: { maxBytes: 4 },
        upload: { enabled: true, endpoint: "/uploads", fieldName: "media" }
      }),
      upload
    );
    const internals = recorder as unknown as {
      currentDraft: RecorderDraft;
      state: "review";
    };

    internals.currentDraft = draft({ sizeBytes: 5 });
    internals.state = "review";

    await expect(recorder.accept()).rejects.toMatchObject({ code: "file-too-large" });
    expect(upload.upload).not.toHaveBeenCalled();
    expect(recorder.getState()).toBe("review");
    expect(recorder.getDraft()).toMatchObject({ sizeBytes: 5 });
  });
});

describe("capabilities and MIME negotiation", () => {

  it("continues webcam video without audio when microphone capture is unavailable", async () => {
    class FakeMediaRecorder {
      static isTypeSupported = vi.fn(() => true);
      pause() {}
    }
    const cameraTrack = { stop: vi.fn(), getSettings: () => ({ deviceId: "camera" }) } as unknown as MediaStreamTrack;
    const cameraOnlyStream = {
      getVideoTracks: () => [cameraTrack],
      getAudioTracks: () => [],
      getTracks: () => [cameraTrack]
    } as unknown as MediaStream;
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.audio) throw new DOMException("Microphone denied", "NotAllowedError");
      return cameraOnlyStream;
    });

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("window", { isSecureContext: true, ImageCapture: class ImageCapture {} });
    vi.stubGlobal("indexedDB", {});
    vi.stubGlobal("document", { createElement: vi.fn(() => ({ captureStream: vi.fn() })) });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia,
        getDisplayMedia: vi.fn(),
        getSupportedConstraints: vi.fn(() => ({})),
        enumerateDevices: vi.fn(async () => [])
      }
    });

    const recorder = new BrowserMediaRecorder(createRecorderConfig({ mode: "video" }));
    await recorder.open();
    await recorder.prepare();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(recorder.getPreviewAvailability()).toMatchObject({
      camera: true,
      microphone: false,
      warning: expect.stringMatching(/without audio/i)
    });
  });

  it("continues screen video when optional microphone access is unavailable", async () => {
    class FakeMediaRecorder {
      static isTypeSupported = vi.fn(() => true);
      pause() {}
    }
    const screenTrack = {
      stop: vi.fn(),
      getSettings: () => ({ displaySurface: "browser" }),
      addEventListener: vi.fn()
    } as unknown as MediaStreamTrack;
    const screenStream = {
      getVideoTracks: () => [screenTrack],
      getAudioTracks: () => [],
      getTracks: () => [screenTrack],
      addTrack: vi.fn()
    } as unknown as MediaStream;

    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("window", { isSecureContext: true, ImageCapture: class ImageCapture {} });
    vi.stubGlobal("indexedDB", {});
    vi.stubGlobal("document", { createElement: vi.fn(() => ({ captureStream: vi.fn() })) });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => { throw new DOMException("Microphone denied", "NotAllowedError"); }),
        getDisplayMedia: vi.fn(async () => screenStream),
        getSupportedConstraints: vi.fn(() => ({})),
        enumerateDevices: vi.fn(async () => [])
      }
    });

    const recorder = new BrowserMediaRecorder(createRecorderConfig({ mode: "screen-microphone" }));
    await recorder.open();
    await recorder.prepare();

    expect(recorder.getPreviewAvailability()).toMatchObject({
      screen: true,
      microphone: false,
      warning: expect.stringMatching(/without microphone audio/i)
    });
  });

  it("lists selectable cameras and microphones after permission is available", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        enumerateDevices: vi.fn(async () => [
          { kind: "videoinput", deviceId: "front", label: "Front camera" },
          { kind: "videoinput", deviceId: "rear", label: "Rear camera" },
          { kind: "audioinput", deviceId: "built-in", label: "Built-in microphone" },
          { kind: "audioinput", deviceId: "usb", label: "USB microphone" },
          { kind: "audiooutput", deviceId: "speaker", label: "Speaker" }
        ])
      }
    });

    const recorder = new BrowserMediaRecorder(createRecorderConfig({ mode: "video" }));
    await expect(recorder.getInputDevices()).resolves.toEqual([
      { kind: "videoinput", deviceId: "front", label: "Front camera" },
      { kind: "videoinput", deviceId: "rear", label: "Rear camera" },
      { kind: "audioinput", deviceId: "built-in", label: "Built-in microphone" },
      { kind: "audioinput", deviceId: "usb", label: "USB microphone" }
    ]);
  });

  it("selects the first supported MIME for the requested media type", () => {
    class FakeMediaRecorder {
      static isTypeSupported = vi.fn((mime: string) => mime === "video/webm" || mime === "audio/webm");
      pause() {}
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    expect(selectMimeType(["video/mp4", "video/webm"], "video")).toBe("video/webm");
    expect(selectMimeType(["audio/mp4", "audio/webm"], "audio")).toBe("audio/webm");
  });

  it("exposes container and audio/video codec details", () => {
    expect(parseMediaCodecs("video/mp4;codecs=avc1.42E01E,mp4a.40.2")).toEqual({
      containerMimeType: "video/mp4",
      codecs: ["avc1.42E01E", "mp4a.40.2"],
      videoCodec: "avc1.42E01E",
      audioCodec: "mp4a.40.2"
    });
    expect(parseMediaCodecs("image/jpeg")).toEqual({
      containerMimeType: "image/jpeg",
      codecs: []
    });
  });

  it("reports browser capabilities from mocked APIs", async () => {
    class FakeMediaRecorder {
      static isTypeSupported = vi.fn((mime: string) => mime === "video/webm" || mime === "audio/webm");
      pause() {}
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("window", { isSecureContext: true, ImageCapture: class ImageCapture {} });
    vi.stubGlobal("indexedDB", {});
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ captureStream: vi.fn() }))
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(),
        getDisplayMedia: vi.fn(),
        getSupportedConstraints: vi.fn(() => ({ width: true, height: true })),
        enumerateDevices: vi.fn(async () => [
          { kind: "videoinput", label: "Fake camera" },
          { kind: "audioinput", label: "Fake microphone" }
        ])
      }
    });

    const capabilities = await detectCapabilities();
    expect(capabilities.secureContext).toBe(true);
    expect(capabilities.getUserMedia).toBe(true);
    expect(capabilities.getDisplayMedia).toBe(true);
    expect(capabilities.mediaRecorder).toBe(true);
    expect(capabilities.canvasCapture).toBe(true);
    expect(capabilities.devices.cameras).toBe(1);
    expect(capabilities.devices.microphones).toBe(1);
    expect(capabilities.supportedMimeTypes).toContain("video/webm");
  });
});

describe("mock upload adapter", () => {
  it("returns a ready result", async () => {
    const progress = vi.fn();
    const result = await new MockUploadAdapter().upload({
      config: {
        enabled: true,
        fieldName: "media"
      },
      draft: draft(),
      onProgress: progress
    });

    expect(result.status).toBe("ready");
    expect(progress).toHaveBeenCalled();
  });
});

describe("multipart upload adapter", () => {
  it("posts media, metadata, CSRF, owner token, headers, and progress", async () => {
    const progress = vi.fn();
    const sent: Array<{ url: string; body: FormData; headers: Record<string, string> }> = [];

    class FakeXMLHttpRequest {
      static latest: FakeXMLHttpRequest;
      upload = { onprogress: undefined as ((event: ProgressEvent) => void) | undefined };
      status = 200;
      responseText = JSON.stringify({
        uploadId: "upload-1",
        serverMediaId: "media-1",
        playbackUrl: "/media?id=media-1",
        thumbnailUrl: "/media?id=media-1&kind=thumbnail",
        status: "ready"
      });
      onload: (() => void) | undefined;
      onerror: (() => void) | undefined;
      onabort: (() => void) | undefined;
      private url = "";
      private headers: Record<string, string> = {};

      constructor() {
        FakeXMLHttpRequest.latest = this;
      }

      open(_method: string, url: string) {
        this.url = url;
      }

      setRequestHeader(header: string, value: string) {
        this.headers[header] = value;
      }

      send(body: FormData) {
        sent.push({ url: this.url, body, headers: this.headers });
        this.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 } as ProgressEvent);
        this.onload?.();
      }

      abort() {
        this.onabort?.();
      }
    }

    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);

    const result = await new SimpleMultipartUploadAdapter().upload({
      config: {
        enabled: true,
        endpoint: "/api/uploads",
        fieldName: "media",
        csrfToken: "csrf",
        ownerToken: "owner",
        headers: {
          "X-Test": "yes"
        },
        metadata: {
          integration: "php-demo"
        }
      },
      draft: draft({
        thumbnailBlob: new Blob(["thumb"], { type: "image/jpeg" }),
        durationSeconds: 1.5,
        width: 640,
        height: 360,
        frameRate: 24,
        metadata: {
          context: "assignment"
        }
      }),
      onProgress: progress
    });

    expect(result.status).toBe("ready");
    expect(result.serverMediaId).toBe("media-1");
    expect(sent[0]?.url).toBe("/api/uploads");
    expect(sent[0]?.headers["X-Test"]).toBe("yes");
    expect(sent[0]?.body.get("csrfToken")).toBe("csrf");
    expect(sent[0]?.body.get("ownerToken")).toBe("owner");
    const metadata = JSON.parse(String(sent[0]?.body.get("metadata")));
    expect(metadata.context).toBe("assignment");
    expect(metadata.uploadMetadata.integration).toBe("php-demo");
    expect(metadata.frameRate).toBe(24);
    expect(metadata.mediaInfo.videoCodec).toBe("vp9");
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: "preparing", percent: 0 }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: "uploading", percent: 50 }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: "ready", percent: 100 }));
  });

  it("throws when the endpoint is missing or the server rejects upload", async () => {
    await expect(
      new SimpleMultipartUploadAdapter().upload({
        config: {
          enabled: true,
          fieldName: "media"
        },
        draft: draft()
      })
    ).rejects.toThrow("Upload endpoint is required");

    class RejectingXMLHttpRequest {
      upload = {};
      status = 413;
      responseText = JSON.stringify({ error: "Uploaded file is too large." });
      onload: (() => void) | undefined;
      open() {}
      setRequestHeader() {}
      send() {
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", RejectingXMLHttpRequest);

    await expect(
      new SimpleMultipartUploadAdapter().upload({
        config: {
          enabled: true,
          endpoint: "/api/uploads",
          fieldName: "media"
        },
        draft: draft()
      })
    ).rejects.toThrow("Uploaded file is too large.");
  });
});

describe("upload boundary", () => {
  it("keeps resumable tus uploads out of this recorder package", async () => {
    await expect(new ResumableUploadAdapter().upload()).rejects.toThrow("not available in this recorder build");
  });
});
