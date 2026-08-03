import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type JsonObject = Record<string, unknown>;
export type JsonResponse = { status: number; body: unknown };
export type SpawnedProcess = { child: ChildProcess; output: () => string };

const apiServerEntry = join(dirname(fileURLToPath(import.meta.url)), "index.js");

export function asRecord(value: unknown): JsonObject {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as JsonObject;
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body)}\n`);
}

export async function readRequestJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length === 0 ? {} : asRecord(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

export async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await closeServer(server);
  return port;
}

export async function getJson(port: number, path: string): Promise<JsonResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.json() };
}

export async function postJson(port: number, path: string, body: unknown): Promise<JsonResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

export async function waitForJson(port: number, path: string, child: ChildProcess): Promise<JsonResponse> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 5_000) {
    if (child.exitCode !== null) throw new Error(`Child process exited before ${path} became available.`);
    try {
      return await getJson(port, path);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for ${path}: ${lastError instanceof Error ? lastError.message : "unknown error"}`);
}

export async function listen(server: Server, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  return address.port;
}

export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

export async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function spawnNode(entry: string, env: Record<string, string | undefined>): SpawnedProcess {
  const childEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  const child = spawn(process.execPath, [entry], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return { child, output: () => `Child stdout:\n${stdout}\nChild stderr:\n${stderr}` };
}

export function spawnApiServer(
  port: number,
  runRecordDir: string,
  env: Record<string, string | undefined> = {}
): SpawnedProcess {
  return spawnNode(apiServerEntry, { ...env, PORT: String(port), WEBENVOY_RUN_RECORD_DIR: runRecordDir });
}
