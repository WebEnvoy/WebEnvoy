import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CAMOUFOX_UPSTREAM_PINS, launchCamoufoxUpstreamProvider } from "./camoufox-upstream-driver.js";
import { launchSharedPlaywrightProvider, type SharedProviderAdapter } from "./playwright-shared-driver.js";
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
let pageListCalls = 0;
const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  const request = JSON.parse(line);
  let result;
  if (request.op === "launch") result = { status: "ready", driver_ref: "fixture-camoufox", page, pages: [page], viewer_entry: { availability: "unsupported", access_mode: "none", transport: "not_applicable", input_capabilities: [] }, facts: [{ key: "fixture.browser_path", source: "observed", value: request.browser_path }, { key: "fixture.environment.proxy_server", source: "observed", value: String(request.environment?.proxy_server ?? "") }, { key: "fixture.environment.viewport", source: "observed", value: JSON.stringify(request.environment?.viewport ?? null) }] };
  else if (request.op === "page_list" && ++pageListCalls > 1) {
    process.stdout.write(JSON.stringify({ id: request.id, status: "error", message: "Private URL and provider stack details must not escape." }) + "\\n");
    continue;
  }
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
  if (request.op === "interact" && request.action === "snapshot") for (const phase of ["candidate_capture", "candidate_query", "control_read", "accessibility_semantics"]) process.stdout.write(JSON.stringify({ id: 0, event: "provider_snapshot_phase", stage: "provider_snapshot", phase, outcome: "started", duration_ms: 0, observed_at: "2026-09-09T18:00:00.000Z", ...(phase === "control_read" ? { code: "control_index_32" } : {}) }) + "\\n");
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
    const providerDiagnostics: import("./runtime-session-types.js").RuntimeProviderOperationDiagnostic[] = [];
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
        record_provider_diagnostic: diagnostic => providerDiagnostics.push(diagnostic),
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
      await assert.rejects(() => result.pageController!.listPages(), /Private URL and provider stack details must not escape/);
      assert.deepEqual(providerDiagnostics.map(item => ({ stage: item.stage, ...(item.phase === undefined ? {} : { phase: item.phase }), outcome: item.outcome, code: item.code })), [
        { stage: "page_list_request", outcome: "completed", code: undefined },
        { stage: "provider_snapshot", phase: "candidate_capture", outcome: "started", code: undefined },
        { stage: "provider_snapshot", phase: "candidate_query", outcome: "started", code: undefined },
        { stage: "provider_snapshot", phase: "control_read", outcome: "started", code: "control_index_32" },
        { stage: "provider_snapshot", phase: "accessibility_semantics", outcome: "started", code: undefined },
        { stage: "provider_snapshot", outcome: "completed", code: undefined },
        { stage: "page_list_request", outcome: "error", code: "request_failed" }
      ]);
      assert.equal(JSON.stringify(providerDiagnostics).includes("Private URL"), false);
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

