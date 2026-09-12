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
        def evaluate(self, expression):
            return {"language": "en-US", "languages": ["en-US"], "timezone": "Europe/Paris", "viewport": {"width": 800, "height": 600}, "screen": {"width": 800, "height": 600}, "hardware_concurrency": None, "device_memory": None, "webgl_vendor": None, "webgl_renderer": None, "fonts_hash": None, "voices_hash": None, "canvas_hash": None, "audio_hash": None}
    class ClosingPage:
        url = "https://example.test/closed"
        def __init__(self): self.closed_checks = 0
        def is_closed(self):
            self.closed_checks += 1
            return self.closed_checks > 1
        def title(self): raise module.PlaywrightError("Target page closed")
    closing_facts = module.PageState("page:closed", ClosingPage(), ["https://example.test"]).facts()
    assert closing_facts["status"] == "closed"
    assert closing_facts["title"] == ""
    class TransientTitleErrorPage:
        url = "https://example.test/transient"
        def is_closed(self): return False
        def title(self): raise module.PlaywrightError("Transient protocol error")
    transient_facts = module.PageState("page:transient", TransientTitleErrorPage(), ["https://example.test"]).facts()
    assert transient_facts["status"] == "ready"
    assert transient_facts["title"] == ""
    environment_driver = object.__new__(module.Driver)
    environment_driver.pages = {"page:1": module.PageState("page:1", EnvironmentPage(), ["https://example.test"])}
    environment_driver.bundle = bundle
    initial_environment = environment_driver.environment({"provider_page_ref": "page:1"})
    environment_driver.bundle = updated_bundle
    restarted_environment = environment_driver.environment({"provider_page_ref": "page:1"})
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
import hashlib, importlib.util, os, sys, tempfile, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox")
camoufox.__path__ = []
utils = types.ModuleType("camoufox.utils")
utils.launch_options = lambda **kwargs: {}
utils.get_env_vars = lambda config_map, user_agent_os, path=None: {"CAMOU_CONFIG_1": "{}"}
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

body = b"id,status\\n1,ok\\n"
class FakeDownload:
    def __init__(self, page):
        self.page = page
        self.url = "https://example.test/receipt.csv"
        self.suggested_filename = "receipt.csv"
    def failure(self): return None
    def save_as(self, path):
        with open(path, "wb") as handle: handle.write(body)

class DownloadExpectation:
    def __init__(self, download): self.value = download
    def __enter__(self): return self
    def __exit__(self, *args): return False

class FakeLink:
    def __init__(self, page): self.page = page
    def get_attribute(self, name):
        assert name == "href"
        return "/receipt.csv"
    def evaluate(self, expression): assert expression == "e => Boolean(e.isConnected)"; return True
    def click(self, timeout):
        request = types.SimpleNamespace(frame=types.SimpleNamespace(page=self.page), url="https://example.test/receipt.csv", redirected_from=None)
        for listener in self.page.listeners.get("request", []): listener(request)
        for listener in self.page.listeners.get("download", []): listener(self.page.download)

class FakePage:
    url = "https://example.test/"
    def __init__(self): self.download = FakeDownload(self); self.listeners = {}
    def is_closed(self): return False
    def title(self): return "Example"
    def on(self, event, listener): self.listeners.setdefault(event, []).append(listener)
    def remove_listener(self, event, listener): self.listeners.get(event, []).remove(listener)
    def expect_download(self, timeout):
        assert 1 <= timeout <= 1000
        return DownloadExpectation(self.download)

