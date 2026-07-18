import { expect, test } from "@playwright/test";

test("shows the session-positioned Free/Demo consultation badge", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /camera video/i }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const badge = page.getByRole("link", { name: /free demo by videowhisper/i });
  await expect(badge).toHaveAttribute("href", "https://consult.videowhisper.com");
  await expect(badge).toHaveAttribute("target", "_blank");
  await expect(badge).toHaveText(/^(Free|Demo)$/);
  await expect(badge).toHaveCSS("position", "absolute");
  const side = await badge.evaluate((element) => element.style.left || element.style.right);
  expect(side).toBe("14px");
  await expect(badge.locator("xpath=ancestor::div[contains(@class, 'vwr-preview')]")).toHaveCount(1);
});

test("reopens a closed recorder dialog and restores a live preview", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /camera video/i }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Start recording")).toBeVisible();

  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByLabel("Start recording")).toBeHidden();
  await page.getByRole("button", { name: /camera video/i }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Start recording")).toBeVisible();
});

test("shows compact device cycle buttons only after multiple inputs are available", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: async () => [
        { kind: "videoinput", deviceId: "front", label: "Front camera" },
        { kind: "videoinput", deviceId: "rear", label: "Rear camera" },
        { kind: "audioinput", deviceId: "built-in", label: "Built-in microphone" },
        { kind: "audioinput", deviceId: "usb", label: "USB microphone" }
      ]
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /camera video/i }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("button", { name: /switch camera.*front camera/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /switch microphone.*built-in microphone/i })).toBeVisible();
});

test("records a webcam clip with Chromium fake media", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /camera video/i }).click();
  await expect(page.getByText(/free limit: requests webcam video within a 640px long edge.*360 × 640 portrait.*5:00/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByLabel("Start recording")).toBeVisible();
  await page.getByLabel("Start recording").click();

  await expect(page.getByLabel("Stop recording")).toBeVisible();
  await expect(page.getByText("Preview ready", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Recording", { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByLabel("Stop recording").click();

  await expect(page.getByRole("heading", { name: /review before sending/i })).toBeVisible();
  await page.getByRole("button", { name: /^Accept$/ }).click();

  await expect(page.locator(".vwr-result-card")).toBeVisible();
});

test("opens the screen recorder without a physical screen prompt", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "fake screen capture flags are Chromium-specific");

  await page.goto("/");
  await page.getByRole("button", { name: /screen recording/i }).click();
  await expect(page.getByText(/free limit: requests up to 1280 × 720 screen video.*1:00/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.locator(".vwr-recorder, .vwr-error")).toBeVisible();
});

test("switches theme without resetting the active recorder state", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /camera video/i }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Start recording")).toBeVisible();

  await expect(page.getByLabel("Theme")).toHaveValue("auto");
  await page.getByLabel("Theme").selectOption("dark");
  await expect(page.getByText("Preview ready")).toBeVisible();
  await expect(page.getByLabel("Start recording")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeHidden();

  await page.getByLabel("Theme").selectOption("light");
  await expect(page.getByText("Preview ready")).toBeVisible();
  await expect(page.getByLabel("Start recording")).toBeVisible();
});

test("takes a photo from preview without entering recording state", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^photo/i }).click();

  await expect(page.getByText(/maximum length/i)).toHaveCount(0);
  await expect(page.getByText(/webcam photos preserve their aspect ratio within a 1280px long edge/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByLabel("Take photo")).toBeVisible();
  await expect(page.getByLabel("Stop recording")).toBeHidden();
  await expect(page.locator(".vwr-timer")).toHaveCount(0);
  await page.getByLabel("Take photo").click();

  await expect(page.getByRole("heading", { name: /review before sending/i })).toBeVisible();
  await page.getByRole("button", { name: /discard and retry/i }).click();
  await expect(page.getByLabel("Take photo")).toBeVisible();

  await page.getByLabel("Take photo").click();
  await expect(page.getByRole("heading", { name: /review before sending/i })).toBeVisible();
  await page.getByRole("button", { name: /^Accept$/ }).click();
  await expect(page.locator(".vwr-result-card")).toBeVisible();
});

test("takes a screenshot from screen preview without entering recording state", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "fake screen capture flags are Chromium-specific");

  await page.goto("/");
  await page.getByRole("button", { name: /^screenshot/i }).click();
  await expect(page.getByText(/maximum length/i)).toHaveCount(0);
  await expect(page.getByText(/screen snapshots preserve their aspect ratio within a 1280px long edge/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByLabel("Take screenshot")).toBeVisible();
  await expect(page.locator(".vwr-timer")).toHaveCount(0);
  await page.getByLabel("Take screenshot").click();
  await expect(page.getByRole("heading", { name: /review before sending/i })).toBeVisible();
});
