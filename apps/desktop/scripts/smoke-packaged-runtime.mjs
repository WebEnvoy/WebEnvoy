import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electron from "electron";

const screenshotPath = path.resolve(
  process.env.WEBENVOY_PACKAGED_RUNTIME_SMOKE_SCREENSHOT ?? "artifacts/app-265-packaged-runtime-smoke.png",
);

const corePort = await reservePort();
const harborPort = await reservePort();
const userDataDir = await mkdtemp(path.join(tmpdir(), "webenvoy-app-packaged-runtime-"));

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

  if (!result.runtimeSupervisorState?.canUseLiveRuntime || result.runtimeSupervisorState?.failClosed) {
    throw new Error(`Packaged runtime smoke failed: live gate was not ready. ${JSON.stringify(result.runtimeSupervisorState)}`);
  }
  if (core?.launchSource !== "packaged-path" || harbor?.launchSource !== "packaged-path") {
    throw new Error(`Packaged runtime smoke failed: runtimes were not launched from packaged paths. ${JSON.stringify(services)}`);
  }
  if (core?.admission?.state !== "ready" || harbor?.health?.state !== "ready") {
    throw new Error(`Packaged runtime smoke failed: owner health/admission is not ready. ${JSON.stringify(services)}`);
  }
  if (!result.coreThreadReadReady) {
    throw new Error("Packaged runtime smoke failed: renderer did not consume Core /threads.");
  }
  if (
    !result.packagedTaskBoundary?.lodeActionDeclared ||
    result.packagedTaskBoundary.effectivePolicyStatus !== 200 ||
    !result.packagedTaskBoundary.effectivePolicyReady ||
    result.packagedTaskBoundary.threadCreateStatus !== 201 ||
    result.packagedTaskBoundary.firstTurnSubmitStatus !== 503 ||
    !result.packagedTaskBoundary.firstTurnRecorded ||
    result.packagedTaskBoundary.firstTurnStatus !== "waiting_for_user" ||
    result.packagedTaskBoundary.firstTurnFailureCode !== "identity_environment_missing"
  ) {
    throw new Error(`Packaged runtime smoke failed: task boundary probe did not fail closed as expected. ${JSON.stringify(result.packagedTaskBoundary)}`);
  }
  if (
    result.packagedViewport?.windowWidth !== 720 ||
    result.packagedViewport?.horizontalOverflow !== false ||
    result.packagedViewport?.scrollWidth > result.packagedViewport?.innerWidth
  ) {
    throw new Error(`Packaged runtime smoke failed: production window did not hold the 720px layout boundary. ${JSON.stringify(result.packagedViewport)}`);
  }

  console.log(
    [
      "Packaged runtime smoke passed.",
      `Core endpoint: http://127.0.0.1:${corePort}`,
      `Harbor endpoint: http://127.0.0.1:${harborPort}`,
      `Core pid: ${core.pid}`,
      `Harbor pid: ${harbor.pid}`,
      "Core /threads: ready",
      "Packaged Lode action + Core policy + first-turn boundary: verified fail-closed before Harbor session creation",
      "Production viewport: 720px without horizontal overflow",
      `Lode asset source: ${result.runtimeSupervisorState.lodeAssets.source}`,
      `Screenshot: ${screenshotPath}`,
      "Boundary: local packaged Core/Harbor runtime health/admission only; no real account/profile/Cookie/production page and no submit/publish/send.",
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
      WEBENVOY_PACKAGED_SMOKE_RUNTIME_EXPECTATION: "live_ready",
      WEBENVOY_PACKAGED_SMOKE_CORE_ENDPOINT: coreEndpoint,
      WEBENVOY_PACKAGED_SMOKE_HARBOR_ENDPOINT: harborEndpoint,
      WEBENVOY_PACKAGED_SMOKE_USER_DATA_DIR: userDataDir,
      WEBENVOY_PACKAGED_SMOKE_SCREENSHOT: screenshotPath,
      WEBENVOY_PACKAGED_SMOKE_TASK_BOUNDARY: "1",
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
    throw new Error(`Packaged runtime Electron smoke failed.\n${stderr || stdout}`);
  }

  const resultLine = stdout
    .split("\n")
    .find((line) => line.startsWith("WEBSMOKE_RESULT "));
  if (!resultLine) {
    throw new Error(`Packaged runtime Electron smoke failed: result line is missing.\n${stdout}`);
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
