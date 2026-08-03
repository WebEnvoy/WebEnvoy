import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { coreLodeAssetEnvironment, resolveLodeAssetBundle, type LodeAssetBundleState } from "./lodeAssetBundle.js";

export type RuntimeServiceId = "core" | "harbor";

export type RuntimeEndpointConfig = {
  coreEndpoint: string;
  harborEndpoint: string;
};

export type RuntimeSupervisorOptions = {
  dataDir?: string;
};

export type RuntimeServiceLaunchConfig = {
  command: string;
  args?: string[];
  cwd?: string;
  source: "env-command" | "env-path" | "packaged-path" | "local-cwd";
};

export type RuntimeProcessState = "not_configured" | "starting" | "running" | "exited" | "failed";
export type RuntimeProbeState = "ready" | "unavailable";

export type RuntimeProbe = {
  state: RuntimeProbeState;
  url: string;
  statusCode?: number;
  summary: string;
  attempts?: Array<{ url: string; statusCode?: number; summary: string }>;
};

type RuntimeProbeAttempt = RuntimeProbe & {
  continueFallback: boolean;
};

export type RuntimeServiceState = {
  id: RuntimeServiceId;
  name: string;
  endpoint: string;
  processState: RuntimeProcessState;
  launchSource: RuntimeServiceLaunchConfig["source"] | "not_configured";
  command?: string;
  cwd?: string;
  pid?: number;
  health: RuntimeProbe;
  admission?: RuntimeProbe;
  checkedAt: string;
  lastExitCode?: number | null;
  lastError?: string;
  lastOutput?: string;
  repairAction: string;
};

export type RuntimeSupervisorState = {
  mode: "real";
  checkedAt: string;
  services: RuntimeServiceState[];
  lodeAssets: LodeAssetBundleState;
  canUseLiveRuntime: boolean;
  failClosed: boolean;
  summary: string;
};

type ProcessSnapshot = {
  processState: RuntimeProcessState;
  child?: ChildProcess;
  endpoint?: string;
  supervisorToken?: string;
  outputRedactor?: RuntimeOutputRedactor;
  errorRedactor?: RuntimeOutputRedactor;
  lastExitCode?: number | null;
  lastError?: string;
  lastOutput?: string;
};

const serviceNames: Record<RuntimeServiceId, string> = {
  core: "Core",
  harbor: "Harbor",
};

const serviceHealthPaths: Record<RuntimeServiceId, string[]> = {
  core: ["/health", "/ready", "/runtime/health"],
  harbor: ["/readiness", "/health", "/ready", "/runtime/health"],
};

const coreAdmissionPaths = ["/admission/health", "/admission/ready", "/tasks/admission/health"];
const runtimeOutputRedactionCarryLength = 1024;

type RuntimeOutputRedactor = {
  write(chunk: string): string;
  flush(): string;
};

export function resolveRuntimeServiceLaunchConfig(
  id: RuntimeServiceId,
  env: NodeJS.ProcessEnv = process.env,
  resourcesPath = getResourcesPath(),
): RuntimeServiceLaunchConfig | null {
  const prefix = `WEBENVOY_${id.toUpperCase()}_RUNTIME`;
  const command = env[`${prefix}_COMMAND`]?.trim();
  if (command) {
    const parsed = parseCommand(command);
    if (parsed) return { ...parsed, cwd: env[`${prefix}_CWD`], source: "env-command" };
  }

  const explicitPath = env[`${prefix}_PATH`]?.trim();
  if (explicitPath) return { command: explicitPath, cwd: env[`${prefix}_CWD`], source: "env-path" };

  const cwd = env[`${prefix}_CWD`]?.trim();
  if (cwd) return { command: "pnpm", args: ["start:runtime"], cwd, source: "local-cwd" };

  if (env.WEBENVOY_DISABLE_PACKAGED_RUNTIME !== "1") {
    const packagedPath = resolvePackagedRuntimePath(id, resourcesPath);
    if (packagedPath) return { command: process.execPath, args: [packagedPath], source: "packaged-path" };
  }

  return null;
}

