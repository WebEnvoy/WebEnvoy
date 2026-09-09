import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { HarborRuntime, createFixtureLauncher, type LocalProviderLauncher } from "./index.js";
import { boundedEnvironmentUpdate, normalizeEnvironmentObservation, trustEnvironmentProbe } from "./profile-environment.js";
import { startHarborRuntimeServer } from "./server.js";

const root = mkdtempSync(join(tmpdir(), "harbor-environment-test-"));
process.env.HARBOR_PROFILE_STORAGE_ROOT = join(root, "profiles");
after(() => rmSync(root, { recursive: true, force: true }));
const hash = "a".repeat(64);
test("private environment bundle and launch failure/replay follow the versioned contract", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixture = [join(here, "camoufox-environment.fixture.py"), join(here, "../../../../packages/runtime-api/src/camoufox-environment.fixture.py")].find(existsSync);
  assert.ok(fixture);
  assert.match(execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? process.env.PYTHON ?? "python3", ["-B", fixture], { encoding: "utf8" }), /camoufox real launch boundary fixture passed/);
});
function observation(timezone = "Asia/Shanghai") {
  return normalizeEnvironmentObservation({ status: "completed", observed_at: "2026-09-09T18:00:00.000Z",
    provider: { camoufox_version: "0.5.6", browser_version: "152.0.4-beta.30", properties_sha256: hash }, bundle_hash: hash,
    observed: { timezone, language: "zh-CN", languages: ["zh-CN"], viewport: { width: 1280, height: 900 }, screen: { width: 1920, height: 1080 }, hardware_concurrency: 8 },
    continuity: { state: "match", checked_fields: ["screen", "hardware_concurrency"], changed_fields: [], unknown_fields: ["audio_hash"] }
  });
}

test("bounds environment updates and observations without claiming unknown fields", () => {
  assert.equal(boundedEnvironmentUpdate({ provider_id: "chrome_official" }), null);
  assert.equal(boundedEnvironmentUpdate({ timezone: "" }), null);
  assert.equal(boundedEnvironmentUpdate({ timezone: "x\n" }), null);
  assert.equal(boundedEnvironmentUpdate({}), null);
  assert.deepEqual(boundedEnvironmentUpdate({ timezone: "UTC" }), { timezone: "UTC" });
  assert.equal(normalizeEnvironmentObservation({}), null);
  const facts = observation();
  assert.ok(facts);
  assert.equal(facts.observed.device_memory, null);
  assert.equal(facts.observed.audio_hash, null);
  assert.equal(facts.continuity.state, "match");
});

test("requires Core supervisor authorization before environment lookup or mutation", async () => {
  const token = Buffer.alloc(32, 7).toString("base64url");
  const server = await startHarborRuntimeServer({ port: 0, runtime: new HarborRuntime(createFixtureLauncher("ready")), manual_authentication_supervisor_token: token });
  try {
    const url = server.url + "/runtime/identity-environments/identity-env_missing/environment";
    for (const method of ["GET", "POST"]) {
      assert.equal((await fetch(url, { method })).status, 403);
      const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ idempotency_key: "missing-environment", configuration: { timezone: "UTC" } }) } : {}) });
      assert.equal(response.status, 200);
      const result = await response.json() as { status: string; failure_class: string };
      assert.equal(result.status, "unavailable");
      assert.equal(result.failure_class, "identity_environment_missing");
    }
  } finally { await server.close(); }
});

test("keeps active effective facts until explicit same-Profile restart and preserves invalid-update state", async () => {
  const base = createFixtureLauncher("ready");
  let launches = 0;
  const launcher: LocalProviderLauncher = async input => {
    launches += 1;
    const result = await base(input);
    if (result.status !== "ready") return result;
    const timezone = input.identity_environment?.environment.timezone ?? "Asia/Shanghai";
    return { ...result, execution_surface: "local_provider", readEnvironment: trustEnvironmentProbe(async () => observation(timezone)) };
  };
  const runtime = new HarborRuntime(launcher, { persistence_path: join(root, "environments.json") });
  const browser = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const record = runtime.createLocalIdentityEnvironment({
    platform: "darwin", arch: "arm64", home_dir: "/Users/test", env: {},
    path_exists: path => path === browser, is_executable: path => path === browser, read_text: () => null,
    identity_environment_ref: "identity-env_environment-test", profile_ref: "profile_environment-test",
    site: { site_id: "generic", origin: "https://example.com", display_name: "Fixture only" },
    requested_provider_id: "chrome_official", language: "zh-CN", timezone: "Asia/Shanghai", storage_state: "present"
  });
  const ref = record.identity_environment_ref;
  const start = () => runtime.openManagedIdentityEnvironmentSession({ identity_environment_ref: ref, operation_scope: "profile_management", url: "https://example.com", control_owner: "agent", holder_ref: "fixture-agent", headless: true });
  const first = await start();
  assert.ok(!("status" in first), JSON.stringify(first));
  if ("status" in first) return;
  const initial = await runtime.readProfileEnvironment(ref);
  assert.equal(initial.status, "completed");
  if (initial.status !== "completed") return;
  assert.equal(initial.configured.timezone, "Asia/Shanghai");
  assert.equal(initial.effective?.timezone, "Asia/Shanghai");
  assert.equal(initial.pending, null);
  assert.equal(initial.drift.state, "match");
  assert.ok(initial.drift.unknown_fields.includes("network_exit"));
  const updated = await runtime.updateProfileEnvironment(ref, { idempotency_key: "environment-update-1", configuration: { timezone: "UTC" } });
  assert.equal(updated.status, "completed", JSON.stringify(updated));
  if (updated.status !== "completed") return;
  assert.equal(updated.configured.timezone, "UTC");
  assert.equal(updated.effective?.timezone, "Asia/Shanghai");
  assert.equal(updated.pending?.timezone, "UTC");
  assert.equal(updated.observed?.timezone, "Asia/Shanghai");
  assert.equal(launches, 1);
  const invalid = await runtime.updateProfileEnvironment(ref, { idempotency_key: "environment-invalid", configuration: { timezone: "Not/AZone" } });
  assert.equal(invalid.status, "unavailable");
  const changedKey = await runtime.updateProfileEnvironment(ref, { idempotency_key: "environment-update-1", configuration: { timezone: "Asia/Tokyo" } });
  assert.equal(changedKey.status, "unavailable");
  const repeat = await runtime.updateProfileEnvironment(ref, { idempotency_key: "environment-update-1", configuration: { timezone: "UTC" } });
  assert.equal(repeat.status, "completed");
  await runtime.closeSession(first.runtime_session_ref);
  const stopped = await runtime.readProfileEnvironment(ref);
  assert.ok(stopped.status === "completed" && stopped.effective === null && stopped.observation_status === "inactive");
  const second = await start();
  assert.ok(!("status" in second), JSON.stringify(second));
  if ("status" in second) return;
  const restarted = await runtime.readProfileEnvironment(ref);
  assert.ok(restarted.status === "completed");
  if (restarted.status !== "completed") return;
  assert.equal(restarted.profile_ref, initial.profile_ref);
  assert.notEqual(second.runtime_session_ref, first.runtime_session_ref);
  assert.equal(restarted.effective?.timezone, "UTC");
  assert.equal(restarted.observed?.timezone, "UTC");
  assert.equal(restarted.pending, null);
  assert.equal(restarted.drift.state, "match");
  assert.equal(restarted.bundle_hash, initial.bundle_hash);
  assert.equal(launches, 2);
  await runtime.closeSession(second.runtime_session_ref);
});
