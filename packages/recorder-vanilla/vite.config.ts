import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The WordPress plugins load the IIFE directly in a browser, where Node's
  // `process` global does not exist. Ensure React's production branch is
  // selected and its process.env checks are compiled away.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  cacheDir: "/private/tmp/nosync-icloud/lms-video-suite-recorder-vite/recorder-vanilla",
  build: {
    lib: {
      entry: "src/index.tsx",
      name: "VideoWhisperRecorder",
      formats: ["es", "iife"],
      fileName: (format) => (format === "iife" ? "videowhisper-recorder.browser.js" : "index.js")
    },
    rollupOptions: {
      output: {
        assetFileNames: "videowhisper-recorder.[ext]"
      }
    },
    sourcemap: true
  }
});