export function summarizeRuntimeReadiness(services: RuntimeServiceState[], lodeAssets = resolveLodeAssetBundle()) {
  const core = services.find((service) => service.id === "core");
  const harbor = services.find((service) => service.id === "harbor");
  const canUseLiveRuntime =
    core?.health.state === "ready" &&
    core.admission?.state === "ready" &&
    harbor?.health.state === "ready" &&
    lodeAssets.state === "ready";

  return {
    canUseLiveRuntime,
    failClosed: !canUseLiveRuntime,
    summary: canUseLiveRuntime
      ? "本地 Core health/admission、Harbor runtime health 与 Lode capability assets 均可用。"
      : "生产运行已 fail closed：Core health/admission、Harbor runtime health 或 Lode capability assets 尚不可用，fixture/demo 不作为可用结果。",
  };
}

export function createRuntimeSupervisor(options: RuntimeSupervisorOptions = {}) {
  const processSnapshots = new Map<RuntimeServiceId, ProcessSnapshot>();
  const runtimeDataDir = options.dataDir ?? process.env.WEBENVOY_RUNTIME_DATA_DIR;
  const supervisorToken = randomBytes(32).toString("base64url");
  const getHarborSupervisorToken = (harborEndpoint: string) => {
    const snapshot = processSnapshots.get("harbor");
    return snapshot?.endpoint === normalizeEndpoint(harborEndpoint) && snapshot.child
      ? snapshot.supervisorToken
      : undefined;
  };

  return {
    async readState(config: RuntimeEndpointConfig): Promise<RuntimeSupervisorState> {
      const checkedAt = new Date().toISOString();
      const lodeAssets = resolveLodeAssetBundle();
      const services = await Promise.all(
        (["core", "harbor"] as const).map((id) =>
          readServiceState(id, config, checkedAt, processSnapshots, lodeAssets, runtimeDataDir, supervisorToken),
        ),
      );
      const readiness = summarizeRuntimeReadiness(services, lodeAssets);

      return {
        mode: "real",
        checkedAt,
        services,
        lodeAssets,
        ...readiness,
      };
    },
    stop() {
      for (const snapshot of processSnapshots.values()) {
        snapshot.child?.kill();
      }
    },
    getHarborRuntimeSupervisorToken: getHarborSupervisorToken,
    getHarborManualAuthSupervisorToken: getHarborSupervisorToken,
  };
}

async function readServiceState(
  id: RuntimeServiceId,
  config: RuntimeEndpointConfig,
  checkedAt: string,
  processSnapshots: Map<RuntimeServiceId, ProcessSnapshot>,
  lodeAssets: LodeAssetBundleState,
  runtimeDataDir: string | undefined,
  supervisorToken: string,
): Promise<RuntimeServiceState> {
  const endpoint = endpointFor(id, config);
  const launch = resolveRuntimeServiceLaunchConfig(id);
  const snapshot = ensureProcess(
    id,
    launch,
    processSnapshots,
    runtimeProcessEnvironment(id, config, lodeAssets, runtimeDataDir),
    endpoint,
    supervisorToken,
  );
  let health = await probeFirst(endpoint, serviceHealthPaths[id]);
  if (id === "harbor" && process.env.HARBOR_RUNTIME_PROVIDER === "fixture") {
    health = {
      ...health,
      state: "unavailable",
      summary: "Harbor fixture runtime provider is contract-only and cannot be used as live browser evidence.",
    };
  }
  const admission = id === "core" ? await probeFirst(endpoint, coreAdmissionPaths) : undefined;
  const processState = health.state === "ready" && snapshot.processState === "not_configured" ? "running" : snapshot.processState;

  return {
    id,
    name: serviceNames[id],
    endpoint,
    processState,
    launchSource: launch?.source ?? "not_configured",
    command: launch?.command,
    cwd: launch?.cwd,
    pid: snapshot.child?.pid,
    health,
    ...(admission ? { admission } : {}),
    checkedAt,
    lastExitCode: snapshot.lastExitCode,
    lastError: snapshot.lastError,
    lastOutput: snapshot.lastOutput,
    repairAction: repairAction(id, launch, health, admission),
  };
}

