import { access, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const source = resolve(root, "packages/recorder-vanilla/dist");
const targets = [
  resolve(root, "../../../video-posts-webcam-recorder/trunk/recorder"),
  resolve(root, "../../../video-comments-webcam-recorder/trunk/recorder")
];
const assets = ["videowhisper-recorder.browser.js", "videowhisper-recorder.css"];

for (const asset of assets) {
  try {
    await access(resolve(source, asset));
  } catch {
    throw new Error(`Missing ${asset}. Run npm run build first.`);
  }
}

for (const target of targets) {
  for (const asset of assets) {
    const destination = resolve(target, asset);
    if (asset.endsWith(".js")) {
      const code = await readFile(resolve(source, asset), "utf8");
      await writeFile(destination, code.replace(/\n?\/\/# sourceMappingURL=.*$/m, "") + "\n");
    } else {
      await copyFile(resolve(source, asset), destination);
    }
  }
  // Build instructions belong in development documentation, never in a
  // WordPress.org plugin's distributed runtime asset folder.
  await rm(resolve(target, "README.md"), { force: true });
}

console.log("Synced production recorder assets to both WordPress plugins.");
