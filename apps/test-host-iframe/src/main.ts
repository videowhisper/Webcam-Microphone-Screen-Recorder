const frame = document.getElementById("recorder-frame") as HTMLIFrameElement;

frame.addEventListener("load", () => {
  frame.contentWindow?.postMessage(
    {
      schemaVersion: "1",
      type: "videowhisper-recorder:init",
      correlationId: crypto.randomUUID(),
      allowedParentOrigins: [window.location.origin],
      config: {
        mode: "video",
        renderMode: "page",
        ui: {
          launchLabel: "Add Video",
          mobileFullscreen: true,
          theme: "auto",
          showLocalSave: true,
          showNevermind: true
        }
      }
    },
    window.location.origin
  );
});

window.addEventListener("message", (event) => {
  if (event.origin === window.location.origin && event.data?.type === "videowhisper-recorder:saved") {
    console.info("iframe recorder result", event.data.result);
  }
});
