import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5177",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    permissions: ["camera", "microphone"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--enable-usermedia-screen-capturing",
        "--auto-select-desktop-capture-source=Entire screen",
        "--allow-http-screen-capture"
      ]
    }
  },
  webServer: [
    {
      command: "npm run dev --workspace @videowhisper/recorder-free-demo",
      url: "http://127.0.0.1:5177",
      reuseExistingServer: true,
      timeout: 30_000
    }
  ],
  projects: [
    {
      name: "chromium-fake-media",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
