import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFixtureLauncher, DEFAULT_IDENTITY_SITE_URLS, HarborRuntime } from "./index.js";

const smokeProfileRoot = mkdtempSync(join(tmpdir(), "harbor-runtime-smoke-"));
const previousProfileRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
process.env.HARBOR_PROFILE_STORAGE_ROOT = smokeProfileRoot;
process.once("exit", () => {
  if (previousProfileRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT;
  else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousProfileRoot;
  rmSync(smokeProfileRoot, { recursive: true, force: true });
});

const useLocalProvider = process.argv.includes("--local");
const runtime = new HarborRuntime(
  useLocalProvider ? undefined : createFixtureLauncher("ready"),
  useLocalProvider ? {} : { resolve_proxy: () => "http://127.0.0.1:8080" }
);
const providerStatus = runtime.getBrowserProviderStatus();
const providerBinding = runtime.getIdentityEnvironmentProviderBinding();
const identityEnvironment = runtime.getLocalIdentityEnvironmentFacts({
  identity_environment_ref: "identity-env_smoke",
  execution_identity_ref: "execution-identity_smoke",
  profile_ref: "profile_smoke",
  site: {
    site_id: "example",
    origin: "https://example.test",
    display_name: "Example",
    account_identifier: "fixture-account",
    account_ref: "account_smoke"
  },
  login_state: "manual_auth_required",
  storage_state: "present",
  proxy_ref: "proxy_smoke",
  region: "US",
  language: "en-US",
  timezone: "America/Los_Angeles",
  fingerprint_summary: "fixture-provider-claim",
  credential_ref: "credential_smoke",
  keychain_ref: "keychain://harbor/smoke",
  login_method: "manual",
  human_verification: ["manual_login", "captcha"]
});
const identityConsistency = runtime.getIdentityConsistencyFacts({
  identity_environment: identityEnvironment,
  observed_environment: {
    proxy_ref: "proxy_smoke",
    region: "US",
    language: "en-US",
    timezone: "America/Los_Angeles",
    login_state: "manual_auth_required"
  },
  risk_events: ["login_missing"]
});
const managedIdentityEnvironment = runtime.createLocalIdentityEnvironment({
  identity_environment_ref: "identity-env_smoke-managed",
  execution_identity_ref: "execution-identity_smoke-managed",
  profile_ref: "profile_smoke-managed",
  profile_storage_ref: "profile-storage_smoke-managed",
  site: {
    site_id: "xiaohongshu",
    origin: "https://www.xiaohongshu.com",
    display_name: "小红书",
    account_ref: "account_smoke-managed"
  },
  login_state: "manual_auth_required",
  storage_state: "present",
  proxy_ref: "proxy_smoke-managed",
  region: "US",
  language: "en-US",
  timezone: "America/Los_Angeles",
  fingerprint_summary: "fixture-provider-claim"
});
const bossIdentityEnvironment = runtime.createLocalIdentityEnvironment({
  identity_environment_ref: "identity-env_smoke-boss-managed",
  execution_identity_ref: "execution-identity_smoke-boss-managed",
  profile_ref: "profile_smoke-boss-managed",
  profile_storage_ref: "profile-storage_smoke-boss-managed",
  site: {
    site_id: "boss",
    origin: "https://www.zhipin.com",
    display_name: "BOSS 直聘",
    account_ref: "account_smoke-boss-managed"
  },
  login_state: "manual_auth_required",
  storage_state: "present",
  region: "CN",
  language: "zh-CN",
  timezone: "Asia/Shanghai",
  fingerprint_summary: "fixture-provider-claim"
});
const session = await runtime.createSession();
const visibleViewerRuntime = new HarborRuntime(createFixtureLauncher("ready"));
const visibleViewerSession = await visibleViewerRuntime.createSession({ headless: false, control_owner: "core_task" });
const visibleViewerControl = visibleViewerRuntime.getViewerControlFacts(visibleViewerSession.runtime_session_ref);
const browserSession = await runtime.openIdentityEnvironmentSession({
  identity_environment: identityEnvironment,
  url: useLocalProvider ? "about:blank" : "https://example.test/runtime-session",
  control_owner: "agent",
  holder_ref: "smoke-agent"
});
const managedBrowserSession = await runtime.openManagedIdentityEnvironmentSession({
  identity_environment_ref: "identity-env_smoke-managed",
  url: DEFAULT_IDENTITY_SITE_URLS.xiaohongshu,
  control_owner: "agent",
  holder_ref: "smoke-managed-agent"
});
const bossBrowserSession = await runtime.openManagedDefaultSiteSession({
  identity_environment_ref: "identity-env_smoke-boss-managed",
  control_owner: "agent",
  holder_ref: "smoke-boss-agent"
});
const xhsLiveCapture = "status" in managedBrowserSession || managedBrowserSession.lifecycle_state !== "active"
  ? managedBrowserSession
  : await runtime.captureLiveSnapshot(managedBrowserSession.runtime_session_ref, {
      summary: "Live xiaohongshu default page captured as Harbor refs.",
      elements: [{ label: "xiaohongshu default page", role: "document" }]
    });
const bossLiveCapture = "status" in bossBrowserSession || bossBrowserSession.lifecycle_state !== "active"
  ? bossBrowserSession
  : await runtime.captureLiveSnapshot(bossBrowserSession.runtime_session_ref, {
      summary: "Live BOSS default page captured as Harbor refs.",
      elements: [{ label: "BOSS default page", role: "document" }]
    });
const xhsLiveEvidence = "status" in xhsLiveCapture && xhsLiveCapture.status === "captured"
  ? xhsLiveCapture.evidence_refs.map((ref) => runtime.getEvidence(ref))
  : xhsLiveCapture;
const bossLiveEvidence = "status" in bossLiveCapture && bossLiveCapture.status === "captured"
  ? bossLiveCapture.evidence_refs.map((ref) => runtime.getEvidence(ref))
  : bossLiveCapture;
const xhsSiteResourceFacts = "status" in managedBrowserSession || managedBrowserSession.lifecycle_state !== "active"
  ? managedBrowserSession
  : await runtime.getSiteResourceFacts(managedBrowserSession.runtime_session_ref, { site_id: "xiaohongshu", task_kind: "search_notes" });
const bossSiteResourceFacts = "status" in bossBrowserSession || bossBrowserSession.lifecycle_state !== "active"
  ? bossBrowserSession
  : await runtime.getSiteResourceFacts(bossBrowserSession.runtime_session_ref, { site_id: "boss", task_kind: "job_search" });
const managedBrowserStopped = "status" in managedBrowserSession || managedBrowserSession.lifecycle_state === "failed"
  ? managedBrowserSession
  : await runtime.stopSession(managedBrowserSession.runtime_session_ref, { control_owner: "agent" });
const bossBrowserStopped = "status" in bossBrowserSession || bossBrowserSession.lifecycle_state === "failed"
  ? bossBrowserSession
  : await runtime.stopSession(bossBrowserSession.runtime_session_ref, { control_owner: "agent" });
const browserSessionReusable = "status" in browserSession || browserSession.lifecycle_state !== "active"
  ? browserSession
  : await runtime.openIdentityEnvironmentSession({
      identity_environment: identityEnvironment,
      url: useLocalProvider ? "about:blank" : "https://example.test/runtime-session/reused",
      control_owner: "agent",
      holder_ref: "smoke-agent"
    });
const browserSessionReleased = "status" in browserSessionReusable || browserSessionReusable.lifecycle_state !== "active"
  ? browserSessionReusable
  : runtime.releaseSession(browserSessionReusable.runtime_session_ref, { control_owner: "agent" });
const browserSessionStopped = "status" in browserSessionReleased || browserSessionReleased.lifecycle_state === "failed"
  ? browserSessionReleased
  : await runtime.stopSession(browserSessionReleased.runtime_session_ref);
const capture = session.lifecycle_state === "active"
  ? runtime.captureSnapshot(session.runtime_session_ref, {
      title: useLocalProvider ? "Local runtime smoke" : "Fixture runtime smoke",
      url: "about:blank",
      summary: "Runtime Session can produce low-noise snapshot, refmap, and evidence refs.",
      capture_method: useLocalProvider ? "provided_context" : "fixture",
      source_locator: useLocalProvider ? "local://about-blank" : "fixture://runtime-smoke",
      elements: [{ label: "Runtime smoke page", role: "document" }]
    })
  : null;
const readback = runtime.getSession(session.runtime_session_ref);
const viewerControl = runtime.getViewerControlFacts(session.runtime_session_ref);
const handoff = runtime.recordHandoff(session.runtime_session_ref, {
  control_owner: "user",
  handoff_reason: "viewer_only"
});
const coreRuntime = runtime.getCoreRuntimeFacts(session.runtime_session_ref);
const validationRuntime = runtime.getValidationRuntimeFacts(session.runtime_session_ref);
const writePrecheck = runtime.getWritePrecheckFacts(session.runtime_session_ref);
const appStatus = runtime.getAppRuntimeStatusFixture(session.runtime_session_ref);
const scene = capture?.status === "captured" ? runtime.getCoreSceneReference(capture.snapshot_ref) : capture;
const evidenceStatus = capture?.status === "captured" ? runtime.getEvidenceStatusFixture(capture.snapshot_ref) : capture;
const previewEvidence = runtime.capturePreviewEvidence(session.runtime_session_ref);
const redactedPreviewExport = "status" in previewEvidence ? previewEvidence : runtime.getRedactedPreviewExportFixture(previewEvidence.before_preview.snapshot_ref);
const closed = await runtime.closeSession(session.runtime_session_ref);
const staleEvidenceStatus = capture?.status === "captured" ? runtime.getEvidenceStatusFixture(capture.snapshot_ref) : capture;

console.log(JSON.stringify({
  mode: useLocalProvider ? "local" : "fixture",
  session,
  visibleViewerSession,
  visibleViewerControl,
  providerStatus,
  providerBinding,
  identityEnvironment,
  identityConsistency,
  managedIdentityEnvironment,
  bossIdentityEnvironment,
  browserSession,
  managedBrowserSession,
  bossBrowserSession,
  xhsLiveCapture,
  bossLiveCapture,
  xhsLiveEvidence,
  bossLiveEvidence,
  xhsSiteResourceFacts,
  bossSiteResourceFacts,
  managedBrowserStopped,
  bossBrowserStopped,
  browserSessionReusable,
  browserSessionReleased,
  browserSessionStopped,
  capture,
  scene,
  previewEvidence,
  readback,
  viewerControl,
  handoff,
  coreRuntime,
  validationRuntime,
  writePrecheck,
  redactedPreviewExport,
  appStatus,
  evidenceStatus,
  staleEvidenceStatus,
  closed
}, null, 2));

const localUnavailableAllowed = useLocalProvider && session.lifecycle_state === "failed" && Boolean(session.current_error);
const browserSessionReady = !("status" in browserSession) && browserSession.current_page.status === "ready";
const browserSessionFailedWithFacts = "status" in browserSession || (!("status" in browserSession) && browserSession.current_error !== null);
const xhsLiveCaptureCaptured = "status" in xhsLiveCapture && xhsLiveCapture.status === "captured";
const bossLiveCaptureCaptured = "status" in bossLiveCapture && bossLiveCapture.status === "captured";
const xhsSiteResourceFactsReady = !("status" in xhsSiteResourceFacts) &&
  xhsSiteResourceFacts.schema_version === "harbor-site-resource-facts/v0" &&
  xhsSiteResourceFacts.evidence_refs.length > 0;
const bossSiteResourceFactsReady = !("status" in bossSiteResourceFacts) &&
  bossSiteResourceFacts.schema_version === "harbor-site-resource-facts/v0" &&
  bossSiteResourceFacts.evidence_refs.length > 0;
const staleEvidenceInvalid = !staleEvidenceStatus ||
  "status" in staleEvidenceStatus ||
  staleEvidenceStatus.scene_status.display_state !== "stale";

if (
  !readback ||
  !closed ||
  providerStatus.providers.length !== 2 ||
  !providerStatus.excluded_providers.some((provider) => provider.provider === "chromium") ||
  !providerStatus.excluded_providers.some((provider) => provider.provider === "donut_browser") ||
  providerBinding.schema_version !== "harbor-identity-provider-binding/v0" ||
  visibleViewerSession.availability.viewer !== "available" ||
  "status" in visibleViewerControl ||
  identityEnvironment.schema_version !== "harbor-local-identity-environment/v0" ||
  identityConsistency.schema_version !== "harbor-identity-consistency-facts/v0" ||
  identityEnvironment.login_state.recovery_required !== true ||
  identityConsistency.resources.some((resource) => resource.key === "proxy") !== true ||
  identityConsistency.public_facts.core !== "admission_resource_facts_and_blocking_reasons" ||
  identityEnvironment.consumer_boundary.not_exposed.includes("cookie_value") !== true ||
  managedIdentityEnvironment.public_boundary.output !== "status_and_redacted_refs_only" ||
  runtime.listLocalIdentityEnvironments().length !== 2 ||
  (!localUnavailableAllowed && (!capture || capture.status !== "captured")) ||
  (!useLocalProvider && !browserSessionReady) ||
  (!useLocalProvider && ("status" in managedBrowserSession || managedBrowserSession.current_page.status !== "ready")) ||
  (!useLocalProvider && ("status" in bossBrowserSession || bossBrowserSession.current_page.requested_url !== DEFAULT_IDENTITY_SITE_URLS.boss)) ||
  (!useLocalProvider && !xhsLiveCaptureCaptured) ||
  (!useLocalProvider && !bossLiveCaptureCaptured) ||
  (!useLocalProvider && !xhsSiteResourceFactsReady) ||
  (!useLocalProvider && !bossSiteResourceFactsReady) ||
  (useLocalProvider && !browserSessionReady && !browserSessionFailedWithFacts) ||
  "status" in viewerControl ||
  "status" in handoff ||
  "status" in coreRuntime ||
  "status" in validationRuntime ||
  (!localUnavailableAllowed && "status" in writePrecheck) ||
  "status" in appStatus ||
  (!localUnavailableAllowed && (!evidenceStatus || "status" in evidenceStatus)) ||
  (!localUnavailableAllowed && "status" in previewEvidence) ||
  (!localUnavailableAllowed && "status" in redactedPreviewExport) ||
  (!localUnavailableAllowed && staleEvidenceInvalid)
) {
  process.exitCode = 1;
}
