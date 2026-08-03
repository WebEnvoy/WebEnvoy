import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const outRoot = path.resolve("dist-electron/runtime");
const sourceLock = JSON.parse(await readFile(new URL("./runtime-source-lock.json", import.meta.url), "utf8"));
const coreRoot = findRoot("WEBENVOY_CORE_RUNTIME_SOURCE_DIR", ["../WebEnvoy", "../../WebEnvoy"], "packages/api-server/package.json", sourceLock.core);
const harborRoot = findRoot("WEBENVOY_HARBOR_RUNTIME_SOURCE_DIR", ["../Harbor", "../../Harbor"], "packages/runtime-api/src/runtime-server.ts", sourceLock.harbor);
const requirePackagedRuntime = process.env.WEBENVOY_REQUIRE_PACKAGED_RUNTIME === "1";
const packaged = [];
const missing = [];

await rm(outRoot, { recursive: true, force: true });
await mkdir(outRoot, { recursive: true });

if (coreRoot) {
  buildRuntime(coreRoot, "Core");
  await packageCoreRuntime(coreRoot, path.join(outRoot, "core"));
  packaged.push({ service: "core", sourceRoot: coreRoot });
} else {
  missing.push("Core runtime source missing; set WEBENVOY_CORE_RUNTIME_SOURCE_DIR or check out sibling WebEnvoy.");
}

if (harborRoot) {
  buildRuntime(harborRoot, "Harbor");
  await packageHarborRuntime(harborRoot, path.join(outRoot, "harbor"));
  packaged.push({ service: "harbor", sourceRoot: harborRoot });
} else {
  missing.push("Harbor runtime source missing; set WEBENVOY_HARBOR_RUNTIME_SOURCE_DIR or check out sibling Harbor.");
}

await writeFile(
  path.join(outRoot, "packaging-state.json"),
  `${JSON.stringify(
    {
      schema_version: "webenvoy-app-packaged-runtime-assets/v0",
      status: missing.length === 0 ? "ready" : "blocked",
      packaged,
      missing,
      consumer_boundary:
        "App packages local Core/Harbor runtime launch wrappers only; Core and Harbor remain runtime truth owners.",
    },
    null,
    2,
  )}\n`,
);

if (missing.length > 0) {
  const message = `Packaged runtime assets blocked: ${missing.join(" ")}`;
  if (requirePackagedRuntime) throw new Error(message);
  console.error(message);
}

async function packageCoreRuntime(sourceRoot, outDir) {
  await mkdir(path.join(outDir, "node_modules", "@webenvoy"), { recursive: true });
  await copyPackage(path.join(sourceRoot, "packages", "api-server"), path.join(outDir, "node_modules", "@webenvoy", "api-server"));
  await copyPackage(path.join(sourceRoot, "packages", "core"), path.join(outDir, "node_modules", "@webenvoy", "core-runtime"));
  await writeFile(path.join(outDir, "start-runtime.mjs"), coreStartScript());
  console.log(`Packaged Core runtime from ${sourceRoot} into ${outDir}`);
}

async function packageHarborRuntime(sourceRoot, outDir) {
  await mkdir(outDir, { recursive: true });
  await cp(path.join(sourceRoot, "dist"), path.join(outDir, "dist"), { recursive: true });
  await copyProductionDependencies(sourceRoot, outDir);
  await writeFile(path.join(outDir, "start-runtime.mjs"), harborStartScript());
  console.log(`Packaged Harbor runtime from ${sourceRoot} into ${outDir}`);
}

async function copyProductionDependencies(sourceRoot, outDir) {
  const packageJson = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
  for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
    const from = path.join(sourceRoot, "node_modules", dependency);
    if (!existsSync(from)) throw new Error(`Harbor production dependency is missing: ${dependency}`);
    await cp(from, path.join(outDir, "node_modules", dependency), { recursive: true, dereference: true });
  }
}

async function copyPackage(from, to) {
  await mkdir(to, { recursive: true });
  await cp(path.join(from, "dist"), path.join(to, "dist"), { recursive: true });
  await cp(path.join(from, "package.json"), path.join(to, "package.json"));
}

