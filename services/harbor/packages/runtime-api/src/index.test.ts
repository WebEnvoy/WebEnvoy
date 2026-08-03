import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import {
  bindIdentityEnvironmentDefaultProvider,
  createLocalIdentityEnvironmentFacts,
  createFixtureLauncher,
  DEFAULT_IDENTITY_SITE_URLS,
  detectBrowserProviders,
  diagnoseBrowserProviderFailure,
  HarborRuntime,
  launchLocalDedicatedProvider,
  type LocalProviderLauncher,
  type LocalProviderLaunchInput
} from "./index.js";
import * as HarborRuntimeApi from "./index.js";
import { classifyLaunchFailure } from "./provider-management.js";
import { resolveRuntimeProviderBinding } from "./local-provider-launcher.js";
import { trustLocalProviderReadProbe } from "./read-operation-probe-trust.js";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const cloakPath = "/Users/test/.cloakbrowser/chromium-145.0.7632.109.2/Chromium.app/Contents/MacOS/Chromium";
const testProfileRoot = mkdtempSync(join(tmpdir(), "harbor-index-profiles-"));
process.env.HARBOR_PROFILE_STORAGE_ROOT = testProfileRoot;
after(() => rmSync(testProfileRoot, { recursive: true, force: true }));

test("keeps legacy site adapters behind explicit namespaces", () => {
  assert.equal(HarborRuntimeApi.LODE_262_ALLOWLIST_PIN.repository, "WebEnvoy/Lode");
  assert.equal(HarborRuntimeApi.LODE_268_DETAIL_PIN.repository, "WebEnvoy/Lode");
  assert.equal("public_summary" in HarborRuntimeApi, false);
  assert.equal(typeof HarborRuntimeApi.legacyReadOperation.admitAllowlistedReadOperation, "function");
  assert.equal(typeof HarborRuntimeApi.legacySiteRuntimeFacts.createSiteResourceFacts, "function");
});

function providerFixture(paths: Record<string, { executable?: boolean; text?: string }>) {
  return {
    platform: "darwin" as const,
    arch: "arm64",
    home_dir: "/Users/test",
    env: {},
    path_exists: (path: string) => path in paths,
    is_executable: (path: string) => paths[path]?.executable ?? false,
    read_text: (path: string) => paths[path]?.text ?? null
  };
}

function capturingLauncher(launches: LocalProviderLaunchInput[], closes?: string[]): LocalProviderLauncher {
  return async (input) => {
    launches.push({ ...input });
    return {
      status: "ready",
      cdp_ref: "cdp_test",
      viewer_entry: input.headless
        ? {
            availability: "unsupported",
            access_mode: "none",
            transport: "not_applicable",
            input_capabilities: [],
            unavailable_reason: "unsupported"
          }
        : {
            availability: "available",
            access_mode: "interactive",
            transport: "local_window",
            input_capabilities: ["keyboard_mouse"]
          },
      page: {
        current_url: input.url,
        title: "Captured launcher page",
        status: "ready",
        facts: [{ key: "page.status", source: "observed", value: "ready" }]
      },
      facts: [{ key: "profile.storage_ref.received", source: "configured", value: input.profile_storage_ref ? "present" : "missing" }],
      openUrl: async (url) => ({
        current_url: url,
        title: "Captured launcher page",
        status: "ready",
        facts: [{ key: "page.status", source: "observed", value: "ready" }]
      }),
      captureScreenshot: async () => ({
        screenshot_ref: "screenshot_test",
        mime_type: "image/png",
        byte_length: 1,
        sha256: "00",
        captured_at: new Date().toISOString(),
        facts: []
      }),
      close: async () => { closes?.push(input.profile_ref); }
    };
  };
}

function writeFakeBrowserExecutable(dir: string): string {
  const browserPath = join(dir, "fake-browser.mjs");
  writeFileSync(browserPath, `#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const userDataArg = process.argv.find((arg) => arg.startsWith("--user-data-dir="));
const profileDir = userDataArg?.slice("--user-data-dir=".length);
const requestedUrl = process.argv.findLast((arg) => !arg.startsWith("--")) ?? "about:blank";
if (!profileDir) process.exit(2);
mkdirSync(profileDir, { recursive: true });
if (existsSync(join(profileDir, "DevToolsActivePort"))) process.exit(4);
if (process.env.HARBOR_FAKE_BROWSER_MARKER) writeFileSync(process.env.HARBOR_FAKE_BROWSER_MARKER, profileDir);
let pageListCalls = 0;
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === process.env.HARBOR_FAKE_BROWSER_HANG_PATH) return;
  response.setHeader("content-type", "application/json");
  if (url.pathname === "/json/version") {
    const address = server.address();
    const port = address && typeof address !== "string" ? address.port : 0;
    response.end(JSON.stringify({ Browser: "FakeBrowser/1.0", "Protocol-Version": "1.3", webSocketDebuggerUrl: "ws://127.0.0.1:" + port + "/devtools/browser/fake" }));
    return;
  }
if (url.pathname === "/json/list") {
    pageListCalls += 1;
    if (pageListCalls <= Number(process.env.HARBOR_FAKE_BROWSER_EMPTY_LIST_COUNT || 0)) {
      response.end("[]");
      return;
    }
    if (pageListCalls <= Number(process.env.HARBOR_FAKE_BROWSER_EMPTY_LIST_COUNT || 0) + Number(process.env.HARBOR_FAKE_BROWSER_ABOUT_BLANK_LIST_COUNT || 0)) {
      response.end(JSON.stringify([{ type: "page", url: "about:blank" }]));
      return;
    }
    response.end(JSON.stringify([{
      type: "page",
      url: process.env.HARBOR_FAKE_BROWSER_REDIRECT_URL || requestedUrl,
      title: process.env.HARBOR_FAKE_BROWSER_REDIRECT_TITLE || "Fake page",
      ...(process.env.HARBOR_FAKE_BROWSER_WEBSOCKET_URL
        ? { webSocketDebuggerUrl: process.env.HARBOR_FAKE_BROWSER_WEBSOCKET_URL }
        : {})
    }]));
    return;
  }
if (url.pathname === "/json/new") {
    if (process.env.HARBOR_FAKE_BROWSER_NEW_URL_MARKER) writeFileSync(process.env.HARBOR_FAKE_BROWSER_NEW_URL_MARKER, decodeURIComponent(url.search.slice(1)));
    response.end(JSON.stringify({
      id: "fake-page",
      type: "page",
      url: decodeURIComponent(url.search.slice(1)),
      title: "Fake page",
      ...(process.env.HARBOR_FAKE_BROWSER_WEBSOCKET_URL
        ? { webSocketDebuggerUrl: process.env.HARBOR_FAKE_BROWSER_WEBSOCKET_URL }
        : {})
    }));
    return;
  }
  if (url.pathname === "/json/close/fake-page") {
    response.end(JSON.stringify({ closed: true }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not_found" }));
});
const startServer = () => server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") process.exit(3);
  writeFileSync(join(profileDir, "DevToolsActivePort"), String(address.port) + "\\n/devtools/browser/fake\\n");
});
setTimeout(startServer, Number(process.env.HARBOR_FAKE_BROWSER_PORT_DELAY_MS || 0));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
setInterval(() => {}, 10000);
`);
  chmodSync(browserPath, 0o700);
  return browserPath;
}

async function startNonCdpEndpoint(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "ok" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("non-CDP test endpoint did not bind a port");
  return {
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close((cause) => cause ? reject(cause) : resolve()))
  };
}

test("creates, reads, and closes a runtime session", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession();

  assert.equal(session.lifecycle_state, "active");
  assert.equal(session.availability.cdp, "available");
  assert.equal(session.availability.viewer, "unsupported");
  assert.equal(session.control_owner, "system");
  assert.match(session.viewer_ref ?? "", /^viewer_/);
  assert.equal(runtime.getSession(session.runtime_session_ref)?.runtime_session_ref, session.runtime_session_ref);

  const detailTargets = (runtime as unknown as { detailReadTargets: {
    register: (input: { runtime_session_ref: string; site_id: "boss"; search_operation_id: "boss_job_search"; targets: { canonical_url: string }[]; now: number }) => string[];
    consume: (input: { detail_ref: string; runtime_session_ref: string; site_id: "boss"; operation_id: "boss_read_job_detail"; now: number }) => unknown;
  } }).detailReadTargets;
  const [closeRef] = detailTargets.register({
    runtime_session_ref: session.runtime_session_ref,
    site_id: "boss",
    search_operation_id: "boss_job_search",
    targets: [{ canonical_url: "https://www.zhipin.com/job_detail/Close_Lifecycle.html" }],
    now: 1_000
  });

  const closed = await runtime.closeSession(session.runtime_session_ref);
  assert.equal(closed?.lifecycle_state, "closed");
  assert.equal(closed?.availability.cdp, "unavailable");
  assert.equal(closed?.availability.viewer, "unavailable");
  assert.equal(closed?.control_owner, "none");
  assert.equal(detailTargets.consume({ detail_ref: closeRef, runtime_session_ref: session.runtime_session_ref, site_id: "boss", operation_id: "boss_read_job_detail", now: 2_000 }), "detail_ref_expired");

  const closedStatus = runtime.getAppRuntimeStatusFixture(session.runtime_session_ref);
  assert.equal("status" in closedStatus, false);
  if ("status" in closedStatus) throw new Error("closed app fixture should be readable");
  assert.equal(closedStatus.browser_status, "closed");
  assert.equal(closedStatus.viewer_status.display_state, "expired");
  assert.equal(closedStatus.control_status.owner, "none");
});

test("reports provider unavailability as structured runtime facts", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("unavailable"));
  const session = await runtime.createSession();

  assert.equal(session.lifecycle_state, "failed");
  assert.equal(session.current_error?.code, "provider_unavailable");
  assert.equal(session.availability.cdp, "unavailable");
});

test("detects only CloakBrowser and official Chrome provider status", () => {
  const catalog = detectBrowserProviders(providerFixture({
    [cloakPath]: { executable: true },
    [chromePath]: { executable: true },
    "/Applications/Google Chrome.app/Contents/Info.plist": {
      text: "<plist><dict><key>CFBundleShortVersionString</key><string>125.0.1</string></dict></plist>"
    },
    "/Applications/Chromium.app/Contents/MacOS/Chromium": { executable: true }
  }));

  assert.deepEqual(catalog.providers.map((provider) => provider.provider_id), ["cloakbrowser", "chrome_official"]);
  assert.equal(catalog.providers.some((provider) => provider.display_name === "Chromium"), false);
  assert.equal(catalog.excluded_providers.some((provider) => provider.provider === "chromium"), true);
  assert.equal(catalog.excluded_providers.some((provider) => provider.provider === "donut_browser"), true);

  const cloak = catalog.providers[0]!;
  const chrome = catalog.providers[1]!;
  assert.equal(cloak.role, "primary");
  assert.equal(cloak.default_for_identity_environment, true);
  assert.equal(cloak.install.status, "installed");
  assert.equal(cloak.install.version, "145.0.7632.109.2");
  assert.equal(chrome.role, "restricted_fallback");
  assert.equal(chrome.install.version, "125.0.1");
  assert.equal(chrome.capabilities.find((capability) => capability.key === "native_fingerprint_control")?.state, "unsupported");
});

test("binds identity environments to CloakBrowser by default and warns on Chrome fallback", () => {
  const cloakDefault = bindIdentityEnvironmentDefaultProvider(providerFixture({
    [cloakPath]: { executable: true },
    [chromePath]: { executable: true }
  }));
  assert.equal(cloakDefault.selected_provider_id, "cloakbrowser");
  assert.equal(cloakDefault.selection_reason, "cloakbrowser_default");
  assert.equal(cloakDefault.requires_user_notice, false);

  const chromeFallback = bindIdentityEnvironmentDefaultProvider(providerFixture({
    [chromePath]: { executable: true }
  }));
  assert.equal(chromeFallback.selected_provider_id, "chrome_official");
  assert.equal(chromeFallback.selection_reason, "chrome_restricted_fallback");
  assert.equal(chromeFallback.requires_user_notice, true);
  assert.equal(chromeFallback.warnings.some((warning) => warning.includes("受限后备")), true);

  const unavailableRequested = bindIdentityEnvironmentDefaultProvider({
    ...providerFixture({ [chromePath]: { executable: true } }),
    requested_provider_id: "cloakbrowser"
  });
  assert.equal(unavailableRequested.selected_provider_id, null);
  assert.equal(unavailableRequested.selection_reason, "requested_provider_unavailable");
});

test("explains provider install and launch failure diagnostics", () => {
  const invalidPath = detectBrowserProviders({
    ...providerFixture({}),
    env: { HARBOR_CLOAKBROWSER_PATH: "/missing/cloak" }
  }).providers[0]!;
  assert.equal(invalidPath.install.status, "path_invalid");
  assert.equal(invalidPath.diagnostics[0]?.failure_class, "path_invalid");

  const proxy = diagnoseBrowserProviderFailure({
    provider_id: "cloakbrowser",
    failure_class: "proxy_unavailable",
    message: "Proxy auth failed."
  });
  assert.equal(proxy.failure_class, "proxy_unavailable");
  assert.equal(proxy.app_summary.includes("代理"), true);

  const args = diagnoseBrowserProviderFailure({
    provider_id: "chrome_official",
    failure_class: "launch_args_incompatible"
  });
  assert.equal(args.suggested_action.includes("启动参数"), true);

  assert.equal(classifyLaunchFailure(new Error("fetch failed")), "cdp_unavailable");
});

