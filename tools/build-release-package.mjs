import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const recorderRoot = resolve(root, "..");
const releases = resolve(recorderRoot, "releases/free");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const version = packageJson.version;
const packageName = `videowhisper-webcam-microphone-screen-recorder-${version}`;
const staging = resolve(releases, `.staging-${packageName}`);
const packageRoot = resolve(staging, packageName);
const zipPath = resolve(releases, `${packageName}.zip`);
const checksumPath = `${zipPath}.sha256`;

await execFileAsync("npm", ["run", "build"], {
  cwd: root,
  env: { ...process.env, VWR_RELEASE_BUILD: "1" }
});
await rm(staging, { recursive: true, force: true });
await rm(zipPath, { force: true });
await rm(checksumPath, { force: true });
await mkdir(packageRoot, { recursive: true });

// Public browser demo: its relative Vite assets and runtime base-path bootstrap
// work from any extracted subfolder.
await cp(resolve(root, "apps/free-demo/dist"), packageRoot, { recursive: true });
await writeFile(resolve(packageRoot, ".htaccess"), staticHtaccess());
await writeFile(resolve(packageRoot, "DEPLOYMENT.md"), deploymentReadme());
await cp(resolve(root, "NOTICE.md"), resolve(packageRoot, "NOTICE.md"));

// Keep the PHP application implementation behind the /api front controller.
const appRoot = resolve(packageRoot, "api/app");
await cp(resolve(root, "server/php-demo/src"), resolve(appRoot, "src"), { recursive: true });
await cp(resolve(root, "server/php-demo/config"), resolve(appRoot, "config"), {
  recursive: true,
  filter: (source) => !source.endsWith("credentials.php")
});
await cp(resolve(root, "server/php-demo/public/index.php"), resolve(appRoot, "public/index.php"));
await cp(resolve(root, "server/php-demo/bin/cleanup.php"), resolve(appRoot, "bin/cleanup.php"));
await mkdir(resolve(appRoot, "storage/media"), { recursive: true });
await mkdir(resolve(appRoot, "storage/thumbnails"), { recursive: true });
await mkdir(resolve(appRoot, "storage/logs"), { recursive: true });
await Promise.all([
  writeFile(resolve(appRoot, ".htaccess"), denyAllHtaccess()),
  writeFile(resolve(appRoot, "storage/media/.gitkeep"), ""),
  writeFile(resolve(appRoot, "storage/thumbnails/.gitkeep"), ""),
  writeFile(resolve(appRoot, "storage/logs/.gitkeep"), ""),
  writeFile(resolve(packageRoot, "api/index.php"), "<?php\ndeclare(strict_types=1);\nrequire __DIR__ . '/app/public/index.php';\n"),
  writeFile(resolve(packageRoot, "api/.htaccess"), apiHtaccess())
]);

await execFileAsync("zip", ["-qry", zipPath, packageName], { cwd: staging });
const digest = createHash("sha256").update(await readFile(zipPath)).digest("hex");
await writeFile(checksumPath, `${digest}  ${packageName}.zip\n`);
await rm(staging, { recursive: true, force: true });

console.log(`Created ${zipPath}`);
console.log(`Created ${checksumPath}`);

function staticHtaccess() {
  return `Options -Indexes
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^api(?:/|$) - [L]
  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^ - [L]
  RewriteRule ^ index.html [L]
</IfModule>
`;
}

function apiHtaccess() {
  return `Options -Indexes
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^app(?:/|$) - [F,L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ index.php [QSA,L]
</IfModule>
`;
}

function denyAllHtaccess() {
  return `<IfModule mod_authz_core.c>
  Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
</IfModule>
`;
}

function deploymentReadme() {
  return `# VideoWhisper Webcam, Microphone & Screen Recorder\n\nExtract this folder into the public folder you want to use, for example:\n\n\`\`\`text\n<document-root>/webcam-microphone-screen-recorder/\n\`\`\`\n\nThe browser demo automatically detects that folder. Its API defaults to the\n\`api/\` subfolder, so uploads use\n\`/webcam-microphone-screen-recorder/api/uploads\` without configuration.\n\nBefore public exposure, copy \`api/app/config/credentials.example.php\` to\n\`api/app/config/credentials.php\` and replace the admin username, password,\nand HMAC secret. The defaults intentionally keep a private quick test working,\nbut are unsafe for a public demo.\n\nThe \`api/app/storage/\` directories must be writable by the PHP process.\nThis package relies on Apache rewrite rules. For nginx or another server, route\nunknown demo paths to \`index.html\`, route \`api/*\` to \`api/index.php\`, and\ndeny direct access to \`api/app/\`.\n\nTo use another API endpoint, edit \`recorder-config.js\` and set\n\`apiBasePath\`. Do not upload runtime SQLite files, media, thumbnails, logs,\nor \`credentials.php\` to GitHub.\n`;
}
