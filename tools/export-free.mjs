import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = process.env.VW_RECORDER_EXPORT_DIR
  ? resolve(process.env.VW_RECORDER_EXPORT_DIR)
  : resolve(root, "../distribution/free/source");

const allowlist = [
  "package.json",
  "package-lock.json",
  ".gitignore",
  "eslint.config.js",
  "playwright.config.ts",
  "vitest.config.ts",
  "tsconfig.base.json",
  "README.md",
  "LICENSE",
  "LICENSES.md",
  "NOTICE.md",
  "SECURITY.md",
  "docs",
  "tests",
  "tools",
  "packages/recorder-types",
  "packages/recorder-core",
  "packages/recorder-upload",
  "packages/recorder-ui",
  "packages/recorder-react",
  "packages/recorder-free",
  "packages/recorder-vanilla",
  "packages/recorder-iframe",
  "apps/free-demo",
  "apps/test-host-vanilla",
  "apps/test-host-react",
  "apps/test-host-iframe",
  "server/php-demo"
];

try {
  await stat(resolve(out, ".git"));
  throw new Error(
    `Refusing to replace Git checkout at ${out}. Set VW_RECORDER_EXPORT_DIR to an empty staging directory, then review and copy the export.`
  );
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const item of allowlist) {
  await cp(resolve(root, item), resolve(out, item), {
    recursive: true,
    filter: (source) => shouldExport(source)
  });
}

console.log(`Exported public source to ${out}`);

function shouldExport(source) {
  const parts = relative(root, source).split(sep);
  const relativePath = parts.join("/");
  if (["node_modules", ".vite", "dist", "dist-types", "coverage", "test-results", "playwright-report", ".codex", ".agents"].some((name) => parts.includes(name))) {
    return false;
  }
  if (
    parts[0] === "docs" &&
    !["docs", "docs/screenshots", "docs/screenshots/02-view.png", "docs/wordpress-integration.md"].includes(relativePath)
  ) {
    return false;
  }
  if (parts.some((part) => ["AGENTS.md", "CLAUDE.md", ".env", ".env.local", "attachments"].includes(part)) || source.endsWith(".tsbuildinfo") || source.endsWith(".map")) {
    return false;
  }
  if (parts[0] === "server" && parts[1] === "php-demo" && parts[2] === "config" && parts[3] === "credentials.php") {
    return false;
  }
  if (parts[0] === "server" && parts[1] === "php-demo" && parts[2] === "storage") {
    return false;
  }
  return true;
}
