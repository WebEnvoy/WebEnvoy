import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CAMOUFOX_UPSTREAM_PINS,
  classifyUpstreamPageRequest,
  hasRetiredCamoufoxBinding,
  inheritUpstreamPopupAuthorizedOrigins,
  isOfficialCamoufoxLaunchRequest,
  launchCamoufoxUpstreamProvider,
  normalizeUpstreamViewerEntry,
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
  assert.equal(CAMOUFOX_UPSTREAM_PINS.source_sha256, "3b43e766574f286a6a63296cf58b660b7a3120952086c869b4df4c9a71604bc3");
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

test("accepts only public viewer values at the JSONL boundary", () => {
  assert.deepEqual(normalizeUpstreamViewerEntry({
    availability: "available",
    access_mode: "interactive",
    transport: "local_window",
    input_capabilities: ["keyboard_mouse"]
  }), {
    availability: "available",
    access_mode: "interactive",
    transport: "local_window",
    input_capabilities: ["keyboard_mouse"]
  });
  assert.deepEqual(normalizeUpstreamViewerEntry(undefined), {
    availability: "unsupported",
    access_mode: "none",
    transport: "not_applicable",
    input_capabilities: [],
    unavailable_reason: "unsupported"
  });
  assert.throws(() => normalizeUpstreamViewerEntry({
    availability: "available",
    access_mode: "native_window",
    transport: "native",
    input_capabilities: ["mouse", "keyboard"]
  }), /public viewer entry/);
});

test("rejects an unknown popup relation before request continuation", () => {
  assert.equal(classifyUpstreamPageRequest({ page_ref: null, known_page_refs: ["page:1"], request_origin: "https://example.test", authorized_origins: ["https://example.test"] }), "reject_unknown_page");
  assert.equal(classifyUpstreamPageRequest({ page_ref: "page:1", known_page_refs: ["page:1"], request_origin: "https://other.test", authorized_origins: ["https://example.test"] }), "reject_origin");
  assert.equal(classifyUpstreamPageRequest({ page_ref: "page:1", known_page_refs: ["page:1"], request_origin: "https://example.test", authorized_origins: ["https://example.test"] }), "allow");
});

test("inherits popup origins only from a confirmed opener Page", () => {
  const pages = [
    { provider_page_ref: "page:1", authorized_origins: ["https://example.test", "https://example.test", "file:///tmp/private"] },
    { provider_page_ref: "page:2", authorized_origins: ["https://other.test"] }
  ];
  assert.deepEqual(inheritUpstreamPopupAuthorizedOrigins({ opener_page_ref: "page:1", pages }), ["https://example.test"]);
  assert.deepEqual(inheritUpstreamPopupAuthorizedOrigins({ opener_page_ref: "page:missing", pages }), []);
  assert.deepEqual(inheritUpstreamPopupAuthorizedOrigins({ opener_page_ref: null, pages }), []);
});

