import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFixtureLauncher, HarborRuntime } from "./index.js";
import {
  ProviderLifecycleIdempotencyCapacityError,
  ProviderLifecycleIdempotencyConflict,
  ProviderLifecycleIdempotencyStore
} from "./provider-lifecycle-idempotency.js";
import { startHarborRuntimeServer } from "./server.js";

const version = "146.0.7680.177.5";

test("provider mutation HTTP enforces JSON, body limits, and idempotency", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "harbor-provider-http-"));
  const token = Buffer.alloc(32, 9).toString("base64url");
  const runtime = new HarborRuntime(createFixtureLauncher("ready"), {}, {
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: async (input) => {
      input.on_progress({ phase: "downloading", downloaded_bytes: 1, total_bytes: 2 });
      await new Promise<never>((_resolve, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
      throw new Error("unreachable");
    },
    verify_launch: async (_path, expected) => ({ browser_version: expected })
  });
  const server = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: token });
  const operations = `${server.url}/runtime/browser-providers/cloakbrowser/lifecycle/operations`;
  try {
    assert.equal((await mutate(operations, token, "missing-key", JSON.stringify({ operation: "install", version }), undefined)).status, 400);
    assert.equal((await mutate(operations, token, "wrong-media", "{}", "media-key", "text/plain")).status, 415);
    assert.equal((await mutate(operations, token, "malformed", "{", "malformed-key")).status, 400);
    assert.equal((await mutate(operations, token, "oversized", JSON.stringify({ padding: "x".repeat(17_000) }), "large-key")).status, 413);

    const body = JSON.stringify({ operation: "install", version });
    const first = await mutate(operations, token, "first", body, "install-key");
    const replay = await mutate(operations, token, "replay", body, "install-key");
    assert.equal(first.status, 202);
    assert.equal(replay.status, 202);
    assert.equal(first.body.lifecycle.operation.operation_id, replay.body.lifecycle.operation.operation_id);

    const conflict = await mutate(operations, token, "conflict", JSON.stringify({ operation: "install", version: "146.0.7680.178.1" }), "install-key");
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, "idempotency_conflict");

    const cancelUrl = `${server.url}/runtime/browser-providers/cloakbrowser/lifecycle/cancel`;
    const cancelled = await mutate(cancelUrl, token, "cancel", "{}", "cancel-key");
    const cancelReplay = await mutate(cancelUrl, token, "cancel replay", "{}", "cancel-key");
    assert.equal(cancelled.status, 202);
    assert.equal(cancelReplay.status, 202);
    assert.equal(cancelled.body.lifecycle.operation.operation_id, cancelReplay.body.lifecycle.operation.operation_id);
  } finally {
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("provider idempotency receipts have bounded TTL and capacity", async () => {
  let now = 0;
  let calls = 0;
  const store = new ProviderLifecycleIdempotencyStore({ ttl_ms: 100, capacity: 1, now: () => now });
  const operation = async () => ++calls;
  assert.equal(await store.execute("key-a", "request-a", operation), 1);
  assert.equal(await store.execute("key-a", "request-a", operation), 1);
  assert.throws(() => store.execute("key-a", "request-b", operation), ProviderLifecycleIdempotencyConflict);
  assert.throws(() => store.execute("key-b", "request-b", operation), ProviderLifecycleIdempotencyCapacityError);
  assert.equal(await store.execute("key-a", "request-a", operation), 1);
  assert.equal(calls, 1);
  now = 101;
  assert.equal(await store.execute("key-a", "request-b", operation), 2);
  assert.throws(() => store.execute("key-b", "request-b", operation), ProviderLifecycleIdempotencyCapacityError);
  now = 202;
  assert.equal(await store.execute("key-b", "request-b", operation), 3);
  assert.throws(() => store.execute("key-a", "request-c", operation), ProviderLifecycleIdempotencyCapacityError);
});

test("provider idempotency capacity returns bounded 503 while the original key remains replayable", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "harbor-provider-http-capacity-"));
  const token = Buffer.alloc(32, 5).toString("base64url");
  const runtime = new HarborRuntime(createFixtureLauncher("ready"), {}, { cache_dir: cacheDir, env: {}, platform: "linux", arch: "x64" });
  const server = await startHarborRuntimeServer({
    port: 0,
    runtime,
    manual_authentication_supervisor_token: token,
    provider_lifecycle_idempotency: { capacity: 1, ttl_ms: 1_000 }
  });
  const recheck = `${server.url}/runtime/browser-providers/cloakbrowser/lifecycle/recheck`;
  try {
    const first = await mutate(recheck, token, "A", "{}", "key-a");
    const full = await mutate(recheck, token, "B", "{}", "key-b");
    const replay = await mutate(recheck, token, "A replay", "{}", "key-a");
    assert.equal(first.status, 200);
    assert.equal(full.status, 503);
    assert.equal(full.body.error, "idempotency_capacity_exceeded");
    assert.equal(full.body.retryable, true);
    assert.ok(full.body.retry_after_ms >= 1 && full.body.retry_after_ms <= 1_000);
    assert.deepEqual(replay.body, first.body);
  } finally {
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("provider cancel and recheck require an Idempotency-Key and JSON object", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "harbor-provider-http-empty-"));
  const token = Buffer.alloc(32, 4).toString("base64url");
  const runtime = new HarborRuntime(createFixtureLauncher("ready"), {}, { cache_dir: cacheDir, env: {}, platform: "linux", arch: "x64" });
  const server = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: token });
  try {
    const recheck = `${server.url}/runtime/browser-providers/cloakbrowser/lifecycle/recheck`;
    assert.equal((await mutate(recheck, token, "no key", "{}", undefined)).status, 400);
    assert.equal((await mutate(recheck, token, "no json", "", "recheck-key", null)).status, 415);
    assert.equal((await mutate(recheck, token, "not empty", "{\"unexpected\":true}", "recheck-key-2")).status, 400);
    assert.equal((await mutate(recheck, token, "valid", "{}", "recheck-key-3")).status, 200);
  } finally {
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

async function mutate(
  url: string,
  token: string,
  _label: string,
  body: string,
  key?: string,
  contentType: string | null = "application/json"
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (key) headers["idempotency-key"] = key;
  if (contentType) headers["content-type"] = contentType;
  const response = await fetch(url, { method: "POST", headers, body });
  return { status: response.status, body: await response.json() };
}
