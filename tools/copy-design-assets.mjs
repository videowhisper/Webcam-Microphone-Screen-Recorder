import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const source = resolve(root, "../../recorder-design/screenshots");
const target = resolve(root, "docs/screenshots");

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log(`Copied design screenshots to ${target}`);
