import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createLocalIdentityEnvironmentFacts } from "./identity-environment.js";
import {
  CHROME_OFFICIAL_PAIRING,
  hostTimezone,
  isOfficialChromeLaunchRequest,
  isHostTimezone,
  launchChromeOfficialProvider,
  readChromeOfficialPairingFacts
} from "./chrome-official-driver.js";

const DRIVER_DIR = dirname(fileURLToPath(import.meta.url));

test("keeps IANA timezone aliases consistent at the Chrome adapter boundary", () => {
  const previousTimezone = process.env.TZ;
  try {
    for (const [host, alias] of [["Asia/Kolkata", "Asia/Calcutta"], ["Europe/Kyiv", "Europe/Kiev"], ["US/Eastern", "America/New_York"]] as const) {
      process.env.TZ = host;
      assert.equal(hostTimezone(), host);
      assert.equal(isHostTimezone(host), true);
      assert.equal(isHostTimezone(alias), true);
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

function chromeIdentity(browserPath = "/fixture/Google Chrome") {
  const identity = createLocalIdentityEnvironmentFacts({
    identity_environment_ref: "identity:chrome-official-adapter-test",
    requested_provider_id: "chrome_official",
    profile_storage_ref: "storage:chrome-official-adapter-test",
    site: { site_id: "fixture", origin: "https://example.test", display_name: "Fixture" },
    env: { HARBOR_CHROME_PATH: browserPath },
    platform: "darwin",
    arch: "arm64",
    path_exists: candidate => candidate === browserPath,
    is_executable: candidate => candidate === browserPath,
    read_text: () => null,
    list_dir: () => []
  });
  const install = identity.provider_binding.selected_provider?.install;
  assert.ok(install);
  Object.assign(install, {
    version: CHROME_OFFICIAL_PAIRING.browser_version,
    version_status: "known",
    launchability: "launchable",
    source: CHROME_OFFICIAL_PAIRING.source,
    signature_status: CHROME_OFFICIAL_PAIRING.signature_status,
    source_sha256: CHROME_OFFICIAL_PAIRING.source_sha256,
    executable_sha256: CHROME_OFFICIAL_PAIRING.executable_sha256,
    browser_version: CHROME_OFFICIAL_PAIRING.browser_version,
    playwright_version: CHROME_OFFICIAL_PAIRING.playwright_version
  });
  return identity;
}

test("admits only the exact owner-verified Chrome pairing and reaches shared launch", async () => {
  const identity = chromeIdentity();
  const input = {
    operation_scope: "profile_management" as const,
    browser_path: "",
    provider_id: "chrome_official" as const,
    headless: true,
    timeout_ms: 1_000,
    url: "about:blank",
    profile_ref: identity.profile_ref,
    profile_storage_ref: identity.browser_storage.profile_storage_ref,
    provider_ref: "provider:chrome-official-adapter-test",
    scope_semantics: "agent_operations_v2" as const,
    identity_environment: identity
  };
  assert.deepEqual(readChromeOfficialPairingFacts(identity.provider_binding), CHROME_OFFICIAL_PAIRING);
  assert.equal(isOfficialChromeLaunchRequest(input), true);
  const timezone = hostTimezone();
  assert.ok(timezone);
  assert.equal(isHostTimezone(timezone), true);
  const mismatchedTimezone = ["UTC", "Asia/Shanghai", "America/New_York", "Europe/Paris", "Asia/Tokyo"]
    .find(candidate => !isHostTimezone(candidate));
  assert.ok(mismatchedTimezone);
  const mismatchedTimezoneResult = await launchChromeOfficialProvider(input, {
    provider_id: "chrome_official",
    proxy_server: null,
    language: null,
    timezone: mismatchedTimezone,
    viewport: null
  });
  assert.equal(mismatchedTimezoneResult.status, "unavailable");
  if (mismatchedTimezoneResult.status === "unavailable") assert.equal(mismatchedTimezoneResult.error.code, "unsupported");
  for (const scope of [undefined, "legacy_request_guard_v1" as const]) {
    const withoutV2 = { ...input, scope_semantics: scope };
    assert.equal(isOfficialChromeLaunchRequest(withoutV2), false);
    const result = await launchChromeOfficialProvider(withoutV2);
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") assert.equal(result.error.code, "unsupported");
  }

  const mismatched = {
    ...identity.provider_binding,
    selected_provider: {
      ...identity.provider_binding.selected_provider!,
      install: {
        ...identity.provider_binding.selected_provider!.install,
        executable_sha256: "0".repeat(64)
      }
    }
  };
  assert.equal(readChromeOfficialPairingFacts(mismatched), null);
  assert.equal(isOfficialChromeLaunchRequest({
    ...input,
    identity_environment: { ...identity, provider_binding: mismatched }
  }), false);

  const { launchLocalDedicatedProvider } = await import("./local-provider-launcher.js");
  for (const scope of [undefined, "legacy_request_guard_v1" as const]) {
    const result = await launchLocalDedicatedProvider({ ...input, scope_semantics: scope });
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") assert.equal(result.error.code, "provider_unavailable");
  }

  const root = mkdtempSync(join(tmpdir(), "harbor-chrome-adapter-route-"));
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  const previousPython = process.env.HARBOR_PLAYWRIGHT_PYTHON;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
  delete process.env.HARBOR_PLAYWRIGHT_PYTHON;
  try {
    const result = await launchChromeOfficialProvider(input, {
      provider_id: "chrome_official",
      proxy_server: null,
      language: null,
      timezone,
      viewport: null
    });
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") {
      // The shared launcher, rather than a Chrome-specific Page/Files path,
      // owns this installed-runtime prerequisite and must fail before spawn.
      assert.equal(result.error.code, "driver_unavailable");
      assert.equal(result.facts.some(fact => fact.key === "provider.chrome_official.connection" && fact.value === "public_connect_over_cdp"), true);
    }
  } finally {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    if (previousPython === undefined) delete process.env.HARBOR_PLAYWRIGHT_PYTHON;
    else process.env.HARBOR_PLAYWRIGHT_PYTHON = previousPython;
    rmSync(root, { recursive: true, force: true });
  }
});

test("packages the Chrome adapter without a second Page/Files driver", () => {
  const source = readFileSync(join(DRIVER_DIR, "chrome_official_driver.py"), "utf8");
  assert.match(source, /connect_over_cdp/);
  assert.doesNotMatch(source, /launch_persistent_context/);
  assert.doesNotMatch(source, /^\s*(?:from|import)\s+camoufox(?:\.|\s|$)/im);
});

test("Chrome Python adapter validates configuration and owns exact process cleanup", () => {
  const driver = join(DRIVER_DIR, "chrome_official_driver.py");
  const script = String.raw`
import asyncio, importlib.util, os, shutil, sys, tempfile, types

shared = types.ModuleType("playwright_shared_driver")
shared.async_playwright = lambda: object()
shared.canonical_executable_path = lambda value: value if isinstance(value, str) and value else (_ for _ in ()).throw(ValueError("bad executable"))
shared.main = lambda _adapter: None
sys.modules["playwright_shared_driver"] = shared
spec = importlib.util.spec_from_file_location("chrome_official_driver", sys.argv[1])
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

pairing = {
    "source": module.SOURCE,
    "signature_status": module.SIGNATURE_STATUS,
    "source_sha256": module.SOURCE_SHA256,
    "executable_sha256": module.EXECUTABLE_SHA256,
    "browser_version": module.BROWSER_VERSION,
    "playwright_version": module.PLAYWRIGHT_VERSION,
}
request = {
    "browser_path": "/managed/Google Chrome",
    "headless": True,
    "url": "https://example.test/start",
    "timeout_ms": 1000,
    "chrome_pairing": pairing,
    "scope_semantics": "agent_operations_v2",
    "environment": {"language": "zh-CN", "proxy_server": "http://127.0.0.1:8080"},
}
assert module._validate_pairing(pairing) == pairing
module.importlib.metadata.version = lambda _name: module.PLAYWRIGHT_VERSION
module._sha256_file = lambda _path: module.EXECUTABLE_SHA256
assert module.ChromeOfficialAdapter.verify(request)[-1]["value"] == module.CONNECTION
host_timezone = module._host_timezone()
assert isinstance(host_timezone, str) and host_timezone
request["environment"] = {**request["environment"], "timezone": host_timezone}
assert module.chrome_launch_flags(request) == ["--lang=zh-CN", "--proxy-server=http://127.0.0.1:8080"]
mismatched_aliases = (("Asia/Kolkata", "Asia/Calcutta"), ("Europe/Kyiv", "Europe/Kiev"), ("US/Eastern", "America/New_York"))
previous_timezone = os.environ.get("TZ")
try:
    for raw_timezone, _alias in mismatched_aliases:
        os.environ["TZ"] = raw_timezone
        assert module._host_timezone() == raw_timezone
        assert module.chrome_launch_flags(dict(request, environment={"timezone": raw_timezone})) == []
finally:
    if previous_timezone is None: os.environ.pop("TZ", None)
    else: os.environ["TZ"] = previous_timezone
mismatched_timezone = next(candidate for candidate in ("UTC", "Asia/Shanghai", "America/New_York", "Europe/Paris", "Asia/Tokyo") if candidate != host_timezone)
rejected_timezone = dict(request, environment={"timezone": mismatched_timezone})
try:
    module.chrome_launch_flags(rejected_timezone)
    raise AssertionError("mismatched timezone was accepted")
except ValueError as error:
    assert "timezone" in str(error)

class Page:
    async def evaluate(self, _expression, expected):
        assert "resolvedOptions().timeZone" in _expression
        assert expected in (host_timezone, "Asia/Kolkata", "Europe/Kyiv", "US/Eastern")
        return True

class Context:
    def __init__(self): self.pages = [Page()]

asyncio.run(module.verify_timezone_readback(Context(), host_timezone))
for raw_timezone, alias in mismatched_aliases:
    class AliasPage:
        async def evaluate(self, _expression, expected):
            assert "resolvedOptions().timeZone" in _expression
            assert expected == raw_timezone
            return True
    asyncio.run(module.verify_timezone_readback(types.SimpleNamespace(pages=[AliasPage()]), raw_timezone))
class MismatchPage:
    async def evaluate(self, _expression, _expected): return False
try:
    asyncio.run(module.verify_timezone_readback(types.SimpleNamespace(pages=[MismatchPage()]), "Asia/Kolkata"))
    raise AssertionError("mismatched timezone readback was accepted")
except ValueError as error:
    assert "readback" in str(error)
try:
    asyncio.run(module.verify_timezone_readback(types.SimpleNamespace(pages=[]), host_timezone))
    raise AssertionError("missing timezone readback was accepted")
except ValueError as error:
    assert "readback" in str(error)

for scope in (None, "legacy_request_guard_v1"):
    old_scope = request.pop("scope_semantics", None)
    if scope is not None: request["scope_semantics"] = scope
    for operation in (module.ChromeOfficialAdapter.verify, module.ChromeOfficialAdapter.prepare):
        try:
            operation(request) if operation is module.ChromeOfficialAdapter.verify else operation(request, "/managed/profile")
            raise AssertionError("non-v2 scope was accepted")
        except ValueError as error:
            assert "agent_operations_v2" in str(error)
    if old_scope is not None: request["scope_semantics"] = old_scope

class PsResult:
    def __init__(self, output, returncode=0): self.stdout = output; self.returncode = returncode
real_subprocess_run = module.subprocess.run
module.subprocess.run = lambda *_args, **_kwargs: PsResult("p1000\nn127.0.0.1:43123\n")
assert module.listener_identity(types.SimpleNamespace(pid=1000), 43123) == {"pid": 1000, "address": "127.0.0.1:43123"}
for output in ("p1000\nn0.0.0.0:43123\n", "p1001\nn127.0.0.1:43123\n"):
    module.subprocess.run = lambda *_args, output=output, **_kwargs: PsResult(output)
    try:
        module.listener_identity(types.SimpleNamespace(pid=1000), 43123)
        raise AssertionError("non-owned listener was accepted")
    except ValueError:
        pass
module.subprocess.run = real_subprocess_run
for key in ("timezone", "viewport"):
    rejected = dict(request, environment={key: mismatched_timezone if key == "timezone" else {"width": 800, "height": 600}})
    try:
        module.chrome_launch_flags(rejected)
        raise AssertionError(key + " was accepted")
    except ValueError as error:
        assert key in str(error)

profile = tempfile.mkdtemp(prefix="chrome-adapter-fake-profile-")
resolved_profile = os.path.realpath(profile)
active_port_path = os.path.join(resolved_profile, module.ACTIVE_PORT_FILENAME)
with open(active_port_path, "w", encoding="ascii") as stale:
    stale.write("43120\n/devtools/browser/stale\n")
events = []
class Process:
    next_pid = 1000
    def __init__(self, exits_on_wait=True):
        self.pid = Process.next_pid; Process.next_pid += 1
        self.returncode = None; self.terminate_calls = 0; self.kill_calls = 0; self.wait_calls = 0; self.exits_on_wait = exits_on_wait
    def terminate(self): self.terminate_calls += 1; events.append("terminate")
    def kill(self): self.kill_calls += 1; self.returncode = 9; events.append("kill")
    async def wait(self):
        self.wait_calls += 1; events.append("wait")
        if self.returncode is None and self.exits_on_wait: self.returncode = 0
        return self.returncode

processes = []
async def spawn(*args, **kwargs):
    assert args[0] == request["browser_path"]
    assert "--user-data-dir=" + resolved_profile in args
    assert "--remote-debugging-address=127.0.0.1" in args
    assert "--remote-debugging-port=0" in args
    assert "--remote-allow-origins=*" not in args
    assert kwargs["start_new_session"] is True
    assert not os.path.exists(active_port_path)
    port = 43123 + len(processes)
    with open(active_port_path, "w", encoding="ascii") as active:
        active.write(str(port) + "\n/devtools/browser/fake-" + str(port) + "\n")
    process = Process(); processes.append(process); events.append("spawn"); return process
module.asyncio.create_subprocess_exec = spawn
module.process_identity = lambda process, _executable, profile_dir: (
    ({"pid": process.pid, "started_at": "Mon Jan  1 00:00:00 2026"}
     if profile_dir == resolved_profile else (_ for _ in ()).throw(AssertionError(profile_dir)))
)
module.listener_identity = lambda process, port: {"pid": process.pid, "address": "127.0.0.1:" + str(port)}
async def endpoint_closed(endpoint): events.append(("endpoint_closed", endpoint))
module.wait_for_endpoint_closed = endpoint_closed

class Browser:
    def __init__(self, process): self.contexts = [Context()]; self.process = process; self.close_calls = 0
    async def close(self): self.close_calls += 1; events.append("browser.close")
class Chromium:
    def __init__(self): self.browser = None; self.calls = 0
    async def connect_over_cdp(self, endpoint):
        self.calls += 1; events.append(("connect", endpoint)); self.browser = Browser(processes[-1]); return self.browser
class Playwright:
    def __init__(self): self.chromium = Chromium()

async def run_success():
    adapter = module.ChromeOfficialAdapter()
    context = await adapter.create_context(Playwright(), request, profile)
    assert context is adapter.browser.contexts[0]
    assert events.index("spawn") < events.index(("connect", "http://127.0.0.1:43123"))
    await adapter.close_owned_resources(); await adapter.close_owned_resources()
    assert events.index("browser.close") < events.index("wait")
    assert processes[0].terminate_calls == 1 and processes[0].wait_calls == 1 and processes[0].kill_calls == 0
    assert adapter.browser is None
    assert events.count("browser.close") == 1
    assert events.count(("endpoint_closed", "http://127.0.0.1:43123")) == 1

async def run_connect_failure():
    failing_process = Process(exits_on_wait=True)
    async def failing_spawn(*_args, **_kwargs):
        assert not os.path.exists(active_port_path)
        with open(active_port_path, "w", encoding="ascii") as active:
            active.write("43125\n/devtools/browser/failing\n")
        processes.append(failing_process); return failing_process
    module.asyncio.create_subprocess_exec = failing_spawn
    async def failing_connect(_endpoint): raise RuntimeError("connect failed")
    class FailingPlaywright:
        class Chromium:
            connect_over_cdp = staticmethod(failing_connect)
        chromium = Chromium()
    adapter = module.ChromeOfficialAdapter()
    try:
        await adapter.create_context(FailingPlaywright(), request, profile)
        raise AssertionError("connect failure was hidden")
    except RuntimeError as error:
        assert str(error) == "connect failed"
    assert failing_process.terminate_calls == 1 and failing_process.wait_calls == 1
    assert failing_process.kill_calls == 0

async def run_graceful_close_failure():
    lingering = Process(exits_on_wait=False)
    async def lingering_spawn(*_args, **_kwargs):
        assert not os.path.exists(active_port_path)
        with open(active_port_path, "w", encoding="ascii") as active:
            active.write("43126\n/devtools/browser/lingering\n")
        processes.append(lingering); return lingering
    module.asyncio.create_subprocess_exec = lingering_spawn
    adapter = module.ChromeOfficialAdapter()
    context = await adapter.create_context(Playwright(), request, profile)
    assert context is adapter.browser.contexts[0]
    try:
        await adapter.close_owned_resources()
        raise AssertionError("forced shutdown was reported as graceful")
    except RuntimeError as error:
        assert "forced termination" in str(error) or "gracefully" in str(error)
    assert lingering.terminate_calls == 1 and lingering.kill_calls == 1 and lingering.wait_calls == 2
    try:
        await adapter.close_owned_resources()
        raise AssertionError("shutdown failure was not sticky")
    except RuntimeError as error:
        assert "forced termination" in str(error) or "gracefully" in str(error)
    assert lingering.terminate_calls == 1 and lingering.kill_calls == 1

async def run_preexisting_crash():
    crashed = Process(exits_on_wait=True)
    crashed.returncode = -6
    try:
        await module.wait_for_process(crashed)
        raise AssertionError("pre-close process crash was hidden")
    except RuntimeError as error:
        assert "unexpectedly" in str(error)
    assert crashed.terminate_calls == 0 and crashed.wait_calls == 1 and crashed.kill_calls == 0

class TerminateCrash(Process):
    async def wait(self):
        self.wait_calls += 1; events.append("wait-terminate-crash")
        if self.returncode is None: self.returncode = -6
        return self.returncode

async def run_terminate_crash():
    crashed = TerminateCrash()
    try:
        await module.wait_for_process(crashed)
        raise AssertionError("post-terminate crash was hidden")
    except RuntimeError as error:
        assert "unexpectedly" in str(error)
    assert crashed.terminate_calls == 1 and crashed.wait_calls == 1 and crashed.kill_calls == 0

asyncio.run(run_success())
asyncio.run(run_connect_failure())
asyncio.run(run_graceful_close_failure())
asyncio.run(run_preexisting_crash())
asyncio.run(run_terminate_crash())
assert processes[0].pid != processes[1].pid
shutil.rmtree(profile)
`;
  execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON ?? "python3", ["-B", "-c", script, driver], {
    encoding: "utf8",
    timeout: 5_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
});