page = FakePage()
state = module.PageState("page:1", page, ["https://example.test"])
state.controls["control:0"] = ("link", "Download", "/receipt.csv", None, FakeLink(page))
instance = object.__new__(module.Driver)
instance.pages = {"page:1": state}
instance.current = "page:1"
instance.request = {"timeout_ms": 1000}
staging = tempfile.mktemp(prefix="harbor-download-property-")
try:
    result = instance.file_operation({"provider_page_ref": "page:1", "operation": "download", "expected_origin": "https://example.test", "authorized_origins": ["https://example.test"], "target_ref": "control:0", "staging_path": staging, "timeout_ms": 1000})
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
import importlib.util, os, sys, tempfile, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox"); camoufox.__path__ = []
utils = types.ModuleType("camoufox.utils"); utils.launch_options = lambda **kwargs: {}; utils.get_env_vars = lambda *args, **kwargs: {"CAMOU_CONFIG_1": "{}"}
camoufox.utils = utils; sys.modules["camoufox"] = camoufox; sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright"); playwright.__path__ = []
sync_api = types.ModuleType("playwright.sync_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
sync_api.Error = Error; sync_api.Page = Page; sync_api.Route = Route; sync_api.TimeoutError = TimeoutError; sync_api.sync_playwright = lambda: None
playwright.sync_api = sync_api; sys.modules["playwright"] = playwright; sys.modules["playwright.sync_api"] = sync_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class Handle:
    def __init__(self): self.connected = True; self.calls = []
    def evaluate(self, expression):
        if expression == "e => Boolean(e.isConnected)": return self.connected
        if expression == "e => e.files ? e.files.length : 0": return 0
        raise AssertionError(expression)
    def is_visible(self, timeout=None): return self.connected
    def evaluate_files(self): return 0
    def set_input_files(self, path, timeout=None): self.calls.append((path, timeout))
    def dispose(self): self.connected = False

class PageImpl:
    url = "https://a.test/"; main_frame = object()
    def __init__(self): self.handles = [Handle()]
    def is_closed(self): return False
    def title(self): return "Fixture"
    def query_selector_all(self, selector): return list(self.handles)
    def evaluate(self, expression):
        if "document.querySelectorAll" in expression:
            return {"text": "", "controls": [{"i": 0, "dom_index": 0, "role": "file", "name": "Upload", "href": None, "file_index": 0, "enabled": True}]}
        raise AssertionError(expression)

class Request:
    def __init__(self, page, url): self.frame = types.SimpleNamespace(page=page); self.url = url; self.redirected_from = None; self.method = "POST"; self.post_data = None
class RouteImpl:
    def __init__(self, request): self.request = request; self.aborted = None; self.fetch_called = False
    def abort(self, reason): self.aborted = reason
    def fetch(self, **kwargs): self.fetch_called = True; raise AssertionError("unauthorized route fetched")

page = PageImpl(); instance = object.__new__(module.Driver); instance.pages = {}; instance.current = "page:1"; instance.request = {"timeout_ms": 1000}; instance.unattributed_rejection_count = 0
state = module.PageState("page:1", page, ["https://a.test", "https://b.test"]); instance.pages = {"page:1": state}
snap = instance.snapshot(state); old_ref = snap["controls"][0]["target_ref"]; old = page.handles[0]
source = tempfile.mktemp(prefix="harbor-upload-target-"); open(source, "wb").write(b"x")
try:
    sent = instance.file_operation({"provider_page_ref": "page:1", "operation": "upload", "expected_origin": "https://a.test", "authorized_origins": ["https://a.test"], "target_ref": old_ref, "source_path": source, "timeout_ms": 1000})
    assert sent["status"] == "completed", sent
    assert state.origins == {"https://a.test"}
    replacement = Handle(); page.handles = [replacement]; old.connected = False
    stale = instance.file_operation({"provider_page_ref": "page:1", "operation": "upload", "expected_origin": "https://a.test", "authorized_origins": ["https://a.test"], "target_ref": old_ref, "source_path": source, "timeout_ms": 1000})
    assert stale["status"] == "unavailable" and stale["dispatch_state"] == "not_dispatched", stale
    assert replacement.calls == []
    fresh = instance.snapshot(state); fresh_ref = fresh["controls"][0]["target_ref"]
    delivered = instance.file_operation({"provider_page_ref": "page:1", "operation": "upload", "expected_origin": "https://a.test", "authorized_origins": ["https://a.test"], "target_ref": fresh_ref, "source_path": source, "timeout_ms": 1000})
    assert delivered["status"] == "completed", delivered
    route = RouteImpl(Request(page, "https://b.test/steal")); instance.route(route)
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
import importlib.util, os, sys, tempfile, time, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox"); camoufox.__path__ = []
utils = types.ModuleType("camoufox.utils"); utils.launch_options = lambda **kwargs: {}; utils.get_env_vars = lambda *args, **kwargs: {"CAMOU_CONFIG_1": "{}"}
camoufox.utils = utils; sys.modules["camoufox"] = camoufox; sys.modules["camoufox.utils"] = utils
playwright = types.ModuleType("playwright"); playwright.__path__ = []
sync_api = types.ModuleType("playwright.sync_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
sync_api.Error = Error; sync_api.Page = Page; sync_api.Route = Route; sync_api.TimeoutError = TimeoutError; sync_api.sync_playwright = lambda: None
playwright.sync_api = sync_api; sys.modules["playwright"] = playwright; sys.modules["playwright.sync_api"] = sync_api
spec = importlib.util.spec_from_file_location("camoufox_upstream_driver", sys.argv[1]); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class Request:
    def __init__(self, page, url): self.frame = types.SimpleNamespace(page=page); self.url = url; self.redirected_from = None; self.method = "GET"; self.post_data = None
class Link:
    def __init__(self, page, download, extras=()): self.page = page; self.download = download; self.extras = extras
    def evaluate(self, expression): return True
    def get_attribute(self, name): assert name == "href"; return "/expected.csv"
    def click(self, timeout):
        request = Request(self.page, "https://files.test/expected.csv")
        for listener in self.page.listeners.get("request", []): listener(request)
        for item in (self.download, *self.extras):
            for listener in self.page.listeners.get("download", []): listener(item)
class Download:
    def __init__(self, page, url, body=b"id,status\\n1,ok\\n", delay=0): self.page = page; self.url = url; self.suggested_filename = "receipt.csv"; self.body = body; self.delay = delay; self.cancelled = 0; self.deleted = 0
    def failure(self): return None
    def save_as(self, path):
        if self.delay: time.sleep(self.delay)
        with open(path, "wb") as handle: handle.write(self.body)
    def cancel(self): self.cancelled += 1
    def delete(self): self.deleted += 1
class Expectation:
    def __init__(self, value): self.value = value
    def __enter__(self): return self
    def __exit__(self, *args): return False
class PageImpl:
    url = "https://files.test/"; main_frame = object()
    def __init__(self, download, extras=()): self.download = download; self.link = Link(self, download, extras); self.listeners = {}
    def is_closed(self): return False
    def title(self): return "Fixture"
    def on(self, event, listener): self.listeners.setdefault(event, []).append(listener)
    def remove_listener(self, event, listener): self.listeners.get(event, []).remove(listener)
    def expect_download(self, timeout): return Expectation(self.download)
def make(download, extras=()):
    page = PageImpl(download, extras); download.page = page; [setattr(item, "page", page) for item in extras]
    state = module.PageState("page:1", page, ["https://files.test"]); state.controls["target"] = ("link", "Download", "/expected.csv", None, page.link)
    instance = object.__new__(module.Driver); instance.pages = {"page:1": state}; instance.current = "page:1"; instance.request = {"timeout_ms": 1000}; instance.unattributed_rejection_count = 0
    return instance, page
def run(download, extras=(), timeout=1000):
    instance, page = make(download, extras); staging = tempfile.mktemp(prefix="harbor-download-bound-")
    result = instance.file_operation({"provider_page_ref": "page:1", "operation": "download", "expected_origin": "https://files.test", "authorized_origins": ["https://files.test"], "target_ref": "target", "staging_path": staging, "timeout_ms": timeout})
    assert not os.path.exists(staging)
    return result, download, extras
wrong, wrong_download, _ = run(Download(None, "https://files.test/unrelated.csv"))
assert wrong["failure_class"] == "download_relation_unavailable" and wrong_download.cancelled == 1, wrong
first = Download(None, "https://files.test/expected.csv"); second = Download(None, "https://files.test/expected.csv")
multiple, first, extras = run(first, (second,))
assert multiple["failure_class"] == "download_relation_unavailable" and first.cancelled == second.cancelled == 1, multiple
oversize, oversized, _ = run(Download(None, "https://files.test/expected.csv", body=b"x" * (10 * 1024 * 1024 + 1)))
assert oversize["failure_class"] == "file_limit_exceeded" and oversized.cancelled == 1, oversize
timeout, slow, _ = run(Download(None, "https://files.test/expected.csv", delay=0.2), timeout=20)
assert timeout["failure_class"] == "timeout" and slow.cancelled == 1, timeout
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("waits for the declared Page condition instead of returning success after a delay", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import importlib.util, os, sys, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox")
camoufox.__path__ = []
utils = types.ModuleType("camoufox.utils")
utils.launch_options = lambda **kwargs: {}
utils.get_env_vars = lambda config_map, user_agent_os, path=None: {"CAMOU_CONFIG_1": "{}"}
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

class FakeBody:
    def __init__(self, page): self.page = page
    def inner_text(self, timeout=None): return self.page.text

class FakeTarget:
    def __init__(self, page): self.page = page
    def is_visible(self, timeout=None): return True
    def is_enabled(self, timeout=None): return self.page.enabled

class FakePage:
    url = "https://example.test/"
    main_frame = object()
    def __init__(self):
        self.text = "ready"
        self.enabled = False
        self.ticks = 0
        self.on_wait = None
    def is_closed(self): return False
    def title(self): return "Fixture"
    def locator(self, selector):
        assert selector == "body"
        return FakeBody(self)
    def get_by_role(self, role, name, exact):
        assert (role, name, exact) == ("button", "Continue", True)
        return FakeTarget(self)
    def wait_for_timeout(self, milliseconds):
        self.ticks += 1
        if self.on_wait: self.on_wait(self)

page = FakePage()
state = module.PageState("page:1", page, ["https://example.test"])
state.controls["control:0"] = ("button", "Continue", None, None)
instance = object.__new__(module.Driver)
instance.pages = {"page:1": state}
instance.current = "page:1"
instance.request = {"timeout_ms": 1000}

base = {"provider_page_ref": "page:1", "expected_origin": "https://example.test", "authorized_origins": ["https://example.test"]}
missing = instance.interact({**base, "action": "wait", "wait_for": "text", "text": "Processing", "timeout_ms": 100})
assert missing["status"] == "unavailable", missing
assert missing["dispatch_state"] == "not_dispatched", missing
assert missing["failure_class"] == "wait_condition_timeout", missing

page.ticks = 0
page.on_wait = lambda current: setattr(current, "text", "Processing") if current.ticks >= 2 else None
found = instance.interact({**base, "action": "wait", "wait_for": "text", "text": "Processing", "timeout_ms": 100})
assert found["status"] == "completed", found
assert found["dispatch_state"] == "dispatched", found

page.on_wait = lambda current: setattr(current, "enabled", True) if current.ticks >= 2 else None
page.ticks = 0
enabled = instance.interact({**base, "action": "wait", "wait_for": "enabled", "target_ref": "control:0", "timeout_ms": 100})
assert enabled["status"] == "completed", enabled

page.on_wait = lambda current: instance.on_navigate(state, page.main_frame) if current.ticks == 2 else None
page.ticks = 0
changed = instance.interact({**base, "action": "wait", "wait_for": "page_changed", "timeout_ms": 100})
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
import importlib.util, os, sys, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox")
camoufox.__path__ = []
utils = types.ModuleType("camoufox.utils")
utils.launch_options = lambda **kwargs: {}
utils.get_env_vars = lambda config_map, user_agent_os, path=None: {"CAMOU_CONFIG_1": __import__("json").dumps(config_map, separators=(",", ":"))}
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
state.controls["control:stale"] = ("button", "Stale")
driver.on_navigate(state, object())
assert state.generation == 1
driver.on_navigate(state, page.main_frame)
assert state.generation == 2
assert state.controls == {}
driver.on_navigate(state, page.main_frame)
assert state.generation == 3
assert "active" not in state.facts()
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

test("installs the persistent-context guard before the initial navigation and closes safely on setup failure", () => {
  const driver = join(dirname(fileURLToPath(import.meta.url)), "camoufox-upstream-driver.py");
  const script = `
import importlib.util, os, sys, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
camoufox = types.ModuleType("camoufox")
camoufox.__path__ = []
utils = types.ModuleType("camoufox.utils")
utils.launch_options = lambda **kwargs: {}
utils.get_env_vars = lambda config_map, user_agent_os, path=None: {"CAMOU_CONFIG_1": "{}"}
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

events = []
class FakePage:
    def __init__(self):
        self.url = "about:blank"
        self.main_frame = object()
        self.closed = False
    def on(self, *args): events.append(("page.on", args[0]))
    def is_closed(self): return self.closed
    def title(self): return "Fixture"
    def goto(self, url, **kwargs): events.append("goto"); self.url = url
    def close(self): self.closed = True

class FakeContext:
    def __init__(self, page, fail_online=False):
        self.pages = [page]
        self.fail_online = fail_online
    def on(self, event, callback): events.append(("context.on", event))
    def route(self, pattern, callback): events.append(("context.route", pattern))
    def set_offline(self, value):
        events.append(("context.offline", value))
        if self.fail_online: raise RuntimeError("offline setup failure")
    def close(self): events.append("context.close")
    def new_page(self): return self.pages[0]

class FakeBrowserType:
    def launch_persistent_context(self, **kwargs):
        events.append(("launch", kwargs.get("offline"), kwargs.get("service_workers")))
        return current_context

class FakePlaywright:
    firefox = FakeBrowserType()
    def stop(self): events.append("playwright.stop")

class Factory:
    def start(self): events.append("playwright.start"); return FakePlaywright()

module.verify_runtime_pins = lambda request: "properties"
module.options_for = lambda request, profile: ({"args": [], "env": {}, "executable_path": request["browser_path"], "firefox_user_prefs": {}, "headless": False}, {"identity_hash": "stable"}, False, {})
module.sync_playwright = lambda: Factory()
request = {"profile_dir": "/tmp/harbor-driver-guard", "browser_path": "/managed/camoufox", "source": {"source": "official_release", "source_sha256": module.SOURCE_SHA256_PIN, "camoufox_version": module.CAMOUFOX_VERSION_PIN, "browser_version": module.BROWSER_VERSION_PIN, "playwright_version": module.PLAYWRIGHT_VERSION_PIN}, "url": "https://s1.test/start", "timeout_ms": 100}
current_context = FakeContext(FakePage())
instance = module.Driver(request)
launch_index = next(i for i, value in enumerate(events) if isinstance(value, tuple) and value[0] == "launch")
route_index = events.index(("context.route", "**/*"))
offline_index = events.index(("context.offline", False))
goto_index = events.index("goto")
assert events[launch_index] == ("launch", True, "block")
assert launch_index < route_index < offline_index < goto_index
instance.close()

events.clear()
current_context = FakeContext(FakePage(), fail_online=True)
try:
    module.Driver(request)
    raise AssertionError("setup failure was swallowed")
except RuntimeError:
    pass
assert "context.close" in events
assert "playwright.stop" in events
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
