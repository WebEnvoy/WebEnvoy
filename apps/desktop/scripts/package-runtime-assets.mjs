import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const outRoot = path.resolve("dist-electron/runtime");
const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspaceRoot = path.resolve(appRoot, "../..");
const coreRoot = workspaceRoot;
const harborRoot = path.join(workspaceRoot, "services", "harbor");
const workspaceSource = readWorkspaceSource();
const requirePackagedRuntime = process.env.WEBENVOY_REQUIRE_PACKAGED_RUNTIME === "1";
const packaged = [];
const missing = [];

await rm(outRoot, { recursive: true, force: true });
await mkdir(outRoot, { recursive: true });

if (
  workspaceSource.commit &&
  workspaceSource.component_trees.core &&
  existsSync(path.join(coreRoot, "packages/api-server/package.json"))
) {
  buildRuntime("Core", "@webenvoy/api-server");
  await packageCoreRuntime(coreRoot, path.join(outRoot, "core"));
  packaged.push({ service: "core", component_path: "packages/api-server" });
} else {
  missing.push("Core runtime source missing from workspace packages/api-server.");
}

if (
  workspaceSource.commit &&
  workspaceSource.component_trees.harbor &&
  existsSync(path.join(harborRoot, "packages/runtime-api/src/runtime-server.ts"))
) {
  buildRuntime("Harbor", "@webenvoy/harbor");
  await packageHarborRuntime(harborRoot, path.join(outRoot, "harbor"));
  packaged.push({ service: "harbor", component_path: "services/harbor" });
} else {
  missing.push("Harbor runtime source missing from workspace services/harbor.");
}

if (!workspaceSource.commit || !workspaceSource.tree) missing.push("Workspace Git commit or tree is unavailable.");

await writeFile(
  path.join(outRoot, "packaging-state.json"),
  `${JSON.stringify(
    {
      schema_version: "webenvoy-app-packaged-runtime-assets/v1",
      status: missing.length === 0 ? "ready" : "blocked",
      workspace: {
        commit: workspaceSource.commit,
        tree: workspaceSource.tree,
        component_paths: {
          core: "packages/api-server",
          harbor: "services/harbor",
        },
        component_trees: workspaceSource.component_trees,
      },
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

function buildRuntime(name, packageName) {
  const result = spawnSync("pnpm", ["--filter", packageName, "build"], {
    cwd: workspaceRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${name} runtime build failed with status ${result.status ?? "unknown"}.`);
  }
}

function readWorkspaceSource() {
  const commit = readGitObject("HEAD");
  return {
    commit,
    tree: commit ? readGitObject(`${commit}^{tree}`) : null,
    component_trees: {
      core: commit ? readGitObject(`${commit}:packages/api-server`) : null,
      harbor: commit ? readGitObject(`${commit}:services/harbor`) : null,
    },
  };
}

function readGitObject(revision) {
  const result = spawnSync("git", ["rev-parse", revision], { cwd: workspaceRoot, encoding: "utf8" });
  const object = result.status === 0 ? result.stdout.trim() : "";
  return /^[0-9a-f]{40}$/.test(object) ? object : null;
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