test("refreshes a persisted provider binding against the current installation", () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const facts = runtime.getLocalIdentityEnvironmentFacts({
    ...providerFixture({ [chromePath]: { executable: true } }),
    requested_provider_id: "chrome_official",
    identity_environment_ref: "identity-env_stale-provider-binding",
    execution_identity_ref: "execution-identity_stale-provider-binding",
    profile_ref: "profile_stale-provider-binding",
    site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" },
    login_state: "logged_in",
    storage_state: "present"
  });
  facts.provider_binding.selected_provider!.install.path = "/stale/Google Chrome";

  const currentPath = "/Applications/Google Chrome Current.app/Contents/MacOS/Google Chrome";
  const currentDetection = providerFixture({ [currentPath]: { executable: true } });
  currentDetection.env = { HARBOR_CHROME_PATH: currentPath };
  const rebound = resolveRuntimeProviderBinding(facts, currentDetection);
  assert.equal(rebound.selected_provider_id, "chrome_official");
  assert.equal(rebound.selected_provider?.install.path, currentPath);
  assert.equal(rebound.selection_reason, "requested_provider_available");
  assert.equal(rebound.execution_identity_ref, facts.execution_identity_ref);
  assert.equal(rebound.profile_ref, facts.profile_ref);
});

test("returns local identity environment facts without protected material", () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const facts = runtime.getLocalIdentityEnvironmentFacts({
    ...providerFixture({ [cloakPath]: { executable: true } }),
    identity_environment_ref: "identity-env_xhs-alice",
    execution_identity_ref: "execution-identity_xhs-alice",
    profile_ref: "profile_xhs-alice",
    profile_storage_ref: "profile-storage_xhs-alice",
    site: {
      site_id: "xiaohongshu",
      origin: "https://www.xiaohongshu.com",
      display_name: "小红书",
      account_identifier: "alice@example.test",
      account_ref: "account_xhs-alice"
    },
    login_state: "expired",
    login_state_reason: "last observed session expired",
    storage_state: "present",
    proxy_ref: "proxy_tokyo-home",
    proxy_label: "Tokyo residential",
    region: "JP",
    language: "zh-CN",
    timezone: "Asia/Tokyo",
    browser_family: "cloakbrowser",
    user_agent_summary: "CloakBrowser Chromium 145",
    viewport: "1280x900",
    fingerprint_summary: "provider_claim_ref:fingerprint_xhs-alice",
    credential_ref: "credential_xhs-alice",
    keychain_ref: "keychain://harbor/xhs-alice",
    local_secret_ref: "local-secret_xhs-alice",
    login_method: "qr",
    human_verification: ["qr_scan", "two_factor", "captcha", "login_expired"]
  });

  assert.equal(facts.schema_version, "harbor-local-identity-environment/v0");
  assert.equal(facts.identity_environment_ref, "identity-env_xhs-alice");
  assert.equal(facts.site_binding.site_id, "xiaohongshu");
  assert.equal(facts.login_state.state, "expired");
  assert.equal(facts.login_state.recovery_required, true);
  assert.equal(facts.login_state.manual_authentication_state, "required");
  assert.deepEqual(facts.login_state.human_verification, ["qr_scan", "two_factor", "captcha", "login_expired"]);
  assert.equal(facts.browser_storage.cookies_session_state, "present");
  assert.equal(facts.browser_storage.profile_storage_ref.startsWith("profile_storage_ref_"), true);
  assert.equal(facts.browser_storage.cleanup_rule, "delete_profile_storage_and_refs");
  assert.equal(facts.environment.proxy.state, "configured");
  assert.equal(facts.environment.region, "JP");
  assert.equal(facts.environment.language, "zh-CN");
  assert.equal(facts.environment.timezone, "Asia/Tokyo");
  assert.equal(facts.provider_binding.selected_provider_id, "cloakbrowser");
  assert.equal(facts.credential_recovery.login_method, "qr");
  assert.equal(facts.credential_recovery.keychain_ref, "keychain://harbor/xhs-alice");
  assert.deepEqual(facts.credential_recovery.forbidden_plaintext, ["password", "verification_code", "cookie", "session_token"]);
  assert.equal(facts.import_export_delete.default_export, "safe_summary_only");
  assert.equal(facts.import_export_delete.full_export, "explicit_user_action_required");
  assert.equal(facts.import_export_delete.local_encryption, "required_for_protected_material");
  assert.equal(facts.import_export_delete.residual_check, "profile_storage_credentials_and_refs");
  assert.equal(facts.consumer_boundary.app, "public_summary_refs_and_recovery_state_only");
  assert.equal(facts.consumer_boundary.core, "admission_facts_refs_and_blocking_reasons_only");
  assert.equal(facts.consumer_boundary.lode, "site_requirement_matching_refs_only");
  assert.equal(facts.risk_boundary.target_site_bypass, "not_claimed");
  assert.equal(facts.sensitive_material_boundary.some((boundary) => boundary.class === "never_export_material"), true);

  const publicJson = JSON.stringify(facts);
  assert.equal(publicJson.includes("plain-secret-value"), false);
  assert.equal(publicJson.includes("sms-code-123456"), false);
  assert.equal(publicJson.includes("session-token-value"), false);
  assert.equal(publicJson.includes("cookie-value"), false);
  assert.equal(publicJson.includes("storage-value"), false);
  assert.equal(publicJson.includes("profile-storage_xhs-alice"), false);
  assert.equal(publicJson.includes("proxy-password"), false);
});

