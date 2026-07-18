import type { RemoveInput, UploadAdapter, UploadInput, UploadResult } from "@videowhisper/recorder-types";

export class MockUploadAdapter implements UploadAdapter {
  async upload(input: UploadInput): Promise<UploadResult> {
    input.onProgress?.({
      loadedBytes: input.draft.sizeBytes,
      totalBytes: input.draft.sizeBytes,
      percent: 100,
      stage: "ready"
    });

    return {
      uploadId: `mock-${input.draft.id}`,
      serverMediaId: `mock-media-${input.draft.id}`,
      remoteUrl: input.draft.localUrl,
      playbackUrl: input.draft.localUrl,
      ...(input.draft.thumbnailUrl ? { thumbnailUrl: input.draft.thumbnailUrl } : {}),
      status: "ready"
    };
  }
}

export class SimpleMultipartUploadAdapter implements UploadAdapter {
  async upload(input: UploadInput): Promise<UploadResult> {
    const endpoint = input.config.endpoint;
    if (!endpoint) {
      throw new Error("Upload endpoint is required.");
    }

    const form = new FormData();
    form.append(input.config.fieldName, input.draft.blob, input.draft.fileName);
    form.append("metadata", JSON.stringify({
      ...input.draft.metadata,
      id: input.draft.id,
      sessionId: input.draft.sessionId,
      type: input.draft.type,
      fileName: input.draft.fileName,
      mimeType: input.draft.mimeType,
      sizeBytes: input.draft.sizeBytes,
      durationSeconds: input.draft.durationSeconds,
      width: input.draft.width,
      height: input.draft.height,
      frameRate: input.draft.frameRate,
      audioPresent: input.draft.audioPresent,
      mediaInfo: input.draft.mediaInfo,
      uploadMetadata: input.config.metadata ?? {}
    }));

    if (input.draft.thumbnailBlob) {
      form.append("thumbnail", input.draft.thumbnailBlob, `${input.draft.id}-thumbnail.jpg`);
    }

    if (input.config.csrfToken) {
      form.append("csrfToken", input.config.csrfToken);
    }

    if (input.config.ownerToken) {
      form.append("ownerToken", input.config.ownerToken);
    }

    input.onProgress?.({
      loadedBytes: 0,
      totalBytes: input.draft.sizeBytes,
      percent: 0,
      stage: "preparing"
    });

    const response = await uploadWithProgress(endpoint, form, {
      headers: input.config.headers ?? {},
      ...(input.signal ? { signal: input.signal } : {}),
      onProgress: (loadedBytes, totalBytes) => {
        input.onProgress?.({
          loadedBytes,
          totalBytes: totalBytes || input.draft.sizeBytes,
          percent: totalBytes ? Math.round((loadedBytes / totalBytes) * 100) : 0,
          stage: "uploading"
        });
      }
    });

    if (!response.ok) {
      throw new Error(response.error ?? "Upload failed.");
    }

    input.onProgress?.({
      loadedBytes: input.draft.sizeBytes,
      totalBytes: input.draft.sizeBytes,
      percent: 100,
      stage: response.status === "processing" ? "processing" : "ready"
    });

    return {
      ...(response.uploadId ? { uploadId: response.uploadId } : {}),
      ...(response.serverMediaId ? { serverMediaId: response.serverMediaId } : {}),
      ...(response.remoteUrl ? { remoteUrl: response.remoteUrl } : {}),
      ...(response.playbackUrl ? { playbackUrl: response.playbackUrl } : {}),
      ...(response.thumbnailUrl ? { thumbnailUrl: response.thumbnailUrl } : {}),
      status: response.status ?? "ready",
      ...(response.metadata ? { metadata: response.metadata } : {})
    };
  }

  async remove(input: RemoveInput): Promise<void> {
    const endpoint = input.config.deleteEndpoint;
    if (!endpoint || !input.result.serverMediaId) {
      return;
    }

    const form = new FormData();
    form.append("serverMediaId", input.result.serverMediaId);
    if (input.config.csrfToken) {
      form.append("csrfToken", input.config.csrfToken);
    }
    if (input.config.ownerToken) {
      form.append("ownerToken", input.config.ownerToken);
    }

    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      ...(input.config.headers ? { headers: input.config.headers } : {}),
      body: form,
      ...(input.signal ? { signal: input.signal } : {})
    });
    const payload = parseJson(await response.text());
    if (!response.ok) {
      throw new Error(typeof payload.message === "string" ? payload.message : "The Media Library item could not be removed.");
    }
  }
}

export class ResumableUploadAdapter implements UploadAdapter {
  async upload(): Promise<UploadResult> {
    throw new Error("Resumable tus uploads are not available in this recorder build.");
  }
}

interface UploadProgressOptions {
  headers: Record<string, string>;
  signal?: AbortSignal | undefined;
  onProgress: (loadedBytes: number, totalBytes: number) => void;
}

interface UploadResponse {
  ok: boolean;
  error?: string;
  uploadId?: string;
  serverMediaId?: string;
  remoteUrl?: string;
  playbackUrl?: string;
  thumbnailUrl?: string;
  status?: UploadResult["status"];
  metadata?: Record<string, unknown>;
}

function uploadWithProgress(endpoint: string, form: FormData, options: UploadProgressOptions): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint, true);
    for (const [header, value] of Object.entries(options.headers)) {
      xhr.setRequestHeader(header, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress(event.loaded, event.total);
      }
    };
    xhr.onload = () => {
      const json = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true, ...json });
      } else {
        resolve({ ok: false, error: typeof json.error === "string" ? json.error : `Upload failed with HTTP ${xhr.status}.` });
      }
    };
    xhr.onerror = () => reject(new Error("Network upload failed."));
    xhr.onabort = () => reject(new Error("Upload was cancelled."));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

function parseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