test("covers #540 G0 enumeration, semantics, identity, and bounded waits in the shared driver", () => {
  const driver = join(DRIVER_DIR, "playwright_shared_driver.py");
  const script = String.raw`
import asyncio, contextlib, importlib.util, io, json, os, sys, time, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
playwright = types.ModuleType("playwright"); playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error; async_api.Page = Page; async_api.Route = Route; async_api.TimeoutError = TimeoutError; async_api.async_playwright = lambda: None
playwright.async_api = async_api; sys.modules["playwright"] = playwright; sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("playwright_shared_driver", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

progress_output = io.StringIO()
with contextlib.redirect_stdout(progress_output):
    started = module.Driver._record_snapshot_phase("candidate_capture", "started")
    module.Driver._record_snapshot_phase("candidate_capture", "completed", started)
progress_events = [json.loads(line) for line in progress_output.getvalue().splitlines()]
assert len(progress_events) == 2, progress_events
assert all(event["id"] == 0 and event["event"] == "provider_snapshot_phase" and event["stage"] == "provider_snapshot" for event in progress_events), progress_events
assert all(event["phase"] == "candidate_capture" and "page_text" not in event for event in progress_events), progress_events
assert [event["outcome"] for event in progress_events] == ["started", "completed"], progress_events

class Handle:
    def __init__(self, index, role="button", name=None, name_source="none", description=None):
        self.index = index
        self.role = role
        self.name = name if name is not None else "Action " + str(index)
        self.public_role = role
        self.public_name = self.name
        self.name_source = name_source
        self.description = description
        self.form_token = object()
        self.form_action = "/compose"
        self.form_action_override = None
        self.form_method_override = None
        self.context = [{"kind": "form", "name": "Composer"}]
        self.placeholder = "Save value"
        self.connected = True
        self.clicks = 0
        self.fills = []
        self.presses = []
        self.disposals = 0
        self.aria_snapshot_calls = 0
        self.dom_identity = object()
    def clone(self):
        clone = object.__new__(Handle)
        clone.__dict__ = self.__dict__.copy()
        clone.disposals = 0
        return clone
    def metadata(self):
        return {
            "role": self.role,
            "name": self.name,
            "name_source": self.name_source,
            "description": self.description,
            "description_source": "aria-describedby" if self.description else None,
            "context": self.context,
            "hints": {"placeholder": self.placeholder, "input_type": None, "multiline": False, "editable": False},
            "href": None,
            "action": {"href": None, "download": None, "target": None, "form": {"action": self.form_action, "method": "post", "formaction": self.form_action_override, "formmethod": self.form_method_override}},
            "enabled": True,
            "dom_index": self.index,
            "truncated_fields": [],
        }
    async def evaluate(self, expression, *args):
        if expression == "e => Boolean(e.isConnected)": return self.connected
        if expression == "e => e.files ? e.files.length : 0": return 0
        if expression == "(e, other) => e === other": return bool(args) and args[0].dom_identity is self.dom_identity
        if expression == "(e, form) => e.form === form": return bool(args) and args[0] is self.form_token
        if "getBoundingClientRect" in expression: return self.metadata()
        raise AssertionError("unexpected handle expression: " + expression)
    async def evaluate_handle(self, expression):
        assert expression == "e => e.form"
        return self.form_token
    async def is_visible(self): return self.connected
    async def is_enabled(self): return self.connected
    async def click(self, timeout=None): self.clicks += 1
    async def fill(self, text, timeout=None): self.fills.append(text)
    async def press(self, key, timeout=None): self.presses.append(key)
    async def dispose(self): self.disposals += 1

class Body:
    def __init__(self, page): self.page = page
    async def inner_text(self, timeout=None): return self.page.text

class ControlLocator:
    def __init__(self, page, handles, fresh=False):
        self.page = page
        self.handles = handles
        self.fresh = fresh
    def nth(self, index):
        return ControlLocator(self.page, self.handles[index:index + 1], self.fresh)
    async def count(self): return len(self.handles)
    async def element_handle(self):
        if not self.handles:
            return None
        return self.handles[0].clone() if self.fresh else self.handles[0]
    async def evaluate(self, expression, *args):
        assert expression == "(candidate, original) => candidate === original"
        return bool(self.handles) and bool(args) and self.handles[0].dom_identity is args[0].dom_identity
    async def aria_snapshot(self):
        handle = self.handles[0] if self.handles else None
        if handle is not None: handle.aria_snapshot_calls += 1
        return None if handle is None else "- " + handle.public_role + " " + json.dumps(handle.public_name)

class Mouse:
    def __init__(self): self.wheels = []
    async def wheel(self, x, y): self.wheels.append((x, y))

class PageImpl:
    url = "https://example.test/form"
    main_frame = object()
    def __init__(self):
        self.text = "short body"
        self.handles = self.make_handles()
        self.mutate_after_text = False
        self.locator_mismatch_index = None
        self.wait_ticks = 0
        self.mouse = Mouse()
        self.fresh_after_first_query = False
        self.query_count = 0
        self.last_query_handles = []
    @staticmethod
    def make_handles():
        values = [
            # Same role/name/context; only aria-describedby distinguishes these
            # controls, so the public result must not fall back to ambiguity.
            Handle(0, name="Save", name_source="html_label", description="Primary action"),
            Handle(1, name="Save", name_source="aria_labelledby", description="Secondary action"),
            Handle(2, name="Save", name_source="aria_label", description="Tertiary action"),
        ]
        values.extend(Handle(index) for index in range(3, 160))
        # Keep this same-name group across the 128/32 response boundary.
        values[127] = Handle(127, name="Save", name_source="content", description="Fourth action")
        values[128] = Handle(128, name="Save", name_source="content", description="Fifth action")
        return values
    @staticmethod
    def make_ambiguous_handles():
        values = PageImpl.make_handles()
        values[0] = Handle(0, name="Save", name_source="html_label", description="Same action")
        values[1] = Handle(1, name="Save", name_source="aria_labelledby", description="Same action")
        values[2] = Handle(2, name="Other", name_source="aria_label", description="Other action")
        return values
    @staticmethod
    def make_incomplete_handles():
        first = Handle(0, name="Save")
        first.context = []
        first.placeholder = None
        return [first] + [Handle(index, name="Action " + str(index)) for index in range(1, 2049)]
    @staticmethod
    def make_metadata_limited_handles():
        handles = []
        for index in range(800):
            handle = Handle(index, name="名" * 256, description="说明" * 128)
            handle.public_name = "名" * 256
            handle.context = [{"kind": "form", "name": "模块" * 64}, {"kind": "region", "name": "区域" * 64}]
            handle.placeholder = "提示" * 64
            handles.append(handle)
        return handles
    def is_closed(self): return False
    async def title(self): return "Fixture"
    async def query_selector_all(self, selector):
        self.query_count += 1
        handles = list(self.handles)
        if self.fresh_after_first_query and self.query_count > 1:
            handles = [handle.clone() for handle in handles]
            self.last_query_handles = handles
        return handles
    async def evaluate(self, expression):
        if "document.body" in expression:
            text = self.text
            if self.mutate_after_text:
                self.mutate_after_text = False
                self.handles[0].description = "Changed before publish"
            return text
        raise AssertionError("unexpected page expression: " + expression)
    def locator(self, selector):
        if selector == "body": return Body(self)
        assert selector == module.OBSERVATION_SELECTOR
        handles = list(self.handles)
        if self.locator_mismatch_index is not None:
            index = self.locator_mismatch_index
            handles[index] = Handle(index, name=self.handles[index].name)
        return ControlLocator(self, handles, self.fresh_after_first_query and self.query_count > 1)
    def get_by_role(self, role, name, exact):
        return ControlLocator(self, [handle for handle in self.handles if handle.public_role == role and handle.public_name == name])
    async def wait_for_timeout(self, milliseconds):
        self.wait_ticks += 1
        await asyncio.sleep(0)

class EmptyLocator:
    def nth(self, index): return self
    async def element_handle(self): return None

class ScanHandle:
    def __init__(self): self.disposals = 0
    async def evaluate(self, expression, *args): raise AssertionError("scan sentinel is not a control")
    async def dispose(self): self.disposals += 1

class UnobservableHandle(Handle):
    async def evaluate(self, expression, *args):
        if expression == module.CONTROL_SEMANTICS_SCRIPT: return None
        return await super().evaluate(expression, *args)

class ScanPage:
    url = "https://example.test/form"
    main_frame = object()
    def __init__(self): self.handles = [ScanHandle() for _ in range(module.MAX_OBSERVATION_ELEMENTS + 1)]
    async def query_selector_all(self, selector): return list(self.handles)
    def locator(self, selector): return EmptyLocator()
    async def evaluate(self, expression): return "short body"

async def run():
    page = PageImpl()
    state = module.PageState("page:1", page, ["https://example.test"])
    instance = object.__new__(module.Driver)
    instance.pages = {"page:1": state}
    instance.current = "page:1"
    instance.request = {"timeout_ms": 1000}
    instance.close_requested = asyncio.Event()
    common = {"provider_page_ref": "page:1", "page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "expected_origin": "https://example.test", "authorized_origins": ["https://example.test"]}

    # Unsupported/hidden selector candidates are filtered by the fixed DOM
    # projection and must not trigger an expensive provider AX snapshot.
    hidden_handle = UnobservableHandle(0)
    visible_handle = Handle(1)
    page.handles = [hidden_handle, visible_handle]
    filtered_state = module.PageState("page:filtered", page, ["https://example.test"])
    filtered_batch = await instance.snapshot(filtered_state, {"page_ref": "page:filtered", "page_id": "page:filtered", "document_generation": 1, "limit": 128})
    assert filtered_batch["coverage"]["controls"]["captured_count"] == 1, filtered_batch
    assert hidden_handle.aria_snapshot_calls == 0, hidden_handle.aria_snapshot_calls
    assert visible_handle.aria_snapshot_calls == 2, visible_handle.aria_snapshot_calls
    page.handles = PageImpl.make_handles()

    # Regression: a DOM semantic change after body text capture must reject
    # the first batch and release every original ElementHandle.
    original_capture_handles = list(page.handles)
    page.mutate_after_text = True
    try:
        await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
        raise AssertionError("changed first snapshot was published")
    except module.ObservationFailure as error:
        assert error.failure_class == "observation_changed", error.failure_class
    assert state.snapshot_batch is None
    assert state.controls == {}
    assert all(handle.disposals == 1 for handle in original_capture_handles), [handle.disposals for handle in original_capture_handles]

    page.handles = PageImpl.make_handles()
    first = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    assert first["schema_version"] == "harbor-observation-targets/v1", first
    assert len(first["controls"]) == 128, len(first["controls"])
    assert first["coverage"]["controls"]["captured_count"] == 160, first
    assert first["coverage"]["controls"]["returned_through"] == 128, first
    assert first["continuation"]["has_more"] is True, first
    assert all(control["name_source"] == "provider_accessibility" for control in first["controls"]), first["controls"][:3]
    assert first["controls"][0]["description"] == "Primary action", first["controls"][0]
    assert "value" not in first["controls"][0], first["controls"][0]
    assert first["controls"][0]["context"] == [{"kind": "form", "name": "Composer"}], first["controls"][0]
    assert first["controls"][0]["disambiguation"] == "contextual", first["controls"][0]

    first_ref = first["controls"][0]["target_ref"]
    first_handle = page.handles[0]
    assert state.control_metadata[first_ref]["action"]["form"]["action"] == "/compose", state.control_metadata[first_ref]
    assert state.control_metadata[first_ref]["action"]["form"]["method"] == "post", state.control_metadata[first_ref]
    assert await instance.control_handle(state, first_ref) is first_handle
    assert await instance.locator(state, {"target_ref": first_ref, "observation_ref": first["observation_ref"], "document_generation": 1}) is first_handle

    continuation = dict(common, action="snapshot", observation_ref=first["observation_ref"], cursor=first["continuation"]["next_cursor"], limit=128)
    second_result = await instance.interact(continuation)
    assert second_result["status"] == "completed", second_result
    second = second_result["snapshot"]
    assert second["observation_ref"] == first["observation_ref"], second
    assert second["captured_at"] == first["captured_at"], second
    assert len(second["controls"]) == 32, second
    assert second["continuation"]["has_more"] is False, second
    assert second["controls"][0]["name"] == "Save", second["controls"][0]
    assert second["controls"][0]["disambiguation"] == "contextual", second["controls"][0]
    assert await instance.control_handle(state, first_ref) is first_handle
    assert await instance.locator(state, {"target_ref": first_ref, "observation_ref": first["observation_ref"], "document_generation": 1}) is first_handle

    clicked = await instance.interact(dict(common, action="click", observation_ref=first["observation_ref"], target_ref=first_ref))
    assert clicked["status"] == "completed" and clicked["dispatch_state"] == "dispatched", clicked
    assert first_handle.clicks == 1, first_handle.clicks

    # Public role/name wins over the fixed DOM supplement, but a Locator that
    # denotes another node is rejected rather than aligned by array order.
    page.handles = PageImpl.make_handles()
    page.handles[0].public_name = "Public Save"
    public_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    assert public_batch["controls"][0]["name"] == "Public Save", public_batch["controls"][0]
    assert public_batch["controls"][0]["name_source"] == "provider_accessibility", public_batch["controls"][0]
    public_ref = public_batch["controls"][0]["target_ref"]
    page.handles[0].public_name = "Renamed Save"
    public_changed = await instance.interact(dict(common, action="click", observation_ref=public_batch["observation_ref"], target_ref=public_ref))
    assert public_changed["status"] == "unavailable", public_changed
    assert public_changed["dispatch_state"] == "not_dispatched", public_changed
    assert public_changed["failure_class"] == "target_semantics_changed", public_changed
    page.handles = PageImpl.make_handles()
    page.locator_mismatch_index = 0
    try:
        await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
        raise AssertionError("mismatched public Locator was adopted")
    except module.ObservationFailure as error:
        assert error.failure_class == "observation_changed", error.failure_class
    page.locator_mismatch_index = None

    # Regression: an incomplete enumeration cannot turn a singleton with
    # false/general hints into a contextual target.
    page.handles = PageImpl.make_incomplete_handles()
    incomplete_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    assert incomplete_batch["coverage"]["controls"]["enumeration_complete"] is False, incomplete_batch["coverage"]["controls"]
    assert "capture_limit_reached" in incomplete_batch["coverage"]["controls"]["reason_codes"], incomplete_batch["coverage"]["controls"]
    incomplete_ref = incomplete_batch["controls"][0]["target_ref"]
    assert incomplete_batch["controls"][0]["disambiguation"] == "ambiguous", incomplete_batch["controls"][0]
    incomplete_action = await instance.interact(dict(common, action="click", observation_ref=incomplete_batch["observation_ref"], target_ref=incomplete_ref))
    assert incomplete_action["status"] == "unavailable", incomplete_action
    assert incomplete_action["dispatch_state"] == "not_dispatched", incomplete_action
    assert incomplete_action["failure_class"] == "target_ambiguous", incomplete_action
    assert page.handles[0].clicks == 0, page.handles[0].clicks

    scan_page = ScanPage()
    scan_state = module.PageState("page:scan", scan_page, ["https://example.test"])
    scan_batch = await instance.snapshot(scan_state, {"page_ref": "page:scan", "page_id": "page:scan", "document_generation": 1, "limit": 128})
    scan_controls = scan_batch["coverage"]["controls"]
    assert scan_batch["controls"] == [], scan_batch
    assert scan_controls["enumeration_complete"] is False, scan_controls
    assert scan_controls["captured_count"] == 0, scan_controls
    assert scan_controls["total"] is None, scan_controls
    assert scan_controls["reason_codes"] == ["scan_limit_reached"], scan_controls
    assert scan_batch["continuation"]["has_more"] is False, scan_batch
    assert scan_controls["complete"] is False, scan_controls
    assert all(handle.disposals > 0 for handle in scan_page.handles), "scan-limit handles were not released"

    page.handles = PageImpl.make_ambiguous_handles()
    ambiguous_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    ambiguous_ref = ambiguous_batch["controls"][0]["target_ref"]
    ambiguous = await instance.interact(dict(common, action="click", observation_ref=ambiguous_batch["observation_ref"], target_ref=ambiguous_ref))
    assert ambiguous["status"] == "unavailable", ambiguous
    assert ambiguous["dispatch_state"] == "not_dispatched", ambiguous
    assert ambiguous["failure_class"] == "target_ambiguous", ambiguous
    assert page.handles[0].clicks == 0, page.handles[0].clicks
    other_ref = ambiguous_batch["controls"][2]["target_ref"]
    other = await instance.interact(dict(common, action="click", observation_ref=ambiguous_batch["observation_ref"], target_ref=other_ref))
    assert other["status"] == "completed" and other["dispatch_state"] == "dispatched", other
    assert page.handles[2].clicks == 1, page.handles[2].clicks

    # Regression: the metadata budget makes the captured batch incomplete;
    # unchanged candidates must still pass the same-budget consistency check.
    page.handles = PageImpl.make_metadata_limited_handles()
    page.fresh_after_first_query = True
    page.query_count = 0
    metadata_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    metadata_verification_handles = list(page.last_query_handles)
    metadata_controls = metadata_batch["coverage"]["controls"]
    assert metadata_controls["enumeration_complete"] is False, metadata_controls
    assert metadata_controls["captured_count"] < 800, metadata_controls
    assert metadata_controls["total"] is None, metadata_controls
    assert "metadata_truncated" in metadata_controls["reason_codes"], metadata_controls
    assert metadata_batch["coverage"]["semantics"]["complete"] is False, metadata_batch
    assert "metadata_truncated" in metadata_batch["coverage"]["semantics"]["reason_codes"], metadata_batch
    assert metadata_batch["continuation"]["has_more"] is True, metadata_batch
    assert metadata_batch["continuation"]["returned_count"] == len(metadata_batch["controls"]) > 0, metadata_batch
    assert all(handle.disposals == 1 for handle in metadata_verification_handles), "fresh consistency handles were not released"
    metadata_cursor = metadata_batch["continuation"]["next_cursor"]
    metadata_continuation = metadata_batch
    metadata_refs = [control["target_ref"] for control in metadata_batch["controls"]]
    metadata_segments = 1
    while metadata_continuation["continuation"]["has_more"]:
        assert metadata_segments < 16, "metadata continuation did not make progress"
        metadata_cursor_result = await instance.interact(dict(common, action="snapshot", observation_ref=metadata_batch["observation_ref"], cursor=metadata_cursor, limit=128))
        assert metadata_cursor_result["status"] == "completed", metadata_cursor_result
        metadata_continuation = metadata_cursor_result["snapshot"]
        assert metadata_continuation["observation_ref"] == metadata_batch["observation_ref"], metadata_continuation
        assert metadata_continuation["captured_at"] == metadata_batch["captured_at"], metadata_continuation
        assert metadata_continuation["coverage"]["controls"]["reason_codes"] == metadata_controls["reason_codes"], metadata_continuation
        assert metadata_continuation["continuation"]["returned_count"] == len(metadata_continuation["controls"]) > 0, metadata_continuation
        metadata_refs.extend(control["target_ref"] for control in metadata_continuation["controls"])
        metadata_segments += 1
        metadata_cursor = metadata_continuation["continuation"]["next_cursor"]
    assert metadata_continuation["continuation"]["has_more"] is False, metadata_continuation
    assert metadata_continuation["continuation"]["next_cursor"] is None, metadata_continuation
    assert metadata_continuation["coverage"]["controls"]["complete"] is False, metadata_continuation
    assert metadata_continuation["coverage"]["controls"]["returned_through"] == metadata_controls["captured_count"], metadata_continuation
    retained_count = metadata_controls["captured_count"]
    assert len(metadata_refs) == retained_count, metadata_refs
    assert len(set(metadata_refs)) == retained_count, metadata_refs
    assert state.snapshot_batch["records"][0]["handle"] is page.handles[0], (state.snapshot_batch["records"][0]["handle"], page.handles[0])
    assert metadata_verification_handles[0] is not page.handles[0], (metadata_verification_handles[0], page.handles[0])
    assert all(handle.disposals == 0 for handle in page.handles[:retained_count]), [(index, handle.disposals) for index, handle in enumerate(page.handles[:retained_count]) if handle.disposals][:5]
    assert all(handle.disposals > 0 for handle in page.handles[retained_count:]), "unretained handles were not released"

    page.handles[0].description = "变化后的描述"
    metadata_changed = await instance.interact(dict(common, action="snapshot", observation_ref=metadata_batch["observation_ref"], cursor=metadata_batch["continuation"]["next_cursor"], limit=128))
    assert metadata_changed["status"] == "unavailable", metadata_changed
    assert metadata_changed["dispatch_state"] == "not_dispatched", metadata_changed
    assert metadata_changed["failure_class"] == "observation_cursor_stale", metadata_changed
    assert all(handle.disposals == 1 for handle in page.last_query_handles), "changed-page consistency handles were not released"

    page.handles = PageImpl.make_handles()
    page.fresh_after_first_query = False
    changed_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    changed_first = page.handles[0]
    changed_first.description = "Changed after capture"
    semantic_action = await instance.interact(dict(common, action="click", observation_ref=changed_batch["observation_ref"], target_ref=changed_batch["controls"][0]["target_ref"]))
    assert semantic_action["status"] == "unavailable", semantic_action
    assert semantic_action["dispatch_state"] == "not_dispatched", semantic_action
    assert semantic_action["failure_class"] == "target_semantics_changed", semantic_action
    assert changed_first.clicks == 0, changed_first.clicks
    cursor_stale = await instance.interact(dict(common, action="snapshot", observation_ref=changed_batch["observation_ref"], cursor=changed_batch["continuation"]["next_cursor"], limit=128))
    assert cursor_stale["status"] == "unavailable", cursor_stale
    assert cursor_stale["dispatch_state"] == "not_dispatched", cursor_stale
    assert cursor_stale["failure_class"] == "observation_cursor_stale", cursor_stale

    # A query-only effective form-action change must remain distinguishable in
    # the private identity even though the stored action facts are redacted.
    page.handles = PageImpl.make_handles()
    query_first = page.handles[0]
    query_first.form_action = "/compose?id=1"
    query_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    query_first.form_action = "/compose?id=2"
    query_action = await instance.interact(dict(common, action="click", observation_ref=query_batch["observation_ref"], target_ref=query_batch["controls"][0]["target_ref"]))
    assert query_action["status"] == "unavailable", query_action
    assert query_action["dispatch_state"] == "not_dispatched", query_action
    assert query_action["failure_class"] == "target_semantics_changed", query_action
    assert query_first.clicks == 0, query_first.clicks

    page.handles = PageImpl.make_handles()
    form_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    form_first = page.handles[0]
    form_first.form_action = "/different-form"
    form_action = await instance.interact(dict(common, action="click", observation_ref=form_batch["observation_ref"], target_ref=form_batch["controls"][0]["target_ref"]))
    assert form_action["status"] == "unavailable", form_action
    assert form_action["dispatch_state"] == "not_dispatched", form_action
    assert form_action["failure_class"] == "target_semantics_changed", form_action
    assert form_first.clicks == 0, form_first.clicks

    # Regression: changing a submitter's formaction/formmethod on the same
    # node invalidates the old target before any click is dispatched.
    page.handles = PageImpl.make_handles()
    override_first = page.handles[0]
    override_first.form_action_override = "/alternate-form?id=1"
    override_first.form_method_override = "post"
    override_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    override_first.form_action_override = "/alternate-form?id=2"
    override_action = await instance.interact(dict(common, action="click", observation_ref=override_batch["observation_ref"], target_ref=override_batch["controls"][0]["target_ref"]))
    assert override_action["status"] == "unavailable", override_action
    assert override_action["dispatch_state"] == "not_dispatched", override_action
    assert override_action["failure_class"] == "target_semantics_changed", override_action
    assert override_first.clicks == 0, override_first.clicks

    # A method-only submitter override change is independently identity-bound.
    override_first.form_action_override = "/alternate-form?id=1"
    override_first.form_method_override = "get"
    method_action = await instance.interact(dict(common, action="click", observation_ref=override_batch["observation_ref"], target_ref=override_batch["controls"][0]["target_ref"]))
    assert method_action["status"] == "unavailable", method_action
    assert method_action["dispatch_state"] == "not_dispatched", method_action
    assert method_action["failure_class"] == "target_semantics_changed", method_action
    assert override_first.clicks == 0, override_first.clicks

    page.handles = PageImpl.make_handles()
    replacement_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    replacement_ref = replacement_batch["controls"][0]["target_ref"]
    replaced = page.handles[0]
    replacement = Handle(0, name="Save", name_source="html_label", description="Primary action")
    page.handles[0] = replacement
    replaced.connected = False
    stale_action = await instance.interact(dict(common, action="click", observation_ref=replacement_batch["observation_ref"], target_ref=replacement_ref))
    assert stale_action["status"] == "unavailable", stale_action
    assert stale_action["dispatch_state"] == "not_dispatched", stale_action
    assert stale_action["failure_class"] == "target_stale", stale_action
    assert replaced.clicks == 0 and replacement.clicks == 0, (replaced.clicks, replacement.clicks)

    page.handles = PageImpl.make_handles()
    stable_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    stable_first = page.handles[0]
    page.text = "unrelated countdown 10:01"
    stable_action = await instance.interact(dict(common, action="click", observation_ref=stable_batch["observation_ref"], target_ref=stable_batch["controls"][0]["target_ref"]))
    assert stable_action["status"] == "completed" and stable_action["dispatch_state"] == "dispatched", stable_action
    assert stable_first.clicks == 1, stable_first.clicks

    page.handles = PageImpl.make_handles()
    old_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    page.handles = PageImpl.make_handles()
    new_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    old_cursor = await instance.interact(dict(common, action="snapshot", observation_ref=old_batch["observation_ref"], cursor=old_batch["continuation"]["next_cursor"], limit=128))
    assert old_cursor["status"] == "unavailable", old_cursor
    assert old_cursor["dispatch_state"] == "not_dispatched", old_cursor
    assert old_cursor["failure_class"] == "observation_cursor_stale", old_cursor
    assert new_batch["observation_ref"] != old_batch["observation_ref"], (old_batch, new_batch)

    page.handles = PageImpl.make_handles()
    navigation_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 1, "limit": 128})
    await instance.on_navigate(state, page.main_frame)
    navigation_cursor = await instance.interact(dict(common, action="snapshot", observation_ref=navigation_batch["observation_ref"], cursor=navigation_batch["continuation"]["next_cursor"], limit=128))
    assert navigation_cursor["status"] == "unavailable", navigation_cursor
    assert navigation_cursor["dispatch_state"] == "not_dispatched", navigation_cursor
    assert navigation_cursor["failure_class"] == "observation_cursor_stale", navigation_cursor

    page.handles = PageImpl.make_handles()
    list_batch = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 2, "limit": 128})
    page.handles = PageImpl.make_handles()
    list_cursor = await instance.interact(dict(common, action="snapshot", document_generation=2, observation_ref=list_batch["observation_ref"], cursor=list_batch["continuation"]["next_cursor"], limit=128))
    assert list_cursor["status"] == "unavailable", list_cursor
    assert list_cursor["dispatch_state"] == "not_dispatched", list_cursor
    assert list_cursor["failure_class"] == "observation_cursor_stale", list_cursor

    page.handles = PageImpl.make_handles()
    wait_start = time.monotonic()
    wait_result = await instance.interact(dict(common, action="wait", document_generation=2, wait_for="text", text="never present", timeout_ms=75))
    assert wait_result["status"] == "unavailable", wait_result
    assert wait_result["dispatch_state"] == "dispatched", wait_result
    assert wait_result["failure_class"] == "wait_condition_timeout", wait_result
    assert page.wait_ticks > 0, page.wait_ticks
    assert time.monotonic() - wait_start < 1.0

    # Public field caps make a single control too small to trigger the
    # response ceiling; keep the deterministic guard and exercise the
    # multi-byte 64 KiB text boundary instead.
    page.text = "界" * 32768
    bounded = await instance.snapshot(state, {"page_ref": "page:1", "page_id": "page:1", "document_generation": 2, "limit": 128})
    assert len(bounded["controls"]) == 128, len(bounded["controls"])
    assert len(json.dumps(bounded, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) < 256 * 1024
    assert bounded["truncated"] is True, bounded
    assert bounded["coverage"]["text"]["state"] == "truncated", bounded
    assert len(bounded["text"].encode("utf-8")) == 65535, len(bounded["text"].encode("utf-8"))
    assert "\ufffd" not in bounded["text"], "UTF-8 truncation split a code point"

asyncio.run(run())
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("keeps Camoufox and Chrome on the shared public observation projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "harbor-shared-observation-probe-"));
  const helper = join(root, "fixture-driver.mjs");
  await writeFile(helper, `import readline from "node:readline";
const page = { provider_page_ref: "page:1", current_url: "https://example.test/form", title: "Fixture", status: "ready", origin: "https://example.test", active: true, document_generation: 1, task_selected: true, facts: [] };
const snapshot = { schema_version: "harbor-observation-targets/v1", page_id: "page-id", document_generation: 1, captured_at: "2026-09-17T00:00:00.000Z", page_ref: "page-id", observation_ref: "observation:1", controls: [{ target_ref: "target:save", role: "button", name: "Save", name_source: "aria_labelledby", description: "Primary action", context: [{ kind: "form", name: "Composer" }], hints: { placeholder: null, input_type: null, multiline: false, editable: false }, disambiguation: "unique", enabled: true, truncated_fields: [] }], text: "short body", truncated: false, coverage: { controls: { enumeration_complete: true, captured_count: 1, total: 1, returned_through: 1, complete: true, reason_codes: [] }, text: { state: "complete", returned_bytes: 10 }, semantics: { state: "complete", reason_codes: [] } }, continuation: { has_more: false, next_cursor: null } };
const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  const request = JSON.parse(line);
  let result;
  if (request.op === "launch") result = { status: "ready", driver_ref: "fixture-shared", page, pages: [page], viewer_entry: { availability: "unsupported", access_mode: "none", transport: "not_applicable", input_capabilities: [] }, facts: [] };
  else if (request.op === "interact") result = request.action === "snapshot" ? { status: "completed", dispatch_state: "not_dispatched", page, snapshot } : { status: "completed", dispatch_state: "dispatched", page: { ...page, facts: [{ key: "fixture.target", source: "observed", value: String(request.target_ref ?? "") }] } };
  else if (request.op === "close") result = { closed: true };
  else result = page;
  process.stdout.write(JSON.stringify({ id: request.id, status: "ok", result }) + "\\n");
}`);
  await chmod(helper, 0o700);
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = join(root, "profiles");
  try {
    for (const provider_id of ["camoufox", "chrome_official"] as const) {
      const input = {
        operation_scope: "profile_management",
        browser_path: `/managed/${provider_id}`,
        provider_id,
        headless: true,
        timeout_ms: 1_000,
        url: "https://example.test/form",
        profile_ref: `profile:${provider_id}`,
        profile_storage_ref: `storage:${provider_id}`,
        provider_ref: `provider:${provider_id}`,
        scope_semantics: "agent_operations_v2"
      } as LocalProviderLaunchInput;
      const adapter: SharedProviderAdapter = {
        provider_id,
        driver_filename: "fixture-driver.mjs",
        pythonPath: () => process.execPath,
        driverPath: () => helper,
        browserPath: () => input.browser_path,
        launchFields: () => ({}),
        facts: () => [],
        normalizeEnvironmentObservation: () => null
      };
      const launched = await launchSharedPlaywrightProvider(input, adapter);
      try {
        assert.equal(launched.status, "ready", `${provider_id} did not reach shared launch: ${JSON.stringify(launched)}`);
        if (launched.status !== "ready") continue;
        assert.ok(launched.interaction);
        const observed = await launched.interaction({ action: "snapshot", expected_origin: "https://example.test", control_generation: 1 });
        assert.equal(observed.status, "completed", `${provider_id} snapshot was not completed`);
        const publicSnapshot = observed.snapshot as unknown as { schema_version?: string; controls?: Array<Record<string, unknown>> };
        const firstControl = publicSnapshot.controls?.[0];
        assert.equal(publicSnapshot.schema_version, "harbor-observation-targets/v1");
        assert.equal(firstControl?.name_source, "aria_labelledby");
        assert.equal(firstControl?.description, "Primary action");
        assert.deepEqual(firstControl?.context, [{ kind: "form", name: "Composer" }]);
        const clicked = await launched.interaction({ action: "click", expected_origin: "https://example.test", control_generation: 1, target_ref: "target:save" });
        assert.equal(clicked.status, "completed");
        assert.equal(clicked.dispatch_state, "dispatched");
        assert.equal(clicked.page?.facts.find(fact => fact.key === "fixture.target")?.value, "target:save");
      } finally {
        if (launched.status === "ready") await launched.close();
      }
    }
  } finally {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
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

test("uses one owned-resource close seam for an attached Context", async () => {
  const driver = join(DRIVER_DIR, "playwright_shared_driver.py");
  const script = `
import asyncio, importlib.util, os, shutil, sys, tempfile, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
playwright = types.ModuleType("playwright"); playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error; async_api.Page = Page; async_api.Route = Route; async_api.TimeoutError = TimeoutError
async_api.async_playwright = lambda: None
playwright.async_api = async_api
sys.modules["playwright"] = playwright; sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("playwright_shared_driver", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

events = []
class FakePage:
    url = "about:blank"
    def on(self, *_args): pass

class FakeContext:
    def __init__(self): self.pages = [FakePage()]; self.close_calls = 0
    def on(self, *_args): pass
    async def close(self): self.close_calls += 1; events.append("context.close")

class FakePlaywright:
    def __init__(self): self.stop_calls = 0
    async def stop(self): self.stop_calls += 1; events.append("playwright.stop")

class Factory:
    def __init__(self, playwright): self.playwright = playwright
    async def start(self): return self.playwright

class Adapter:
    def __init__(self): self.context = FakeContext(); self.playwright = FakePlaywright(); self.owned_close_calls = 0
    def verify(self, _request): return []
    def prepare(self, _request, _profile): return {}, {}, False, {}
    def playwright_factory(self): return Factory(self.playwright)
    async def create_context(self, _playwright, _request, _profile):
        events.append("create_context"); return self.context
    async def close_owned_resources(self):
        self.owned_close_calls += 1; events.append("owned.close")

async def no_navigation(_driver, _state, _url, _origins, _scope): pass
module.Driver.navigate = no_navigation

async def run():
    root = tempfile.mkdtemp(prefix="shared-attached-close-")
    adapter = Adapter()
    request = {"profile_dir": root, "browser_path": "/managed/chrome", "url": "https://example.test/start", "timeout_ms": 1000, "scope_semantics": "agent_operations_v2"}
    instance = module.Driver(request, adapter)
    await instance.start()
    assert events == ["create_context"], events
    assert instance.downloads_root is None
    await instance.close_context_for_download()
    assert events[-2:] == ["context.close", "owned.close"], events
    assert adapter.owned_close_calls == 1
    await instance.close()
    assert adapter.owned_close_calls == 1, adapter.owned_close_calls
    assert adapter.playwright.stop_calls == 1, adapter.playwright.stop_calls
    assert instance._close_completed is True
    shutil.rmtree(root)

asyncio.run(run())
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});

