import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const source = resolve(root, "../distribution/free/source");
const forbiddenNames = new Set(["AGENTS.md", "CLAUDE.md", ".env", ".env.local", "credentials.php", ".DS_Store"]);

await execFileAsync("node", ["tools/export-free.mjs"], { cwd: root });
const forbidden = await findForbidden(source);
if (forbidden.length) {
  throw new Error(`Public GitHub source contains forbidden files:\n${forbidden.join("\n")}`);
}

console.log(`Prepared clean GitHub source at ${source}`);
console.log("Upload the separately built deployment ZIP and .sha256 file as GitHub Release assets, not repository source.");

async function findForbidden(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name);
    if (forbiddenNames.has(entry.name) || entry.name === ".codex" || entry.name === ".agents" || entry.name === "attachments") {
      found.push(fullPath);
      continue;
    }
    if (entry.isDirectory()) {
      found.push(...await findForbidden(fullPath));
    } else if (!(await stat(fullPath)).isFile()) {
      found.push(fullPath);
    }
  }
  return found;
}
