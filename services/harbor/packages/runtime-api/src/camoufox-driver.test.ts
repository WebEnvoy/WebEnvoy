import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import {
  createLocalIdentityEnvironmentFacts,
  HarborRuntime,
  launchCamoufoxProvider,
  type LocalProviderLaunchInput
} from "./index.js";
import { profileStoragePath } from "./profile-storage.js";
import { selectLocalProviderId } from "./local-provider-launcher.js";

const fixtureDir = mkdtempSync(join(tmpdir(), "harbor-camoufox-driver-"));
const previousProfileStorageRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
process.env.HARBOR_PROFILE_STORAGE_ROOT = join(fixtureDir, "profiles");
const helperPath = join(fixtureDir, "fake-camoufox-driver.mjs");
const browserPath = join(fixtureDir, "Camoufox.app", "Contents", "MacOS", "camoufox");
writeFileSync(helperPath, `#!/usr/bin/env node
import * as readline from "node:readline";

let page = { current_url: "about:blank", title: "", status: "ready" };
const output = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  if (!line.trim()) continue;
  const request = JSON.parse(line);
  if (request.op === "launch") {
    page = { current_url: request.url, title: "Camoufox fixture", status: "ready" };
    output({ id: request.id, status: "ready", page, python_version: "3.12.1", camoufox_version: "0.5.6", browser_version: "152.0.4-beta.30", properties_source: "resources_copy" });
  } else if (request.op === "open_url") {
    page = { current_url: request.url, title: "Camoufox fixture", status: "ready" };
    output({ id: request.id, status: "ok", page });
  } else if (request.op === "site_resource_probe") {
    output({ id: request.id, status: "ok", observation: { origin: "https://www.xiaohongshu.com", pathname: "/explore", ready: true, login_like: false, challenge_like: false, vue_ready: true, pinia_ready: true } });
  } else if (request.op === "read_operation_probe") {
    output({ id: request.id, status: "ok", page: { current_url: request.target_url, title: "Search", status: "ready" }, observation: {
      status: "completed", observed_origin: request.expected_origin, response_status: 200,
      detail_urls: ["https://www.xiaohongshu.com/explore/0123456789abcdef01234567"],
      search_items: [{ title: "WebEnvoy 公开结果", author_display_name: "非生产账号" }]
    } });
  } else if (request.op === "close") {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    output({ id: request.id, status: "ok" });
    process.exit(0);
  } else {
    output({ id: request.id, status: "error", message: "unsupported operation" });
  }
}
`);
chmodSync(helperPath, 0o700);
mkdirSync(join(fixtureDir, "Camoufox.app", "Contents", "MacOS"), { recursive: true });
writeFileSync(browserPath, "fixture executable");
chmodSync(browserPath, 0o700);