test("manages local xhs and boss identity environments with redacted public output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harbor-identity-env-"));
  const persistence_path = join(dir, "identity-environments.json");
  try {
    const runtime = new HarborRuntime(createFixtureLauncher("ready"), {
      persistence_path,
      resolve_proxy: () => "http://127.0.0.1:8080"
    });
    const xhs = runtime.createLocalIdentityEnvironment({
      ...providerFixture({ [cloakPath]: { executable: true } }),
      identity_environment_ref: "identity-env_xhs-managed",
      execution_identity_ref: "execution-identity_xhs-managed",
      profile_ref: "profile_xhs-managed",
      profile_storage_ref: "profile-storage_xhs-managed",
      cookie_jar_ref: "cookie-jar_xhs-managed",
      browser_storage_ref: "browser-storage_xhs-managed",
      site: {
        site_id: "xiaohongshu",
        origin: "https://www.xiaohongshu.com",
        display_name: "小红书",
        account_identifier: "alice@example.test",
        account_ref: "account_xhs-managed"
      },
      login_state: "manual_auth_required",
      storage_state: "present",
      proxy_ref: "proxy_tokyo-managed",
      region: "JP",
      language: "zh-CN",
      timezone: "Asia/Tokyo",
      fingerprint_summary: "provider_claim_ref:fingerprint_xhs-managed",
      credential_ref: "credential_xhs-managed",
      keychain_ref: "keychain://harbor/xhs-managed",
      local_secret_ref: "local-secret_xhs-managed",
      login_method: "qr",
      human_verification: ["qr_scan", "captcha"]
    });
    const boss = runtime.importLocalIdentityEnvironment({
      ...providerFixture({ [chromePath]: { executable: true } }),
      identity_environment_ref: "identity-env_boss-managed",
      execution_identity_ref: "execution-identity_boss-managed",
      profile_ref: "profile_boss-managed",
      profile_storage_ref: "profile-storage_boss-managed",
      browser_storage_ref: "browser-storage_boss-managed",
      imported_from: "manual_profile_import",
      site: {
        site_id: "boss",
        origin: "https://www.zhipin.com",
        display_name: "BOSS 直聘",
        account_ref: "account_boss-managed"
      },
      login_state: "logged_in",
      storage_state: "present",
      proxy_ref: "proxy_shanghai-managed",
      region: "CN",
      language: "zh-CN",
      timezone: "Asia/Shanghai",
      fingerprint_summary: "provider_claim_ref:fingerprint_boss-managed"
    });

    assert.equal(xhs.site.site_id, "xiaohongshu");
    assert.equal(xhs.status.readiness, "needs_auth");
    assert.equal(xhs.refs.profile_storage_ref.startsWith("profile_storage_ref_"), true);
    assert.notEqual(xhs.refs.profile_storage_ref, "profile-storage_xhs-managed");
    assert.equal(boss.site.site_id, "boss");
    assert.equal(runtime.listLocalIdentityEnvironments().length, 2);

    const updated = runtime.updateLocalIdentityEnvironment("identity-env_xhs-managed", {
      login_state: "logged_in",
      storage_state: "present",
      manual_authentication_state: "completed",
      observed_environment: {
        proxy_ref: "proxy_tokyo-managed",
        region: "JP",
        language: "zh-CN",
        timezone: "Asia/Tokyo",
        login_state: "logged_in"
      }
    });
    assert.equal(updated?.status.login_state, "logged_in");
    assert.equal(updated?.status.manual_authentication_state, "completed");

    const session = await runtime.openManagedIdentityEnvironmentSession({
      identity_environment_ref: "identity-env_xhs-managed",
      url: "https://www.xiaohongshu.com/explore",
      control_owner: "agent"
    });
    assert.equal("status" in session, false);
    if ("status" in session) throw new Error("managed identity environment session should open");
    assert.equal(session.identity_environment_ref, "identity-env_xhs-managed");
    assert.equal(session.profile_ref, "profile_xhs-managed");

    const defaultBossSession = await runtime.openManagedDefaultSiteSession({
      identity_environment_ref: "identity-env_boss-managed",
      control_owner: "agent"
    });
    assert.equal("status" in defaultBossSession, false);
    if ("status" in defaultBossSession) throw new Error("default BOSS session should open");
    assert.equal(defaultBossSession.current_page.requested_url, DEFAULT_IDENTITY_SITE_URLS.boss);
    assert.equal(defaultBossSession.current_page.current_url, DEFAULT_IDENTITY_SITE_URLS.boss);

    assert.throws(() => runtime.createLocalIdentityEnvironment({
      identity_environment_ref: "identity-env_rejected",
      site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com" },
      password: "plain-secret-value",
      cookie_value: "cookie-value",
      session_token: "session-token-value",
      raw_storage: { localStorage: "storage-value" }
    } as Parameters<HarborRuntime["createLocalIdentityEnvironment"]>[0]), /Sensitive local identity material/);

    const publicJson = JSON.stringify(runtime.listLocalIdentityEnvironments());
    const persistedJson = readFileSync(persistence_path, "utf8");
    for (const material of [
      "plain-secret-value",
      "cookie-value",
      "session-token-value",
      "storage-value",
      "keychain://harbor/xhs-managed",
      "profile-storage_xhs-managed",
      "profile-storage_boss-managed",
      "browser-storage_xhs-managed",
      "browser-storage_boss-managed"
    ]) {
      assert.equal(publicJson.includes(material), false);
    }
    for (const material of ["plain-secret-value", "cookie-value", "session-token-value", "storage-value"]) {
      assert.equal(persistedJson.includes(material), false);
    }
    assert.equal(publicJson.includes("cookie_value"), true);
    assert.equal(publicJson.includes("raw_profile_data"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("opens managed user sessions with persistent profile storage refs and visible viewer facts", async () => {
  const launches: LocalProviderLaunchInput[] = [];
  const runtime = new HarborRuntime(capturingLauncher(launches));
  runtime.createLocalIdentityEnvironment({
    ...providerFixture({ [chromePath]: { executable: true } }),
    identity_environment_ref: "identity-env_xhs-persistent",
    execution_identity_ref: "execution-identity_xhs-persistent",
    profile_ref: "profile_xhs-persistent",
    profile_storage_ref: "profile-storage_xhs-persistent",
    site: {
      site_id: "xiaohongshu",
      origin: "https://www.xiaohongshu.com",
      display_name: "小红书",
      account_ref: "account_xhs-persistent"
    },
    login_state: "logged_in",
    storage_state: "present"
  });

  const session = await runtime.openManagedIdentityEnvironmentSession({
    identity_environment_ref: "identity-env_xhs-persistent",
    url: "https://www.xiaohongshu.com/explore",
    control_owner: "user"
  });

  assert.equal("status" in session, false);
  if ("status" in session) throw new Error("managed user session should open");
  assert.equal(launches.length, 1);
  assert.equal(launches[0]?.profile_storage_ref, "profile-storage_xhs-persistent");
  assert.equal(launches[0]?.headless, false);
  assert.equal(session.identity_environment_ref, "identity-env_xhs-persistent");
  assert.equal(session.profile_ref, "profile_xhs-persistent");
  assert.equal(session.control_owner, "user");
  assert.equal(session.availability.viewer, "available");
  assert.equal(session.viewer_entry?.transport, "local_window");

  const publicJson = JSON.stringify(session);
  assert.equal(publicJson.includes("profile-storage_xhs-persistent"), false);
  assert.equal(publicJson.includes("raw_profile_data"), false);
  assert.equal(publicJson.includes("webSocketDebuggerUrl"), false);
});

test("local provider maps profile storage refs to stable private directories without exposing the ref", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harbor-profile-storage-root-"));
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = dir;
  try {
    const profileStorageRef = "profile-storage_local-provider-test";
    const storageId = createHash("sha256").update(profileStorageRef).digest("hex").slice(0, 32);
    const storagePath = join(dir, storageId);
    mkdirSync(storagePath, { recursive: true, mode: 0o777 });
    chmodSync(storagePath, 0o777);
    const result = await launchLocalDedicatedProvider({
      browser_path: process.execPath,
      headless: true,
      timeout_ms: 25,
      url: "about:blank",
      profile_ref: "profile_local-provider-test",
      profile_storage_ref: profileStorageRef,
      provider_ref: "provider_local-provider-test"
    });
    assert.equal(existsSync(storagePath), true);
    assert.equal(statSync(storagePath).mode & 0o777, 0o700);
    assert.equal(JSON.stringify(result).includes(profileStorageRef), false);
    assert.equal(result.facts.some((fact) => fact.key === "profile.storage_scope" && fact.value === "persistent_ref"), true);
  } finally {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local provider preserves persistent profile dirs and removes ephemeral dirs after successful close", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harbor-fake-browser-"));
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  const previousMarker = process.env.HARBOR_FAKE_BROWSER_MARKER;
  const browserPath = writeFakeBrowserExecutable(dir);
  process.env.HARBOR_PROFILE_STORAGE_ROOT = join(dir, "profiles");
  try {
    const persistentMarker = join(dir, "persistent-profile.txt");
    process.env.HARBOR_FAKE_BROWSER_MARKER = persistentMarker;
    const persistent = await launchLocalDedicatedProvider({
      browser_path: browserPath,
      headless: true,
      timeout_ms: 3000,
      url: "about:blank",
      profile_ref: "profile_persistent-close-test",
      profile_storage_ref: "profile-storage_persistent-close-test",
      provider_ref: "provider_fake"
    });
    assert.equal(persistent.status, "ready");
    if (persistent.status !== "ready") throw new Error("persistent fake browser should be ready");
    const persistentDir = readFileSync(persistentMarker, "utf8");
    await persistent.close();
    assert.equal(existsSync(persistentDir), true);

    const ephemeralMarker = join(dir, "ephemeral-profile.txt");
    process.env.HARBOR_FAKE_BROWSER_MARKER = ephemeralMarker;
    const ephemeral = await launchLocalDedicatedProvider({
      browser_path: browserPath,
      headless: true,
      timeout_ms: 3000,
      url: "about:blank",
      profile_ref: "profile_ephemeral-close-test",
      provider_ref: "provider_fake"
    });
    assert.equal(ephemeral.status, "ready");
    if (ephemeral.status !== "ready") throw new Error("ephemeral fake browser should be ready");
    const ephemeralDir = readFileSync(ephemeralMarker, "utf8");
    await ephemeral.close();
    assert.equal(existsSync(ephemeralDir), false);
  } finally {
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    if (previousMarker === undefined) delete process.env.HARBOR_FAKE_BROWSER_MARKER;
    else process.env.HARBOR_FAKE_BROWSER_MARKER = previousMarker;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local provider removes unavailable and non-CDP stale DevTools ports", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harbor-stale-devtools-port-"));
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  const browserPath = writeFakeBrowserExecutable(dir);
  const nonCdp = await startNonCdpEndpoint();
  process.env.HARBOR_PROFILE_STORAGE_ROOT = join(dir, "profiles");
  try {
    for (const [name, port] of [["unavailable", "0"], ["non-CDP", String(nonCdp.port)]]) {
      const profileStorageRef = `profile-storage_stale-${name}`;
      const storageId = createHash("sha256").update(profileStorageRef).digest("hex").slice(0, 32);
      const profileDir = join(process.env.HARBOR_PROFILE_STORAGE_ROOT, storageId);
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(join(profileDir, "DevToolsActivePort"), `${port}\n/devtools/browser/stale\n`);

      const result = await launchLocalDedicatedProvider({
        browser_path: browserPath,
        headless: true,
        timeout_ms: 3000,
        url: "about:blank",
        profile_ref: `profile_stale-${name}`,
        profile_storage_ref: profileStorageRef,
        provider_ref: "provider_fake"
      });
      assert.equal(result.status, "ready", `${name} stale DevTools port should be removed before launch`);
      if (result.status === "ready") await result.close();
    }
  } finally {
    await nonCdp.close();
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bounds provider version and page-list readback while preserving redirect facts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harbor-bounded-provider-readback-"));
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  const previousHangPath = process.env.HARBOR_FAKE_BROWSER_HANG_PATH;
  const previousRedirectUrl = process.env.HARBOR_FAKE_BROWSER_REDIRECT_URL;
  const previousRedirectTitle = process.env.HARBOR_FAKE_BROWSER_REDIRECT_TITLE;
  const previousWebSocketUrl = process.env.HARBOR_FAKE_BROWSER_WEBSOCKET_URL;
  const previousPortDelay = process.env.HARBOR_FAKE_BROWSER_PORT_DELAY_MS;
  const previousEmptyListCount = process.env.HARBOR_FAKE_BROWSER_EMPTY_LIST_COUNT;
  const previousAboutBlankListCount = process.env.HARBOR_FAKE_BROWSER_ABOUT_BLANK_LIST_COUNT;
  const originalWebSocket = globalThis.WebSocket;
  const browserPath = writeFakeBrowserExecutable(dir);
  process.env.HARBOR_PROFILE_STORAGE_ROOT = join(dir, "profiles");
  try {
    for (const path of ["/json/version", "/json/list"]) {
      process.env.HARBOR_FAKE_BROWSER_HANG_PATH = path;
      const startedAt = Date.now();
      const result = await launchLocalDedicatedProvider({
        browser_path: browserPath,
        headless: false,
        timeout_ms: 500,
        url: "https://www.zhipin.com/web/geek/job",
        profile_ref: `profile_hanging-${path.slice(6)}`,
        provider_ref: "provider_fake"
      });
      assert.ok(Date.now() - startedAt < 2000, `${path} readback must remain bounded`);
      assert.equal(result.status, path === "/json/version" ? "unavailable" : "ready", JSON.stringify(result));
      if (path === "/json/list" && result.status === "ready") {
        assert.equal(result.page.status, "unavailable");
        assert.equal(result.page.error?.code, "cdp_unavailable");
        await result.close();
      }
    }

    process.env.HARBOR_FAKE_BROWSER_HANG_PATH = "/json/version";
    process.env.HARBOR_FAKE_BROWSER_PORT_DELAY_MS = "300";
    const delayedStartedAt = Date.now();
    const delayedVersion = await launchLocalDedicatedProvider({
      browser_path: browserPath,
      headless: false,
      timeout_ms: 500,
      url: "https://www.zhipin.com/web/geek/job",
      profile_ref: "profile_delayed-version-timeout",
      provider_ref: "provider_fake"
    });
    assert.equal(delayedVersion.status, "unavailable");
    assert.ok(Date.now() - delayedStartedAt < 700, "port readiness and version readback must share one launch deadline");
    delete process.env.HARBOR_FAKE_BROWSER_PORT_DELAY_MS;
    delete process.env.HARBOR_FAKE_BROWSER_HANG_PATH;

    process.env.HARBOR_FAKE_BROWSER_EMPTY_LIST_COUNT = "1";
    process.env.HARBOR_FAKE_BROWSER_ABOUT_BLANK_LIST_COUNT = "1";
    const delayedPage = await launchLocalDedicatedProvider({
      browser_path: browserPath,
      headless: false,
      timeout_ms: 500,
      url: "https://www.zhipin.com/web/geek/job",
      profile_ref: "profile_delayed-page-target",
      provider_ref: "provider_fake"
    });
    assert.equal(delayedPage.status, "ready");
    if (delayedPage.status === "ready") {
      assert.equal(delayedPage.page.status, "ready");
      await delayedPage.close();
    }
    delete process.env.HARBOR_FAKE_BROWSER_EMPTY_LIST_COUNT;
    delete process.env.HARBOR_FAKE_BROWSER_ABOUT_BLANK_LIST_COUNT;

    process.env.HARBOR_FAKE_BROWSER_REDIRECT_URL = "https://www.zhipin.com/web/passport/zp/verify.html?code=35";
    process.env.HARBOR_FAKE_BROWSER_REDIRECT_TITLE = "安全验证 - BOSS直聘";
    const redirected = await launchLocalDedicatedProvider({
      browser_path: browserPath,
      headless: false,
      timeout_ms: 2000,
      url: "https://www.zhipin.com/web/geek/job",
      profile_ref: "profile_challenge-redirect",
      provider_ref: "provider_fake"
    });
    assert.equal(redirected.status, "ready");
    if (redirected.status === "ready") {
      assert.equal(redirected.page.current_url, process.env.HARBOR_FAKE_BROWSER_REDIRECT_URL);
      assert.equal(redirected.page.title, "安全验证 - BOSS直聘");
      assert.equal(JSON.stringify(redirected).includes("webSocketDebuggerUrl"), false);
      await redirected.close();
    }

    process.env.HARBOR_FAKE_BROWSER_HANG_PATH = "/json/new";
    const openUrlTimeout = await launchLocalDedicatedProvider({
      browser_path: browserPath,
      headless: false,
      timeout_ms: 500,
      url: "https://www.zhipin.com/web/geek/job",
      profile_ref: "profile_open-url-timeout",
      provider_ref: "provider_fake"
    });
    assert.equal(openUrlTimeout.status, "ready");
    if (openUrlTimeout.status === "ready") {
      const startedAt = Date.now();
      const nextPage = await openUrlTimeout.openUrl("https://www.zhipin.com/web/geek/recommend");
      assert.ok(Date.now() - startedAt < 2000, "open-url readback must remain bounded");
      assert.equal(nextPage.status, "unavailable");
      assert.equal(nextPage.error?.code, "url_unreachable");
      await openUrlTimeout.close();
    }

    delete process.env.HARBOR_FAKE_BROWSER_HANG_PATH;
    process.env.HARBOR_FAKE_BROWSER_WEBSOCKET_URL = "ws://127.0.0.1/fake-page";
    for (const ignoredMethod of ["Runtime.enable", "Runtime.evaluate"]) {
      installFakeCdpWebSocket(ignoredMethod);
      const startedAt = Date.now();
      const cdpTimeout = await launchLocalDedicatedProvider({
        browser_path: browserPath,
        headless: false,
        timeout_ms: 500,
        url: "https://www.zhipin.com/web/geek/job",
        profile_ref: `profile_cdp-${ignoredMethod.slice(8)}`,
        provider_ref: "provider_fake"
      });
      assert.ok(Date.now() - startedAt < 1500, `${ignoredMethod} must remain bounded`);
      assert.equal(cdpTimeout.status, "ready", ignoredMethod);
      if (cdpTimeout.status === "ready") await cdpTimeout.close();
    }

    const committedRedirectUrl = "https://www.zhipin.com/web/passport/zp/verify.html?code=35";
    installFakeCdpWebSocket("Never", committedRedirectUrl);
    const committedRedirect = await launchLocalDedicatedProvider({
      browser_path: browserPath,
      headless: false,
      timeout_ms: 500,
      url: "https://www.zhipin.com/web/geek/job",
      profile_ref: "profile_cdp-committed-redirect",
      provider_ref: "provider_fake"
    });
    assert.equal(committedRedirect.status, "ready");
    if (committedRedirect.status === "ready") {
      const nextPage = await committedRedirect.openUrl("https://www.zhipin.com/web/geek/recommend");
      assert.equal(nextPage.status, "ready");
      assert.equal(nextPage.current_url, committedRedirectUrl);
      await committedRedirect.close();
    }
  } finally {
    globalThis.WebSocket = originalWebSocket;
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    if (previousHangPath === undefined) delete process.env.HARBOR_FAKE_BROWSER_HANG_PATH;
    else process.env.HARBOR_FAKE_BROWSER_HANG_PATH = previousHangPath;
    if (previousRedirectUrl === undefined) delete process.env.HARBOR_FAKE_BROWSER_REDIRECT_URL;
    else process.env.HARBOR_FAKE_BROWSER_REDIRECT_URL = previousRedirectUrl;
    if (previousRedirectTitle === undefined) delete process.env.HARBOR_FAKE_BROWSER_REDIRECT_TITLE;
    else process.env.HARBOR_FAKE_BROWSER_REDIRECT_TITLE = previousRedirectTitle;
    if (previousWebSocketUrl === undefined) delete process.env.HARBOR_FAKE_BROWSER_WEBSOCKET_URL;
    else process.env.HARBOR_FAKE_BROWSER_WEBSOCKET_URL = previousWebSocketUrl;
    if (previousPortDelay === undefined) delete process.env.HARBOR_FAKE_BROWSER_PORT_DELAY_MS;
    else process.env.HARBOR_FAKE_BROWSER_PORT_DELAY_MS = previousPortDelay;
    if (previousEmptyListCount === undefined) delete process.env.HARBOR_FAKE_BROWSER_EMPTY_LIST_COUNT;
    else process.env.HARBOR_FAKE_BROWSER_EMPTY_LIST_COUNT = previousEmptyListCount;
    if (previousAboutBlankListCount === undefined) delete process.env.HARBOR_FAKE_BROWSER_ABOUT_BLANK_LIST_COUNT;
    else process.env.HARBOR_FAKE_BROWSER_ABOUT_BLANK_LIST_COUNT = previousAboutBlankListCount;
    rmSync(dir, { recursive: true, force: true });
  }
});

function assignedLocation(message: { method: string; params?: { expression?: string } }): string | null {
  const match = message.method === "Runtime.evaluate"
    ? message.params?.expression?.match(/^location\.assign\((.+)\)$/s)
    : null;
  if (!match) return null;
  return JSON.parse(match[1]!) as string;
}

function installFakeCdpWebSocket(ignoredMethod: string, redirectUrl?: string): void {
  class FakeCdpWebSocket extends EventTarget {
    readyState = 0;
    private currentUrl = "about:blank";

    constructor(_url: string | URL) {
      super();
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }

    send(payload: string): void {
      const message = JSON.parse(payload) as { id: number; method: string; params?: { expression?: string; url?: string } };
      if (message.method === ignoredMethod) return;
      if (message.method === "Page.navigate") this.currentUrl = redirectUrl ?? message.params?.url ?? this.currentUrl;
      const assignedUrl = assignedLocation(message);
      if (assignedUrl) this.currentUrl = redirectUrl ?? assignedUrl;
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({
          id: message.id,
          result: message.method === "Page.getFrameTree"
            ? { frameTree: { frame: { url: this.currentUrl } } }
            : {}
        })
      })));
    }

    close(): void {
      this.readyState = 3;
      this.dispatchEvent(new Event("close"));
    }
  }
  globalThis.WebSocket = FakeCdpWebSocket as unknown as typeof WebSocket;
}

