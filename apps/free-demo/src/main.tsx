import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RecorderMode } from "@videowhisper/recorder-types";
import { createFreeRecorderConfig } from "@videowhisper/recorder-free";
import { VideoWhisperRecorder } from "@videowhisper/recorder-react";
import "@videowhisper/recorder-ui/styles.css";
import "./styles.css";

type DemoTheme = "light" | "dark" | "auto";

declare global {
  interface Window {
    VW_RECORDER_DEMO_BASE_PATH?: string;
    VW_RECORDER_DEMO_CONFIG?: {
      apiBasePath?: string;
    };
  }
}

const modes: Array<{ mode: RecorderMode; title: string; copy: string; path: string }> = [
  { mode: "video", title: "Camera video", copy: "Record a webcam response with automatic thumbnail.", path: "/free/video" },
  { mode: "audio", title: "Microphone audio", copy: "Capture a spoken answer or voice note.", path: "/free/audio" },
  { mode: "screen", title: "Screen recording", copy: "Record a browser tab, window, or screen.", path: "/free/screen" },
  { mode: "screen-microphone", title: "Screen + microphone", copy: "Narrate a screen demonstration.", path: "/free/screen-microphone" },
  { mode: "photo", title: "Photo", copy: "Take a profile or assignment photo.", path: "/free/photo" },
  { mode: "screenshot", title: "Screenshot", copy: "Capture a browser tab, window, or screen as an image.", path: "/free/screenshot" }
];

const publicBasePath = normalizeBasePath(window.VW_RECORDER_DEMO_BASE_PATH ?? "/");
const apiBasePath = normalizeEndpoint(window.VW_RECORDER_DEMO_CONFIG?.apiBasePath || `${publicBasePath}api`);

function App() {
  const initialMode = modeFromPath();
  const [mode, setMode] = useState<RecorderMode>(initialMode);
  const [theme, setTheme] = useState<DemoTheme>("auto");
  const [autoStart, setAutoStart] = useState(false);
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const [localSave, setLocalSave] = useState(true);
  const config = useMemo(
    () =>
      createFreeRecorderConfig({
        target: "#demo-recorder",
        mode,
        renderMode: "inline",
        ui: {
          launchLabel: "Add recording",
          mobileFullscreen: true,
          theme: "auto",
          showLocalSave: localSave,
          showNevermind: true
        },
        capture: {
          autoStart
        },
        upload: {
          enabled: uploadEnabled,
          endpoint: apiUrl("uploads"),
          fieldName: "media"
        },
        metadata: {
          integration: "standalone-demo",
          selectedMode: mode
        },
        callbacks: {
          onSaved(result) {
            console.info("Recorder saved", result);
          }
        }
      }),
    [autoStart, localSave, mode, uploadEnabled]
  );

  function selectMode(nextMode: RecorderMode) {
    setMode(nextMode);
    const nextPath = modes.find((item) => item.mode === nextMode)?.path;
    if (nextPath) {
      window.history.replaceState({}, "", appUrl(nextPath));
    }
  }

  return (
    <main className="demo" data-theme={theme}>
      <header className="demo-header">
        <div className="demo-brand">
          <span className="demo-mark" />
          <span>VideoWhisper Recorder</span>
          <span className="demo-pill">FREE DEMO</span>
        </div>
        <div className="demo-header-actions">
          <label className="demo-theme-select">
            <span>Theme</span>
            <select aria-label="Theme" value={theme} onChange={(event) => setTheme(event.target.value as DemoTheme)}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="auto">Auto</option>
            </select>
          </label>
          <a href={apiUrl("admin/media")} className="demo-link">PHP media browser</a>
          <a href="https://demo.videowhisper.com/webcam-microphone-screen-recorder/" className="demo-link" target="_blank" rel="noreferrer">Official Demo</a>
          <a href="https://github.com/videowhisper/Webcam-Microphone-Screen-Recorder/" className="demo-link" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://consult.videowhisper.com/?department=Setup" className="demo-link" target="_blank" rel="noreferrer">Contact</a>
        </div>
      </header>

      <section className="demo-grid">
        <aside className="demo-sidebar">
          <h1>Webcam, Microphone &amp; Screen Recorder</h1>
          <p>Test the public Free build for webcam, microphone, screen recording, screenshots, and photo capture.</p>
          <div className="demo-mode-list">
            {modes.map((item) => (
              <button className={item.mode === mode ? "is-active" : ""} type="button" key={item.mode} onClick={() => selectMode(item.mode)}>
                <strong>{item.title}</strong>
                <span>{item.copy}</span>
              </button>
            ))}
          </div>
          <label className="demo-toggle">
            <input type="checkbox" checked={uploadEnabled} onChange={(event) => setUploadEnabled(event.target.checked)} />
            Upload to PHP demo endpoint
          </label>
          <label className="demo-toggle">
            <input type="checkbox" checked={localSave} onChange={(event) => setLocalSave(event.target.checked)} />
            Show local download
          </label>
          <label className="demo-toggle">
            <input type="checkbox" checked={autoStart} onChange={(event) => setAutoStart(event.target.checked)} />
            Start immediately after permission
          </label>
        </aside>

        <section id="demo-recorder" className="demo-recorder">
          <VideoWhisperRecorder key={`${mode}-${uploadEnabled}-${localSave}-${autoStart}`} config={config} />
        </section>
      </section>
    </main>
  );
}

function modeFromPath(): RecorderMode {
  const pathname = window.location.pathname;
  const match = modes.find((item) => pathname.includes(item.path));
  return match?.mode ?? "video";
}

function appUrl(path: string): string {
  return `${publicBasePath}${path.replace(/^\//, "")}`;
}

function apiUrl(path: string): string {
  return `${apiBasePath}/${path.replace(/^\//, "")}`;
}

function normalizeBasePath(value: string): string {
  const path = value.startsWith("/") ? value : `/${value}`;
  return `${path.replace(/\/+$/, "")}/`.replace(/^\/\//, "/");
}

function normalizeEndpoint(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    return value.replace(/\/+$/, "");
  }
  return normalizeBasePath(value).replace(/\/$/, "");
}

createRoot(document.getElementById("root")!).render(<App />);
