import { mkdir, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scope = resolve(root, "node_modules/@videowhisper");

const links = {
  "recorder-core": "packages/recorder-core",
  "recorder-free": "packages/recorder-free",
  "recorder-free-demo": "apps/free-demo",
  "recorder-iframe": "packages/recorder-iframe",
  "recorder-react": "packages/recorder-react",
  "recorder-test-host-iframe": "apps/test-host-iframe",
  "recorder-test-host-react": "apps/test-host-react",
  "recorder-types": "packages/recorder-types",
  "recorder-ui": "packages/recorder-ui",
  "recorder-upload": "packages/recorder-upload",
  "recorder-vanilla": "packages/recorder-vanilla"
};

await mkdir(scope, { recursive: true });

for (const [name, target] of Object.entries(links)) {
  const link = resolve(scope, name);
  await rm(link, { force: true, recursive: true });
  await symlink(resolve(root, target), link);
}

console.log("Repaired @videowhisper workspace links.");