class DelayedNavigationAckCdpWebSocket extends EventTarget {
  static ignoreFrameTree = false;
  static bootstrapRedirectUrl = "";
  static bootstrapRedirectMethod = "";
  static bootstrapRedirectOnNavigation = 0;
  static detailMode = false;
  static detailEvaluationCount = 0;
  static detailRequestContinued = false;
  static fetchResponseBodyUsed = false;
  static preflightResponseBodyUsed = false;
  static searchResponseIntercepted = false;
  static navigationUrl = "";
  static navigationUrls: string[] = [];
  static pageNavigateCount = 0;
  static pageCloseCount = 0;
  static searchResponseFinished = false;
  static responseBodyRequestedBeforeFinished = false;
  readyState = 0;

  constructor(_url: string | URL) {
    super();
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(payload: string): void {
    const message = JSON.parse(payload) as {
      id: number;
      method: string;
      params?: { requestId?: string; expression?: string; url?: string; interceptResponse?: boolean };
    };
    if (message.method === "Page.navigate") {
      DelayedNavigationAckCdpWebSocket.pageNavigateCount += 1;
      return;
    }
    const assignedUrl = assignedLocation(message);
    if (assignedUrl) {
      const url = assignedUrl;
      const navigationIndex = DelayedNavigationAckCdpWebSocket.navigationUrls.length + 1;
      DelayedNavigationAckCdpWebSocket.navigationUrl = url;
      DelayedNavigationAckCdpWebSocket.navigationUrls.push(url);
      const redirectApplies = Boolean(DelayedNavigationAckCdpWebSocket.bootstrapRedirectUrl) &&
        (DelayedNavigationAckCdpWebSocket.bootstrapRedirectOnNavigation === 0 ||
          DelayedNavigationAckCdpWebSocket.bootstrapRedirectOnNavigation === navigationIndex);
      const documentUrl = redirectApplies ? DelayedNavigationAckCdpWebSocket.bootstrapRedirectUrl : url;
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({
          method: "Fetch.requestPaused",
          params: {
            requestId: "navigation",
            resourceType: "Document",
            request: {
              url: documentUrl,
              ...(redirectApplies && DelayedNavigationAckCdpWebSocket.bootstrapRedirectMethod
                ? { method: DelayedNavigationAckCdpWebSocket.bootstrapRedirectMethod }
                : {})
            }
          }
        })
      })));
      return;
    }
    if (message.method === "Fetch.continueRequest" && message.params?.requestId === "navigation") {
      queueMicrotask(() => {
        this.respond(message.id, {});
        if (DelayedNavigationAckCdpWebSocket.navigationUrl.includes("/search_result")) {
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              method: "Network.requestWillBeSent",
              params: {
                requestId: "preflight-response",
                request: { method: "OPTIONS", url: "https://so.xiaohongshu.com/api/sns/web/v2/search/notes" }
              }
            })
          }));
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              method: "Fetch.requestPaused",
              params: {
                requestId: "preflight-response-fetch",
                resourceType: "XHR",
                request: { method: "OPTIONS", url: "https://so.xiaohongshu.com/api/sns/web/v2/search/notes" }
              }
            })
          }));
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              method: "Network.responseReceived",
              params: {
                requestId: "preflight-response",
                response: { status: 200, url: "https://so.xiaohongshu.com/api/sns/web/v2/search/notes" }
              }
            })
          }));
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              method: "Network.loadingFinished",
              params: { requestId: "preflight-response" }
            })
          }));
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              method: "Network.requestWillBeSent",
              params: {
                requestId: "search-response",
                request: { method: "POST", url: "https://so.xiaohongshu.com/api/sns/web/v2/search/notes" }
              }
            })
          }));
        }
        this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify({
              method: "Network.responseReceived",
              params: {
                requestId: "search-response",
              response: {
                status: 200,
                url: DelayedNavigationAckCdpWebSocket.detailMode
                  ? DelayedNavigationAckCdpWebSocket.navigationUrl
                  : "https://so.xiaohongshu.com/api/sns/web/v2/search/notes"
              }
            }
          })
        }));
        if (DelayedNavigationAckCdpWebSocket.navigationUrl.includes("/search_result")) {
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              method: "Fetch.requestPaused",
              params: {
                requestId: "search-response-fetch",
                resourceType: "XHR",
                request: { method: "POST", url: "https://so.xiaohongshu.com/api/sns/web/v2/search/notes" }
              }
            })
          }));
        }
      });
      return;
    }
    if (message.method === "Network.getResponseBody" && message.params?.requestId === "preflight-response") {
      DelayedNavigationAckCdpWebSocket.preflightResponseBodyUsed = true;
      this.respond(message.id, {
        body: JSON.stringify({
          success: true,
          code: 0,
          data: {
            items: [{
              id: "fedcba987654321001234567",
              xsec_token: "preflight-private-token",
              note_card: { id: "fedcba987654321001234567", display_title: "错误预检结果" }
            }]
          }
        }),
        base64Encoded: false
      });
      return;
    }
    if (message.method === "Fetch.continueRequest" && message.params?.requestId === "search-response-fetch") {
      if (message.params.interceptResponse !== true) {
        this.respond(message.id, {});
        return;
      }
      DelayedNavigationAckCdpWebSocket.searchResponseIntercepted = message.params.interceptResponse === true;
      this.respond(message.id, {});
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({
          method: "Fetch.requestPaused",
          params: {
            requestId: "search-response-fetch",
            resourceType: "XHR",
            responseStatusCode: 200,
            request: { method: "POST", url: "https://so.xiaohongshu.com/api/sns/web/v2/search/notes" }
          }
        })
      })));
      return;
    }
    if (message.method === "Fetch.getResponseBody" && message.params?.requestId === "search-response-fetch") {
      DelayedNavigationAckCdpWebSocket.fetchResponseBodyUsed = true;
      this.respond(message.id, {
        body: JSON.stringify({
          success: true,
          code: 0,
          data: {
            items: [{
              id: "0123456789abcdef01234567",
              xsec_token: "private-navigation-token",
              note_card: {
                id: "0123456789abcdef01234567",
                display_title: "公开搜索笔记",
                user: { nickname: "公开作者" },
                interact_info: { liked_count: 10, comment_count: 2, collected_count: 3 }
              }
            }]
          }
        }),
        base64Encoded: false
      });
      return;
    }
    if (message.method === "Network.getResponseBody" && message.params?.requestId === "search-response") {
      if (!DelayedNavigationAckCdpWebSocket.searchResponseFinished) {
        DelayedNavigationAckCdpWebSocket.responseBodyRequestedBeforeFinished = true;
        this.respondError(message.id, -32000, "No resource with given identifier found");
        return;
      }
      this.respond(message.id, {
        body: JSON.stringify({
          success: true,
          code: 0,
          data: {
            items: [{
              id: "0123456789abcdef01234567",
              xsec_token: "private-navigation-token",
              note_card: {
                id: "0123456789abcdef01234567",
                display_title: "公开搜索笔记",
                user: { nickname: "公开作者" },
                interact_info: { liked_count: 10, comment_count: 2, collected_count: 3 }
              }
            }]
          }
        }),
        base64Encoded: false
      });
      return;
    }
    if (message.method === "Fetch.continueRequest" && message.params?.requestId === "detail-resource") {
      DelayedNavigationAckCdpWebSocket.detailRequestContinued = true;
      this.respond(message.id, {});
      return;
    }
    if (message.method === "Runtime.evaluate") {
      if (message.params?.expression?.includes("document.title")) {
        this.respond(message.id, {
          result: {
            value: {
              title: "Fake page",
              url: DelayedNavigationAckCdpWebSocket.navigationUrl || "about:blank",
              readyState: "complete"
            }
          }
        });
        return;
      }
      if (DelayedNavigationAckCdpWebSocket.detailMode) {
        const evaluationCount = ++DelayedNavigationAckCdpWebSocket.detailEvaluationCount;
        const documentReady = evaluationCount > 1;
        const ready = evaluationCount > 2 &&
          DelayedNavigationAckCdpWebSocket.detailRequestContinued;
        if (evaluationCount === 1) {
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              method: "Fetch.requestPaused",
              params: {
                requestId: "detail-resource",
                resourceType: "Script",
                request: { url: "https://www.xiaohongshu.com/detail-resource.js" }
              }
            })
          })));
        }
        this.respond(message.id, {
          result: {
            value: {
              origin: "https://www.xiaohongshu.com",
              pathname: "/explore/0123456789abcdef01234567",
              ready: documentReady,
              rendered_surface: documentReady,
              login_like: false,
              challenge_like: false,
              vue_ready: ready,
              pinia_ready: ready,
              normalized: ready ? {
                kind: "xiaohongshu_note_detail",
                canonical_url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567",
                note_id: "0123456789abcdef01234567",
                title: "公开标题",
                summary: "公开摘要",
                body_summary: "公开正文摘要",
                author: {
                  display_name: "公开作者",
                  author_id: "author_123",
                  profile_url: "https://www.xiaohongshu.com/user/profile/author_123"
                },
                interaction_metrics: { likes: "10", comments: "2", collects: "3", shares: "1" },
                source_status: "located"
              } : undefined
            }
          }
        });
        return;
      }
      if (!DelayedNavigationAckCdpWebSocket.searchResponseFinished) {
        setTimeout(() => {
          DelayedNavigationAckCdpWebSocket.searchResponseFinished = true;
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              method: "Network.loadingFinished",
              params: { requestId: "search-response" }
            })
          }));
        }, 10);
      }
      this.respond(message.id, {
      result: {
        value: {
          origin: "https://www.xiaohongshu.com",
          pathname: "/search_result",
          search: "?keyword=AI",
          ready: true,
          pinia_ready: true,
          list_valid: true,
          note_count: 1,
          detail_urls: ["https://www.xiaohongshu.com/explore/0123456789abcdef01234567"],
          search_items: [{
            title: "公开搜索笔记",
            author_display_name: "公开作者",
            interaction_metrics: { likes: "10", comments: "2", collects: "3" }
          }]
        }
      }
    });
      return;
    }
    if (message.method === "Page.getFrameTree") {
      if (DelayedNavigationAckCdpWebSocket.ignoreFrameTree) return;
      this.respond(message.id, {
        frameTree: { frame: { url: "https://www.xiaohongshu.com/explore" } }
      });
      return;
    }
    if (message.method === "Page.captureScreenshot") {
      this.respond(message.id, { data: Buffer.from("fake screenshot").toString("base64") });
      return;
    }
    if (message.method === "Page.close") {
      DelayedNavigationAckCdpWebSocket.pageCloseCount += 1;
      this.respond(message.id, {});
      return;
    }
    this.respond(message.id, {});
  }

  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }

  private respond(id: number, result: Record<string, unknown>): void {
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ id, result })
    })));
  }

  private respondError(id: number, code: number, message: string): void {
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
      data: JSON.stringify({ id, error: { code, message } })
    })));
  }
}

