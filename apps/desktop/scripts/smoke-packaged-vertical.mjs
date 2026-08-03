import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electron from "electron";

const screenshotPath = path.resolve(
  process.env.WEBENVOY_PACKAGED_VERTICAL_SMOKE_SCREENSHOT ?? "artifacts/app-261-packaged-vertical-smoke.png",
);

const core = await startJsonServer((pathname) => {
  if (pathname === "/threads") {
    return { ok: true, threads: [] };
  }
  if (["/health", "/ready", "/runtime/health", "/admission/health", "/admission/ready", "/tasks/admission/health"].includes(pathname)) {
    return {
      service: "webenvoy-core-smoke",
      status: "ready",
      evidence_boundary: "local owner-shaped smoke only; no real site, account, profile, Cookie, submit, publish, or send action",
    };
  }

  return null;
});
const harbor = await startJsonServer((pathname) => {
  if (pathname === "/readiness") {
    return {
      service: "webenvoy-harbor-smoke",
      status: "ready",
      provider_detection_ref: "harbor:provider-detection/app-261/local-smoke",
      evidence_ref: "harbor:evidence/app-261/local-smoke",
      evidence_boundary: "local owner-shaped smoke only; no provider launch, profile use, or production page access",
    };
  }

  return null;
});

try {
  await mkdir(path.dirname(screenshotPath), { recursive: true });

  const result = await runElectronSmoke({
    coreEndpoint: core.endpoint,
    harborEndpoint: harbor.endpoint,
    screenshotPath,
    expectation: "live_ready",
  });

  if (!result.runtimeSupervisorState?.canUseLiveRuntime) {
    throw new Error(`Packaged vertical smoke failed: live runtime gate was not ready. ${JSON.stringify(result.runtimeSupervisorState)}`);
  }

  if (result.runtimeSupervisorState.lodeAssets?.state !== "ready" || result.runtimeSupervisorState.lodeAssets.packageCount < 6) {
    throw new Error(`Packaged vertical smoke failed: Lode assets were not packaged. ${JSON.stringify(result.runtimeSupervisorState.lodeAssets)}`);
  }

  const fixtureCore = await startJsonServer((pathname) => {
    if (pathname === "/threads") return { ok: true, threads: [] };
    if (["/health", "/admission/health"].includes(pathname)) {
      return {
        service: "webenvoy-core-smoke",
        status: "ready",
      };
    }
    return null;
  });
  const fixtureHarbor = await startJsonServer((pathname) => {
    if (pathname === "/readiness") return { service: "webenvoy-harbor-smoke", status: "ready", source: "fixture" };
    if (pathname === "/health") return { service: "webenvoy-harbor-smoke", status: "ready" };
    return null;
  });
  try {
    const fixtureResult = await runElectronSmoke({
      coreEndpoint: fixtureCore.endpoint,
      harborEndpoint: fixtureHarbor.endpoint,
      expectation: "fail_closed",
    });
    const harborHealth = fixtureResult.runtimeSupervisorState?.services?.find((service) => service.id === "harbor")?.health;
    if (!fixtureResult.runtimeSupervisorState?.failClosed || fixtureResult.runtimeSupervisorState.canUseLiveRuntime || harborHealth?.state !== "unavailable") {
      throw new Error(`Packaged vertical smoke failed: fixture Harbor readiness opened live gate. ${JSON.stringify(fixtureResult.runtimeSupervisorState)}`);
    }
  } finally {
    await fixtureCore.close();
    await fixtureHarbor.close();
  }

  console.log(
    [
      "Packaged vertical smoke passed.",
      `Core endpoint: ${core.endpoint}`,
      `Harbor endpoint: ${harbor.endpoint}`,
      `Lode asset source: ${result.runtimeSupervisorState.lodeAssets.source}`,
      `Screenshot: ${screenshotPath}`,
      "Fixture fail-closed check: passed.",
      "Boundary: local owner-shaped health/admission/evidence refs only; no real account/profile/Cookie/production page and no submit/publish/send.",
    ].join("\n"),
  );
} finally {
  await core.close();
  await harbor.close();
}

async function runElectronSmoke({ coreEndpoint, harborEndpoint, screenshotPath, expectation }) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "webenvoy-app-packaged-smoke-"));
  const child = spawn(electron, ["dist-electron/main.js"], {
    env: {
      ...process.env,
      WEBENVOY_PACKAGED_SMOKE: "1",
      WEBENVOY_PACKAGED_SMOKE_RUNTIME_EXPECTATION: expectation,
      WEBENVOY_PACKAGED_SMOKE_CORE_ENDPOINT: coreEndpoint,
      WEBENVOY_PACKAGED_SMOKE_HARBOR_ENDPOINT: harborEndpoint,
      WEBENVOY_PACKAGED_SMOKE_USER_DATA_DIR: userDataDir,
      WEBENVOY_DISABLE_PACKAGED_RUNTIME: "1",
      ...(screenshotPath ? { WEBENVOY_PACKAGED_SMOKE_SCREENSHOT: screenshotPath } : {}),
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

  await rm(userDataDir, { recursive: true, force: true });

  if (exitCode !== 0) {
    throw new Error(`Packaged vertical Electron smoke failed.\n${stderr || stdout}`);
  }

  const resultLine = stdout
    .split("\n")
    .find((line) => line.startsWith("WEBSMOKE_RESULT "));

  if (!resultLine) {
    throw new Error("Packaged vertical Electron smoke failed: result line is missing.");
  }

  return JSON.parse(resultLine.slice("WEBSMOKE_RESULT ".length));
}

async function startJsonServer(bodyForPath) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = bodyForPath(url.pathname);
    if (body == null) {
      response.writeHead(404, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(`${JSON.stringify({ status: "missing" })}\n`);
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(`${JSON.stringify(body)}\n`);
  });

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local smoke server port.");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
