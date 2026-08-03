import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electron from "electron";

const screenshotPath = path.resolve(
  process.env.WEBENVOY_PACKAGED_SMOKE_SCREENSHOT ?? "artifacts/gh-168-packaged-preview.png",
);
await mkdir(path.dirname(screenshotPath), { recursive: true });

const core = await startUnavailableJsonServer();
const harbor = await startUnavailableJsonServer();
const userDataDir = await mkdtemp(path.join(tmpdir(), "webenvoy-app-packaged-smoke-"));

const child = spawn(electron, ["dist-electron/main.js"], {
  env: {
    ...process.env,
    WEBENVOY_PACKAGED_SMOKE: "1",
    WEBENVOY_PACKAGED_SMOKE_SCREENSHOT: screenshotPath,
    WEBENVOY_PACKAGED_SMOKE_CORE_ENDPOINT: core.endpoint,
    WEBENVOY_PACKAGED_SMOKE_HARBOR_ENDPOINT: harbor.endpoint,
    WEBENVOY_PACKAGED_SMOKE_USER_DATA_DIR: userDataDir,
    WEBENVOY_DISABLE_PACKAGED_RUNTIME: "1",
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
await core.close();
await harbor.close();

if (exitCode !== 0) {
  throw new Error(`Packaged Electron smoke failed.\n${stderr || stdout}`);
}

const resultLine = stdout
  .split("\n")
  .find((line) => line.startsWith("WEBSMOKE_RESULT "));

if (!resultLine) {
  throw new Error("Packaged Electron smoke failed: result line is missing.");
}

const result = JSON.parse(resultLine.slice("WEBSMOKE_RESULT ".length));

if (!result.hasPreload || result.rootChildCount === 0 || result.rootTextLength === 0) {
  throw new Error(`Packaged Electron smoke failed: ${JSON.stringify(result)}`);
}

const lodeAssets = result.runtimeSupervisorState?.lodeAssets;
if (!lodeAssets) {
  throw new Error("Packaged Electron smoke failed: Lode asset bundle state is missing.");
}

if (lodeAssets.state === "ready" && lodeAssets.packageCount < 6) {
  throw new Error(`Packaged Electron smoke failed: incomplete Lode asset bundle ${JSON.stringify(lodeAssets)}`);
}

if (lodeAssets.state !== "ready" && !result.runtimeSupervisorState?.failClosed) {
  throw new Error(`Packaged Electron smoke failed: missing Lode assets did not fail closed ${JSON.stringify(result.runtimeSupervisorState)}`);
}

console.log(`Packaged Electron smoke passed. Lode assets: ${lodeAssets.state}. Screenshot: ${screenshotPath}`);

async function startUnavailableJsonServer() {
  const server = createServer((_request, response) => {
    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(`${JSON.stringify({ status: "missing" })}\n`);
  });

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate a local packaged smoke server port.");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve(null)))),
  };
}