test("bootstraps XHS reads through the canonical explore page without waiting for navigation acknowledgement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harbor-read-navigation-ack-"));
  const newUrlMarker = join(dir, "new-url");
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  const previousHangPath = process.env.HARBOR_FAKE_BROWSER_HANG_PATH;
  const previousRedirectUrl = process.env.HARBOR_FAKE_BROWSER_REDIRECT_URL;
  const previousWebSocketUrl = process.env.HARBOR_FAKE_BROWSER_WEBSOCKET_URL;
  const previousNewUrlMarker = process.env.HARBOR_FAKE_BROWSER_NEW_URL_MARKER;
  const originalWebSocket = globalThis.WebSocket;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = join(dir, "profiles");
  process.env.HARBOR_FAKE_BROWSER_REDIRECT_URL = "https://www.xiaohongshu.com/explore";
  process.env.HARBOR_FAKE_BROWSER_WEBSOCKET_URL = "ws://127.0.0.1/fake-page";
  process.env.HARBOR_FAKE_BROWSER_NEW_URL_MARKER = newUrlMarker;
  globalThis.WebSocket = DelayedNavigationAckCdpWebSocket as unknown as typeof WebSocket;
  try {
    const identityEnvironment = createLocalIdentityEnvironmentFacts({
      identity_environment_ref: "identity-env_delayed-navigation-ack",
      execution_identity_ref: "execution-identity_delayed-navigation-ack",
      profile_ref: "profile_delayed-navigation-ack",
      site: {
        site_id: "xiaohongshu",
        origin: "https://www.xiaohongshu.com",
        display_name: "Xiaohongshu"
      },
      login_state: "logged_in",
      storage_state: "present"
    });
    const provider = await launchLocalDedicatedProvider({
      browser_path: writeFakeBrowserExecutable(dir),
      headless: true,
      timeout_ms: 5000,
      url: "https://www.xiaohongshu.com/search_result?keyword=AI&source=web_search_result_notes",
      profile_ref: "profile_delayed-navigation-ack",
      profile_storage_ref: "profile-storage_delayed-navigation-ack",
      provider_ref: "provider_fake",
      identity_environment: identityEnvironment
    });
    assert.equal(provider.status, "ready", JSON.stringify(provider));
    if (provider.status !== "ready") throw new Error("fake provider should be ready");
    assert.ok(provider.probeReadOperation);
    const startedAt = Date.now();
    const result = await provider.probeReadOperation({
      site_id: "xiaohongshu",
      operation_id: "xhs_search_notes",
      query: "AI",
      target_url: "https://www.xiaohongshu.com/search_result?keyword=AI",
      expected_origin: "https://www.xiaohongshu.com"
    });
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 500, "read operation must not wait for the delayed navigation acknowledgement");
    assert.equal(readFileSync(newUrlMarker, "utf8"), "about:blank");
    assert.deepEqual(DelayedNavigationAckCdpWebSocket.navigationUrls.slice(0, 3), [
      "https://www.xiaohongshu.com/explore",
      "https://www.xiaohongshu.com/explore",
      "https://www.xiaohongshu.com/search_result?keyword=AI"
    ]);
    assert.equal(DelayedNavigationAckCdpWebSocket.pageNavigateCount, 0);
    assert.equal(result.status, "completed");
    assert.equal(DelayedNavigationAckCdpWebSocket.searchResponseIntercepted, true);
    assert.equal(DelayedNavigationAckCdpWebSocket.fetchResponseBodyUsed, true);
    assert.equal(DelayedNavigationAckCdpWebSocket.preflightResponseBodyUsed, false);
    assert.equal(DelayedNavigationAckCdpWebSocket.responseBodyRequestedBeforeFinished, false);
    if (result.status === "completed") {
      assert.deepEqual(result.search_items, [{
        title: "公开搜索笔记",
        author_display_name: "公开作者",
        interaction_metrics: { likes: "10", comments: "2", collects: "3" }
      }]);
      assert.equal(JSON.stringify(result.search_items).includes("private-navigation-token"), false);
    }

    DelayedNavigationAckCdpWebSocket.detailMode = true;
    const detail = await provider.probeReadOperation({
      site_id: "xiaohongshu",
      operation_id: "xhs_read_note_detail",
      detail_ref: "detail_ref_delayed-readiness",
      target_url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_token=private-navigation-token&xsec_source=pc_search",
      expected_origin: "https://www.xiaohongshu.com"
    });
    assert.equal(detail.status, "completed");
    if (detail.status === "completed") {
      assert.equal(detail.page.current_url, "https://www.xiaohongshu.com/explore/0123456789abcdef01234567");
      assert.equal(JSON.stringify(detail.page).includes("private-navigation-token"), false);
    }
    assert.equal(DelayedNavigationAckCdpWebSocket.detailEvaluationCount, 3);
    assert.equal(DelayedNavigationAckCdpWebSocket.detailRequestContinued, true);
    DelayedNavigationAckCdpWebSocket.detailMode = false;

    DelayedNavigationAckCdpWebSocket.bootstrapRedirectUrl = "https://so.xiaohongshu.com/api/sns/web/v2/search/notes";
    DelayedNavigationAckCdpWebSocket.bootstrapRedirectMethod = "POST";
    DelayedNavigationAckCdpWebSocket.bootstrapRedirectOnNavigation =
      DelayedNavigationAckCdpWebSocket.navigationUrls.length + 2;
    const drift = await provider.probeReadOperation({
      site_id: "xiaohongshu",
      operation_id: "xhs_search_notes",
      query: "AI",
      target_url: "https://www.xiaohongshu.com/search_result?keyword=AI",
      expected_origin: "https://www.xiaohongshu.com"
    });
    assert.equal(drift.status, "unavailable");
    if (drift.status === "unavailable") {
      assert.equal(drift.failure_class, "origin_drift");
      assert.equal(drift.retryable, false);
    }
    DelayedNavigationAckCdpWebSocket.bootstrapRedirectUrl = "";
    DelayedNavigationAckCdpWebSocket.bootstrapRedirectMethod = "";
    DelayedNavigationAckCdpWebSocket.bootstrapRedirectOnNavigation = 0;

    DelayedNavigationAckCdpWebSocket.ignoreFrameTree = true;
    const boundedStartedAt = Date.now();
    const unavailable = await provider.probeReadOperation({
      site_id: "xiaohongshu",
      operation_id: "xhs_search_notes",
      query: "AI",
      target_url: "https://www.xiaohongshu.com/search_result?keyword=AI",
      expected_origin: "https://www.xiaohongshu.com"
    });
    const boundedElapsed = Date.now() - boundedStartedAt;
    assert.ok(boundedElapsed < 5500, "XHS bootstrap commit readback must remain bounded");
    assert.equal(unavailable.status, "unavailable");
    if (unavailable.status === "unavailable") assert.equal(unavailable.failure_class, "page_not_ready");

    DelayedNavigationAckCdpWebSocket.ignoreFrameTree = false;
    DelayedNavigationAckCdpWebSocket.searchResponseFinished = false;
    process.env.HARBOR_FAKE_BROWSER_HANG_PATH = "/json/close/fake-page";
    const cleanupProvider = await launchLocalDedicatedProvider({
      browser_path: writeFakeBrowserExecutable(dir),
      headless: true,
      timeout_ms: 5000,
      url: "about:blank",
      profile_ref: "profile_bounded-target-cleanup",
      provider_ref: "provider_fake"
    });
    assert.equal(cleanupProvider.status, "ready", JSON.stringify(cleanupProvider));
    if (cleanupProvider.status !== "ready") throw new Error("cleanup provider should be ready");
    const pageCloseCount = DelayedNavigationAckCdpWebSocket.pageCloseCount;
    const cleanupStartedAt = Date.now();
    const cleanupResult = await cleanupProvider.probeReadOperation!({
      site_id: "xiaohongshu",
      operation_id: "xhs_search_notes",
      query: "AI",
      target_url: "https://www.xiaohongshu.com/search_result?keyword=AI",
      expected_origin: "https://www.xiaohongshu.com"
    });
    const cleanupElapsed = Date.now() - cleanupStartedAt;
    assert.ok(cleanupElapsed < 2000, `CDP target cleanup must not wait on the stalled HTTP fallback: ${cleanupElapsed}ms ${JSON.stringify(cleanupResult)}`);
    assert.equal(cleanupResult.status, "completed");
    assert.ok(DelayedNavigationAckCdpWebSocket.pageCloseCount > pageCloseCount);
    await cleanupProvider.close();
    delete process.env.HARBOR_FAKE_BROWSER_HANG_PATH;

    DelayedNavigationAckCdpWebSocket.ignoreFrameTree = false;
    DelayedNavigationAckCdpWebSocket.detailMode = true;
    DelayedNavigationAckCdpWebSocket.detailEvaluationCount = 0;
    DelayedNavigationAckCdpWebSocket.detailRequestContinued = false;
    DelayedNavigationAckCdpWebSocket.fetchResponseBodyUsed = false;
    DelayedNavigationAckCdpWebSocket.preflightResponseBodyUsed = false;
    DelayedNavigationAckCdpWebSocket.searchResponseIntercepted = false;
    const runtime = new HarborRuntime(async () => provider);
    const session = await runtime.createSession({ url: "about:blank", control_owner: "core_task" });
    const internal = runtime as unknown as {
      runtimeSessions: {
        probeReadOperation: (runtimeSessionRef: string, input: {
          site_id: "xiaohongshu";
          operation_id: "xhs_read_note_detail";
          detail_ref: string;
          target_url: string;
          expected_origin: string;
        }) => Promise<unknown>;
      };
    };
    await internal.runtimeSessions.probeReadOperation(session.runtime_session_ref, {
      site_id: "xiaohongshu",
      operation_id: "xhs_read_note_detail",
      detail_ref: "detail_ref_session-readback",
      target_url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_token=private-navigation-token&xsec_source=pc_search",
      expected_origin: "https://www.xiaohongshu.com"
    });
    const readback = runtime.getSession(session.runtime_session_ref);
    assert.equal(readback?.current_page.requested_url, "https://www.xiaohongshu.com/explore/0123456789abcdef01234567");
    assert.equal(readback?.current_page.current_url, "https://www.xiaohongshu.com/explore/0123456789abcdef01234567");
    assert.equal(JSON.stringify(readback).includes("private-navigation-token"), false);
    assert.equal(JSON.stringify(readback).includes("xsec_"), false);
    await runtime.close();
  } finally {
    DelayedNavigationAckCdpWebSocket.ignoreFrameTree = false;
    DelayedNavigationAckCdpWebSocket.bootstrapRedirectUrl = "";
    DelayedNavigationAckCdpWebSocket.bootstrapRedirectMethod = "";
    DelayedNavigationAckCdpWebSocket.bootstrapRedirectOnNavigation = 0;
    DelayedNavigationAckCdpWebSocket.detailMode = false;
    DelayedNavigationAckCdpWebSocket.detailEvaluationCount = 0;
    DelayedNavigationAckCdpWebSocket.detailRequestContinued = false;
    DelayedNavigationAckCdpWebSocket.navigationUrl = "";
    DelayedNavigationAckCdpWebSocket.navigationUrls = [];
    DelayedNavigationAckCdpWebSocket.pageNavigateCount = 0;
    DelayedNavigationAckCdpWebSocket.pageCloseCount = 0;
    DelayedNavigationAckCdpWebSocket.searchResponseFinished = false;
    DelayedNavigationAckCdpWebSocket.responseBodyRequestedBeforeFinished = false;
    DelayedNavigationAckCdpWebSocket.preflightResponseBodyUsed = false;
    DelayedNavigationAckCdpWebSocket.searchResponseIntercepted = false;
    globalThis.WebSocket = originalWebSocket;
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
    else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    if (previousHangPath === undefined) delete process.env.HARBOR_FAKE_BROWSER_HANG_PATH;
    else process.env.HARBOR_FAKE_BROWSER_HANG_PATH = previousHangPath;
    if (previousRedirectUrl === undefined) delete process.env.HARBOR_FAKE_BROWSER_REDIRECT_URL;
    else process.env.HARBOR_FAKE_BROWSER_REDIRECT_URL = previousRedirectUrl;
    if (previousWebSocketUrl === undefined) delete process.env.HARBOR_FAKE_BROWSER_WEBSOCKET_URL;
    else process.env.HARBOR_FAKE_BROWSER_WEBSOCKET_URL = previousWebSocketUrl;
    if (previousNewUrlMarker === undefined) delete process.env.HARBOR_FAKE_BROWSER_NEW_URL_MARKER;
    else process.env.HARBOR_FAKE_BROWSER_NEW_URL_MARKER = previousNewUrlMarker;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("opens an identity environment session with page and controller facts", async () => {
  const launches: LocalProviderLaunchInput[] = [];
  const fixtureLauncher = createFixtureLauncher("ready");
  const runtime = new HarborRuntime((input) => {
    launches.push(input);
    return fixtureLauncher(input);
  });
  const session = await runtime.openIdentityEnvironmentSession({
    identity_environment: {
      ...providerFixture({ [cloakPath]: { executable: true } }),
      identity_environment_ref: "identity-env_xhs-open",
      execution_identity_ref: "execution-identity_xhs-open",
      profile_ref: "profile_xhs-open",
      site: {
        site_id: "xiaohongshu",
        origin: "https://www.xiaohongshu.com",
        display_name: "小红书"
      },
      login_state: "logged_in",
      storage_state: "present"
    },
    url: "https://www.xiaohongshu.com/explore",
    control_owner: "agent",
    holder_ref: "agent_run_1"
  });

  assert.equal("status" in session, false);
  if ("status" in session) throw new Error("identity environment session should open");
  assert.equal(session.identity_environment_ref, "identity-env_xhs-open");
  assert.equal(session.execution_identity_ref, "execution-identity_xhs-open");
  assert.equal(session.profile_ref, "profile_xhs-open");
  assert.equal(session.current_page.requested_url, "https://www.xiaohongshu.com/explore");
  assert.equal(session.current_page.current_url, "https://www.xiaohongshu.com/explore");
  assert.equal(session.current_page.title, "Fixture page for https://www.xiaohongshu.com/explore");
  assert.equal(session.current_page.status, "ready");
  assert.equal(session.control_owner, "agent");
  assert.equal(session.control_lock.owner, "agent");
  assert.equal(session.control_lock.holder_ref, "agent_run_1");
  assert.equal(launches[0]?.timeout_ms, 15_000);
  assert.equal(session.facts.some((fact) => fact.key === "lifecycle.reference.donut_browser"), true);

  const publicJson = JSON.stringify(session);
  assert.equal(publicJson.includes("webSocketDebuggerUrl"), false);
  assert.equal(publicJson.includes("cookie"), false);
  assert.equal(publicJson.includes("token"), false);
});

test("reuses, locks, releases, and stops identity environment sessions", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const identity_environment = runtime.getLocalIdentityEnvironmentFacts({
    ...providerFixture({ [cloakPath]: { executable: true } }),
    identity_environment_ref: "identity-env_boss",
    execution_identity_ref: "execution-identity_boss",
    profile_ref: "profile_boss",
    site: {
      site_id: "boss",
      origin: "https://www.zhipin.com",
      display_name: "BOSS 直聘"
    },
    login_state: "logged_in",
    storage_state: "present"
  });
  const opened = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com",
    control_owner: "agent"
  });
  assert.equal("status" in opened, false);
  if ("status" in opened) throw new Error("initial session should open");

  const reused = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com/web/geek/job",
    control_owner: "agent"
  });
  assert.equal("status" in reused, false);
  if ("status" in reused) throw new Error("session should be reused by same controller");
  assert.equal(reused.runtime_session_ref, opened.runtime_session_ref);
  assert.equal(reused.current_page.current_url, "https://www.zhipin.com/web/geek/job");

  const detailTargets = (runtime as unknown as { detailReadTargets: {
    register: (input: { runtime_session_ref: string; site_id: "boss"; search_operation_id: "boss_job_search"; targets: { canonical_url: string }[]; now: number }) => string[];
    consume: (input: { detail_ref: string; runtime_session_ref: string; site_id: "boss"; operation_id: "boss_read_job_detail"; now: number }) => unknown;
  } }).detailReadTargets;
  const [releaseRef] = detailTargets.register({
    runtime_session_ref: opened.runtime_session_ref,
    site_id: "boss",
    search_operation_id: "boss_job_search",
    targets: [{ canonical_url: "https://www.zhipin.com/job_detail/Release_Lifecycle.html" }],
    now: 1_000
  });

  const locked = runtime.lockSession(opened.runtime_session_ref, { control_owner: "user", holder_ref: "manual_user" });
  assert.equal("status" in locked, true);
  if (!("status" in locked)) throw new Error("different controller should not take held session");
  assert.equal(locked.failure_class, "session_locked");

  const released = runtime.releaseSession(opened.runtime_session_ref, { control_owner: "agent" });
  assert.equal("status" in released, false);
  if ("status" in released) throw new Error("owner should release session");
  assert.equal(released.lifecycle_state, "idle");
  assert.equal(released.control_owner, "none");
  assert.equal(released.control_lock.state, "released");
  const retainedReleaseTarget = detailTargets.consume({
    detail_ref: releaseRef,
    runtime_session_ref: opened.runtime_session_ref,
    site_id: "boss",
    operation_id: "boss_read_job_detail",
    now: 2_000
  });
  assert.equal(typeof retainedReleaseTarget, "object");
  if (typeof retainedReleaseTarget === "string") throw new Error("release should retain detail refs for the next turn");

  const userLocked = runtime.lockSession(opened.runtime_session_ref, { control_owner: "user", holder_ref: "manual_user" });
  assert.equal("status" in userLocked, false);
  if ("status" in userLocked) throw new Error("released session should be lockable by user");
  assert.equal(userLocked.lifecycle_state, "locked");
  assert.equal(userLocked.control_owner, "user");
  assert.deepEqual(runtime.captureSnapshot(opened.runtime_session_ref), {
    status: "unavailable",
    failure_class: "source_unavailable",
    message: "Runtime Session is not readable for snapshot capture.",
    retryable: true
  });

  const conflict = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com/web/geek/job",
    control_owner: "core_task"
  });
  assert.equal("status" in conflict, true);
  if (!("status" in conflict)) throw new Error("core_task should not take user lock");
  assert.equal(conflict.current_error.code, "session_locked");

  const [stopRef] = detailTargets.register({
    runtime_session_ref: opened.runtime_session_ref,
    site_id: "boss",
    search_operation_id: "boss_job_search",
    targets: [{ canonical_url: "https://www.zhipin.com/job_detail/Stop_Lifecycle.html" }],
    now: 3_000
  });

  const stopped = await runtime.stopSession(opened.runtime_session_ref, { control_owner: "user" });
  assert.equal("status" in stopped, false);
  if ("status" in stopped) throw new Error("user should stop locked session");
  assert.equal(stopped.lifecycle_state, "closed");
  assert.equal(stopped.control_lock.state, "closed");
  assert.equal(detailTargets.consume({ detail_ref: stopRef, runtime_session_ref: opened.runtime_session_ref, site_id: "boss", operation_id: "boss_read_job_detail", now: 4_000 }), "detail_ref_expired");
});

