import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import asyncio, importlib.util, os, sys, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox")
camoufox.__path__ = []
camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils")
utils.launch_options = lambda **kwargs: {}
env_calls = []
def fake_get_env_vars(config_map, user_agent_os, path=None):
    env_calls.append((config_map, user_agent_os, str(path) if path else None))
    return {"CAMOU_CONFIG_1": __import__("json").dumps(config_map, ensure_ascii=False, separators=(",", ":"))}
utils.get_env_vars = fake_get_env_vars
camoufox.utils = utils
sys.modules["camoufox"] = camoufox
sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright")
playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error
async_api.Page = Page
async_api.Route = Route
async_api.TimeoutError = TimeoutError
async_api.async_playwright = lambda: None
playwright.async_api = async_api
sys.modules["playwright"] = playwright
sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.SOURCE_SHA256_PIN == "${CAMOUFOX_UPSTREAM_PINS.source_sha256}"
assert module.parse_viewport({"width": 1280, "height": 900}) == {"width": 1280, "height": 900}
try:
    module.parse_viewport({"width": 1280, "height": 900, "unexpected": True})
    raise AssertionError("unexpected viewport field accepted")
except ValueError:
    pass
seen = []
def fake_launch_options(**kwargs):
    seen.append(kwargs)
    config = {"timezone": kwargs["config"].get("timezone", "UTC"), "fingerprint.seed": "stable-seed", "fonts": ["Inter"]}
    return {"args": [], "env": {**utils.get_env_vars(config, "mac", path=executable_path), "PROVIDER_ENV": "stable"}, "executable_path": executable_path, "firefox_user_prefs": {}, "headless": bool(kwargs["headless"])}
module.launch_options = fake_launch_options
profile = __import__("tempfile").mkdtemp(prefix="harbor-camoufox-options-")
executable_root = __import__("tempfile").mkdtemp(prefix="harbor-camoufox-executables-")
executable_path = os.path.join(executable_root, "camoufox")
other_executable = os.path.join(executable_root, "other-camoufox")
open(executable_path, "wb").close()
open(other_executable, "wb").close()
try:
    options, bundle, replay, context_options = module.options_for({"headless": False, "browser_path": executable_path, "source": {"source": "official_release", "source_sha256": module.SOURCE_SHA256_PIN, "camoufox_version": module.CAMOUFOX_VERSION_PIN, "browser_version": module.BROWSER_VERSION_PIN, "playwright_version": module.PLAYWRIGHT_VERSION_PIN}, "environment": {"timezone": "UTC"}}, profile)
    assert replay is False
    assert seen[0]["exclude_addons"] == [module.DefaultAddons.UBO]
    assert seen[0]["config"]["timezone"] == "UTC"
    expected_config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(executable_path))), "Resources", "camoufox") if sys.platform == "darwin" else os.path.realpath(executable_path)
    assert seen[0]["executable_path"] == expected_config_path
    assert options["executable_path"] == os.path.realpath(executable_path)
    assert context_options == {"timezone_id": "UTC"}
    assert bundle["context_options"] == {"timezone_id": "UTC"}
    assert module.decode_camoufox_config(options) == {"timezone": "UTC", "fingerprint.seed": "stable-seed", "fonts": ["Inter"]}
    assert bundle["config"] == module.decode_camoufox_config(options)
    assert __import__("json").loads(options["env"]["CAMOU_CONFIG_1"])["timezone"] == "UTC"
    immutable = {key: bundle[key] for key in ("config_sha256", "identity_hash")}
    immutable_launch = {key: options[key] for key in ("args", "executable_path", "firefox_user_prefs", "headless")}
    immutable_config = {key: value for key, value in bundle["config"].items() if key != "timezone"}
    updated_options, updated_bundle, updated_replay, updated_context_options = module.options_for({"headless": False, "browser_path": executable_path, "source": {"source": "official_release", "source_sha256": module.SOURCE_SHA256_PIN, "camoufox_version": module.CAMOUFOX_VERSION_PIN, "browser_version": module.BROWSER_VERSION_PIN, "playwright_version": module.PLAYWRIGHT_VERSION_PIN}, "environment": {"timezone": "Europe/Paris"}}, profile)
    assert updated_replay is True
    assert updated_context_options == {"timezone_id": "Europe/Paris"}
    assert updated_bundle["context_options"] == {"timezone_id": "Europe/Paris"}
    assert {key: updated_options[key] for key in ("args", "executable_path", "firefox_user_prefs", "headless")} == immutable_launch
    assert updated_bundle["config"] != bundle["config"]
    assert {key: value for key, value in updated_bundle["config"].items() if key != "timezone"} == immutable_config
    assert updated_bundle["config"]["timezone"] == "Europe/Paris"
    assert updated_bundle["config_sha256"] != immutable["config_sha256"]
    assert updated_bundle["identity_hash"] == immutable["identity_hash"]
    assert updated_options["env"]["PROVIDER_ENV"] == options["env"]["PROVIDER_ENV"]
    assert __import__("json").loads(updated_options["env"]["CAMOU_CONFIG_1"])["timezone"] == "Europe/Paris"
    assert "UTC" not in updated_options["env"]["CAMOU_CONFIG_1"]
    assert module.decode_camoufox_config(updated_options) == updated_bundle["config"]
    assert env_calls[-1][0]["timezone"] == "Europe/Paris"
    assert env_calls[-1][1:] == ("mac", os.path.realpath(executable_path))
    try:
        module.options_for({"headless": False, "browser_path": other_executable, "source": {"source": "official_release", "source_sha256": module.SOURCE_SHA256_PIN, "camoufox_version": module.CAMOUFOX_VERSION_PIN, "browser_version": module.BROWSER_VERSION_PIN, "playwright_version": module.PLAYWRIGHT_VERSION_PIN}, "environment": {}}, profile)
        raise AssertionError("replay accepted an executable path different from the owner request")
    except ValueError:
        pass
    class EnvironmentPage:
        url = "https://example.test/"
        def is_closed(self): return False
        async def evaluate(self, expression):
            return {"language": "en-US", "languages": ["en-US"], "timezone": "Europe/Paris", "viewport": {"width": 800, "height": 600}, "screen": {"width": 800, "height": 600}, "hardware_concurrency": None, "device_memory": None, "webgl_vendor": None, "webgl_renderer": None, "fonts_hash": None, "voices_hash": None, "canvas_hash": None, "audio_hash": None}
    class ClosingPage:
        url = "https://example.test/closed"
        def __init__(self): self.closed_checks = 0
        def is_closed(self):
            self.closed_checks += 1
            return self.closed_checks > 1
        async def title(self): raise module.PlaywrightError("Target page closed")
    closing_facts = asyncio.run(module.PageState("page:closed", ClosingPage(), ["https://example.test"]).facts())
    assert closing_facts["status"] == "closed"
    assert closing_facts["title"] == ""
    class TransientTitleErrorPage:
        url = "https://example.test/transient"
        def is_closed(self): return False
        async def title(self): raise module.PlaywrightError("Transient protocol error")
    transient_facts = asyncio.run(module.PageState("page:transient", TransientTitleErrorPage(), ["https://example.test"]).facts())
    assert transient_facts["status"] == "ready"
    assert transient_facts["title"] == ""
    environment_driver = object.__new__(module.Driver)
    environment_driver.pages = {"page:1": module.PageState("page:1", EnvironmentPage(), ["https://example.test"])}
    environment_driver.bundle = bundle
    initial_environment = asyncio.run(environment_driver.environment({"provider_page_ref": "page:1"}))
    environment_driver.bundle = updated_bundle
    restarted_environment = asyncio.run(environment_driver.environment({"provider_page_ref": "page:1"}))
    assert initial_environment["bundle_hash"] == bundle["identity_hash"]
    assert restarted_environment["bundle_hash"] == updated_bundle["identity_hash"] == initial_environment["bundle_hash"]
    bundle_mtime = os.stat(module.bundle_path(profile)).st_mtime_ns
    _, same_bundle, same_replay, _ = module.options_for({"headless": False, "browser_path": executable_path, "source": {"source": "official_release", "source_sha256": module.SOURCE_SHA256_PIN, "camoufox_version": module.CAMOUFOX_VERSION_PIN, "browser_version": module.BROWSER_VERSION_PIN, "playwright_version": module.PLAYWRIGHT_VERSION_PIN}, "environment": {"timezone": "Europe/Paris"}}, profile)
    assert same_replay is True
    assert same_bundle["context_options"] == {"timezone_id": "Europe/Paris"}
    assert os.stat(module.bundle_path(profile)).st_mtime_ns == bundle_mtime
    legacy_profile = __import__("tempfile").mkdtemp(prefix="harbor-camoufox-legacy-options-")
    try:
        legacy_bundle = dict(bundle)
        legacy_bundle["config"] = dict(options["env"])
        legacy_bundle["config_sha256"] = module.json_hash(legacy_bundle["config"])
        legacy_bundle["identity_hash"] = module.json_hash(module.identity_config(legacy_bundle["config"]))
        module.bundle_path(legacy_profile).write_bytes(module.canonical_json(legacy_bundle) + b"\\n")
        os.chmod(module.bundle_path(legacy_profile), 0o600)
        try:
            module.options_for({"headless": False, "browser_path": executable_path, "source": {"source": "official_release", "source_sha256": module.SOURCE_SHA256_PIN, "camoufox_version": module.CAMOUFOX_VERSION_PIN, "browser_version": module.BROWSER_VERSION_PIN, "playwright_version": module.PLAYWRIGHT_VERSION_PIN}, "environment": {"timezone": "Asia/Tokyo"}}, legacy_profile)
            raise AssertionError("legacy raw-env bundle was accepted")
        except ValueError:
            pass
    finally:
        __import__("shutil").rmtree(legacy_profile)
    try:
        module.options_for({"headless": False, "browser_path": executable_path, "source": {"source": "official_release", "source_sha256": module.SOURCE_SHA256_PIN, "camoufox_version": module.CAMOUFOX_VERSION_PIN, "browser_version": module.BROWSER_VERSION_PIN, "playwright_version": module.PLAYWRIGHT_VERSION_PIN}, "environment": {"timezone": "Not/AZone"}}, profile)
        raise AssertionError("invalid timezone was accepted")
    except ValueError:
        pass
    assert module.load_bundle(profile)["context_options"] == {"timezone_id": "Europe/Paris"}
    assert module.viewer_entry(False) == {"availability": "available", "access_mode": "interactive", "transport": "local_window", "input_capabilities": ["keyboard_mouse"]}
    assert module.viewer_entry(True)["availability"] == "unsupported"
