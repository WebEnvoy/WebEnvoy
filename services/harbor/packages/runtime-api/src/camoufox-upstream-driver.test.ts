import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CAMOUFOX_UPSTREAM_PINS,
  classifyUpstreamPageRequest,
  hasRetiredCamoufoxBinding,
  isOfficialCamoufoxLaunchRequest,
  launchCamoufoxUpstreamProvider,
  readCamoufoxUpstreamSourceFacts
} from "./camoufox-upstream-driver.js";
import { bindIdentityEnvironmentDefaultProvider, detectBrowserProviders } from "./provider-management.js";

const sourceSha = CAMOUFOX_UPSTREAM_PINS.source_sha256;
const pins = {
  HARBOR_CAMOUFOX_SOURCE: CAMOUFOX_UPSTREAM_PINS.source,
  HARBOR_CAMOUFOX_SOURCE_SHA256: sourceSha,
  HARBOR_CAMOUFOX_VERSION: CAMOUFOX_UPSTREAM_PINS.camoufox_version,
  HARBOR_CAMOUFOX_BROWSER_VERSION: CAMOUFOX_UPSTREAM_PINS.browser_version,
  HARBOR_CAMOUFOX_PLAYWRIGHT_VERSION: CAMOUFOX_UPSTREAM_PINS.playwright_version
};

test("admits only the owner-provided official source and fixed pins", () => {
  assert.deepEqual(readCamoufoxUpstreamSourceFacts(pins), {
    source: "official_release",
    source_sha256: sourceSha,
    camoufox_version: "0.5.6",
    browser_version: "152.0.4-beta.30",
    playwright_version: "1.60.0"
  });
  assert.equal(readCamoufoxUpstreamSourceFacts({ ...pins, HARBOR_CAMOUFOX_BROWSER_VERSION: "152.0.4" }), null);
  assert.equal(readCamoufoxUpstreamSourceFacts({ ...pins, HARBOR_CAMOUFOX_SOURCE: "unknown" }), null);
  assert.equal(readCamoufoxUpstreamSourceFacts({ ...pins, HARBOR_CAMOUFOX_SOURCE_SHA256: "a".repeat(64) }), null);
  assert.equal(isOfficialCamoufoxLaunchRequest({ provider_id: "camoufox", browser_path: "/managed/camoufox" }, pins), true);
  assert.equal(isOfficialCamoufoxLaunchRequest({ provider_id: "camoufox", browser_path: "/managed/camoufox" }, { ...pins, HARBOR_CAMOUFOX_SOURCE_SHA256: "bad" }), false);
  assert.equal(hasRetiredCamoufoxBinding({ camoufoxArtifact: { executable: "/old" } }), true);
  assert.equal(hasRetiredCamoufoxBinding({ source: "official_release" }), false);
});

test("rejects an unknown popup relation before request continuation", () => {
  assert.equal(classifyUpstreamPageRequest({ page_ref: null, known_page_refs: ["page:1"], request_origin: "https://example.test", authorized_origins: ["https://example.test"] }), "reject_unknown_page");
  assert.equal(classifyUpstreamPageRequest({ page_ref: "page:1", known_page_refs: ["page:1"], request_origin: "https://other.test", authorized_origins: ["https://example.test"] }), "reject_origin");
  assert.equal(classifyUpstreamPageRequest({ page_ref: "page:1", known_page_refs: ["page:1"], request_origin: "https://example.test", authorized_origins: ["https://example.test"] }), "allow");
});

test("projects only owner-verified Camoufox as launchable", () => {
  const path = "/managed/camoufox";
  const catalog = detectBrowserProviders({
    platform: "darwin",
    arch: "arm64",
    env: { ...pins, HARBOR_CAMOUFOX_PATH: path, HARBOR_CAMOUFOX_INSTALL_ROOT: "/managed" },
    path_exists: candidate => candidate === path,
    is_executable: candidate => candidate === path
  });
  const camoufox = catalog.providers.find(provider => provider.provider_id === "camoufox")!;
  assert.equal(camoufox.install.launchability, "launchable");
  assert.equal(camoufox.install.source, "official_release");
  assert.equal(camoufox.capabilities.find(capability => capability.key === "cdp")?.state, "unsupported");
  const binding = bindIdentityEnvironmentDefaultProvider({
    platform: "darwin",
    arch: "arm64",
    env: { ...pins, HARBOR_CAMOUFOX_PATH: path },
    path_exists: candidate => candidate === path,
    is_executable: candidate => candidate === path,
    requested_provider_id: "camoufox"
  });
  assert.equal(binding.selected_provider_id, "camoufox");
});