test("executes a detail read while a reused session is locked by Core", async () => {
  let probeCalls = 0;
  const launcher = capturingLauncher([]);
  const runtime = new HarborRuntime(async (input) => {
    const launched = await launcher(input);
    if (launched.status === "unavailable") return launched;
    return {
      ...launched,
      execution_surface: "local_provider",
      probeReadOperation: trustLocalProviderReadProbe(async (probe) => {
        probeCalls += 1;
        return {
          status: "unavailable",
          failure_class: "page_not_ready",
          message: "Fixture probe reached.",
          retryable: true,
          page: {
            current_url: probe.target_url,
            title: "Fixture note",
            status: "ready",
            facts: [{ key: "page.status", source: "validation_evidence", value: "operation_probe_ready" }]
          }
        };
      })
    };
  });
  runtime.createLocalIdentityEnvironment({
    ...providerFixture({ [chromePath]: { executable: true } }),
    identity_environment_ref: "identity-env_xhs-locked-read",
    execution_identity_ref: "execution-identity_xhs-locked-read",
    profile_ref: "profile_xhs-locked-read",
    profile_storage_ref: "profile-storage_xhs-locked-read",
    site: {
      site_id: "xiaohongshu",
      origin: "https://www.xiaohongshu.com",
      display_name: "小红书"
    },
    login_state: "logged_in",
    storage_state: "present"
  });
  const opened = await runtime.openManagedIdentityEnvironmentSession({
    identity_environment_ref: "identity-env_xhs-locked-read",
    url: "https://www.xiaohongshu.com/search_result?keyword=%E7%BE%8E%E9%A3%9F&source=web_search_result_notes",
    control_owner: "core_task",
    holder_ref: "search_run",
    headless: false
  });
  assert.equal("status" in opened, false);
  if ("status" in opened) throw new Error("managed Core session should open");
  const detailTargets = (runtime as unknown as { detailReadTargets: {
    register: (input: {
      runtime_session_ref: string;
      site_id: "xiaohongshu";
      search_operation_id: "xhs_search_notes";
      targets: { canonical_url: string }[];
    }) => string[];
  } }).detailReadTargets;
  const [detailRef] = detailTargets.register({
    runtime_session_ref: opened.runtime_session_ref,
    site_id: "xiaohongshu",
    search_operation_id: "xhs_search_notes",
    targets: [{ canonical_url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567" }]
  });
  const released = runtime.releaseSession(opened.runtime_session_ref, { control_owner: "core_task" });
  assert.equal("status" in released, false);
  const locked = runtime.lockSession(opened.runtime_session_ref, {
    control_owner: "core_task",
    holder_ref: "detail_run"
  });
  assert.equal("status" in locked, false);
  if ("status" in locked) throw new Error("Core should lock the released session");
  assert.equal(locked.lifecycle_state, "locked");

  const mismatched = await runtime.executeAllowlistedReadOperation(opened.runtime_session_ref, {
    site_id: "xiaohongshu",
    operation_id: "xhs_read_note_detail",
    detail_ref: detailRef,
    holder_ref: "other_detail_run"
  });
  assert.equal(mismatched.status, "unavailable");
  if (mismatched.status !== "unavailable") throw new Error("a different Core holder must fail closed");
  assert.equal(mismatched.failure_class, "session_user_controlled");
  assert.equal(probeCalls, 0);

  const result = await runtime.executeAllowlistedReadOperation(opened.runtime_session_ref, {
    site_id: "xiaohongshu",
    operation_id: "xhs_read_note_detail",
    detail_ref: detailRef,
    holder_ref: "detail_run"
  });
  assert.equal(result.status, "unavailable");
  if (result.status !== "unavailable") throw new Error("fixture probe should return its page readiness state");
  assert.equal(result.failure_class, "page_not_ready");
  assert.equal(probeCalls, 1);
});

test("replaces visibility-incompatible identity sessions without leaking viewer or control state", async () => {
  const launches: LocalProviderLaunchInput[] = [];
  const closes: string[] = [];
  const runtime = new HarborRuntime(capturingLauncher(launches, closes));
  const identity_environment = runtime.getLocalIdentityEnvironmentFacts({
    ...providerFixture({ [cloakPath]: { executable: true } }),
    identity_environment_ref: "identity-env_visibility",
    execution_identity_ref: "execution-identity_visibility",
    profile_ref: "profile_visibility",
    site: {
      site_id: "boss",
      origin: "https://www.zhipin.com",
      display_name: "BOSS 直聘"
    },
    login_state: "logged_in",
    storage_state: "present"
  });

  const core = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com",
    control_owner: "core_task"
  });
  assert.equal("status" in core, false);
  if ("status" in core) throw new Error("headless Core session should open");
  assert.equal(launches[0]?.headless, true);
  assert.equal(core.availability.viewer, "unsupported");

  const detailTargets = (runtime as unknown as { detailReadTargets: {
    register: (input: { runtime_session_ref: string; site_id: "boss"; search_operation_id: "boss_job_search"; targets: { canonical_url: string }[]; now: number }) => string[];
    consume: (input: { detail_ref: string; runtime_session_ref: string; site_id: "boss"; operation_id: "boss_read_job_detail"; now: number }) => unknown;
  } }).detailReadTargets;
  const [replacementRef] = detailTargets.register({
    runtime_session_ref: core.runtime_session_ref,
    site_id: "boss",
    search_operation_id: "boss_job_search",
    targets: [{ canonical_url: "https://www.zhipin.com/job_detail/Replacement_Lifecycle.html" }],
    now: 1_000
  });

  const blockedManual = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com/web/geek/job",
    control_owner: "user"
  });
  assert.equal("status" in blockedManual, true);
  if (!("status" in blockedManual)) throw new Error("manual session must not replace an active Core session");
  assert.equal(blockedManual.failure_class, "session_locked");
  assert.equal(launches.length, 1);
  assert.equal(closes.length, 0);

  const releasedCore = runtime.releaseSession(core.runtime_session_ref, { control_owner: "core_task" });
  assert.equal("status" in releasedCore, false);
  if ("status" in releasedCore) throw new Error("Core session should release before manual replacement");
  const manual = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com/web/geek/job",
    control_owner: "user"
  });
  assert.equal("status" in manual, false);
  if ("status" in manual) throw new Error("manual visible session should replace released headless Core session");
  assert.notEqual(manual.runtime_session_ref, core.runtime_session_ref);
  assert.deepEqual(launches.map((launch) => launch.headless), [true, false]);
  assert.ok(launches[0]?.profile_storage_ref);
  assert.equal(launches[1]?.profile_storage_ref, launches[0]?.profile_storage_ref);
  assert.deepEqual(closes, ["profile_visibility"]);
  assert.equal(manual.control_owner, "user");
  assert.equal(manual.control_lock.state, "held");
  assert.equal(manual.availability.viewer, "available");
  assert.equal(manual.viewer_entry?.transport, "local_window");

  const closedCore = runtime.getSession(core.runtime_session_ref);
  assert.equal(closedCore?.lifecycle_state, "closed");
  assert.equal(closedCore?.control_owner, "none");
  assert.equal(closedCore?.control_lock.state, "closed");
  assert.equal(closedCore?.availability.viewer, "unavailable");
  const closedViewer = runtime.getViewerControlFacts(core.runtime_session_ref);
  assert.equal("status" in closedViewer, false);
  if ("status" in closedViewer) throw new Error("closed viewer facts should remain readable");
  assert.equal(closedViewer.viewer.availability, "expired");
  assert.equal(closedViewer.control.owner, "none");
  assert.equal(detailTargets.consume({
    detail_ref: replacementRef,
    runtime_session_ref: core.runtime_session_ref,
    site_id: "boss",
    operation_id: "boss_read_job_detail",
    now: 2_000
  }), "detail_ref_expired");

  const reusedManual = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com/web/geek/recommend",
    control_owner: "user"
  });
  assert.equal("status" in reusedManual, false);
  if ("status" in reusedManual) throw new Error("compatible manual session should be reused");
  assert.equal(reusedManual.runtime_session_ref, manual.runtime_session_ref);
  assert.equal(launches.length, 2);
  assert.equal(closes.length, 1);

  const blockedCore = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com/web/geek/job",
    control_owner: "core_task"
  });
  assert.equal("status" in blockedCore, true);
  if (!("status" in blockedCore)) throw new Error("Core must not replace a user-held visible session");
  assert.equal(blockedCore.failure_class, "session_locked");
  assert.equal(launches.length, 2);
  assert.equal(closes.length, 1);

  const [closeRef] = detailTargets.register({
    runtime_session_ref: manual.runtime_session_ref,
    site_id: "boss",
    search_operation_id: "boss_job_search",
    targets: [{ canonical_url: "https://www.zhipin.com/job_detail/Close_Lifecycle.html" }],
    now: 3_000
  });
  await runtime.close();
  assert.equal(closes.length, 2);
  assert.equal(detailTargets.consume({
    detail_ref: closeRef,
    runtime_session_ref: manual.runtime_session_ref,
    site_id: "boss",
    operation_id: "boss_read_job_detail",
    now: 4_000
  }), "detail_ref_expired");
});

test("replaces a headed Core session when Core requests headless execution", async () => {
  const launches: LocalProviderLaunchInput[] = [];
  const closes: string[] = [];
  const runtime = new HarborRuntime(capturingLauncher(launches, closes));
  const identity_environment = runtime.getLocalIdentityEnvironmentFacts({
    ...providerFixture({ [cloakPath]: { executable: true } }),
    identity_environment_ref: "identity-env_core-visibility",
    execution_identity_ref: "execution-identity_core-visibility",
    profile_ref: "profile_core-visibility",
    site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS 直聘" },
    login_state: "logged_in",
    storage_state: "present"
  });
  const headed = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com",
    control_owner: "core_task",
    headless: false
  });
  assert.equal("status" in headed, false);
  if ("status" in headed) throw new Error("headed Core session should open");

  const otherHolder = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com/web/geek/job",
    control_owner: "core_task",
    holder_ref: "different_core_operation"
  });
  assert.equal("status" in otherHolder, true);
  if (!("status" in otherHolder)) throw new Error("different holder must not replace an active headed Core session");
  assert.equal(otherHolder.failure_class, "session_locked");
  assert.equal(launches.length, 1);
  assert.equal(closes.length, 0);

  const headless = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com/web/geek/job",
    control_owner: "core_task"
  });
  assert.equal("status" in headless, false);
  if ("status" in headless) throw new Error("headless Core session should replace incompatible headed session");
  assert.notEqual(headless.runtime_session_ref, headed.runtime_session_ref);
  assert.deepEqual(launches.map((launch) => launch.headless), [false, true]);
  assert.deepEqual(closes, ["profile_core-visibility"]);
  assert.equal(runtime.getSession(headed.runtime_session_ref)?.control_lock.state, "closed");
  assert.equal(headless.availability.viewer, "unsupported");
  assert.equal(headless.control_owner, "core_task");

  const reused = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com/web/geek/recommend",
    control_owner: "core_task"
  });
  assert.equal("status" in reused, false);
  if ("status" in reused) throw new Error("compatible headless Core session should be reused");
  assert.equal(reused.runtime_session_ref, headless.runtime_session_ref);
  assert.equal(launches.length, 2);
});