function buildRuntime(cwd, name) {
  const result = spawnSync("pnpm", ["build"], { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${name} runtime build failed with status ${result.status ?? "unknown"}.`);
  }
}

function findRoot(envName, candidates, requiredPath, expectedHead) {
  const roots = [process.env[envName], ...candidates.map((candidate) => path.resolve(candidate))].filter(Boolean);
  for (const candidate of roots) {
    if (!existsSync(path.join(candidate, requiredPath))) continue;
    if (isLockedCleanSource(candidate, expectedHead)) return candidate;
    if (candidate === process.env[envName]) {
      throw new Error(`${envName} must reference a clean source pinned to ${expectedHead}: ${candidate}`);
    }
  }
  return null;
}

function isLockedCleanSource(candidate, expectedHead) {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: candidate, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: candidate, encoding: "utf8" });
  return head.status === 0 && head.stdout.trim() === expectedHead && status.status === 0 && status.stdout.trim() === "";
}

function coreStartScript() {
  return `import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createApiServer } from "@webenvoy/api-server";
import {
  createFileAuthorizationDecisionStore,
  createFileExecutionPolicyConfigStore,
  createFileRunRecordStore,
  createHttpHarborIdentityFactsReader,
  createHttpHarborRuntimeClient,
  createLocalLodePackageResolver,
  createLocalTaskTurnInputPolicyResolver
} from "@webenvoy/core-runtime";
import { createFileTaskThreadStore } from "@webenvoy/core-runtime/internal/task-thread-store";

const host = process.env.WEBENVOY_CORE_RUNTIME_HOST ?? "127.0.0.1";
const port = parsePort(process.env.PORT ?? process.env.WEBENVOY_CORE_RUNTIME_PORT, 8787);
const runtimeDataDir = process.env.WEBENVOY_RUNTIME_DATA_DIR ?? join(process.cwd(), "data");
const runRecordDir = process.env.WEBENVOY_RUN_RECORD_DIR ?? join(runtimeDataDir, "core-runs");
mkdirSync(runRecordDir, { recursive: true });
const runRecordStore = createFileRunRecordStore({ directory: runRecordDir });
const executionPolicyConfigStore = createFileExecutionPolicyConfigStore({ directory: join(runtimeDataDir, "core-policies") });
if (await executionPolicyConfigStore.getGlobalConfiguration() === undefined) {
  await executionPolicyConfigStore.putGlobalConfiguration({
    schema_version: "webenvoy.execution-policy-mutation.v0",
    idempotency_key: "packaged-runtime-default-policy-v1",
    expected_source_version: null,
    modes: { read: "auto", prepare: "confirm", commit: "confirm", destructive: "confirm" }
  });
}
const lodeRegistryPath = process.env.WEBENVOY_LODE_REGISTRY_PATH;
const taskThreadStore = createFileTaskThreadStore({
  directory: process.env.WEBENVOY_TASK_THREAD_DIR ?? join(runRecordDir, "threads"),
  runRecordStore,
  ...(lodeRegistryPath ? {
    resolveInputPolicy: createLocalTaskTurnInputPolicyResolver({ registryPath: lodeRegistryPath })
  } : {})
});
const authorizationDecisionStore = createFileAuthorizationDecisionStore({
  directory: join(runtimeDataDir, "core-authorization-decisions"),
  runRecordStore,
  taskThreadStore
});
const harborRuntimeUrl = process.env.WEBENVOY_HARBOR_RUNTIME_URL;

const server = createApiServer({
  runRecordStore,
  authorizationDecisionStore,
  executionPolicyConfigStore,
  taskThreadStore,
  ...(lodeRegistryPath ? {
    lodePackageResolver: createLocalLodePackageResolver({
      registryPath: lodeRegistryPath,
      ...(process.env.WEBENVOY_LODE_ASSETS_PATH ? { rootDir: process.env.WEBENVOY_LODE_ASSETS_PATH } : {})
    })
  } : {}),
  ...(harborRuntimeUrl ? {
    harborIdentityFactsReader: createHttpHarborIdentityFactsReader({ baseUrl: harborRuntimeUrl }),
    harborRuntimeClient: createHttpHarborRuntimeClient({ baseUrl: harborRuntimeUrl })
  } : {})
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ service: "webenvoy-api-server", status: "ready", url: \`http://\${host}:\${port}\`, run_record_store: "configured" }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}

function parsePort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("Runtime port must be 1-65535.");
  return port;
}
`;
}

function harborStartScript() {
  return `import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createFixtureLauncher, HarborRuntime } from "./dist/packages/runtime-api/src/index.js";
import { startHarborRuntimeServer } from "./dist/packages/runtime-api/src/server.js";

const host = process.env.HARBOR_RUNTIME_HOST ?? "127.0.0.1";
const port = parsePort(process.env.HARBOR_RUNTIME_PORT ?? process.env.PORT, 8788);
const runtimeDataDir = process.env.WEBENVOY_RUNTIME_DATA_DIR ?? join(process.cwd(), "data");
const identityStore = process.env.HARBOR_IDENTITY_ENVIRONMENTS_PATH ?? join(runtimeDataDir, "harbor", "identity-environments.json");
mkdirSync(dirname(identityStore), { recursive: true });

const launcher = process.env.HARBOR_RUNTIME_PROVIDER === "fixture" ? createFixtureLauncher("ready") : undefined;
const runtime = new HarborRuntime(launcher, { persistence_path: identityStore });
const running = await startHarborRuntimeServer({
  host,
  port,
  runtime,
  manual_authentication_supervisor_token: process.env.HARBOR_MANUAL_AUTH_SUPERVISOR_TOKEN,
});
console.log(JSON.stringify({ service: "harbor-runtime-api", status: "ready", url: running.url, identity_environment_store: "configured" }));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await running.close();
    process.exit(0);
  });
}

function parsePort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("Runtime port must be 1-65535.");
  return port;
}
`;
}