finally:
    __import__("shutil").rmtree(profile)
    __import__("shutil").rmtree(executable_root)
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("reads the Playwright 1.60 Download suggested_filename property", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import asyncio, hashlib, importlib.util, os, sys, tempfile, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox")
camoufox.__path__ = []
camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils")
utils.launch_options = lambda **kwargs: {}
utils.get_env_vars = lambda config_map, user_agent_os, path=None: {"CAMOU_CONFIG_1": "{}"}
camoufox.utils = utils
sys.modules["camoufox"] = camoufox
sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright")
playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error
async_api.Page = Page
async_api.Route = Route
async_api.TimeoutError = TimeoutError
async_api.async_playwright = lambda: None
playwright.async_api = async_api
sys.modules["playwright"] = playwright
sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

body = b"id,status\\n1,ok\\n"
class FakeDownload:
    def __init__(self, page):
        self.page = page
        self.url = "https://example.test/receipt.csv"
        self.suggested_filename = "receipt.csv"
    async def failure(self): return None
    async def save_as(self, path):
        with open(path, "wb") as handle: handle.write(body)
    async def cancel(self): pass
    async def delete(self): pass

class DownloadExpectation:
    def __init__(self, download): self.value = download
    async def __aenter__(self): return self
    async def __aexit__(self, *args): return False

class FakeLink:
    def __init__(self, page): self.page = page
    async def get_attribute(self, name):
        assert name == "href"
        return "/receipt.csv"
    async def evaluate(self, expression): assert expression == "e => Boolean(e.isConnected)"; return True
    async def click(self, timeout):
        request = types.SimpleNamespace(frame=types.SimpleNamespace(page=self.page), url="https://example.test/receipt.csv", redirected_from=None)
        for listener in self.page.listeners.get("request", []): listener(request)
        for listener in self.page.listeners.get("download", []): listener(self.page.download)

class FakePage:
    url = "https://example.test/"
    def __init__(self): self.download = FakeDownload(self); self.listeners = {}
    def is_closed(self): return False
    async def title(self): return "Example"
    def on(self, event, listener): self.listeners.setdefault(event, []).append(listener)
    def remove_listener(self, event, listener): self.listeners.get(event, []).remove(listener)
    def expect_download(self, timeout):
        assert 1 <= timeout <= 1000
        expectation = DownloadExpectation(self.download)
        expectation.value = asyncio.sleep(0, result=self.download)
        return expectation

page = FakePage()
state = module.PageState("page:1", page, ["https://example.test"])
state.controls["control:0"] = ("link", "Download", "/receipt.csv", None, FakeLink(page))
instance = object.__new__(module.Driver)
instance.pages = {"page:1": state}
instance.current = "page:1"
instance.request = {"timeout_ms": 1000}
instance.close_requested = asyncio.Event()
staging = tempfile.mktemp(prefix="harbor-download-property-")
try:
    result = asyncio.run(instance.file_operation({"provider_page_ref": "page:1", "operation": "download", "expected_origin": "https://example.test", "authorized_origins": ["https://example.test"], "target_ref": "control:0", "staging_path": staging, "timeout_ms": 1000}))
    assert result["status"] == "completed", result
    assert result["download"]["suggested_filename"] == "receipt.csv"
    assert result["download"]["sha256"] == hashlib.sha256(body).hexdigest()
finally:
    try: os.unlink(staging)
    except FileNotFoundError: pass
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("narrows file route scope and fails closed on replaced snapshot targets", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import asyncio, importlib.util, os, sys, tempfile, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox"); camoufox.__path__ = []; camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils"); utils.launch_options = lambda **kwargs: {}; utils.get_env_vars = lambda *args, **kwargs: {"CAMOU_CONFIG_1": "{}"}
camoufox.utils = utils; sys.modules["camoufox"] = camoufox; sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright"); playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error; async_api.Page = Page; async_api.Route = Route; async_api.TimeoutError = TimeoutError; async_api.async_playwright = lambda: None
playwright.async_api = async_api; sys.modules["playwright"] = playwright; sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class Handle:
    def __init__(self, name="Upload"): self.connected = True; self.calls = []; self.name = name
    async def evaluate(self, expression):
        if expression == "e => Boolean(e.isConnected)": return self.connected
        if expression == "e => e.files ? e.files.length : 0": return 0
        if "getBoundingClientRect" in expression:
            return {"role": "file", "name": self.name, "href": None, "enabled": True}
        raise AssertionError(expression)
    async def is_visible(self): return self.connected
    def evaluate_files(self): return 0
    async def set_input_files(self, path, timeout=None): self.calls.append((path, timeout))
    async def dispose(self): self.connected = False

class PageImpl:
    url = "https://a.test/"; main_frame = object()
    def __init__(self):
        self.first = Handle("First")
        self.second = Handle("Second")
        self.handles = [self.first, self.second]
        self.reordered = False
    def is_closed(self): return False
    async def title(self): return "Fixture"
    async def query_selector_all(self, selector):
        values = list(self.handles)
        if not self.reordered:
            self.reordered = True
            self.handles = list(reversed(self.handles))
        return values
    async def evaluate(self, expression):
        if "document.body" in expression: return ""
        if "document.querySelectorAll" in expression: raise AssertionError("snapshot metadata must use the exact ElementHandle")
        raise AssertionError(expression)

class Request:
    def __init__(self, page, url): self.frame = types.SimpleNamespace(page=page); self.url = url; self.redirected_from = None; self.method = "POST"; self.post_data = None
class RouteImpl:
    def __init__(self, request): self.request = request; self.aborted = None; self.fetch_called = False
    async def abort(self, reason): self.aborted = reason
    async def fetch(self, **kwargs): self.fetch_called = True; raise AssertionError("unauthorized route fetched")

page = PageImpl(); instance = object.__new__(module.Driver); instance.pages = {}; instance.current = "page:1"; instance.request = {"timeout_ms": 1000}; instance.unattributed_rejection_count = 0
state = module.PageState("page:1", page, ["https://a.test", "https://b.test"]); instance.pages = {"page:1": state}
snap = asyncio.run(instance.snapshot(state)); old_ref = snap["controls"][0]["target_ref"]
assert [item["name"] for item in snap["controls"]] == ["First", "Second"], snap
old = state.controls[old_ref][4]
source = tempfile.mktemp(prefix="harbor-upload-target-"); open(source, "wb").write(b"x")
try:
    sent = asyncio.run(instance.file_operation({"provider_page_ref": "page:1", "operation": "upload", "expected_origin": "https://a.test", "authorized_origins": ["https://a.test"], "target_ref": old_ref, "source_path": source, "timeout_ms": 1000}))
    assert sent["status"] == "completed", sent
    assert state.origins == {"https://a.test"}
    replacement = Handle(); page.handles = [replacement]; old.connected = False
    stale = asyncio.run(instance.file_operation({"provider_page_ref": "page:1", "operation": "upload", "expected_origin": "https://a.test", "authorized_origins": ["https://a.test"], "target_ref": old_ref, "source_path": source, "timeout_ms": 1000}))
    assert stale["status"] == "unavailable" and stale["dispatch_state"] == "not_dispatched", stale
    assert replacement.calls == []
    fresh = asyncio.run(instance.snapshot(state)); fresh_ref = fresh["controls"][0]["target_ref"]
    delivered = asyncio.run(instance.file_operation({"provider_page_ref": "page:1", "operation": "upload", "expected_origin": "https://a.test", "authorized_origins": ["https://a.test"], "target_ref": fresh_ref, "source_path": source, "timeout_ms": 1000}))
    assert delivered["status"] == "completed", delivered
    route = RouteImpl(Request(page, "https://b.test/steal")); asyncio.run(instance.route(route))
    assert route.aborted == "blockedbyclient" and not route.fetch_called
finally:
    try: os.unlink(source)
    except FileNotFoundError: pass
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("attributes downloads to one authorized request chain and bounds save cleanup", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import asyncio, hashlib, importlib.util, os, sys, tempfile, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox"); camoufox.__path__ = []; camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils"); utils.launch_options = lambda **kwargs: {}; utils.get_env_vars = lambda *args, **kwargs: {"CAMOU_CONFIG_1": "{}"}
camoufox.utils = utils; sys.modules["camoufox"] = camoufox; sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright"); playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error; async_api.Page = Page; async_api.Route = Route; async_api.TimeoutError = TimeoutError; async_api.async_playwright = lambda: None
playwright.async_api = async_api; sys.modules["playwright"] = playwright; sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class Request:
    def __init__(self, page, url, redirected_from=None): self.frame = types.SimpleNamespace(page=page); self.url = url; self.redirected_from = redirected_from; self.method = "GET"; self.post_data = None
class Link:
    def __init__(self, page, download, extras=()): self.page = page; self.download = download; self.extras = extras
    async def evaluate(self, expression): return True
    async def get_attribute(self, name): assert name == "href"; return "/expected.csv"
    async def click(self, timeout):
        request = Request(self.page, "https://files.test/expected.csv")
        if self.page.emit_request:
            for listener in self.page.listeners.get("request", []): listener(request)
            if self.page.redirect_url:
                request = Request(self.page, self.page.redirect_url, request)
                for listener in self.page.listeners.get("request", []): listener(request)
        for item in (self.download, *self.extras):
            for listener in self.page.listeners.get("download", []): listener(item)
class Download:
    def __init__(self, page, url, body=b"id,status\\n1,ok\\n", delay=0, extra=None, temp_bytes=None): self.page = page; self.url = url; self.suggested_filename = "receipt.csv"; self.body = body; self.delay = delay; self.extra = extra; self.temp_bytes = temp_bytes; self.cancelled = 0; self.deleted = 0
    async def failure(self): return None
    async def save_as(self, path):
        if self.extra is not None:
            for listener in self.page.listeners.get("download", []): listener(self.extra)
        if self.temp_bytes is not None:
            with open(self.page.temp_path, "wb") as handle: handle.write(self.temp_bytes)
        if self.delay: await asyncio.sleep(self.delay)
        with open(path, "wb") as handle: handle.write(self.body)
    async def path(self): return getattr(self.page, "temp_path", None)
    async def cancel(self): self.cancelled += 1
    async def delete(self): self.deleted += 1
class Expectation:
    def __init__(self, value): self.value = asyncio.sleep(0, result=value)
    async def __aenter__(self): return self
    async def __aexit__(self, *args): return False
class PageImpl:
    url = "https://files.test/"; main_frame = object()
    def __init__(self, download, extras=()): self.download = download; self.link = Link(self, download, extras); self.listeners = {}; self.emit_request = True; self.redirect_url = None
    def is_closed(self): return False
    async def title(self): return "Fixture"
    def on(self, event, listener): self.listeners.setdefault(event, []).append(listener)
    def remove_listener(self, event, listener): self.listeners.get(event, []).remove(listener)
    def expect_download(self, timeout): return Expectation(self.download)
def make(download, extras=(), emit_request=True, scope_semantics="legacy_request_guard_v1", redirect_url=None):
    page = PageImpl(download, extras); page.emit_request = emit_request; download.page = page; [setattr(item, "page", page) for item in extras]
    page.redirect_url = redirect_url
    state = module.PageState("page:1", page, ["https://files.test"], scope_semantics=scope_semantics); state.controls["target"] = ("link", "Download", "/expected.csv", None, page.link)
    instance = object.__new__(module.Driver); instance.pages = {"page:1": state}; instance.current = "page:1"; instance.request = {"timeout_ms": 1000}; instance.scope_semantics = scope_semantics; instance.unattributed_rejection_count = 0; instance.close_requested = asyncio.Event()
    return instance, page
def run(download, extras=(), timeout=1000, use_browser_temp=False, emit_request=True, scope_semantics="legacy_request_guard_v1", redirect_url=None):
    instance, page = make(download, extras, emit_request, scope_semantics, redirect_url); staging = tempfile.mktemp(prefix="harbor-download-bound-")
    temp_root = tempfile.mkdtemp(prefix="harbor-download-temp-") if use_browser_temp else None
    if temp_root is not None:
        instance.downloads_root = __import__("pathlib").Path(temp_root)
        page.temp_path = os.path.join(temp_root, "download")
    result = asyncio.run(instance.file_operation({"provider_page_ref": "page:1", "operation": "download", "expected_origin": "https://files.test", "authorized_origins": ["https://files.test"], "scope_semantics": scope_semantics, "target_ref": "target", "staging_path": staging, "timeout_ms": timeout}))
    if result.get("status") == "completed":
        assert os.path.exists(staging)
        os.unlink(staging)
    else:
        assert not os.path.exists(staging)
    if temp_root is not None:
        assert not os.listdir(temp_root), (result, os.listdir(temp_root))
        __import__("shutil").rmtree(temp_root)
    return result, download, extras
wrong, wrong_download, _ = run(Download(None, "https://files.test/unrelated.csv"))
assert wrong["failure_class"] == "download_relation_unavailable" and wrong_download.cancelled == 1, wrong
first = Download(None, "https://files.test/expected.csv"); second = Download(None, "https://files.test/expected.csv")
multiple, first, extras = run(first, (second,))
assert multiple["failure_class"] == "download_relation_unavailable" and first.cancelled == second.cancelled == 1, multiple
# Chromium can emit a Download for an <a download> without a Page request;
# the transport event alone must not be claimed as a managed file.
unobserved_download = Download(None, "https://files.test/expected.csv")
unobserved, unobserved_download, _ = run(unobserved_download, emit_request=False)
assert unobserved["failure_class"] == "download_relation_unavailable" and unobserved_download.cancelled == 1, unobserved
legacy_redirect, legacy_redirect_download, _ = run(Download(None, "https://cdn.test/receipt.csv"), redirect_url="https://cdn.test/receipt.csv")
assert legacy_redirect["failure_class"] == "download_relation_unavailable" and legacy_redirect_download.cancelled == 1, legacy_redirect
v2_redirect, v2_redirect_download, _ = run(Download(None, "https://cdn.test/receipt.csv"), scope_semantics="agent_operations_v2", redirect_url="https://cdn.test/receipt.csv")
assert v2_redirect["status"] == "completed" and v2_redirect_download.cancelled == 0, v2_redirect
oversize, oversized, _ = run(Download(None, "https://files.test/expected.csv", body=b"x" * (10 * 1024 * 1024 + 1)))
assert oversize["failure_class"] == "file_limit_exceeded" and oversized.cancelled == 1, oversize
timeout, slow, _ = run(Download(None, "https://files.test/expected.csv", delay=0.2), timeout=20)
assert timeout["failure_class"] == "timeout" and slow.cancelled == 1, timeout
late = Download(None, "https://files.test/expected.csv")
extra = Download(None, "https://files.test/expected.csv")
late.extra = extra
multiple_during_save, late, extras = run(late)
assert multiple_during_save["failure_class"] == "download_relation_unavailable" and late.cancelled == extra.cancelled == 1, multiple_during_save
temp_oversize, temp_download, _ = run(Download(None, "https://files.test/expected.csv", delay=0.2, temp_bytes=b"x" * (10 * 1024 * 1024 + 1)), timeout=100, use_browser_temp=True)
assert temp_oversize["failure_class"] == "file_limit_exceeded" and temp_download.cancelled == 1, temp_oversize
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("uses public Context.close and retains an un-converged Download task", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import asyncio, importlib.util, os, sys, tempfile, time, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox"); camoufox.__path__ = []; camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils"); utils.launch_options = lambda **kwargs: {}; utils.get_env_vars = lambda *args, **kwargs: {"CAMOU_CONFIG_1": "{}"}
camoufox.utils = utils; sys.modules["camoufox"] = camoufox; sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright"); playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error; async_api.Page = Page; async_api.Route = Route; async_api.TimeoutError = TimeoutError; async_api.async_playwright = lambda: None
playwright.async_api = async_api; sys.modules["playwright"] = playwright; sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
module.DOWNLOAD_CANCEL_GRACE_S = 0.01
module.DOWNLOAD_SETTLE_GRACE_S = 0.01

class Context:
    def __init__(self): self.close_calls = 0
    async def close(self): self.close_calls += 1

async def main():
    context = Context()
    instance = object.__new__(module.Driver)
    instance.close_requested = asyncio.Event()
    instance.close_lock = asyncio.Lock()
    instance.context = context
    instance.download_settling = set()
    action_release = asyncio.Event()
    cancel_release = asyncio.Event()
    staging = tempfile.mktemp(prefix="harbor-unconverged-download-")
    async def action():
        await action_release.wait()
        with open(staging, "wb") as handle: handle.write(b"late write")
    async def cancel():
        await cancel_release.wait()
    try:
        try:
            await instance.bounded_download_call(staging, time.monotonic() + 0.02, action, cancel=cancel)
            raise AssertionError("bounded call unexpectedly completed")
        except module.DownloadTimeout as error:
            assert error.pending_tasks, "unconverged action/cancel must remain tracked"
            assert context.close_calls == 1, context.close_calls
            assert instance.context is None
            await asyncio.sleep(0)
            assert not os.path.exists(staging), "the action must not write before its tracked task settles"
            action_release.set(); cancel_release.set()
            await asyncio.gather(*error.pending_tasks, return_exceptions=True)
            assert os.path.exists(staging), "the test release proves the task was retained, not cancelled"
    finally:
        try: os.unlink(staging)
        except FileNotFoundError: pass

asyncio.run(main())
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("keeps a Driver fenced while deferred Download cleanup converges", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import asyncio, importlib.util, os, sys, tempfile, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox"); camoufox.__path__ = []; camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils"); utils.launch_options = lambda **kwargs: {}; utils.get_env_vars = lambda *args, **kwargs: {}
camoufox.utils = utils; sys.modules["camoufox"] = camoufox; sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright"); playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error; async_api.Page = Page; async_api.Route = Route; async_api.TimeoutError = TimeoutError; async_api.async_playwright = lambda: None
playwright.async_api = async_api; sys.modules["playwright"] = playwright; sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class PageImpl:
    def __init__(self): self.removed = []
    def remove_listener(self, event, listener): self.removed.append((event, listener))
class Download:
    def __init__(self): self.deleted = 0; self.cancelled = 0
    async def delete(self): self.deleted += 1
    async def cancel(self): self.cancelled += 1

async def main():
    instance = object.__new__(module.Driver)
    instance.close_requested = asyncio.Event()
    instance.download_settling = set()
    instance.download_operations = set()
    instance.context = None
    release_action = asyncio.Event()
    release_cancel = asyncio.Event()
    action_finished = asyncio.Event()
    cancel_finished = asyncio.Event()
    async def action():
        await release_action.wait()
        action_finished.set()
    async def cancel():
        await release_cancel.wait()
        cancel_finished.set()
    action_task = asyncio.create_task(action())
    cancel_task = asyncio.create_task(cancel())
    page = PageImpl(); download = Download()
    staging = tempfile.mktemp(prefix="harbor-deferred-cleanup-")
    module.Driver.defer_download_cleanup(instance, (action_task, cancel_task), page, object(), object(), [], download, staging, {id(download)})
    assert instance.close_requested.is_set()
    assert instance.context is None
    fenced = await module.dispatch(instance, {"op": "page_list"})
    assert fenced["status"] == "unavailable" and fenced["dispatch_state"] == "not_dispatched" and fenced["failure_class"] == "driver_closing", fenced
    assert len(instance.download_settling) == 1
    await asyncio.sleep(0)
    assert not action_finished.is_set() and not cancel_finished.is_set()
    release_action.set(); release_cancel.set()
    await instance.wait_download_cleanup()
    await asyncio.sleep(0)
    assert action_finished.is_set() and cancel_finished.is_set()
    assert not instance.download_settling
    assert download.deleted == 1 and download.cancelled == 0

asyncio.run(main())
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("waits for the declared Page condition instead of returning success after a delay", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import asyncio, importlib.util, os, sys, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox")
camoufox.__path__ = []
camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils")
utils.launch_options = lambda **kwargs: {}
utils.get_env_vars = lambda config_map, user_agent_os, path=None: {"CAMOU_CONFIG_1": "{}"}
camoufox.utils = utils
sys.modules["camoufox"] = camoufox
sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright")
playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error
async_api.Page = Page
async_api.Route = Route
async_api.TimeoutError = TimeoutError
async_api.async_playwright = lambda: None
playwright.async_api = async_api
sys.modules["playwright"] = playwright
sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FakeBody:
    def __init__(self, page): self.page = page
    async def inner_text(self, timeout=None): return self.page.text

class FakeTarget:
    def __init__(self, page): self.page = page
    async def is_visible(self): return True
    async def is_enabled(self): return self.page.enabled

class FakePage:
    url = "https://example.test/"
    main_frame = object()
    def __init__(self):
        self.text = "ready"
        self.enabled = False
        self.ticks = 0
        self.on_wait = None
    def is_closed(self): return False
    async def title(self): return "Fixture"
    def locator(self, selector):
        assert selector == "body"
        return FakeBody(self)
    def get_by_role(self, role, name, exact):
        assert (role, name, exact) == ("button", "Continue", True)
        return FakeTarget(self)
    async def wait_for_timeout(self, milliseconds):
        self.ticks += 1
        if self.on_wait: self.on_wait(self)
        await asyncio.sleep(0)

page = FakePage()
state = module.PageState("page:1", page, ["https://example.test"])
state.controls["control:0"] = ("button", "Continue", None, None)
instance = object.__new__(module.Driver)
instance.pages = {"page:1": state}
instance.current = "page:1"
instance.request = {"timeout_ms": 1000}
instance.close_requested = asyncio.Event()

base = {"provider_page_ref": "page:1", "expected_origin": "https://example.test", "authorized_origins": ["https://example.test"]}
missing = asyncio.run(instance.interact({**base, "action": "wait", "wait_for": "text", "text": "Processing", "timeout_ms": 100}))
assert missing["status"] == "unavailable", missing
assert missing["dispatch_state"] == "dispatched", missing
assert missing["failure_class"] == "wait_condition_timeout", missing

page.ticks = 0
page.on_wait = lambda current: setattr(current, "text", "Processing") if current.ticks >= 2 else None
found = asyncio.run(instance.interact({**base, "action": "wait", "wait_for": "text", "text": "Processing", "timeout_ms": 100}))
assert found["status"] == "completed", found
assert found["dispatch_state"] == "dispatched", found

page.on_wait = lambda current: setattr(current, "enabled", True) if current.ticks >= 2 else None
page.ticks = 0
enabled = asyncio.run(instance.interact({**base, "action": "wait", "wait_for": "enabled", "target_ref": "control:0", "timeout_ms": 100}))
assert enabled["status"] == "completed", enabled

page.on_wait = lambda current: setattr(state, "generation", state.generation + 1) if current.ticks == 2 else None
page.ticks = 0
changed = asyncio.run(instance.interact({**base, "action": "wait", "wait_for": "page_changed", "timeout_ms": 100}))
assert changed["status"] == "completed", changed
`
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("checks every redirect hop before issuing the next fetch", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import asyncio, importlib.util, os, sys, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox")
camoufox.__path__ = []
camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils")
utils.launch_options = lambda **kwargs: {}
utils.get_env_vars = lambda config_map, user_agent_os, path=None: {"CAMOU_CONFIG_1": __import__("json").dumps(config_map, separators=(",", ":"))}
camoufox.utils = utils
sys.modules["camoufox"] = camoufox
sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright")
playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error
async_api.Page = Page
async_api.Route = Route
async_api.TimeoutError = TimeoutError
async_api.async_playwright = lambda: None
playwright.async_api = async_api
sys.modules["playwright"] = playwright
sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class FakePage:
    url = "https://s1.test/"
    main_frame = object()
    mouse = types.SimpleNamespace(wheel=lambda *args: None)
    def __init__(self): self._opener = None
    def on(self, *args): pass
    def is_closed(self): return False
    async def title(self): return "Fixture"
    async def opener(self): return self._opener
    def get_by_role(self, *args, **kwargs): return FakeLocator()
    async def goto(self, url, **kwargs): self.url = url
    async def reload(self): pass
    async def go_back(self): pass
    async def go_forward(self): pass

class FakeLocator:
    async def click(self, **kwargs): pass
    async def fill(self, text, **kwargs): pass
    async def press(self, key, **kwargs): pass

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
    async def dispose(self):
        self.disposed = True

class FakeRoute:
    def __init__(self, request, responses):
        self.request = request
        self.responses = responses
        self.fetches = []
        self.fulfilled = None
        self.aborted = None
    async def fetch(self, **kwargs):
        self.fetches.append(kwargs)
        url = kwargs.get("url", self.request.url)
        return self.responses[url]
    async def fulfill(self, response=None, **kwargs):
        self.fulfilled = response
    async def abort(self, reason):
        self.aborted = reason

page = FakePage()
driver = object.__new__(module.Driver)
driver.request = {"timeout_ms": 100}
state = module.PageState("page:1", page, ["https://s1.test"])
driver.pages = {"page:1": state}
driver.next_ref = 2
driver.current = "page:1"
driver.unattributed_rejection_count = 0
state.controls["control:stale"] = ("button", "Stale")
asyncio.run(driver.on_navigate(state, object()))
assert state.generation == 1
asyncio.run(driver.on_navigate(state, page.main_frame))
assert state.generation == 2
assert state.controls == {}
asyncio.run(driver.on_navigate(state, page.main_frame))
assert state.generation == 3
assert "active" not in asyncio.run(state.facts())
initial = "https://s1.test/redirect/s2"
same_origin = "https://s1.test/from-s1/s3"
route = FakeRoute(FakeRequest(page, initial), {
    initial: FakeResponse(initial, 302, "/from-s1/s3"),
    same_origin: FakeResponse(same_origin, 302, "https://s3.test/final"),
})
asyncio.run(driver.route(route))
assert route.aborted == "blockedbyclient"
assert route.fulfilled is None
assert [item.get("url", initial) for item in route.fetches] == [initial, same_origin]
assert all("s3.test" not in item.get("url", "") for item in route.fetches)

allowed_final = "https://s1.test/final"
allowed = FakeRoute(FakeRequest(page, initial), {
    initial: FakeResponse(initial, 302, "/final"),
    allowed_final: FakeResponse(allowed_final, 200),
})
asyncio.run(driver.route(allowed))
assert allowed.aborted is None
assert allowed.fulfilled.status == 200

v2_page = FakePage()
v2_page.url = "https://other.test/private/path?token=secret"
v2_state = module.PageState("page:v2", v2_page, ["https://s1.test"], scope_semantics="agent_operations_v2")
redacted = asyncio.run(v2_state.facts())
assert redacted["current_url"] == "https://other.test" and redacted["title"] == ""

class RacingPage(FakePage):
    async def title(self):
        self.url = "https://other.test/private?token=secret"
        racing_state.generation += 1
        return "Private title"
    async def evaluate(self, expression):
        self.url = "https://other.test/private?token=secret"
        racing_state.generation += 1
        return {"current_url": "https://s1.test/old", "title": "Private title", "ready_state": "complete", "stable_id": None}

racing_page = RacingPage()
racing_state = module.PageState("page:race", racing_page, ["https://s1.test"], scope_semantics="agent_operations_v2")
driver.pages["page:race"] = racing_state
racing_facts = asyncio.run(racing_state.facts())
assert racing_facts["current_url"] == "https://other.test" and racing_facts["title"] == ""
racing_page.url = "https://s1.test/old"
racing_state.generation = 1
racing_observation = asyncio.run(driver.observe({"provider_page_ref": "page:race", "scope_semantics": "agent_operations_v2"}))
assert racing_observation["observation"]["current_url"] == "https://other.test"
assert racing_observation["observation"]["title"] == ""

class UnauthorizedReadPage(FakePage):
    url = "https://other.test/private?token=secret"
    async def title(self): raise AssertionError("unauthorized title read")
    async def evaluate(self, expression): raise AssertionError("unauthorized document read")

unauthorized_page = UnauthorizedReadPage()
unauthorized_state = module.PageState("page:unauthorized", unauthorized_page, ["https://s1.test"], scope_semantics="agent_operations_v2")
driver.pages["page:unauthorized"] = unauthorized_state
unauthorized_observation = asyncio.run(driver.observe({"provider_page_ref": "page:unauthorized", "scope_semantics": "agent_operations_v2"}))
assert unauthorized_observation["current_url"] == "https://other.test"
assert unauthorized_observation["title"] == ""

class BouncingBodyPage(FakePage):
    url = "https://s1.test/start"
    def locator(self, selector): return self
    async def inner_text(self, timeout):
        self.url = "https://other.test/private?token=secret"
        bouncing_state.generation += 1
        self.url = "https://s1.test/return"
        bouncing_state.generation += 1
        return "private intermediate content"

bouncing_page = BouncingBodyPage()
bouncing_state = module.PageState("page:bounce", bouncing_page, ["https://s1.test"], scope_semantics="agent_operations_v2")
driver.pages["page:bounce"] = bouncing_state
bouncing_result = asyncio.run(driver.public_page({"provider_page_ref": "page:bounce", "scope_semantics": "agent_operations_v2", "expected_origin": "https://s1.test"}))
assert bouncing_result["status"] == "unavailable"
assert "text" not in bouncing_result

popup = FakePage()
popup.url = "https://popup.test/"
popup._opener = page
unknown = FakeRoute(FakeRequest(popup, "https://popup.test/popup?token=private"), {})
asyncio.run(driver.route(unknown))
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
asyncio.run(driver.route(unattributed))
assert unattributed.aborted == "blockedbyclient"
assert unattributed.fetches == []
assert driver.unattributed_rejection_count == 1
assert asyncio.run(popup_state.facts())["facts"] == [
    {"key": "page.relation", "source": "validation_evidence", "value": "unavailable"},
    {"key": "page.initial_request", "source": "validation_evidence", "value": "not_dispatched"},
    {"key": "page.blocked_reason", "source": "validation_evidence", "value": "page_relation_unavailable"},
    {"key": "page.rejected_unattributed_count", "source": "validation_evidence", "value": "1"},
]
asyncio.run(driver.on_page(popup))
assert popup_state.opener == "page:1"
assert popup_state.origins == {"https://s1.test"}
assert popup_state.relation_rejection is True

state.controls["control:1"] = ("button", "Count")
main_action = asyncio.run(driver.interact({"provider_page_ref": "page:1", "action": "click", "expected_origin": "https://s1.test", "authorized_origins": ["https://s1.test", "https://s2.test"], "target_ref": "control:1"}))
assert main_action["status"] == "completed"
assert state.origins == {"https://s1.test", "https://s2.test"}
asyncio.run(driver.navigate(state, "https://s1.test/narrow", ["https://s1.test"]))
assert state.origins == {"https://s1.test"}

popup.url = "https://s2.test/popup"
popup_state.controls["control:1"] = ("button", "Count")
popup_action = asyncio.run(driver.interact({"provider_page_ref": popup_state.ref, "action": "click", "expected_origin": "https://s2.test", "authorized_origins": ["https://s1.test", "https://s2.test"], "target_ref": "control:1"}))
assert popup_action["status"] == "completed"
assert popup_state.origins == {"https://s1.test", "https://s2.test"}

narrowed = asyncio.run(driver.interact({"provider_page_ref": popup_state.ref, "action": "click", "expected_origin": "https://s2.test", "authorized_origins": ["https://s1.test"], "target_ref": "control:1"}))
assert narrowed["status"] == "unavailable"
assert popup_state.origins == {"https://s1.test"}
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("installs the persistent-context guard before the initial navigation and closes safely on setup failure", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import asyncio, importlib.util, os, sys, tempfile, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox")
camoufox.__path__ = []
camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils")
utils.launch_options = lambda **kwargs: {}
utils.get_env_vars = lambda config_map, user_agent_os, path=None: {"CAMOU_CONFIG_1": "{}"}
camoufox.utils = utils
sys.modules["camoufox"] = camoufox
sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright")
playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error
async_api.Page = Page
async_api.Route = Route
async_api.TimeoutError = TimeoutError
async_api.async_playwright = lambda: None
playwright.async_api = async_api
sys.modules["playwright"] = playwright
sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

events = []
class FakePage:
    def __init__(self):
        self.url = "about:blank"
        self.main_frame = object()
        self.closed = False
    def on(self, *args): events.append(("page.on", args[0]))
    def is_closed(self): return self.closed
    async def title(self): return "Fixture"
    async def goto(self, url, **kwargs): events.append("goto"); self.url = url
    async def close(self): self.closed = True

class FakeContext:
    def __init__(self, page, fail_online=False):
        self.pages = [page]
        self.fail_online = fail_online
    def on(self, event, callback): events.append(("context.on", event))
    async def route(self, pattern, callback): events.append(("context.route", pattern))
    async def set_offline(self, value):
        events.append(("context.offline", value))
        if self.fail_online: raise RuntimeError("offline setup failure")
    async def close(self): events.append("context.close")
    async def new_page(self): return self.pages[0]

class FakeBrowserType:
    async def launch_persistent_context(self, **kwargs):
        events.append(("launch", kwargs.get("offline"), kwargs.get("service_workers"), kwargs.get("downloads_path"), set(kwargs)))
        return current_context

class FakePlaywright:
    firefox = FakeBrowserType()
    async def stop(self): events.append("playwright.stop")

class Factory:
    async def start(self): events.append("playwright.start"); return FakePlaywright()

module.verify_runtime_pins = lambda request: "properties"
module.options_for = lambda request, profile: ({"args": [], "env": {}, "executable_path": request["browser_path"], "firefox_user_prefs": {}, "headless": False}, {"identity_hash": "stable"}, False, {})
module.async_playwright = lambda: Factory()
profile = tempfile.mkdtemp(prefix="harbor-driver-guard-")
request = {"profile_dir": profile, "browser_path": "/managed/camoufox", "source": {"source": "official_release", "source_sha256": module.SOURCE_SHA256_PIN, "camoufox_version": module.CAMOUFOX_VERSION_PIN, "browser_version": module.BROWSER_VERSION_PIN, "playwright_version": module.PLAYWRIGHT_VERSION_PIN}, "url": "https://s1.test/start", "timeout_ms": 100}
current_context = FakeContext(FakePage())
instance = asyncio.run(module.Driver.create(request))
launch_index = next(i for i, value in enumerate(events) if isinstance(value, tuple) and value[0] == "launch")
route_index = events.index(("context.route", "**/*"))
offline_index = events.index(("context.offline", False))
goto_index = events.index("goto")
assert events[launch_index][0:3] == ("launch", True, "block")
assert isinstance(events[launch_index][3], str) and events[launch_index][3].startswith(profile)
assert os.path.isdir(events[launch_index][3])
assert launch_index < route_index < offline_index < goto_index
asyncio.run(instance.close())
assert not os.path.exists(events[launch_index][3])

events.clear()
current_context = FakeContext(FakePage())
v2_request = {**request, "scope_semantics": "agent_operations_v2"}
instance = asyncio.run(module.Driver.create(v2_request))
v2_launch = next(value for value in events if isinstance(value, tuple) and value[0] == "launch")
assert "offline" not in v2_launch[4] and "service_workers" not in v2_launch[4]
assert ("context.route", "**/*") not in events
assert not any(isinstance(value, tuple) and value[0] == "context.offline" for value in events)
assert "goto" in events
asyncio.run(instance.close())

events.clear()
current_context = FakeContext(FakePage(), fail_online=True)
try:
    asyncio.run(module.Driver.create(request))
    raise AssertionError("setup failure was swallowed")
except RuntimeError:
    pass
assert "context.close" in events
assert "playwright.stop" in events
__import__("shutil").rmtree(profile)
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

test("dispatches close outside the ordinary Provider-operation lock", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import asyncio, importlib.util, json, os, sys, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox"); camoufox.__path__ = []; camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils"); utils.launch_options = lambda **kwargs: {}; utils.get_env_vars = lambda *args, **kwargs: {}
camoufox.utils = utils; sys.modules["camoufox"] = camoufox; sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright"); playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error; async_api.Page = Page; async_api.Route = Route; async_api.TimeoutError = TimeoutError; async_api.async_playwright = lambda: None
playwright.async_api = async_api; sys.modules["playwright"] = playwright; sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class FakePage:
    async def facts(self, task_selected=False): return {"provider_page_ref": "page:1", "current_url": "https://example.test/", "title": "Fixture", "status": "ready", "facts": []}
class FakeDriver:
    def __init__(self):
        self.pages = {"page:1": FakePage()}; self.current = "page:1"; self.request = {"headless": True}; self.context = object(); self.close_requested = asyncio.Event(); self.properties_sha256 = "test"; self.replay = False
    async def list_pages(self): return [await self.pages["page:1"].facts(task_selected=True)]
    async def interact(self, request):
        await self.close_requested.wait()
        return {"status": "unknown_outcome", "dispatch_state": "dispatched", "failure_class": "control_changed"}
    async def close(self): self.close_requested.set(); self.context = None
async def create(cls, request): return FakeDriver()
module.Driver.create = classmethod(create)
async def fake_dispatch(driver, request):
    if request.get("op") == "close": await driver.close(); return {"closed": True}
    if request.get("op") == "interact": return await driver.interact(request)
    raise AssertionError(request)
module.dispatch = fake_dispatch
class Input:
    def __init__(self): self.lines = iter([json.dumps({"id": 1, "op": "launch"}) + "\\n", json.dumps({"id": 2, "op": "interact"}) + "\\n", json.dumps({"id": 3, "op": "close"}) + "\\n", ""])
    def readline(self): return next(self.lines)
sys.stdin = Input()
asyncio.run(module.main_async())
`;
  const output = execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    timeout: 5_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
  const responses = output.trim().split("\n").map(line => JSON.parse(line) as { id: number; status: string; result?: Record<string, unknown> });
  assert.equal(responses.find(item => item.id === 3)?.result?.closed, true);
  assert.equal(responses.find(item => item.id === 2)?.result?.dispatch_state, "dispatched");
});