test("packages the Python validator under the importable upstream-driver name", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import importlib.util, os, sys, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox")
camoufox.__path__ = []
utils = types.ModuleType("camoufox.utils")
utils.launch_options = lambda **kwargs: {}
camoufox.utils = utils
sys.modules["camoufox"] = camoufox
sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright")
playwright.__path__ = []
sync_api = types.ModuleType("playwright.sync_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
sync_api.Error = Error
sync_api.Page = Page
sync_api.Route = Route
sync_api.TimeoutError = TimeoutError
sync_api.sync_playwright = lambda: None
playwright.sync_api = sync_api
sys.modules["playwright"] = playwright
sys.modules["playwright.sync_api"] = sync_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.SOURCE_SHA256_PIN == "${CAMOUFOX_UPSTREAM_PINS.source_sha256}"
seen = []
def fake_launch_options(**kwargs):
    seen.append(kwargs)
    return {"args": [], "env": {"CAMOU_CONFIG_1": __import__("json").dumps(kwargs["config"], separators=(",", ":"))}, "executable_path": "/managed/camoufox", "firefox_user_prefs": {}, "headless": bool(kwargs["headless"])}
module.launch_options = fake_launch_options
profile = __import__("tempfile").mkdtemp(prefix="harbor-camoufox-options-")
try:
    options, bundle, replay, context_options = module.options_for({"headless": False, "source": {"source": "official_release", "source_sha256": module.SOURCE_SHA256_PIN, "camoufox_version": module.CAMOUFOX_VERSION_PIN, "browser_version": module.BROWSER_VERSION_PIN, "playwright_version": module.PLAYWRIGHT_VERSION_PIN}, "environment": {"timezone": "UTC"}}, profile)
    assert replay is False
    assert seen[0]["config"]["timezone"] == "UTC"
    assert context_options == {"timezone_id": "UTC"}
    assert bundle["context_options"] == {"timezone_id": "UTC"}
    assert options["env"]["CAMOU_CONFIG_1"] == '{"timezone":"UTC"}'
    immutable = {key: bundle[key] for key in ("launch_options", "config", "config_sha256", "identity_hash")}
    updated_options, updated_bundle, updated_replay, updated_context_options = module.options_for({"headless": False, "source": {"source": "official_release", "source_sha256": module.SOURCE_SHA256_PIN, "camoufox_version": module.CAMOUFOX_VERSION_PIN, "browser_version": module.BROWSER_VERSION_PIN, "playwright_version": module.PLAYWRIGHT_VERSION_PIN}, "environment": {"timezone": "Europe/Paris"}}, profile)
    assert updated_replay is True
    assert updated_context_options == {"timezone_id": "Europe/Paris"}
    assert updated_bundle["context_options"] == {"timezone_id": "Europe/Paris"}
    assert updated_bundle["launch_options"] == immutable["launch_options"]
    assert updated_bundle["config"] == immutable["config"]
    assert updated_bundle["config_sha256"] == immutable["config_sha256"]
    assert updated_bundle["identity_hash"] == immutable["identity_hash"]
    assert updated_options == options
    bundle_mtime = os.stat(module.bundle_path(profile)).st_mtime_ns
    _, same_bundle, same_replay, _ = module.options_for({"headless": False, "source": {"source": "official_release", "source_sha256": module.SOURCE_SHA256_PIN, "camoufox_version": module.CAMOUFOX_VERSION_PIN, "browser_version": module.BROWSER_VERSION_PIN, "playwright_version": module.PLAYWRIGHT_VERSION_PIN}, "environment": {"timezone": "Europe/Paris"}}, profile)
    assert same_replay is True
    assert same_bundle["context_options"] == {"timezone_id": "Europe/Paris"}
    assert os.stat(module.bundle_path(profile)).st_mtime_ns == bundle_mtime
    try:
        module.options_for({"headless": False, "source": {"source": "official_release", "source_sha256": module.SOURCE_SHA256_PIN, "camoufox_version": module.CAMOUFOX_VERSION_PIN, "browser_version": module.BROWSER_VERSION_PIN, "playwright_version": module.PLAYWRIGHT_VERSION_PIN}, "environment": {"timezone": "Not/AZone"}}, profile)
        raise AssertionError("invalid timezone was accepted")
    except ValueError:
        pass
    assert module.load_bundle(profile)["context_options"] == {"timezone_id": "Europe/Paris"}
    assert module.viewer_entry(False) == {"availability": "available", "access_mode": "interactive", "transport": "local_window", "input_capabilities": ["keyboard_mouse"]}
    assert module.viewer_entry(True)["availability"] == "unsupported"
finally:
    __import__("shutil").rmtree(profile)
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("checks every redirect hop before issuing the next fetch", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import importlib.util, os, sys, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox")
camoufox.__path__ = []
utils = types.ModuleType("camoufox.utils")
utils.launch_options = lambda **kwargs: {}
camoufox.utils = utils
sys.modules["camoufox"] = camoufox
sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright")
playwright.__path__ = []
sync_api = types.ModuleType("playwright.sync_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
sync_api.Error = Error
sync_api.Page = Page
sync_api.Route = Route
sync_api.TimeoutError = TimeoutError
sync_api.sync_playwright = lambda: None
playwright.sync_api = sync_api
sys.modules["playwright"] = playwright
sys.modules["playwright.sync_api"] = sync_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FakePage:
    url = "https://s1.test/"
    main_frame = object()
    mouse = types.SimpleNamespace(wheel=lambda *args: None)
    def on(self, *args): pass
    def is_closed(self): return False
    def title(self): return "Fixture"
    def get_by_role(self, *args, **kwargs): return FakeLocator()
    def goto(self, url, **kwargs): self.url = url
    def reload(self): pass
    def go_back(self): pass
    def go_forward(self): pass

class FakeLocator:
    def click(self, **kwargs): pass
    def fill(self, text, **kwargs): pass
    def press(self, key, **kwargs): pass

class FakeRequest:
    def __init__(self, page, url):
        self.frame = types.SimpleNamespace(page=page)
        self.url = url
        self.method = "GET"
        self.post_data = None

class FakeResponse:
    def __init__(self, url, status, location=None):
        self.url = url
        self.status = status
        self.headers = {} if location is None else {"location": location}
        self.disposed = False
    def dispose(self):
        self.disposed = True

class FakeRoute:
    def __init__(self, request, responses):
        self.request = request
        self.responses = responses
        self.fetches = []
        self.fulfilled = None
        self.aborted = None
    def fetch(self, **kwargs):
        self.fetches.append(kwargs)
        url = kwargs.get("url", self.request.url)
        return self.responses[url]
    def fulfill(self, response=None, **kwargs):
        self.fulfilled = response
    def abort(self, reason):
        self.aborted = reason

page = FakePage()
driver = object.__new__(module.Driver)
driver.request = {"timeout_ms": 100}
state = module.PageState("page:1", page, ["https://s1.test"])
driver.pages = {"page:1": state}
driver.next_ref = 2
driver.current = "page:1"
driver.unattributed_rejection_count = 0
initial = "https://s1.test/redirect/s2"
same_origin = "https://s1.test/from-s1/s3"
route = FakeRoute(FakeRequest(page, initial), {
    initial: FakeResponse(initial, 302, "/from-s1/s3"),
    same_origin: FakeResponse(same_origin, 302, "https://s3.test/final"),
})
driver.route(route)
assert route.aborted == "blockedbyclient"
assert route.fulfilled is None
assert [item.get("url", initial) for item in route.fetches] == [initial, same_origin]
assert all("s3.test" not in item.get("url", "") for item in route.fetches)

allowed_final = "https://s1.test/final"
allowed = FakeRoute(FakeRequest(page, initial), {
    initial: FakeResponse(initial, 302, "/final"),
    allowed_final: FakeResponse(allowed_final, 200),
})
driver.route(allowed)
assert allowed.aborted is None
assert allowed.fulfilled.status == 200

popup = FakePage()
popup.url = "https://popup.test/"
popup.opener = page
unknown = FakeRoute(FakeRequest(popup, "https://popup.test/popup?token=private"), {})
driver.route(unknown)
assert unknown.aborted == "blockedbyclient"
assert unknown.fetches == []
popup_state = next(item for item in driver.pages.values() if item.page is popup)
assert popup_state.origins == set()
assert popup_state.relation_rejection is True

class MissingPageRequest:
    url = "https://s2.test/popup"
    method = "GET"
    post_data = None
    class MissingFrame:
        @property
        def page(self): raise module.PlaywrightError("page unavailable")
    frame = MissingFrame()

unattributed = FakeRoute(MissingPageRequest(), {})
driver.route(unattributed)
assert unattributed.aborted == "blockedbyclient"
assert unattributed.fetches == []
assert driver.unattributed_rejection_count == 1
assert popup_state.facts()["facts"] == [
    {"key": "page.relation", "source": "validation_evidence", "value": "unavailable"},
    {"key": "page.initial_request", "source": "validation_evidence", "value": "not_dispatched"},
    {"key": "page.blocked_reason", "source": "validation_evidence", "value": "page_relation_unavailable"},
    {"key": "page.rejected_unattributed_count", "source": "validation_evidence", "value": "1"},
]
driver.on_page(popup)
assert popup_state.opener == "page:1"
assert popup_state.origins == {"https://s1.test"}
assert popup_state.relation_rejection is True

state.controls["control:1"] = ("button", "Count")
main_action = driver.interact({"provider_page_ref": "page:1", "action": "click", "expected_origin": "https://s1.test", "authorized_origins": ["https://s1.test", "https://s2.test"], "target_ref": "control:1"})
assert main_action["status"] == "completed"
assert state.origins == {"https://s1.test", "https://s2.test"}
driver.navigate(state, "https://s1.test/narrow", ["https://s1.test"])
assert state.origins == {"https://s1.test"}

popup.url = "https://s2.test/popup"
popup_state.controls["control:1"] = ("button", "Count")
popup_action = driver.interact({"provider_page_ref": popup_state.ref, "action": "click", "expected_origin": "https://s2.test", "authorized_origins": ["https://s1.test", "https://s2.test"], "target_ref": "control:1"})
assert popup_action["status"] == "completed"
assert popup_state.origins == {"https://s1.test", "https://s2.test"}

narrowed = driver.interact({"provider_page_ref": popup_state.ref, "action": "click", "expected_origin": "https://s2.test", "authorized_origins": ["https://s1.test"], "target_ref": "control:1"})
assert narrowed["status"] == "unavailable"
assert popup_state.origins == {"https://s1.test"}
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
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
  else if (request.op === "page_list") result = { pages, rejected_unattributed_count: 1 };
  else if (request.op === "observe") result = page();
  else if (request.op === "observe_identity") result = { current_url: "https://example.test/start", title: "Example", ready_state: "complete", stable_id: null, document_generation: 1 };
  else if (request.op === "interact") result = request.action === "snapshot" ? { status: "completed", dispatch_state: "not_dispatched", page: page(), snapshot: { page_ref: "page:1", observation_ref: "observation:1", controls: [], text: "Example", truncated: false } } : { status: "completed", dispatch_state: "dispatched", page: { ...page(), facts: [{ key: "test.authorized_origins", source: "observed", value: (request.authorized_origins ?? []).join(",") }] } };
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
    assert.equal(result.pageController?.unattributedRequestRejectionCount?.(), 1);
    assert.equal((await result.observePage?.())?.page.current_url, "https://example.test/start");
    assert.equal((await result.interaction?.({ action: "snapshot", expected_origin: "https://example.test", control_generation: 1 }))?.status, "completed");
    const scopedClick = await result.interaction?.({ action: "click", expected_origin: "https://example.test", authorized_origins: ["https://example.test", "https://s2.test"], control_generation: 1, target_ref: "control:1" });
    assert.equal(scopedClick?.dispatch_state, "dispatched");
    assert.equal(scopedClick?.page?.facts.find(fact => fact.key === "test.authorized_origins")?.value, "https://example.test,https://s2.test");
    assert.equal((await result.publicPage?.({ expected_origin: "https://example.test" }))?.status, "completed");
    assert.equal((await result.readEnvironment?.())?.provider.browser_version, "152.0.4-beta.30");
    await result.close();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    for (const [key, value] of Object.entries(previous)) process.env[key] = value;
    rmSync(root, { recursive: true, force: true });
  }
});