test("does not launch a replacement when incompatible session cleanup fails", async () => {
  const launches: LocalProviderLaunchInput[] = [];
  const launcher = capturingLauncher(launches);
  const runtime = new HarborRuntime(async (input) => {
    const result = await launcher(input);
    if (result.status !== "ready") return result;
    return { ...result, close: async () => { throw new Error("fixture cleanup failed"); } };
  });
  const identity_environment = runtime.getLocalIdentityEnvironmentFacts({
    ...providerFixture({ [cloakPath]: { executable: true } }),
    identity_environment_ref: "identity-env_cleanup-failure",
    execution_identity_ref: "execution-identity_cleanup-failure",
    profile_ref: "profile_cleanup-failure",
    site: { site_id: "boss", origin: "https://www.zhipin.com", display_name: "BOSS 直聘" },
    login_state: "logged_in",
    storage_state: "present"
  });
  const core = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com",
    control_owner: "core_task"
  });
  assert.equal("status" in core, false);
  if ("status" in core) throw new Error("initial Core session should open");
  runtime.releaseSession(core.runtime_session_ref, { control_owner: "core_task" });

  const replacement = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com/web/geek/job",
    control_owner: "user"
  });
  assert.equal("status" in replacement, true);
  if (!("status" in replacement)) throw new Error("cleanup failure must block replacement launch");
  assert.equal(replacement.failure_class, "session_cleanup_failed");
  assert.equal(launches.length, 1);
  assert.equal(runtime.getSession(core.runtime_session_ref)?.lifecycle_state, "failed");
  assert.equal(runtime.getSession(core.runtime_session_ref)?.control_lock.state, "released");
  const repeated = await runtime.openIdentityEnvironmentSession({
    identity_environment,
    url: "https://www.zhipin.com/web/geek/job",
    control_owner: "user"
  });
  assert.equal("status" in repeated, true);
  assert.equal(launches.length, 1);
  const runtimeSessions = (runtime as unknown as {
    runtimeSessions: {
      isIdentityEnvironmentInUse: (identityEnvironmentRef: string) => boolean;
      isProfileStorageInUse: (profileStorageRef: string) => boolean;
    };
  }).runtimeSessions;
  assert.equal(runtimeSessions.isIdentityEnvironmentInUse(identity_environment.identity_environment_ref), true);
  assert.equal(runtimeSessions.isProfileStorageInUse(identity_environment.browser_storage.profile_storage_ref), true);
  assert.ok("status" in runtime.releaseSession(core.runtime_session_ref, { control_owner: "core_task" }));
  assert.equal(runtime.getSession(core.runtime_session_ref)?.lifecycle_state, "failed");
});

test("returns structured failure for invalid target URLs", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const result = await runtime.openIdentityEnvironmentSession({
    identity_environment: {
      site: {
        site_id: "xhs",
        origin: "https://www.xiaohongshu.com"
      }
    },
    url: "javascript:alert(1)"
  });

  assert.equal("status" in result, true);
  if (!("status" in result)) throw new Error("invalid URL should not launch");
  assert.equal(result.failure_class, "url_unreachable");
  assert.equal(result.current_error.code, "url_unreachable");
  assert.equal(result.retryable, false);
});

test("reports profile and session blockers as structured validation runtime facts", async () => {
  const locked = await new HarborRuntime(createFixtureLauncher("profile_locked")).createSession();
  assert.equal(locked.lifecycle_state, "failed");
  assert.equal(locked.current_error?.code, "profile_locked");
  assert.equal(locked.current_error?.retryable, true);
  const lockedFacts = new HarborRuntime(createFixtureLauncher("profile_locked"));
  const lockedSession = await lockedFacts.createSession();
  const validation = lockedFacts.getValidationRuntimeFacts(lockedSession.runtime_session_ref);
  assert.equal("status" in validation, false);
  if ("status" in validation) throw new Error("validation facts should be readable");
  assert.equal(validation.runtime_ready, false);
  assert.equal(validation.blocking_reasons[0]?.code, "profile_locked");
  assert.equal(validation.validation_refs.length, 0);

  const lost = await new HarborRuntime(createFixtureLauncher("session_lost")).createSession();
  assert.equal(lost.lifecycle_state, "failed");
  assert.equal(lost.current_error?.code, "session_lost");
  assert.equal(lost.availability.snapshot, "unavailable");
});

test("separates configured, observed, provider claim, and validation evidence facts", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession();
  const sources = new Set(session.facts.map((fact) => fact.source));
  const validation = runtime.getValidationRuntimeFacts(session.runtime_session_ref);

  assert.equal(sources.has("configured"), true);
  assert.equal(sources.has("observed"), true);
  assert.equal(sources.has("provider_claim"), true);
  assert.equal(sources.has("validation_evidence"), true);
  assert.equal("status" in validation, false);
  if ("status" in validation) throw new Error("validation facts should be readable");
  assert.equal(validation.runtime_ready, true);
  assert.equal(validation.validation_refs.length > 0, true);
});

test("does not expose raw CDP endpoints in public session facts", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession();
  const publicJson = JSON.stringify(session);

  assert.equal(publicJson.includes("ws://"), false);
  assert.equal(publicJson.includes("webSocketDebuggerUrl"), false);
  assert.match(session.cdp_ref ?? "", /^cdp_/);
});

test("reports viewer ref, control owner, and handoff facts", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession();

  const viewer = runtime.getViewerControlFacts(session.runtime_session_ref);
  assert.equal("status" in viewer, false);
  if ("status" in viewer) throw new Error("viewer facts should be readable");
  assert.match(viewer.viewer.viewer_ref, /^viewer_/);
  assert.equal(viewer.viewer.viewer_url, null);
  assert.equal(viewer.viewer.availability, "unsupported");
  assert.equal(viewer.viewer.access_mode, "none");
  assert.equal(viewer.control.owner, "system");
  assert.equal(viewer.control.takeover.available, false);
  assert.equal(viewer.control.takeover.unavailable_reason, "viewer_unavailable");

  const handoff = runtime.recordHandoff(session.runtime_session_ref, {
    control_owner: "user",
    handoff_reason: "login_required"
  });
  assert.equal("status" in handoff, false);
  if ("status" in handoff) throw new Error("handoff facts should be readable");
  assert.equal(handoff.control.owner, "user");
  assert.equal(handoff.control.previous_owner, "system");
  assert.equal(handoff.control.handoff_reason, "login_required");
  assert.equal(handoff.control.takeover.available, false);
  assert.equal(handoff.control.takeover.unavailable_reason, "already_user_controlled");
  assert.equal(runtime.getSession(session.runtime_session_ref)?.control_owner, "user");
});

test("returns a Harbor-mediated local viewer entry without raw endpoints", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession({ headless: false, control_owner: "core_task" });

  assert.equal(session.availability.viewer, "available");
  const viewer = runtime.getViewerControlFacts(session.runtime_session_ref);
  assert.equal("status" in viewer, false);
  if ("status" in viewer) throw new Error("local viewer facts should be readable");
  assert.equal(viewer.viewer.availability, "available");
  assert.equal(viewer.viewer.transport, "local_window");
  assert.equal(viewer.viewer.access_mode, "interactive");
  assert.deepEqual(viewer.viewer.input_capabilities, ["keyboard_mouse"]);
  assert.equal(viewer.viewer.viewer_url, null);
  assert.equal(viewer.control.owner, "core_task");
  assert.equal(viewer.privacy_boundary.raw_cdp_endpoint, "not_exposed");
  assert.equal(viewer.privacy_boundary.raw_vnc_endpoint, "not_exposed");
  assert.equal(viewer.privacy_boundary.full_profile_storage, "not_exposed");

  const publicJson = JSON.stringify({ session, viewer });
  assert.equal(publicJson.includes("ws://"), false);
  assert.equal(publicJson.includes("vnc://"), false);
  assert.equal(publicJson.includes("webSocketDebuggerUrl"), false);
  assert.equal(publicJson.includes("cookie"), false);
  assert.equal(publicJson.includes("token"), false);
});

test("returns Core runtime facts and App status fixture from the same Harbor facts", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession();
  runtime.recordHandoff(session.runtime_session_ref, {
    control_owner: "user",
    handoff_reason: "policy_requires_user"
  });

  const core = runtime.getCoreRuntimeFacts(session.runtime_session_ref);
  assert.equal("status" in core, false);
  if ("status" in core) throw new Error("core facts should be readable");
  assert.equal(core.runtime_session_ref, session.runtime_session_ref);
  assert.equal(core.viewer.viewer_ref, session.viewer_ref);
  assert.equal(core.viewer.availability, "unsupported");
  assert.equal(core.control.owner, "user");
  assert.equal(core.control.handoff_reason, "policy_requires_user");
  assert.equal(core.fact_refs.session, session.runtime_session_ref);

  const app = runtime.getAppRuntimeStatusFixture(session.runtime_session_ref);
  assert.equal("status" in app, false);
  if ("status" in app) throw new Error("app fixture should be readable");
  assert.equal(app.runtime_session_ref, session.runtime_session_ref);
  assert.equal(app.browser_status, "ready");
  assert.equal(app.viewer_status.viewer_ref, core.viewer.viewer_ref);
  assert.equal(app.viewer_status.display_state, core.viewer.availability);
  assert.equal(app.control_status.owner, core.control.owner);
  assert.equal(app.control_status.handoff_reason, core.control.handoff_reason);

  const publicJson = JSON.stringify({ core, app });
  assert.equal(publicJson.includes("ws://"), false);
  assert.equal(publicJson.includes("vnc://"), false);
  assert.equal(publicJson.includes("webSocketDebuggerUrl"), false);
  assert.equal(publicJson.includes("raw_cdp"), false);
  assert.equal(publicJson.includes("cookie"), false);
  assert.equal(publicJson.includes("token"), false);
});

test("captures snapshot, refmap, and evidence refs without raw page payloads", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession();
  const capture = runtime.captureSnapshot(session.runtime_session_ref, {
    title: "Inbox",
    url: "https://example.test/inbox",
    summary: "Inbox with two visible messages.",
    source_locator: "fixture://inbox",
    elements: [
      { label: "Open first message", role: "button", locator_hint: "text=Open first message" },
      { label: "Archive", role: "button" }
    ]
  });

  assert.equal(capture.status, "captured");
  if (capture.status !== "captured") throw new Error("capture should be available");
  assert.match(capture.snapshot_ref, /^snapshot_/);
  assert.match(capture.refmap_ref ?? "", /^refmap_/);
  assert.match(capture.core_scene_ref.screenshot_ref ?? "", /^screenshot_/);
  assert.match(capture.core_scene_ref.page_ref, /^page_/);
  assert.match(capture.core_scene_ref.frame_ref, /^frame_/);
  assert.equal(capture.core_scene_ref.page_summary.summary, "Inbox with two visible messages.");
  assert.equal(capture.core_scene_ref.evidence_refs.length, 4);

  const snapshot = runtime.getSnapshot(capture.snapshot_ref);
  assert.equal("snapshot_ref" in snapshot, true);
  if (!("snapshot_ref" in snapshot)) throw new Error("snapshot should be readable");
  assert.equal(snapshot.page.title, "Inbox");
  assert.equal(snapshot.redaction_state, "redacted");

  const refmap = runtime.getRefMap(capture.refmap_ref ?? "");
  assert.equal("refmap_ref" in refmap, true);
  if (!("refmap_ref" in refmap)) throw new Error("refmap should be readable");
  assert.match(refmap.element_refs[0]?.element_ref ?? "", /^element_/);
  assert.match(refmap.element_refs[0]?.source_evidence_ref ?? "", /^evidence_/);
  assert.equal(refmap.element_refs[0]?.label, "Open first message");

  const evidence = runtime.getEvidence(capture.evidence_refs[0] ?? "");
  assert.equal("evidence_ref" in evidence, true);
  if (!("evidence_ref" in evidence)) throw new Error("evidence should be readable");
  assert.equal(evidence.owner, "harbor");
  assert.equal(evidence.storage_scope, "process_memory");
  assert.equal(evidence.provenance.source_locator, "fixture://inbox");

  const coreJson = JSON.stringify(capture.core_scene_ref);
  assert.equal(coreJson.includes("raw_dom"), false);
  assert.equal(coreJson.includes("raw_har"), false);
  assert.equal(coreJson.includes("video"), false);
  assert.equal(coreJson.includes("cookie"), false);
  assert.equal(coreJson.includes("token"), false);
  assert.equal(coreJson.includes("profile_path"), false);
  assert.equal(coreJson.includes("webSocketDebuggerUrl"), false);
});

test("captures live page screenshot refs and artifact facts without raw screenshot bytes", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.openIdentityEnvironmentSession({
    identity_environment: {
      site: {
        site_id: "xiaohongshu",
        origin: "https://www.xiaohongshu.com",
        display_name: "小红书"
      },
      login_state: "logged_in",
      storage_state: "present"
    },
    url: DEFAULT_IDENTITY_SITE_URLS.xiaohongshu,
    control_owner: "agent"
  });
  assert.equal("status" in session, false);
  if ("status" in session) throw new Error("identity environment session should open");

  const capture = await runtime.captureLiveSnapshot(session.runtime_session_ref, {
    elements: [{ label: "Default page", role: "document" }]
  });
  assert.equal(capture.status, "captured");
  if (capture.status !== "captured") throw new Error("live capture should be available");
  assert.equal(capture.core_scene_ref.page_summary.url, DEFAULT_IDENTITY_SITE_URLS.xiaohongshu);
  assert.match(capture.core_scene_ref.screenshot_ref ?? "", /^screenshot_/);

  const screenshotEvidence = capture.evidence_refs
    .map((ref) => runtime.getEvidence(ref))
    .find((record) => !("status" in record) && record.evidence_type === "screenshot");
  assert.ok(screenshotEvidence);
  if (!screenshotEvidence || "status" in screenshotEvidence) throw new Error("screenshot evidence should be readable");
  assert.equal(screenshotEvidence.artifact?.mime_type, "image/png");
  assert.equal((screenshotEvidence.artifact?.byte_length ?? 0) > 0, true);
  assert.match(screenshotEvidence.artifact?.sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(screenshotEvidence.artifact?.raw_bytes, "not_exposed");

  const publicJson = JSON.stringify(capture);
  assert.equal(publicJson.includes("data:image/png"), false);
  assert.equal(publicJson.includes("webSocketDebuggerUrl"), false);
  assert.equal(publicJson.includes("cookie"), false);
  assert.equal(publicJson.includes("token"), false);
});