test("uses the JSONL public-driver vertical slice without a real browser", async () => {
  const root = mkdtempSync(join(tmpdir(), "harbor-camoufox-upstream-test-"));
  const helper = join(root, "fake-driver.mjs");
  const profileRoot = join(root, "profiles");
  writeFileSync(helper, `import readline from "node:readline";
const pages = [{ provider_page_ref: "page:1", current_url: "https://example.test/start", title: "Example", status: "ready", origin: "https://example.test", active: true, document_generation: 1, facts: [] }];
const page = () => pages[0];
const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  const request = JSON.parse(line);
  let result;
  if (request.op === "launch") result = { status: "ready", driver_ref: "fake-upstream", page: page(), pages, viewer_entry: { availability: "unavailable", access_mode: "none", transport: "not_applicable", input_capabilities: [] }, facts: [] };
  else if (request.op === "page_list") result = pages;
  else if (request.op === "observe") result = page();
  else if (request.op === "observe_identity") result = { current_url: "https://example.test/start", title: "Example", ready_state: "complete", stable_id: null, document_generation: 1 };
  else if (request.op === "interact") result = request.action === "snapshot" ? { status: "completed", dispatch_state: "not_dispatched", page: page(), snapshot: { page_ref: "page:1", observation_ref: "observation:1", controls: [], text: "Example", truncated: false } } : { status: "completed", dispatch_state: "dispatched", page: page() };
  else if (request.op === "read_public_page") result = { status: "completed", page: page(), text: "Example", truncated: false };
  else if (request.op === "environment") result = { status: "completed", observed_at: "2026-09-12T00:00:00.000Z", provider: { camoufox_version: "0.5.6", browser_version: "152.0.4-beta.30", properties_sha256: "${"b".repeat(64)}" }, bundle_hash: "${"c".repeat(64)}", observed: { language: "en-US", languages: ["en-US"], timezone: "UTC", viewport: { width: 800, height: 600 }, screen: { width: 800, height: 600 }, hardware_concurrency: null, device_memory: null, webgl_vendor: null, webgl_renderer: null, fonts_hash: null, voices_hash: null, canvas_hash: null, audio_hash: null }, continuity: { state: "unknown", checked_fields: [], changed_fields: [], unknown_fields: [] } };
  else if (request.op === "close") result = { closed: true };
  else result = pages;
  process.stdout.write(JSON.stringify({ id: request.id, status: "ok", result }) + "\\n");
}`);
  chmodSync(helper, 0o700);
  const previous = { ...process.env };
  Object.assign(process.env, pins, { HARBOR_CAMOUFOX_PYTHON: process.execPath, HARBOR_CAMOUFOX_DRIVER: helper, HARBOR_PROFILE_STORAGE_ROOT: profileRoot });
  try {
    const result = await launchCamoufoxUpstreamProvider({ browser_path: "/managed/camoufox", provider_id: "camoufox", headless: true, timeout_ms: 5_000, url: "https://example.test/start", profile_ref: "profile:test", profile_storage_ref: "storage:test", provider_ref: "provider:test" });
    assert.equal(result.status, "ready");
    if (result.status !== "ready") return;
    assert.equal(result.driver_kind, "playwright_jsonl");
    assert.equal((await result.pageController?.listPages())?.[0]?.provider_page_ref, "page:1");
    assert.equal((await result.observePage?.())?.page.current_url, "https://example.test/start");
    assert.equal((await result.interaction?.({ action: "snapshot", expected_origin: "https://example.test", control_generation: 1 }))?.status, "completed");
    assert.equal((await result.interaction?.({ action: "click", expected_origin: "https://example.test", control_generation: 1, target_ref: "control:1" }))?.dispatch_state, "dispatched");
    assert.equal((await result.publicPage?.({ expected_origin: "https://example.test" }))?.status, "completed");
    assert.equal((await result.readEnvironment?.())?.provider.browser_version, "152.0.4-beta.30");
    await result.close();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    for (const [key, value] of Object.entries(previous)) process.env[key] = value;
    rmSync(root, { recursive: true, force: true });
  }
});
