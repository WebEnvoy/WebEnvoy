import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electron from "electron";

const screenshotPath = path.resolve(
  process.env.WEBENVOY_PACKAGED_READONLY_SMOKE_SCREENSHOT ?? "artifacts/app-265-packaged-readonly-smoke.png",
);

const corePort = await reservePort();
const harborPort = await reservePort();
const userDataDir = await mkdtemp(path.join(tmpdir(), "webenvoy-app-packaged-readonly-"));

try {
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  const result = await runElectronSmoke({
    coreEndpoint: `http://127.0.0.1:${corePort}`,
    harborEndpoint: `http://127.0.0.1:${harborPort}`,
    screenshotPath,
    userDataDir,
  });

  const services = result.runtimeSupervisorState?.services ?? [];
  const core = services.find((service) => service.id === "core");
  const harbor = services.find((service) => service.id === "harbor");

  if (result.runtimeSupervisorState?.canUseLiveRuntime || !result.runtimeSupervisorState?.failClosed) {
    throw new Error(`Packaged readonly smoke failed: fixture launcher opened live gate. ${JSON.stringify(result.runtimeSupervisorState)}`);
  }
  if (core?.launchSource !== "packaged-path" || harbor?.launchSource !== "packaged-path") {
    throw new Error(`Packaged readonly smoke failed: runtimes were not launched from packaged paths. ${JSON.stringify(services)}`);
  }
  if (core?.processState !== "running" || harbor?.health?.state !== "unavailable") {
    throw new Error(`Packaged readonly smoke failed: fixture Harbor was not fail-closed after packaged runtime launch. ${JSON.stringify(services)}`);
  }
  if (!/fixture runtime provider/.test(harbor.health.summary)) {
    throw new Error(`Packaged readonly smoke failed: fixture Harbor blocker was not explained. ${JSON.stringify(harbor.health)}`);
  }

  console.log(
    [
      "Packaged readonly fixture-block smoke passed.",
      `Core endpoint: http://127.0.0.1:${corePort}`,
      `Harbor endpoint: http://127.0.0.1:${harborPort}`,
      `Core pid: ${core.pid}`,
      `Harbor pid: ${harbor.pid}`,
      `Lode asset source: ${result.runtimeSupervisorState.lodeAssets.source}`,
      `Screenshot: ${screenshotPath}`,
      "Evidence: Electron App launched packaged Core/Harbor runtime processes and kept fixture Harbor fail-closed.",
      "Boundary: no real account/profile/Cookie/production page/browser launch and no submit/publish/send.",
    ].join("\n"),
  );
} finally {
  await rm(userDataDir, { recursive: true, force: true });
}

async function runElectronSmoke({ coreEndpoint, harborEndpoint, screenshotPath, userDataDir }) {
  const child = spawn(electron, ["dist-electron/main.js"], {
    env: {
      ...process.env,
      WEBENVOY_PACKAGED_SMOKE: "1",
      WEBENVOY_PACKAGED_SMOKE_RUNTIME_EXPECTATION: "fail_closed",
      WEBENVOY_PACKAGED_SMOKE_CORE_ENDPOINT: coreEndpoint,
      WEBENVOY_PACKAGED_SMOKE_HARBOR_ENDPOINT: harborEndpoint,
      WEBENVOY_PACKAGED_SMOKE_USER_DATA_DIR: userDataDir,
      WEBENVOY_PACKAGED_SMOKE_SCREENSHOT: screenshotPath,
      HARBOR_RUNTIME_PROVIDER: "fixture",
      HARBOR_CLOAKBROWSER_PATH: process.execPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise((resolve) => {
    child.on("exit", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`Packaged readonly Electron smoke failed.\n${stderr || stdout}`);
  }

  const resultLine = stdout
    .split("\n")
    .find((line) => line.startsWith("WEBSMOKE_RESULT "));
  if (!resultLine) {
    throw new Error(`Packaged readonly Electron smoke failed: result line is missing.\n${stdout}`);
  }
  return JSON.parse(resultLine.slice("WEBSMOKE_RESULT ".length));
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local runtime smoke port.");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}
