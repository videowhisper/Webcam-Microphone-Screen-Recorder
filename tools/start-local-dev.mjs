#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const phpDir = resolve(root, "server/php-demo");
const appHost = process.env.VWR_APP_HOST || "127.0.0.1";
const appPort = process.env.VWR_APP_PORT || "5177";
const phpHost = process.env.VWR_PHP_HOST || "127.0.0.1";
const phpPort = process.env.VWR_PHP_PORT || "8080";
const phpUploadMax = process.env.VWR_PHP_UPLOAD_MAX || "100M";
const phpPostMax = process.env.VWR_PHP_POST_MAX || "110M";
const phpMemoryLimit = process.env.VWR_PHP_MEMORY_LIMIT || "256M";
const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

printDetails();

if (args.has("--print")) {
  process.exit(0);
}

const portsOk = await checkPorts();
if (!portsOk) {
  process.exit(1);
}

if (args.has("--check")) {
  console.log("Local dev checks passed.");
  process.exit(0);
}

const children = [];

const php = spawn(
  "php",
  [
    "-d",
    `upload_max_filesize=${phpUploadMax}`,
    "-d",
    `post_max_size=${phpPostMax}`,
    "-d",
    `memory_limit=${phpMemoryLimit}`,
    "-S",
    `${phpHost}:${phpPort}`,
    "-t",
    "public"
  ],
  {
    cwd: phpDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  }
);
children.push(php);
pipeOutput(php, "php");

const vite = spawn(
  "npm",
  [
    "run",
    "dev",
    "--workspace",
    "@videowhisper/recorder-free-demo",
    "--",
    "--host",
    appHost,
    "--port",
    appPort
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      VWR_PHP_HOST: phpHost,
      VWR_PHP_PORT: phpPort
    },
    stdio: ["ignore", "pipe", "pipe"]
  }
);
children.push(vite);
pipeOutput(vite, "vite");

for (const child of children) {
  child.on("error", (error) => {
    console.error(`Failed to start ${child === php ? "PHP" : "Vite"}: ${error.message}`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      return;
    }
    if (code && code !== 0) {
      shutdown(code);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function printHelp() {
  console.log(`VideoWhisper Recorder local dev launcher

Usage:
  npm run dev:local
  npm run dev:local -- --check
  npm run dev:local -- --print

Environment:
  VWR_APP_HOST=${appHost}
  VWR_APP_PORT=${appPort}
  VWR_PHP_HOST=${phpHost}
  VWR_PHP_PORT=${phpPort}
  VWR_PHP_UPLOAD_MAX=${phpUploadMax}
  VWR_PHP_POST_MAX=${phpPostMax}
  VWR_PHP_MEMORY_LIMIT=${phpMemoryLimit}
`);
}

function printDetails() {
  const appBase = `http://${appHost}:${appPort}`;
  const phpBase = `http://${phpHost}:${phpPort}`;

  console.log(`
VideoWhisper Recorder local test stack

Recorder app:
  ${appBase}/

Mode URLs:
  ${appBase}/free/video
  ${appBase}/free/audio
  ${appBase}/free/screen
  ${appBase}/free/screen-microphone
  ${appBase}/free/photo
  ${appBase}/free/screenshot

PHP backend:
  ${phpBase}/
  ${phpBase}/api/capabilities

Admin/media browser:
  ${appBase}/admin/media
  ${phpBase}/admin/media

Default admin:
  admin / admin

Upload testing:
  Start both servers with this script, open the recorder app, then enable
  "Upload to PHP demo endpoint" in the demo sidebar.

Local PHP limits for this launcher:
  upload_max_filesize=${phpUploadMax}
  post_max_size=${phpPostMax}
  memory_limit=${phpMemoryLimit}

Stop:
  Ctrl-C
`);
}

async function checkPorts() {
  const appOk = await isPortAvailable(appHost, Number(appPort));
  const phpOk = await isPortAvailable(phpHost, Number(phpPort));

  if (!appOk) {
    console.error(`Port ${appHost}:${appPort} is already in use. Stop the old app server or set VWR_APP_PORT.`);
  }
  if (!phpOk) {
    console.error(`Port ${phpHost}:${phpPort} is already in use. Stop the old PHP server or set VWR_PHP_PORT.`);
  }

  return appOk && phpOk;
}

function isPortAvailable(host, port) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => resolvePromise(false));
    server.once("listening", () => {
      server.close(() => resolvePromise(true));
    });
    server.listen(port, host);
  });
}

function pipeOutput(child, label) {
  child.stdout.on("data", (chunk) => writePrefixed(label, chunk));
  child.stderr.on("data", (chunk) => writePrefixed(label, chunk));
}

function writePrefixed(label, chunk) {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length) {
      console.log(`[${label}] ${line}`);
    }
  }
}

function shutdown(code) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 150);
}
