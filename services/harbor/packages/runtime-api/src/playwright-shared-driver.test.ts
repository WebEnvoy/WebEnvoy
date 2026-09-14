import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CAMOUFOX_UPSTREAM_PINS, launchCamoufoxUpstreamProvider } from "./camoufox-upstream-driver.js";
import type { LocalProviderLaunchInput } from "./runtime-session-types.js";

const DRIVER_DIR = dirname(fileURLToPath(import.meta.url));
const CAMOUFOX_PATH = "/managed/camoufox/camoufox";

const launchCases = [
  {
    id: "camoufox",
    browserPath: CAMOUFOX_PATH,
    launch: launchCamoufoxUpstreamProvider,
    pythonEnv: "HARBOR_CAMOUFOX_PYTHON",
    driverEnv: "HARBOR_CAMOUFOX_DRIVER",
    identity_environment: undefined
  }
] as const;

test("routes the Camoufox adapter through the shared launch factory", async () => {
  const root = await mkdtemp(join(tmpdir(), "harbor-shared-driver-factory-"));
  const helper = join(root, "fixture-driver.mjs");
  await writeFile(helper, `import readline from "node:readline";
const expected = process.env.HARBOR_EXPECTED_DRIVER_PATH;
if (!expected || !process.argv.includes(expected)) process.exit(71);
  const page = { provider_page_ref: "page:1", current_url: "https://example.test/start", title: "Example", status: "ready", origin: "https://example.test", active: true, document_generation: 1, task_selected: true, facts: [] };
const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  const request = JSON.parse(line);
  let result;
  if (request.op === "launch") result = { status: "ready", driver_ref: "fixture-camoufox", page, pages: [page], viewer_entry: { availability: "unsupported", access_mode: "none", transport: "not_applicable", input_capabilities: [] }, facts: [{ key: "fixture.browser_path", source: "observed", value: request.browser_path }, { key: "fixture.environment.proxy_server", source: "observed", value: String(request.environment?.proxy_server ?? "") }, { key: "fixture.environment.viewport", source: "observed", value: JSON.stringify(request.environment?.viewport ?? null) }] };
  else if (request.op === "page_list") result = { pages: [page], rejected_unattributed_count: 0 };
  else if (request.op === "observe") result = page;
  else if (request.op === "observe_identity") result = { current_url: page.current_url, title: page.title, ready_state: "complete", stable_id: null, document_generation: 1 };
  else if (request.op === "interact") result = request.text === "lost" ? { status: "unknown_outcome", dispatch_state: "dispatched", failure_class: "response_lost", page } : { status: "completed", dispatch_state: request.action === "snapshot" ? "not_dispatched" : "dispatched", page, ...(request.action === "snapshot" ? { snapshot: { page_ref: "page:1", observation_ref: "observation:1", controls: [], text: "Example", truncated: false } } : {}) };
  else if (request.op === "file_operation") result = { status: "completed", dispatch_state: "dispatched", operation: request.operation, page, browser_delivery: "completed", page_receipt: "observed", page_processing: "observed", business_commit: "not_observed", ...(request.operation === "download" ? { download: { page_url: page.current_url, url: "https://example.test/export.csv", suggested_filename: "export.csv", byte_length: 4, sha256: "${"d".repeat(64)}", staging_path: request.staging_path } } : {}) };
  else if (request.op === "diagnostics") result = { status: "completed", page_ref: "page:1", document_generation: 1, page, cursor: "cursor:0", next_cursor: "cursor:1", truncated: false, observed_at: "2026-09-09T18:00:00.000Z", network: [], console: [] };
  else if (request.op === "read_public_page") result = { status: "completed", page, text: "Example", truncated: false };
  else if (request.op === "environment") result = { status: "completed", observed_at: "2026-09-09T18:00:00.000Z", provider: { camoufox_version: "0.5.6", browser_version: "152.0.4-beta.30", properties_sha256: "${"a".repeat(64)}" }, bundle_hash: "${"b".repeat(64)}", observed: { language: "zh-CN", languages: ["zh-CN"], timezone: "Asia/Shanghai", viewport: { width: 1280, height: 900 }, screen: { width: 1920, height: 1080 }, hardware_concurrency: 8, device_memory: null, webgl_vendor: null, webgl_renderer: null, fonts_hash: null, voices_hash: null, canvas_hash: null, audio_hash: null }, continuity: { state: "unknown", checked_fields: [], changed_fields: [], unknown_fields: [] } };
  else if (request.op === "close") result = { closed: true };
  else result = page;
  process.stdout.write(JSON.stringify({ id: request.id, status: "ok", result }) + "\\n");
  }`);
  await chmod(helper, 0o700);
  const previous = { ...process.env };
  try {
    process.env.HARBOR_PROFILE_STORAGE_ROOT = join(root, "profiles");
    for (const provider of launchCases) {
      Object.assign(process.env, {
        HARBOR_CAMOUFOX_SOURCE: CAMOUFOX_UPSTREAM_PINS.source,
        HARBOR_CAMOUFOX_SOURCE_SHA256: CAMOUFOX_UPSTREAM_PINS.source_sha256,
        HARBOR_CAMOUFOX_VERSION: CAMOUFOX_UPSTREAM_PINS.camoufox_version,
        HARBOR_CAMOUFOX_BROWSER_VERSION: CAMOUFOX_UPSTREAM_PINS.browser_version,
        HARBOR_CAMOUFOX_PLAYWRIGHT_VERSION: CAMOUFOX_UPSTREAM_PINS.playwright_version
      });
      process.env.HARBOR_EXPECTED_DRIVER_PATH = helper;
      process.env[provider.pythonEnv] = process.execPath;
      if (provider.driverEnv) process.env[provider.driverEnv] = helper;
      const input: LocalProviderLaunchInput = {
        operation_scope: "profile_management",
        browser_path: provider.browserPath,
        provider_id: provider.id,
        identity_environment: provider.identity_environment,
        headless: true,
        timeout_ms: 5_000,
        url: "https://example.test/start",
        profile_ref: `profile:${provider.id}`,
        profile_storage_ref: `storage:${provider.id}`,
        provider_ref: `provider:${provider.id}`,
      } as LocalProviderLaunchInput;
      const result = await provider.launch(input);
      assert.equal(result.status, "ready", `${provider.id} did not launch: ${JSON.stringify(result)}`);
      if (result.status !== "ready") continue;
      assert.equal(result.driver_kind, "playwright_jsonl");
      assert.equal(result.page.current_url, "https://example.test/start");
      assert.equal(result.facts.some(fact => fact.key.startsWith("provider.camoufox.")), true);
      assert.equal(result.facts.some(fact => fact.key === "fixture.environment.proxy_server" && fact.value === ""), true);
      assert.equal(result.facts.some(fact => fact.key === "fixture.environment.viewport" && fact.value === "null"), true);
      const environment = await result.readEnvironment?.();
      assert.ok(environment, `${provider.id} environment read was rejected`);
      assert.equal(environment?.observed.timezone, "Asia/Shanghai");
      assert.equal(environment?.observed.viewport?.width, 1280);
      assert.equal("provider_id" in environment!.provider, false);
      assert.equal((await result.pageController!.listPages())[0]?.provider_page_ref, "page:1");
      assert.equal((await result.interaction!({ action: "snapshot", expected_origin: "https://example.test", control_generation: 1, provider_page_ref: "page:1" })).status, "completed");
      assert.deepEqual(await result.interaction!({ action: "input", expected_origin: "https://example.test", control_generation: 1, provider_page_ref: "missing", text: "never dispatched" }), { status: "unavailable", dispatch_state: "not_dispatched", failure_class: "page_relation_unavailable" });
      assert.equal((await result.interaction!({ action: "input", expected_origin: "https://example.test", control_generation: 1, provider_page_ref: "page:1", text: "lost" })).status, "unknown_outcome");
      assert.equal((await result.executeFileOperation!({ operation: "upload", provider_page_ref: "page:1", expected_origin: "https://example.test", authorized_origins: ["https://example.test"], target_ref: "target:file", source_path: "/managed/input.png" })).status, "completed");
      assert.equal((await result.executeFileOperation!({ operation: "download", provider_page_ref: "page:1", expected_origin: "https://example.test", authorized_origins: ["https://example.test"], target_ref: "target:download", staging_path: "/managed/output.csv" })).status, "completed");
      assert.equal((await result.readDiagnostics!({ origin: "https://example.test", provider_page_ref: "page:1" })).status, "completed");
      await result.close();
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    for (const [key, value] of Object.entries(previous)) process.env[key] = value;
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps Camoufox qualification fail-closed", async () => {
  const previous = { ...process.env };
  try {
    process.env.HARBOR_CAMOUFOX_SOURCE = "official_release";
    process.env.HARBOR_CAMOUFOX_SOURCE_SHA256 = "bad";
    process.env.HARBOR_CAMOUFOX_VERSION = CAMOUFOX_UPSTREAM_PINS.camoufox_version;
    process.env.HARBOR_CAMOUFOX_BROWSER_VERSION = CAMOUFOX_UPSTREAM_PINS.browser_version;
    process.env.HARBOR_CAMOUFOX_PLAYWRIGHT_VERSION = CAMOUFOX_UPSTREAM_PINS.playwright_version;
    const result = await launchCamoufoxUpstreamProvider({
      operation_scope: "profile_management",
      browser_path: CAMOUFOX_PATH,
      provider_id: "camoufox",
      headless: true,
      timeout_ms: 50,
      url: "https://example.test/start",
      profile_ref: "profile:camoufox-rejected",
      provider_ref: "provider:camoufox-rejected"
    });
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") assert.equal(result.error.code, "unsupported");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    for (const [key, value] of Object.entries(previous)) process.env[key] = value;
  }
});

test("packages the shared driver and the thin Camoufox adapter", async () => {
  for (const name of ["playwright_shared_driver.py", "camoufox-upstream-driver.py"]) {
    const contents = await readFile(join(DRIVER_DIR, name), "utf8");
    assert.ok(contents.length > 100, `${name} is missing from the installed asset set`);
  }
  const shared = await readFile(join(DRIVER_DIR, "playwright_shared_driver.py"), "utf8");
  assert.doesNotMatch(shared, /camoufox|CAMOU|PROPERTIES|CAMOUFOX_VERSION_PIN/i);
});
