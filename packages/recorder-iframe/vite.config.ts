import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  cacheDir: "/private/tmp/nosync-icloud/lms-video-suite-recorder-vite/recorder-iframe",
  build: {
    lib: {
      entry: "src/index.tsx",
      name: "VideoWhisperRecorderFrame",
      formats: ["es", "iife"],
      fileName: (format) => (format === "iife" ? "videowhisper-recorder-frame.js" : "index.js")
    },
    sourcemap: true
  }
});