test("surfaces Context.close and Playwright.stop failures without releasing the Driver", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import asyncio, importlib.util, os, shutil, sys, tempfile, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox"); camoufox.__path__ = []; camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils"); utils.launch_options = lambda **kwargs: {}; utils.get_env_vars = lambda *args, **kwargs: {}
camoufox.utils = utils; sys.modules["camoufox"] = camoufox; sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright"); playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error; async_api.Page = Page; async_api.Route = Route; async_api.TimeoutError = TimeoutError; async_api.async_playwright = lambda: None
playwright.async_api = async_api; sys.modules["playwright"] = playwright; sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class Context:
    def __init__(self): self.close_calls = 0
    async def close(self): self.close_calls += 1; raise RuntimeError("context close failed")
class Playwright:
    def __init__(self): self.stop_calls = 0
    async def stop(self): self.stop_calls += 1; raise RuntimeError("playwright stop failed")

async def main():
    root = tempfile.mkdtemp(prefix="harbor-close-failure-")
    instance = object.__new__(module.Driver)
    instance.close_requested = asyncio.Event(); instance.close_lock = asyncio.Lock(); instance.context = Context(); instance.playwright = Playwright(); instance.downloads_root = __import__("pathlib").Path(root); instance.download_operations = set(); instance.download_settling = set()
    try:
        try:
            await instance.close()
            raise AssertionError("close unexpectedly succeeded")
        except RuntimeError as error:
            assert str(error) == "context close failed", str(error)
        assert instance.close_requested.is_set()
        assert instance.context is None and instance.playwright is None
        assert os.path.isdir(root), "failed close must retain task-owned resources for isolation"
        assert instance._close_completed is False
        assert instance._close_in_progress is not None
        assert instance._close_error is not None
        fenced = await module.dispatch(instance, {"op": "page_list"})
        assert fenced["status"] == "unavailable" and fenced["dispatch_state"] == "not_dispatched" and fenced["failure_class"] == "driver_closing", fenced
        try:
            await instance.close()
            raise AssertionError("a second close hid the original Provider failure")
        except RuntimeError as error:
            assert str(error) == "context close failed", str(error)
        assert instance._closing_context is not None and instance._closing_playwright is not None
        assert instance._closing_context.close_calls == 1 and instance._closing_playwright.stop_calls == 1

        context2 = Context(); playwright2 = Playwright()
        instance2 = object.__new__(module.Driver)
        instance2.close_requested = asyncio.Event(); instance2.close_lock = asyncio.Lock(); instance2.context = context2; instance2.playwright = playwright2; instance2.downloads_root = __import__("pathlib").Path(root); instance2.download_operations = set(); instance2.download_settling = set()
        try:
            await instance2.close_context_for_download()
            raise AssertionError("download interruption unexpectedly hid Context.close failure")
        except RuntimeError as error:
            assert str(error) == "context close failed", str(error)
        assert instance2.context is None and instance2._closing_context is context2
        assert instance2._close_error is not None and instance2._close_finalized is False
        try:
            await instance2.close()
            raise AssertionError("Driver.close unexpectedly hid the earlier download Context failure")
        except RuntimeError as error:
            assert str(error) == "context close failed", str(error)
        assert context2.close_calls == 1 and playwright2.stop_calls == 1
    finally:
        shutil.rmtree(root)

