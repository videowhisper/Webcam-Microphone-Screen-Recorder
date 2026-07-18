import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs plus the runtime <base> injected in index.html let the
  // same build run at the domain root or from a demo subfolder.
  base: "./",
  cacheDir: "/private/tmp/nosync-icloud/lms-video-suite-recorder-vite/free-demo",
  server: {
    host: "127.0.0.1",
    port: 5177,
    proxy: {
      "/api": {
        target: `http://${process.env.VWR_PHP_HOST ?? "127.0.0.1"}:${process.env.VWR_PHP_PORT ?? "8080"}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api(?=\/|$)/, "") || "/"
      },
      "/media": `http://${process.env.VWR_PHP_HOST ?? "127.0.0.1"}:${process.env.VWR_PHP_PORT ?? "8080"}`,
      "/admin": `http://${process.env.VWR_PHP_HOST ?? "127.0.0.1"}:${process.env.VWR_PHP_PORT ?? "8080"}`
    }
  },
  build: {
    sourcemap: process.env.VWR_RELEASE_BUILD !== "1"
  }
});
