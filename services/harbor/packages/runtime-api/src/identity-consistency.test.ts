import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureLauncher, HarborRuntime } from "./index.js";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const cloakPath = "/Users/test/.cloakbrowser/chromium-145.0.7632.109.2/Chromium.app/Contents/MacOS/Chromium";

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

test("returns identity environment consistency facts for Core and App", () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const facts = runtime.getIdentityConsistencyFacts({
    identity_environment: {
      ...providerFixture({ [cloakPath]: { executable: true } }),
      identity_environment_ref: "identity-env_xhs-consistency",
      execution_identity_ref: "execution-identity_xhs-consistency",
      profile_ref: "profile_xhs-consistency",
      site: {
        site_id: "xiaohongshu",
        origin: "https://www.xiaohongshu.com",
        display_name: "小红书"
      },
      login_state: "logged_in",
      storage_state: "present",
      proxy_ref: "proxy_tokyo-home",
      region: "JP",
      language: "zh-CN",
      timezone: "Asia/Tokyo",
      user_agent_summary: "CloakBrowser Chromium 145",
      fingerprint_summary: "provider_claim_ref:fingerprint_xhs"
    },
    observed_environment: {
      proxy_ref: "proxy_tokyo-home",
      region: "JP",
      language: "zh-CN",
      timezone: "Asia/Tokyo",
      browser_version: "145.0.7632.109.2",
      login_state: "logged_in"
    }
  });

  assert.equal(facts.schema_version, "harbor-identity-consistency-facts/v0");
  assert.equal(facts.provider.selected_provider_id, "cloakbrowser");
  assert.equal(facts.provider.default_provider_id, "cloakbrowser");
  assert.equal(facts.provider.restricted_fallback_provider_id, "chrome_official");
  assert.equal(facts.provider.excluded_providers.some((provider) => provider.provider === "chromium"), true);
  assert.equal(facts.provider.excluded_providers.some((provider) => provider.provider === "donut_browser"), true);
  assert.equal(facts.resources.find((resource) => resource.key === "proxy")?.state, "satisfied");
  assert.equal(facts.resources.find((resource) => resource.key === "fingerprint")?.state, "satisfied");
  assert.equal(facts.drift.state, "none");
  assert.deepEqual(facts.risk.states, ["normal"]);
  assert.equal(facts.readiness.state, "ready");
  assert.equal(facts.public_facts.core, "admission_resource_facts_and_blocking_reasons");

  const publicJson = JSON.stringify(facts);
  assert.equal(publicJson.includes("plain-secret-value"), false);
  assert.equal(publicJson.includes("webSocketDebuggerUrl"), false);
  assert.equal(publicJson.includes("ws://"), false);
  assert.equal(publicJson.includes("vnc://"), false);
});

test("reports Chrome fallback, drift, login loss, and site risk without bypass promises", () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const facts = runtime.getIdentityConsistencyFacts({
    identity_environment: {
      ...providerFixture({ [chromePath]: { executable: true } }),
      identity_environment_ref: "identity-env_boss-consistency",
      execution_identity_ref: "execution-identity_boss-consistency",
      profile_ref: "profile_boss-consistency",
      site: {
        site_id: "boss",
        origin: "https://www.zhipin.com",
        display_name: "BOSS 直聘"
      },
      login_state: "expired",
      storage_state: "present",
      proxy_ref: "proxy_shanghai-office",
      region: "CN",
      language: "zh-CN",
      timezone: "Asia/Shanghai",
      fingerprint_summary: "not_configured"
    },
    observed_environment: {
      proxy_ref: "proxy_tokyo-home",
      region: "JP",
      language: "zh-CN",
      timezone: "Asia/Tokyo",
      login_state: "expired"
    },
    risk_events: ["site_blocked"]
  });

  assert.equal(facts.provider.selected_provider_id, "chrome_official");
  assert.equal(facts.provider.selected_role, "restricted_fallback");
  assert.equal(facts.provider.requires_user_notice, true);
  assert.equal(facts.resources.find((resource) => resource.key === "provider")?.state, "satisfied");
  assert.equal(facts.resources.find((resource) => resource.key === "fingerprint")?.state, "missing");
  assert.equal(facts.resources.find((resource) => resource.key === "proxy")?.state, "drift");
  assert.equal(facts.resources.find((resource) => resource.key === "login_state")?.state, "missing");
  assert.equal(facts.login.missing, true);
  assert.equal(facts.drift.state, "detected");
  assert.equal(facts.risk.states.includes("login_required"), true);
  assert.equal(facts.risk.states.includes("environment_drift"), true);
  assert.equal(facts.risk.states.includes("site_blocked"), true);
  assert.equal(facts.readiness.state, "blocked");
  assert.equal(facts.provider.limitations.some((limitation) => limitation.includes("不承诺")), true);

  const publicJson = JSON.stringify(facts);
  assert.equal(publicJson.includes("cookie-value"), false);
  assert.equal(publicJson.includes("session-token-value"), false);
  assert.equal(publicJson.includes("password-value"), false);
});