asyncio.run(main())
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("keeps close and EOF reachable behind a bounded ordinary queue", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import asyncio, importlib.util, json, os, sys, threading, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox"); camoufox.__path__ = []; camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils"); utils.launch_options = lambda **kwargs: {}; utils.get_env_vars = lambda *args, **kwargs: {}
camoufox.utils = utils; sys.modules["camoufox"] = camoufox; sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright"); playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error; async_api.Page = Page; async_api.Route = Route; async_api.TimeoutError = TimeoutError; async_api.async_playwright = lambda: None
playwright.async_api = async_api; sys.modules["playwright"] = playwright; sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
module.MAX_PENDING_COMMANDS = 2

class PageImpl:
    async def facts(self, task_selected=False):
        return {"provider_page_ref": "page:1", "current_url": "https://example.test/", "title": "Fixture", "status": "ready", "facts": []}

class FakeDriver:
    def __init__(self):
        self.pages = {"page:1": PageImpl()}; self.current = "page:1"; self.request = {"headless": True}; self.properties_sha256 = "test"; self.replay = False; self.close_requested = asyncio.Event(); self.close_calls = 0
    async def list_pages(self): return [await self.pages["page:1"].facts(task_selected=True)]
    async def interact(self, request):
        interact_started.set()
        await self.close_requested.wait()
        return {"status": "unknown_outcome", "dispatch_state": "dispatched", "failure_class": "control_changed"}
    async def close(self):
        self.close_calls += 1
        self.close_requested.set()

