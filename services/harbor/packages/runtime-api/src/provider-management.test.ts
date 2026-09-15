import assert from "node:assert/strict";
import test from "node:test";
import { detectBrowserProviders } from "./provider-management.js";

const chromeRoot = "/Applications/Google Chrome.app";
const chromePath = `${chromeRoot}/Contents/MacOS/Google Chrome`;
const plistPath = `${chromeRoot}/Contents/Info.plist`;
const plist = `<plist><dict><key>CFBundleShortVersionString</key><string>153.0.8010.37</string></dict></plist>`;

function detectionEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    HARBOR_CHROME_PATH: chromePath,
    HARBOR_CHROME_OFFICIAL_PATH: chromePath,
    HARBOR_CHROME_OFFICIAL_INSTALL_ROOT: chromeRoot,
    HARBOR_CHROME_OFFICIAL_SOURCE: "official_release",
    HARBOR_CHROME_OFFICIAL_SIGNATURE_STATUS: "apple_codesign_verified",
    HARBOR_CHROME_OFFICIAL_SOURCE_SHA256: "6b6cf06fc357a647d26a32453780f020d9d36978ebe30d69ba8a233b538373e3",
    HARBOR_CHROME_OFFICIAL_EXECUTABLE_SHA256: "83dfc7d9e4fde4272ced1c0cc8d3584d3b5d3d3bdac46978ee05031e8c2ae3c2",
    HARBOR_CHROME_OFFICIAL_BROWSER_VERSION: "153.0.8010.37",
    HARBOR_CHROME_OFFICIAL_PLAYWRIGHT_VERSION: "1.60.0",
    ...overrides
  };
}

function detect(env: Record<string, string | undefined>) {
  return detectBrowserProviders({
    platform: "darwin",
    arch: "arm64",
    home_dir: "/Users/fixture",
    env,
    path_exists: path => path === chromePath,
    is_executable: path => path === chromePath,
    read_text: path => path === plistPath ? plist : null,
    list_dir: () => []
  }).providers.find(provider => provider.provider_id === "chrome_official")!;
}

test("detects exact Chrome facts only when the complete owner pairing is present", () => {
  const exact = detect(detectionEnv());
  assert.equal(exact.role, "qualification");
  assert.equal(exact.project_recommended, false);
  assert.equal(exact.install.source, "official_release");
  assert.equal(exact.install.signature_status, "apple_codesign_verified");
  assert.equal(exact.install.source_sha256, "6b6cf06fc357a647d26a32453780f020d9d36978ebe30d69ba8a233b538373e3");
  assert.equal(exact.install.executable_sha256, "83dfc7d9e4fde4272ced1c0cc8d3584d3b5d3d3bdac46978ee05031e8c2ae3c2");
  assert.equal(exact.install.install_root, chromeRoot);
  assert.equal(exact.install.playwright_version, "1.60.0");
  assert.equal(exact.capabilities.find(capability => capability.key === "persistent_profile")?.state, "supported");
  assert.equal(exact.capabilities.find(capability => capability.key === "snapshot_refs")?.state, "limited");
  assert.equal(exact.capabilities.find(capability => capability.key === "evidence_refs")?.state, "limited");
  assert.equal(exact.capabilities.find(capability => capability.key === "cookie_persistence")?.source, "configured");
  assert.equal(exact.capabilities.find(capability => capability.key === "timezone")?.state, "unsupported");
  assert.equal(exact.capabilities.find(capability => capability.key === "viewport")?.state, "unsupported");
  assert.equal(exact.capabilities.find(capability => capability.key === "native_fingerprint_control")?.state, "unsupported");
  assert.equal(exact.limitations.some(limitation => limitation.includes("核心支持范围")), true);
  assert.equal(exact.limitations.some(limitation => limitation.includes("受限后备")), false);
});

test("keeps ordinary Chrome detection narrow when any exact pairing fact is absent or mismatched", () => {
  for (const [key, value] of [["HARBOR_CHROME_OFFICIAL_SIGNATURE_STATUS", undefined], ["HARBOR_CHROME_OFFICIAL_SOURCE_SHA256", "bad"], ["HARBOR_CHROME_OFFICIAL_PATH", `${chromeRoot}-other`]] as const) {
    const install = detect(detectionEnv({ [key]: value }));
    assert.equal(install.install.status, "installed");
    assert.equal(install.install.version, "153.0.8010.37");
    assert.equal(install.install.source, undefined);
    assert.equal(install.install.executable_sha256, undefined);
    assert.equal(install.install.playwright_version, undefined);
    assert.equal(install.install.install_root, undefined);
    assert.equal(install.role, "restricted_fallback");
    assert.equal(install.capabilities.find(capability => capability.key === "persistent_profile")?.state, "limited");
    assert.equal(install.limitations.some(limitation => limitation.includes("受限后备")), true);
  }
});
