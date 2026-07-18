export function createId(prefix: string): string {
  const array = new Uint8Array(12);
  crypto.getRandomValues(array);
  return `${prefix}_${Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function formatExtension(mimeType: string): string {
  if (mimeType.includes("mp4")) {
    return "mp4";
  }
  if (mimeType.includes("webm")) {
    return "webm";
  }
  if (mimeType.includes("ogg")) {
    return "ogg";
  }
  if (mimeType.includes("jpeg")) {
    return "jpg";
  }
  if (mimeType.includes("png")) {
    return "png";
  }
  return "bin";
}

export function parseMediaCodecs(mimeType: string): {
  containerMimeType: string;
  codecs: string[];
  videoCodec?: string;
  audioCodec?: string;
} {
  const [container = mimeType, ...parameters] = mimeType.split(";");
  const codecParameter = parameters.find((parameter) => parameter.trim().toLowerCase().startsWith("codecs="));
  const codecValue = codecParameter?.split("=").slice(1).join("=").trim().replace(/^['\"]|['\"]$/g, "") ?? "";
  const codecs = codecValue ? codecValue.split(",").map((codec) => codec.trim()).filter(Boolean) : [];
  const videoCodec = codecs.find((codec) => /^(av01|avc1|avc3|h264|hev1|hvc1|vp8|vp9)/i.test(codec));
  const audioCodec = codecs.find((codec) => /^(aac|ac-3|ec-3|flac|mp4a|opus|vorbis)/i.test(codec));

  return {
    containerMimeType: container.trim().toLowerCase(),
    codecs,
    ...(videoCodec ? { videoCodec } : {}),
    ...(audioCodec ? { audioCodec } : {})
  };
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function revokeUrl(url: string | undefined): void {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

export async function readVideoMetadata(url: string): Promise<{
  durationSeconds?: number;
  width?: number;
  height?: number;
}> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const metadata: { durationSeconds?: number; width?: number; height?: number } = {};
      if (Number.isFinite(video.duration)) {
        metadata.durationSeconds = video.duration;
      }
      if (video.videoWidth) {
        metadata.width = video.videoWidth;
      }
      if (video.videoHeight) {
        metadata.height = video.videoHeight;
      }
      resolve(metadata);
    };
    video.onerror = () => resolve({});
    video.src = url;
  });
}

export async function readAudioMetadata(url: string): Promise<{ durationSeconds?: number }> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const metadata: { durationSeconds?: number } = {};
      if (Number.isFinite(audio.duration)) {
        metadata.durationSeconds = audio.duration;
      }
      resolve(metadata);
    };
    audio.onerror = () => resolve({});
    audio.src = url;
  });
}

export async function captureVideoFrame(
  source: HTMLVideoElement,
  width: number,
  height: number,
  format: "image/jpeg" | "image/webp" | "image/png",
  quality?: number
): Promise<Blob | undefined> {
  const canvas = document.createElement("canvas");
  const dimensions = fitCaptureDimensions(source.videoWidth, source.videoHeight, width, height);
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d");
  if (!context || source.videoWidth === 0 || source.videoHeight === 0) {
    return undefined;
  }

  // Ask supporting browsers for their highest-quality downscaling algorithm.
  // This improves text-heavy screen snapshots without an image-processing dependency.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, dimensions.width, dimensions.height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? undefined), format, quality);
  });
}

export function fitCaptureDimensions(sourceWidth: number, sourceHeight: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (!sourceWidth || !sourceHeight) {
    return { width: maxWidth, height: maxHeight };
  }
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  };
}