driver_ref = None
async def create(cls, request):
    global driver_ref
    driver_ref = FakeDriver()
    return driver_ref
module.Driver.create = classmethod(create)
async def fake_dispatch(driver, request):
    if request.get("op") == "close":
        await driver.close(); return {"closed": True}
    if request.get("op") == "interact": return await driver.interact(request)
    if request.get("op") == "page_list": return await driver.list_pages()
    raise AssertionError(request)
module.dispatch = fake_dispatch

interact_started = threading.Event()

class Input:
    def __init__(self):
        self.lines = [
            json.dumps({"id": 1, "op": "launch"}) + "\\n",
            json.dumps({"id": 2, "op": "interact"}) + "\\n",
            json.dumps({"id": 3, "op": "interact"}) + "\\n",
            json.dumps({"id": 4, "op": "interact"}) + "\\n",
            json.dumps({"id": 5, "op": "interact"}) + "\\n",
            json.dumps({"id": 6, "op": "interact"}) + "\\n",
            json.dumps({"id": 7, "op": "interact"}) + "\\n",
            json.dumps({"id": 8, "op": "interact"}) + "\\n",
            json.dumps({"id": 9, "op": "interact"}) + "\\n",
            json.dumps({"id": 10, "op": "close"}) + "\\n",
            ""
        ]; self.index = 0
    def readline(self):
        if self.index == 2:
            assert interact_started.wait(1), "the bounded-queue fixture did not enter its in-flight command"
        value = self.lines[self.index]; self.index += 1
        return value