test("captures live page refs without screenshot evidence when screenshot capture fails", async () => {
  const fixtureLauncher = createFixtureLauncher("ready");
  const runtime = new HarborRuntime(async (input) => {
    const launch = await fixtureLauncher(input);
    if (launch.status !== "ready") return launch;
    return {
      ...launch,
      captureScreenshot: async () => ({
        code: "cdp_unavailable" as const,
        message: "Fixture screenshot capture failed.",
        retryable: true
      })
    };
  });
  const session = await runtime.openIdentityEnvironmentSession({
    identity_environment: {
      identity_environment_ref: "identity-env_xhs-screenshot-failure",
      execution_identity_ref: "execution-identity_xhs-screenshot-failure",
      profile_ref: "profile_xhs-screenshot-failure",
      profile_storage_ref: "profile-storage_xhs-screenshot-failure",
      site: {
        site_id: "xiaohongshu",
        origin: "https://www.xiaohongshu.com",
        display_name: "小红书"
      },
      login_state: "logged_in",
      storage_state: "present"
    },
    url: DEFAULT_IDENTITY_SITE_URLS.xiaohongshu,
    control_owner: "agent"
  });
  assert.equal("status" in session, false);
  if ("status" in session) throw new Error("identity environment session should open");

  const capture = await runtime.captureLiveSnapshot(session.runtime_session_ref, {
    elements: [{ label: "Default page", role: "document" }]
  });
  assert.equal(capture.status, "captured");
  if (capture.status !== "captured") throw new Error("live capture should still be available");
  assert.equal(capture.core_scene_ref.screenshot_ref, undefined);
  assert.match(capture.core_scene_ref.source_trace_ref, /^source_trace_/);
  assert.match(capture.core_scene_ref.page_ref, /^page_/);
  assert.match(capture.core_scene_ref.frame_ref, /^frame_/);
  assert.match(capture.refmap_ref ?? "", /^refmap_/);
  assert.equal(capture.evidence_refs.length, 3);
  assert.equal(capture.evidence_refs.map((ref) => runtime.getEvidence(ref)).some((record) => !("status" in record) && record.evidence_type === "screenshot"), false);
  assert.equal(capture.evidence_refs.map((ref) => runtime.getEvidence(ref)).some((record) => !("status" in record) && record.evidence_type === "source_trace"), true);
});

test("returns structured unavailable states for denied, missing, and stale refs", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession();

  const denied = runtime.captureSnapshot(session.runtime_session_ref, {
    evidence_policy: { capture: "deny" }
  });
  assert.equal(denied.status, "unavailable");
  assert.equal(denied.failure_class, "capture_denied");
  assert.equal(denied.retryable, false);

  const missing = runtime.getSnapshot("snapshot_missing");
  assert.equal("status" in missing, true);
  if (!("status" in missing)) throw new Error("missing snapshot should be unavailable");
  assert.equal(missing.failure_class, "snapshot_missing");

  const captured = runtime.captureSnapshot(session.runtime_session_ref, {
    title: "Transient page",
    summary: "A page that will become stale."
  });
  assert.equal(captured.status, "captured");
  if (captured.status !== "captured") throw new Error("capture should be available");
  await runtime.closeSession(session.runtime_session_ref);

  const stale = runtime.getCoreSceneReference(captured.snapshot_ref);
  assert.equal("status" in stale, true);
  if (!("status" in stale)) throw new Error("closed session snapshot should be stale");
  assert.equal(stale.failure_class, "snapshot_stale");
  assert.equal(stale.retryable, true);

  const closedCapture = runtime.captureSnapshot(session.runtime_session_ref);
  assert.equal(closedCapture.status, "unavailable");
  assert.equal(closedCapture.failure_class, "source_unavailable");
});

test("returns App-safe evidence status fixture without private raw material", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession();
  const capture = runtime.captureSnapshot(session.runtime_session_ref, {
    title: "Fixture inbox",
    url: "https://example.test/inbox",
    summary: "Redacted fixture summary for status display.",
    capture_method: "fixture",
    source_locator: "fixture://status/inbox",
    elements: [{ label: "Message row", role: "row" }],
    evidence_policy: {
      redaction_state: "redacted",
      retention_state: "retained"
    }
  });

  assert.equal(capture.status, "captured");
  if (capture.status !== "captured") throw new Error("capture should be available");

  const status = runtime.getEvidenceStatusFixture(capture.snapshot_ref);
  assert.equal("status" in status, false);
  if ("status" in status) throw new Error("evidence status should be readable");
  assert.equal(status.scene_status.display_state, "available");
  assert.equal(status.scene_status.freshness_state, "fresh");
  assert.equal(status.privacy_boundary.access_boundary, "harbor_refs_only");
  assert.equal(status.privacy_boundary.raw_material, "not_exposed");
  assert.equal(status.privacy_boundary.private_capture_store, "process_memory_only");
  assert.equal(status.privacy_boundary.redacted_export_boundary, "redacted_fixture_refs_only");
  assert.equal(status.privacy_boundary.export_consent, "granted");
  assert.equal(status.privacy_boundary.retention_policy, "ephemeral_by_default");
  assert.equal(status.privacy_boundary.deletion_policy, "expire_or_drop_ref");
  assert.equal(status.evidence_status.length, 4);
  assert.equal(status.evidence_status.every((entry) => entry.display_state === "redacted"), true);
  assert.equal(status.evidence_status.every((entry) => entry.retention_state === "retained"), true);

  const expired = runtime.expireEvidence(capture.evidence_refs[0] ?? "");
  assert.equal("evidence_ref" in expired, true);
  const afterExpire = runtime.getEvidenceStatusFixture(capture.snapshot_ref);
  assert.equal("status" in afterExpire, false);
  if ("status" in afterExpire) throw new Error("expired status should be readable");
  assert.equal(afterExpire.evidence_status.some((entry) => entry.display_state === "expired"), true);

  await runtime.closeSession(session.runtime_session_ref);
  const stale = runtime.getEvidenceStatusFixture(capture.snapshot_ref);
  assert.equal("status" in stale, false);
  if ("status" in stale) throw new Error("stale status should be readable");
  assert.equal(stale.scene_status.display_state, "stale");
  assert.equal(stale.scene_status.blocking_reason, "snapshot_stale");
  assert.equal(stale.evidence_status.some((entry) => entry.display_state === "stale"), true);

  const publicJson = JSON.stringify(stale);
  assert.equal(publicJson.includes("raw_dom"), false);
  assert.equal(publicJson.includes("raw_har"), false);
  assert.equal(publicJson.includes("cookie"), false);
  assert.equal(publicJson.includes("token"), false);
  assert.equal(publicJson.includes("profile_path"), false);
  assert.equal(publicJson.includes("storage_state"), false);
});

test("returns write-precheck target and form facts without raw private material", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession();
  const facts = runtime.getWritePrecheckFacts(session.runtime_session_ref, {
    title: "Spoofed direct title",
    url: "https://attacker.example/direct-write-precheck",
    summary: "Spoofed direct summary",
    locator_hint: "body[data-direct-spoofed=true]",
    target_label: "Fixture contact form",
    fields: [
      { label: "Email", input_kind: "email", required: true, sensitivity: "sensitive", export_policy: "redacted", value_state: "redacted" },
      { label: "Message", input_kind: "textarea", required: true, sensitivity: "public", export_policy: "safe_summary", value_state: "present" },
      { label: "Password", input_kind: "password", required: false, sensitivity: "secret", export_policy: "never_export", value_state: "unavailable" }
    ]
  });

  assert.equal("status" in facts, false);
  if ("status" in facts) throw new Error("write-precheck facts should be readable");
  assert.equal(facts.schema_version, "harbor-write-precheck-facts/v0");
  assert.equal(facts.submitted, false);
  assert.match(facts.writable_target.target_ref, /^writable-target_/);
  assert.match(facts.writable_target.snapshot_ref, /^snapshot_/);
  assert.equal(facts.writable_target.role, "form");
  assert.notEqual(facts.writable_target.locator_hint, "body[data-direct-spoofed=true]");
  assert.equal(facts.writable_target.provenance.source, "provided_context");
  assert.equal(facts.form_state.fields.length, 3);
  assert.equal(facts.form_state.fields[0]?.sensitivity, "sensitive");
  assert.equal(facts.form_state.fields[0]?.export_policy, "redacted");
  assert.equal(facts.form_state.fields[2]?.export_policy, "never_export");
  assert.equal(facts.pre_write_guard.no_submit_guard, "active");
  assert.deepEqual(facts.pre_write_guard.blocked_events, ["submit", "publish", "send", "delete", "pay"]);
  assert.equal(facts.pre_write_guard.enforcement, "facts_only_no_real_submit");
  assert.equal(facts.privacy_boundary.raw_values, "not_exposed");
  const directEvidence = runtime.getEvidence(facts.writable_target.evidence_refs[0] ?? "");
  assert.equal("status" in directEvidence, false);
  if ("status" in directEvidence) throw new Error("direct write-precheck evidence should be readable");
  const sourceLocator = directEvidence.provenance.source_locator;
  assert.equal(typeof sourceLocator, "string");
  if (!sourceLocator) throw new Error("direct write-precheck evidence should include a source locator");
  assert.equal(sourceLocator.includes(session.runtime_session_ref), true);

  const publicJson = JSON.stringify(facts);
  assert.equal(publicJson.includes("attacker.example"), false);
  assert.equal(JSON.stringify(directEvidence).includes("attacker.example"), false);
  assert.equal(publicJson.includes("raw_dom"), false);
  assert.equal(publicJson.includes("raw_har"), false);
  assert.equal(publicJson.includes("cookie"), false);
  assert.equal(publicJson.includes("token"), false);
  assert.equal(publicJson.includes("profile_path"), false);
  assert.equal(publicJson.includes("storage_state"), false);
  assert.equal(publicJson.includes("secret-value"), false);
});

test("returns preview evidence refs, provenance, and freshness states", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession();
  const preview = runtime.capturePreviewEvidence(session.runtime_session_ref, {
    url: "https://example.test/write-precheck",
    current_url: "https://example.test/write-precheck"
  });

  assert.equal("status" in preview, false);
  if ("status" in preview) throw new Error("preview evidence should be readable");
  assert.equal(preview.schema_version, "harbor-preview-evidence-status-fixture/v0");
  assert.match(preview.before_preview.snapshot_ref, /^snapshot_/);
  assert.match(preview.before_preview.refmap_ref ?? "", /^refmap_/);
  assert.equal(preview.target_state_provenance.captured_url, "https://example.test/write-precheck");
  assert.equal(preview.target_state_provenance.current_url, "https://example.test/write-precheck");
  assert.equal(preview.freshness.state, "available");
  assert.equal(preview.viewer_evidence_status.evidence_status.length, 4);

  const changed = runtime.getPreviewEvidenceStatusFixture(preview.before_preview.snapshot_ref, "https://example.test/changed");
  assert.equal("status" in changed, false);
  if ("status" in changed) throw new Error("changed preview evidence should be readable");
  assert.equal(changed.freshness.state, "page_changed");
  assert.equal(changed.freshness.blocking_reason, "page_changed");

  runtime.expireEvidence(preview.before_preview.evidence_refs[0] ?? "");
  const unavailable = runtime.getPreviewEvidenceStatusFixture(preview.before_preview.snapshot_ref);
  assert.equal("status" in unavailable, false);
  if ("status" in unavailable) throw new Error("expired preview evidence should be readable");
  assert.equal(unavailable.freshness.state, "evidence_unavailable");

  const publicJson = JSON.stringify(unavailable);
  assert.equal(publicJson.includes("raw_dom"), false);
  assert.equal(publicJson.includes("raw_har"), false);
  assert.equal(publicJson.includes("cookie"), false);
  assert.equal(publicJson.includes("token"), false);
  assert.equal(publicJson.includes("profile_path"), false);
  assert.equal(publicJson.includes("storage_state"), false);
});

test("returns redacted preview export fixture with no-submit and private boundary", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession();
  const preview = runtime.capturePreviewEvidence(session.runtime_session_ref, {
    url: "https://example.test/write-precheck",
    current_url: "https://example.test/write-precheck"
  });

  assert.equal("status" in preview, false);
  if ("status" in preview) throw new Error("preview evidence should be readable");
  const redacted = runtime.getRedactedPreviewExportFixture(preview.before_preview.snapshot_ref);

  assert.equal("status" in redacted, false);
  if ("status" in redacted) throw new Error("redacted preview export should be readable");
  assert.equal(redacted.schema_version, "harbor-redacted-preview-export-fixture/v0");
  assert.equal(redacted.preview_state, "available");
  assert.match(redacted.before_preview_refs.snapshot_ref, /^snapshot_/);
  assert.equal(redacted.no_submit_guard.status, "active");
  assert.deepEqual(redacted.no_submit_guard.blocked_events, ["submit", "publish", "send", "delete", "pay"]);
  assert.equal(redacted.private_boundary.local_capture_store, "process_memory_only");
  assert.equal(redacted.private_boundary.restricted_material, "not_exported");
  assert.equal(redacted.private_boundary.export_boundary, "redacted_preview_refs_only");
  assert.equal(redacted.redacted_export.evidence_status.every((entry) => entry.display_state === "redacted"), true);

  const publicJson = JSON.stringify(redacted);
  assert.equal(publicJson.includes("raw_dom"), false);
  assert.equal(publicJson.includes("raw_har"), false);
  assert.equal(publicJson.includes("raw_network"), false);
  assert.equal(publicJson.includes("cookie"), false);
  assert.equal(publicJson.includes("token"), false);
  assert.equal(publicJson.includes("profile_path"), false);
  assert.equal(publicJson.includes("storage_state"), false);
  assert.equal(publicJson.includes("secret-value"), false);
});