after(() => {
  if (previousProfileStorageRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
  else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousProfileStorageRoot;
  rmSync(fixtureDir, { recursive: true, force: true });
});

test("stages macOS bundle properties in a Driver-owned layout without mutating the install", () => {
  const helperPath = join(dirname(fileURLToPath(import.meta.url)), "camoufox-driver.py");
  const pythonPath = process.env.HARBOR_CAMOUFOX_PYTHON || "python3";
  const script = `
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
spec = importlib.util.spec_from_file_location("camoufox_driver", __import__("sys").argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with TemporaryDirectory(prefix="harbor-camoufox-properties-test-") as root:
    root = Path(root)
    executable = root / "Camoufox.app" / "Contents" / "MacOS" / "camoufox"
    executable.parent.mkdir(parents=True)
    resources = executable.parent.parent / "Resources"
    resources.mkdir(parents=True)
    executable.write_text("fixture executable")
    library = executable.parent / "libmozglue.dylib"
    library.write_text("fixture library")
    (resources / "application.ini").write_text("[App]\\nVersion=152.0.4-beta.30\\n")
    properties = resources / "properties.json"
    properties.write_text("{\\"version\\":\\"152.0.4-beta.30\\"}\\n")
    staged, source = module.prepare_properties(str(executable))
    assert source == "resources_copy"
    layout_path = Path(module.LAUNCH_LAYOUT_DIR)
    staged_path = Path(staged)
    assert not staged_path.is_symlink()
    assert staged_path.read_bytes() == executable.read_bytes()
    assert not (staged_path.parent / library.name).is_symlink()
    assert (staged_path.parent / library.name).read_bytes() == library.read_bytes()
    assert (staged_path.parent / "properties.json").read_bytes() == properties.read_bytes()
    assert not (staged_path.parent.parent / "Resources").is_symlink()
    assert not (executable.parent / "properties.json").exists()
    assert properties.read_text() == "{\\"version\\":\\"152.0.4-beta.30\\"}\\n"
    assert module.firefox_major(str(executable)) == 152
    module.cleanup_launch_layout()
    assert not layout_path.exists()
    adjacent = executable.parent / "properties.json"
    adjacent.write_text("mismatched\\n")
    try:
        module.prepare_properties(str(executable))
    except ValueError as error:
        assert "disagrees" in str(error)
    else:
        raise AssertionError("mismatched bundle metadata was accepted")
    assert adjacent.read_text() == "mismatched\\n"
print("properties layout passed")
`;
  const output = execFileSync(pythonPath, ["-c", script, helperPath], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
  assert.match(output, /properties layout passed/);
});

async function withCamoufoxEnv<T>(callback: () => Promise<T>): Promise<T> {
  const previousPython = process.env.HARBOR_CAMOUFOX_PYTHON;
  const previousHelper = process.env.HARBOR_CAMOUFOX_DRIVER_PATH;
  const previousPath = process.env.HARBOR_CAMOUFOX_PATH;
  process.env.HARBOR_CAMOUFOX_PYTHON = process.execPath;
  process.env.HARBOR_CAMOUFOX_DRIVER_PATH = helperPath;
  process.env.HARBOR_CAMOUFOX_PATH = browserPath;
  try {
    return await callback();
  } finally {
    if (previousPython === undefined) delete process.env.HARBOR_CAMOUFOX_PYTHON;
    else process.env.HARBOR_CAMOUFOX_PYTHON = previousPython;
    if (previousHelper === undefined) delete process.env.HARBOR_CAMOUFOX_DRIVER_PATH;
    else process.env.HARBOR_CAMOUFOX_DRIVER_PATH = previousHelper;
    if (previousPath === undefined) delete process.env.HARBOR_CAMOUFOX_PATH;
    else process.env.HARBOR_CAMOUFOX_PATH = previousPath;
  }
}

function input(profile_storage_ref?: string): LocalProviderLaunchInput {
  return {
    browser_path: browserPath,
    provider_id: "camoufox",
    headless: false,
    timeout_ms: 2_000,
    url: "https://www.xiaohongshu.com/explore",
    profile_ref: "profile-camoufox-driver-test",
    profile_storage_ref,
    provider_ref: "provider-camoufox-driver-test"
  };
}

test("drives a Firefox/Juggler process without a CDP readiness file", async () => withCamoufoxEnv(async () => {
  const profileStorageRef = "camoufox-driver-process-test";
  const launched = await launchCamoufoxProvider(input(profileStorageRef));
  assert.equal(launched.status, "ready");
  if (launched.status !== "ready") return;
  assert.equal(launched.driver_kind, "firefox_juggler");
  assert.match(launched.driver_ref ?? "", /^driver_/);
  assert.equal(launched.cdp_ref, undefined);
  assert.equal(launched.page.current_url, "https://www.xiaohongshu.com/explore");
  assert.equal(launched.facts.find((fact) => fact.key === "camoufox.package.version")?.value, "0.5.6");
  assert.equal(launched.facts.find((fact) => fact.key === "camoufox.properties.source")?.value, "resources_copy");

  const opened = await launched.openUrl("https://www.xiaohongshu.com/search_result?keyword=%E4%B8%AD%E6%96%87");
  assert.equal(opened.current_url, "https://www.xiaohongshu.com/search_result?keyword=%E4%B8%AD%E6%96%87");
  const probe = await launched.probeSiteResource!({ site_id: "xiaohongshu", task_kind: "search_notes" });
  assert.equal(probe.status, "available");
  const read = await launched.probeReadOperation!({
    site_id: "xiaohongshu",
    operation_id: "xhs_search_notes",
    query: "WebEnvoy",
    limit: 1,
    target_url: "https://www.xiaohongshu.com/search_result?keyword=WebEnvoy",
    expected_origin: "https://www.xiaohongshu.com"
  });
  assert.equal(read.status, "completed", JSON.stringify(read));
  if (read.status === "completed") {
    assert.equal(read.public_summary.result_count, 1);
    assert.deepEqual(read.source_refs.map((ref) => ref.kind), ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]);
    assert.deepEqual(read.evidence_ref_kinds.map((ref) => ref.kind), ["snapshot_ref"]);
  }
  await launched.close();
  assert.equal(existsSync(profileStoragePath(profileStorageRef)), true);
}));

test("keeps an identity provider binding ahead of global Camoufox configuration", () => {
  assert.equal(selectLocalProviderId(undefined, "chrome_official", "camoufox", true), "chrome_official");
  assert.equal(selectLocalProviderId("camoufox", "chrome_official", undefined, false), "camoufox");
});

test("keeps the existing Harbor lifecycle around a Camoufox driver", async () => withCamoufoxEnv(async () => {
  const identity = createLocalIdentityEnvironmentFacts({
    identity_environment_ref: "identity-env-camoufox-driver-test",
    execution_identity_ref: "execution-identity-camoufox-driver-test",
    profile_ref: "profile-camoufox-lifecycle-test",
    site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" },
    login_state: "logged_in",
    storage_state: "present",
    requested_provider_id: "camoufox"
  });
  assert.equal(identity.provider_binding.selected_provider_id, "camoufox");

  const runtime = new HarborRuntime();
  const first = await runtime.openIdentityEnvironmentSession({
    identity_environment: identity,
    url: "https://www.xiaohongshu.com/explore",
    control_owner: "agent",
    holder_ref: "camoufox-agent",
    headless: false,
    timeout_ms: 2_000
  });
  assert.equal("status" in first, false);
  if ("status" in first) return;
  assert.equal(first.driver_kind, "firefox_juggler");
  assert.equal(first.availability.driver, "available");
  assert.equal(first.availability.cdp, "unsupported");
  const initialDriver = first.driver_ref;

  const siteFacts = await runtime.getSiteResourceFacts(first.runtime_session_ref, { site_id: "xiaohongshu", task_kind: "search_notes" });
  assert.equal("status" in siteFacts, false);
  if ("status" in siteFacts) return;
  assert.equal(siteFacts.resource_facts.some((fact) => fact.key === "page.vue_app.ready" && fact.state === "available"), true);
  const user = runtime.recordHandoff(first.runtime_session_ref, { control_owner: "user", handoff_reason: "user_requested", takeover_available: true });
  assert.equal("status" in user, false);
  const released = runtime.releaseSession(first.runtime_session_ref, { control_owner: "user" });
  assert.equal("status" in released, false);
  if ("status" in released) return;
  assert.equal(released.lifecycle_state, "idle");

  const reconnected = await runtime.openIdentityEnvironmentSession({
    identity_environment: identity,
    url: "https://www.xiaohongshu.com/explore",
    control_owner: "agent",
    holder_ref: "camoufox-agent-reconnected",
    headless: false,
    reuse_existing: true,
    timeout_ms: 2_000
  });
  assert.equal("status" in reconnected, false);
  if ("status" in reconnected) return;
  assert.equal(reconnected.runtime_session_ref, first.runtime_session_ref);
  assert.notEqual(reconnected.driver_ref, undefined);
  assert.equal(reconnected.current_page.current_url, "https://www.xiaohongshu.com/explore");
  assert.equal(reconnected.driver_ref, initialDriver);

  await runtime.closeSession(first.runtime_session_ref);
  const reopened = await runtime.openIdentityEnvironmentSession({
    identity_environment: identity,
    url: "https://www.xiaohongshu.com/explore",
    control_owner: "agent",
    holder_ref: "camoufox-agent-reopened",
    headless: false,
    reuse_existing: false,
    timeout_ms: 2_000
  });
  assert.equal("status" in reopened, false);
  if ("status" in reopened) return;
  assert.notEqual(reopened.runtime_session_ref, first.runtime_session_ref);
  assert.notEqual(reopened.driver_ref, initialDriver);
  assert.equal(reopened.driver_kind, "firefox_juggler");
  await runtime.closeSession(reopened.runtime_session_ref);
}));
