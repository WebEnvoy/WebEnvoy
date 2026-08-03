import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const rendererUrl = "http://127.0.0.1:5173";
const children = new Set();

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    ...options,
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

function stopAll() {
  for (const child of children) {
    child.kill();
  }
}

async function waitForRenderer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(rendererUrl);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Timed out waiting for Vite renderer at ${rendererUrl}`);
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

run(npmCommand, ["exec", "vite", "--", "--host", "127.0.0.1"]);
await waitForRenderer();

const buildMain = run(npmCommand, ["run", "build:main"]);
await new Promise((resolve, reject) => {
  buildMain.on("exit", (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(`Electron main build failed with exit code ${code}`));
    }
  });
});

const electron = run(npmCommand, ["exec", "electron", "--", "dist-electron/main.js"], {
  env: {
    ...process.env,
    WEBENVOY_RENDERER_URL: rendererUrl,
  },
});

electron.on("exit", (code) => {
  stopAll();
  process.exit(code ?? 0);
});