function ensureProcess(
  id: RuntimeServiceId,
  launch: RuntimeServiceLaunchConfig | null,
  processSnapshots: Map<RuntimeServiceId, ProcessSnapshot>,
  extraEnv: NodeJS.ProcessEnv = {},
  endpoint?: string,
  supervisorToken?: string,
): ProcessSnapshot {
  const current = processSnapshots.get(id);
  if (current?.child && current.endpoint === endpoint && current.processState !== "exited" && current.processState !== "failed") {
    return current;
  }
  if (current?.child && current.endpoint !== endpoint) {
    current.child.kill();
  }

  if (!launch) {
    const snapshot = current ?? { processState: "not_configured" as const, endpoint };
    snapshot.endpoint = endpoint;
    processSnapshots.set(id, snapshot);
    return snapshot;
  }

  try {
    const child = spawn(launch.command, launch.args ?? [], {
      cwd: launch.cwd,
      env: runtimeSupervisorChildEnvironment(id, launch.source, extraEnv, supervisorToken),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const snapshot: ProcessSnapshot = {
      child,
      endpoint,
      processState: "starting",
      supervisorToken,
      outputRedactor: createRuntimeOutputRedactor(supervisorToken),
      errorRedactor: createRuntimeOutputRedactor(supervisorToken),
    };
    processSnapshots.set(id, snapshot);
    child.on("spawn", () => {
      snapshot.processState = "running";
    });
    child.on("error", (error) => {
      snapshot.processState = "failed";
      snapshot.lastError = error.message;
    });
    child.stdout?.on("data", (chunk) => {
      snapshot.lastOutput = appendRuntimeOutput(snapshot.lastOutput, snapshot.outputRedactor?.write(chunk.toString()) ?? "");
    });
    child.stderr?.on("data", (chunk) => {
      snapshot.lastError = appendRuntimeOutput(snapshot.lastError, snapshot.errorRedactor?.write(chunk.toString()) ?? "");
    });
    child.on("close", (code) => {
      snapshot.lastOutput = appendRuntimeOutput(snapshot.lastOutput, snapshot.outputRedactor?.flush() ?? "");
      snapshot.lastError = appendRuntimeOutput(snapshot.lastError, snapshot.errorRedactor?.flush() ?? "");
      snapshot.processState = code === 0 ? "exited" : "failed";
      snapshot.lastExitCode = code;
      snapshot.child = undefined;
    });
    return snapshot;
  } catch (error) {
    const snapshot: ProcessSnapshot = {
      processState: "failed",
      lastError: error instanceof Error ? error.message : String(error),
    };
    processSnapshots.set(id, snapshot);
    return snapshot;
  }
}

export function runtimeSupervisorChildEnvironment(
  id: RuntimeServiceId,
  launchSource: RuntimeServiceLaunchConfig["source"],
  extraEnv: NodeJS.ProcessEnv,
  supervisorToken: string | undefined,
  parentEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const {
    HARBOR_RUNTIME_SUPERVISOR_TOKEN: _ignoredRuntimeSupervisorToken,
    HARBOR_MANUAL_AUTH_SUPERVISOR_TOKEN: _ignoredManualAuthSupervisorToken,
    ...parentEnv
  } = parentEnvironment;
  return {
    ...parentEnv,
    ...(launchSource === "packaged-path" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    ...extraEnv,
    ...(supervisorToken ? { HARBOR_RUNTIME_SUPERVISOR_TOKEN: supervisorToken } : {}),
    ...(id === "harbor" && supervisorToken ? { HARBOR_MANUAL_AUTH_SUPERVISOR_TOKEN: supervisorToken } : {}),
  };
}

export function createRuntimeOutputRedactor(sensitiveValue?: string): RuntimeOutputRedactor {
  let carry = "";
  const carryLength = Math.max(runtimeOutputRedactionCarryLength, (sensitiveValue?.length ?? 0) + 1);

  const drain = (flush: boolean) => {
    let output = "";
    while (carry.length > (flush ? 0 : carryLength)) {
      if (sensitiveValue && carry.startsWith(sensitiveValue)) {
        output += "[redacted]";
        carry = carry.slice(sensitiveValue.length);
      } else {
        output += carry[0];
        carry = carry.slice(1);
      }
    }
    return output;
  };

  return {
    write(chunk) {
      carry += chunk;
      return drain(false);
    },
    flush() {
      return drain(true);
    },
  };
}

function appendRuntimeOutput(current: string | undefined, next: string): string {
  return trimRuntimeOutput(`${current ?? ""}${next}`);
}

function trimRuntimeOutput(value: string): string {
  const normalized = value.replace(/\s+$/g, "");
  return normalized.length > 1000 ? normalized.slice(-1000) : normalized;
}

function runtimeProcessEnvironment(
  id: RuntimeServiceId,
  config: RuntimeEndpointConfig,
  lodeAssets: LodeAssetBundleState,
  runtimeDataDir: string | undefined,
): NodeJS.ProcessEnv {
  const endpoint = endpointFor(id, config);
  const port = endpointPort(endpoint);
  const baseEnv: NodeJS.ProcessEnv = {
    ...(runtimeDataDir ? { WEBENVOY_RUNTIME_DATA_DIR: runtimeDataDir } : {}),
    ...(port ? { PORT: port } : {}),
  };

  if (id === "harbor") {
    return {
      ...baseEnv,
      ...(port ? { HARBOR_RUNTIME_PORT: port } : {}),
      ...(runtimeDataDir ? { HARBOR_IDENTITY_ENVIRONMENTS_PATH: path.join(runtimeDataDir, "harbor", "identity-environments.json") } : {}),
    };
  }

  return {
    ...baseEnv,
    ...coreLodeAssetEnvironment(lodeAssets),
    WEBENVOY_HARBOR_RUNTIME_URL: endpointFor("harbor", config),
    ...(runtimeDataDir ? { WEBENVOY_RUN_RECORD_DIR: path.join(runtimeDataDir, "core", "run-records") } : {}),
  };
}

async function probeFirst(endpoint: string, paths: string[]): Promise<RuntimeProbe> {
  const attempts: RuntimeProbe["attempts"] = [];

  for (const probePath of paths) {
    const result = await probeEndpoint(endpoint, probePath);
    attempts.push({ url: result.url, statusCode: result.statusCode, summary: result.summary });
    const { continueFallback, ...probe } = result;
    if (result.state === "ready") return { ...probe, attempts };
    if (!continueFallback) return { ...probe, attempts };
  }

  return {
    state: "unavailable",
    url: `${endpoint}${paths[0]}`,
    statusCode: attempts.at(-1)?.statusCode,
    summary: `No ready response from ${paths.join(", ")}. ${attempts.at(-1)?.summary ?? ""}`.trim(),
    attempts,
  };
}

async function probeEndpoint(endpoint: string, probePath: string): Promise<RuntimeProbeAttempt> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  const url = `${endpoint}${probePath}`;

  try {
    const response = await fetch(url, {
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = parseJson(text);
    const fixtureReason = fixturePayloadReason(payload);
    const unavailableReason = explicitUnavailableReason(payload);
    if (!response.ok) {
      return {
        state: "unavailable",
        url,
        statusCode: response.status,
        summary: `${probePath} returned ${response.status}.`,
        continueFallback: response.status === 404,
      };
    }
    if (fixtureReason) {
      return {
        state: "unavailable",
        url,
        statusCode: response.status,
        summary: `${probePath} returned fixture/demo state: ${fixtureReason}.`,
        continueFallback: false,
      };
    }
    if (unavailableReason) {
      return {
        state: "unavailable",
        url,
        statusCode: response.status,
        summary: `${probePath} returned unavailable state: ${unavailableReason}.`,
        continueFallback: false,
      };
    }
    const readyReason = explicitReadyReason(payload);
    if (!readyReason) {
      return {
        state: "unavailable",
        url,
        statusCode: response.status,
        summary: `${probePath} returned ${response.status} without owner readiness facts.`,
        continueFallback: false,
      };
    }
    return { state: "ready", url, statusCode: response.status, summary: `${probePath} returned ${response.status}: ${readyReason}.`, continueFallback: false };
  } catch (error) {
    return {
      state: "unavailable",
      url,
      summary: error instanceof Error ? error.message : String(error),
      continueFallback: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(text: string) {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function fixturePayloadReason(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["source", "mode", "environment", "runtime_mode", "kind", "type"]) {
    const field = value[key];
    if (typeof field === "string" && /\b(demo|fixture)\b/i.test(field)) return `${key}=${field}`;
  }
  for (const key of ["demo", "fixture", "is_demo", "is_fixture"]) {
    if (value[key] === true) return `${key}=true`;
  }
  if (value.live === false) return "live=false";
  return null;
}

function explicitUnavailableReason(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["status", "state", "readiness", "health"]) {
    const field = value[key];
    if (field === false) return `${key}=false`;
    if (typeof field === "string" && /^(blocked|down|error|failed|missing|not[-_ ]?ready|unavailable)$/i.test(field)) {
      return `${key}=${field}`;
    }
  }
  if (value.ready === false || value.healthy === false) {
    return value.ready === false ? "ready=false" : "healthy=false";
  }
  return null;
}

function explicitReadyReason(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const key of ["status", "state", "readiness", "health"]) {
    const field = value[key];
    if (field === true) return `${key}=true`;
    if (typeof field === "string" && /^(ready|ok|healthy|available|up)$/i.test(field)) {
      return `${key}=${field}`;
    }
  }
  if (value.ready === true || value.healthy === true) {
    return value.ready === true ? "ready=true" : "healthy=true";
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function endpointFor(id: RuntimeServiceId, config: RuntimeEndpointConfig) {
  return normalizeEndpoint(id === "core" ? config.coreEndpoint : config.harborEndpoint);
}

function normalizeEndpoint(value: string) {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname === "" ? "" : pathname}`;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function endpointPort(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.port) return parsed.port;
    if (parsed.protocol === "http:") return "80";
    if (parsed.protocol === "https:") return "443";
  } catch {
    return undefined;
  }
  return undefined;
}

function resolvePackagedRuntimePath(id: RuntimeServiceId, resourcesPath: string | undefined) {
  const roots = [
    resourcesPath ? path.join(resourcesPath, "runtime") : null,
    path.join(path.dirname(fileURLToPath(import.meta.url)), "runtime"),
  ].filter((value): value is string => Boolean(value));
  for (const root of roots) {
    const candidate = path.join(root, id, "start-runtime.mjs");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function getResourcesPath() {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

function parseCommand(command: string) {
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((token) => token.replace(/^["']|["']$/g, ""));
  if (!tokens?.length) return null;
  return { command: tokens[0], args: tokens.slice(1) };
}

function repairAction(
  id: RuntimeServiceId,
  launch: RuntimeServiceLaunchConfig | null,
  health: RuntimeProbe,
  admission: RuntimeProbe | undefined,
) {
  if (health.state === "ready" && (admission == null || admission.state === "ready")) {
    return `${serviceNames[id]} runtime is ready.`;
  }

  if (!launch) {
    const prefix = `WEBENVOY_${id.toUpperCase()}_RUNTIME`;
    const packagedState =
      process.env.WEBENVOY_DISABLE_PACKAGED_RUNTIME === "1"
        ? "Packaged runtime launch is disabled for this smoke/test run."
        : `Packaged ${serviceNames[id]} runtime assets are missing from the Electron output.`;
    return `${packagedState} Configure ${prefix}_CWD or ${prefix}_COMMAND, or rebuild App with packaged runtime assets.`;
  }

  if (admission?.state === "unavailable") {
    return "Core health is not enough; expose a local admission readiness endpoint before enabling real tasks.";
  }

  return `Check ${serviceNames[id]} command (${launch.command}) and local readiness endpoint.`;
}
