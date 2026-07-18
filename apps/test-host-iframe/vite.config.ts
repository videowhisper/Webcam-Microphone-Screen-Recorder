import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  cacheDir: "/private/tmp/nosync-icloud/lms-video-suite-recorder-vite/test-host-iframe"
});
