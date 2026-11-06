import React from "react";
import { createRoot } from "react-dom/client";
import { createRecorderConfig } from "@videowhisper/recorder-free";
import { VideoWhisperRecorder } from "@videowhisper/recorder-react";
import "@videowhisper/recorder-ui/styles.css";

const config = createRecorderConfig({
  target: "#root",
  mode: "audio",
  renderMode: "inline",
  ui: {
    launchLabel: "Add Audio",
    mobileFullscreen: true,
    theme: "auto",
    showLocalSave: true,
    showNevermind: true
  }
});

createRoot(document.getElementById("root")!).render(<VideoWhisperRecorder config={config} />);