module.sys.stdin = Input()
asyncio.run(module.main_async())
assert driver_ref is not None and driver_ref.close_calls == 1, driver_ref.close_calls if driver_ref else None
`;
  const output = execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    timeout: 5_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
  const responses = output.trim().split("\n").map(line => JSON.parse(line) as { id: number; status: string; message?: string; result?: Record<string, unknown> });
  assert.equal(responses.find(item => item.id === 10)?.result?.closed, true);
  assert.equal(responses.some(item => item.status === "error" && item.message === "Driver ordinary queue is full."), true);
});

test("establishes the EOF close barrier before draining a dispatched command", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import asyncio, importlib.util, json, os, sys, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox"); camoufox.__path__ = []; camoufox.DefaultAddons = type("DefaultAddons", (), {"UBO": object()})
utils = types.ModuleType("camoufox.utils"); utils.launch_options = lambda **kwargs: {}; utils.get_env_vars = lambda *args, **kwargs: {}
camoufox.utils = utils; sys.modules["camoufox"] = camoufox; sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright"); playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error; async_api.Page = Page; async_api.Route = Route; async_api.TimeoutError = TimeoutError; async_api.async_playwright = lambda: None
playwright.async_api = async_api; sys.modules["playwright"] = playwright; sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class PageImpl:
    async def facts(self, task_selected=False):
        return {"provider_page_ref": "page:1", "current_url": "https://example.test/", "title": "Fixture", "status": "ready", "facts": []}

class FakeDriver:
    def __init__(self):
        self.pages = {"page:1": PageImpl()}; self.current = "page:1"; self.request = {"headless": True}; self.properties_sha256 = "test"; self.replay = False; self.close_requested = asyncio.Event(); self.close_calls = 0
    async def list_pages(self): return [await self.pages["page:1"].facts(task_selected=True)]
    async def interact(self, request):
        await self.close_requested.wait()
        return {"status": "unknown_outcome", "dispatch_state": "dispatched", "failure_class": "control_changed"}
    async def close(self):
        self.close_calls += 1
        self.close_requested.set()

driver_ref = None
async def create(cls, request):
    global driver_ref
    driver_ref = FakeDriver()
    return driver_ref
module.Driver.create = classmethod(create)
async def fake_dispatch(driver, request):
    if request.get("op") == "interact": return await driver.interact(request)
    raise AssertionError(request)
module.dispatch = fake_dispatch

class Input:
    def __init__(self):
        self.lines = iter([
            json.dumps({"id": 1, "op": "launch"}) + "\\n",
            json.dumps({"id": 2, "op": "interact"}) + "\\n",
            ""
        ])
    def readline(self): return next(self.lines)

module.sys.stdin = Input()
asyncio.run(module.main_async())
assert driver_ref is not None and driver_ref.close_calls == 1
`;
  const output = execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    timeout: 5_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
  const responses = output.trim().split("\n").map(line => JSON.parse(line) as { id: number; status: string; result?: Record<string, unknown> });
  assert.equal(responses.find(item => item.id === 2)?.result?.dispatch_state, "dispatched");
  assert.equal(responses.find(item => item.id === 2)?.result?.status, "unknown_outcome");
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
    const result = await launchCamoufoxUpstreamProvider({ browser_path: "/managed/camoufox", provider_id: "camoufox", operation_scope: "profile_management", headless: true, timeout_ms: 5_000, url: "https://example.test/start", profile_ref: "profile:test", profile_storage_ref: "storage:test", provider_ref: "provider:test" });
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