test("keeps an owned-resource close failure sticky without retrying the adapter", async () => {
  const driver = join(DRIVER_DIR, "playwright_shared_driver.py");
  const script = `
import asyncio, importlib.util, os, shutil, sys, tempfile, types
sys.path.insert(0, os.path.dirname(sys.argv[1]))
playwright = types.ModuleType("playwright"); playwright.__path__ = []
async_api = types.ModuleType("playwright.async_api")
class Error(Exception): pass
class Page: pass
class Route: pass
class TimeoutError(Exception): pass
async_api.Error = Error; async_api.Page = Page; async_api.Route = Route; async_api.TimeoutError = TimeoutError
async_api.async_playwright = lambda: None
playwright.async_api = async_api
sys.modules["playwright"] = playwright; sys.modules["playwright.async_api"] = async_api
spec = importlib.util.spec_from_file_location("playwright_shared_driver", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class Context:
    def __init__(self): self.close_calls = 0
    async def close(self): self.close_calls += 1

class Playwright:
    def __init__(self): self.stop_calls = 0
    async def stop(self): self.stop_calls += 1

class Adapter:
    def __init__(self): self.close_calls = 0
    async def close_owned_resources(self):
        self.close_calls += 1
        raise RuntimeError("owned close failed")

async def run():
    root = tempfile.mkdtemp(prefix="shared-owned-close-failure-")
    try:
        context, playwright, adapter = Context(), Playwright(), Adapter()
        instance = object.__new__(module.Driver)
        instance.close_requested = asyncio.Event()
        instance.close_lock = asyncio.Lock()
        instance.context = context
        instance.playwright = playwright
        instance.adapter = adapter
        instance.downloads_root = None
        instance.download_operations = set()
        instance.download_settling = set()
        try:
            await instance.close_context_for_download()
            raise AssertionError("owned close failure was hidden")
        except RuntimeError as error:
            assert str(error) == "owned close failed"
        try:
            await instance.close()
            raise AssertionError("Driver.close hid the original owned close failure")
        except RuntimeError as error:
            assert str(error) == "owned close failed"
        assert adapter.close_calls == 1, adapter.close_calls
        assert context.close_calls == 1, context.close_calls
        assert playwright.stop_calls == 1, playwright.stop_calls
        try:
            await instance.close()
            raise AssertionError("sticky close failure was not preserved")
        except RuntimeError as error:
            assert str(error) == "owned close failed"
        assert adapter.close_calls == 1, adapter.close_calls
        assert playwright.stop_calls == 1, playwright.stop_calls
    finally:
        shutil.rmtree(root)

asyncio.run(run())
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});