test("preserves a Python close failure across the TypeScript owner stop boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "harbor-camoufox-close-owner-test-"));
  const helper = join(root, "failing-driver.mjs");
  const profilePathFile = join(root, "profile-path");
  writeFileSync(helper, `import { writeFileSync } from "node:fs";
import readline from "node:readline";
const page = { provider_page_ref: "page:1", current_url: "https://example.test/start", title: "Example", status: "ready", origin: "https://example.test", active: true, document_generation: 1, facts: [] };
const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  const request = JSON.parse(line);
  if (request.op === "launch") {
    writeFileSync(process.env.HARBOR_TEST_PROFILE_PATH_FILE, request.profile_dir);
    process.stdout.write(JSON.stringify({ id: request.id, status: "ok", result: { status: "ready", driver_ref: "failing-upstream", page, pages: [page], viewer_entry: { availability: "unsupported", access_mode: "none", transport: "not_applicable", input_capabilities: [] }, facts: [] } }) + "\\n");
  } else if (request.op === "close") {
    process.stdout.write(JSON.stringify({ id: request.id, status: "error", message: "RuntimeError: context close failed" }) + "\\n");
  } else {
    process.stdout.write(JSON.stringify({ id: request.id, status: "ok", result: page }) + "\\n");
  }
}`);
  chmodSync(helper, 0o700);
  const previous = { ...process.env };
  let profileDir = "";
  let result: Awaited<ReturnType<typeof launchCamoufoxUpstreamProvider>> | undefined;
  Object.assign(process.env, pins, {
    HARBOR_CAMOUFOX_PYTHON: process.execPath,
    HARBOR_CAMOUFOX_DRIVER: helper,
    HARBOR_TEST_PROFILE_PATH_FILE: profilePathFile
  });
  try {
    result = await launchCamoufoxUpstreamProvider({ browser_path: "/managed/camoufox", provider_id: "camoufox", operation_scope: "profile_management", headless: true, timeout_ms: 5_000, url: "https://example.test/start", profile_ref: "profile:close-owner", provider_ref: "provider:close-owner" });
    assert.equal(result.status, "ready");
    if (result.status !== "ready") return;
    await assert.rejects(result.close(), /context close failed/);
    profileDir = readFileSync(profilePathFile, "utf8");
    assert.ok(profileDir && existsSync(profileDir), "a failed owner stop must retain the ephemeral Profile for isolation");
    await assert.rejects(result.close(), /context close failed/);
    assert.equal(existsSync(profileDir), true, "a repeated owner stop must preserve the sticky failure and ownership");
  } finally {
    if (result?.status === "ready") {
      try { await result.close(); } catch { /* sticky close failure is asserted above */ }
    }
    if (profileDir) rmSync(profileDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    for (const [key, value] of Object.entries(previous)) process.env[key] = value;
    rmSync(root, { recursive: true, force: true });
  }
});
