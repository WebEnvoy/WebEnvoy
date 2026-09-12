import { managedPageObservationExpression, normalizeManagedProviderObservation, trustManagedPageObserver } from "./managed-observation.js";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  bindIdentityEnvironmentDefaultProvider,
  classifyLaunchFailure,
  diagnoseBrowserProviderFailure,
  detectBrowserProviders,
  resolveCamoufoxOverride,
  type BrowserProviderDetectionInput,
  type IdentityEnvironmentProviderBinding
} from "./provider-management.js";
import { opaqueRef } from "./refs.js";
import {
  resolveIdentityEnvironmentLaunchConfiguration,
  type ResolvedIdentityEnvironmentLaunchConfiguration
} from "./identity-environment-configuration.js";
import { prepareProfileStorage } from "./profile-storage.js";
import {
  trustLocalProviderReadProbe,
  trustLocalProviderSiteResourceProbe,
  trustLocalProviderMediaActionProbe,
  trustLocalProviderWritePrecheckProbe
} from "./read-operation-probe-trust.js";
import { isOfficialCamoufoxLaunchRequest, launchCamoufoxUpstreamProvider } from "./camoufox-upstream-driver.js";
import { isCanonicalDetailUrl } from "./detail-read-target.js";
import type {
  BossJobDetailPublicSummary,
  LocalProviderLaunchInput,
  LocalProviderLauncher,
  LocalProviderLaunchResult,
  LocalProviderMediaActionInput,
  LocalProviderMediaActionResult,
  LocalProviderDetailPublicSummary,
  LocalProviderPageFacts,
  LocalProviderReadProbeInput,
  LocalProviderReadProbeResult,
  LocalProviderReadProbePublicSummary,
  LocalProviderSiteResourceProbeInput,
  LocalProviderSiteResourceProbeResult,
  LocalProviderScreenshotFacts,
  LocalProviderWritePrecheckProbeInput,
  LocalProviderWritePrecheckProbeResult,
  XhsWritePrecheckCompositionPath,
  XhsWritePrecheckCompositionState,
  XhsWritePrecheckFieldState,
  XhsWritePrecheckMediaState,
  XhsWritePrecheckObservationStatus,
  XhsPublicObservation,
  XhsPublicObservationExpected,
  XhsPublicObservationExpectedMatch,
  XhsPublicObservationFieldSummary,
  XhsPublicObservationPendingIssueCode,
  XhsPathPrepareFailureStage,
  XhsPathPrepareNormalizedState,
  RuntimeErrorCode,
  RuntimeErrorFact,
  RuntimeFact,
  XiaohongshuNoteDetailPublicSummary,
  XiaohongshuSearchPublicFields
} from "./runtime-session-types.js";

type CdpPageTarget = { id?: string; type?: string; webSocketDebuggerUrl?: string; url?: string; title?: string };
type ObservedDetailPublicSummary = Omit<XiaohongshuNoteDetailPublicSummary, "source_citation"> | Omit<BossJobDetailPublicSummary, "detail_ref" | "source_citation">;

class ProviderPageCommitError extends Error {}
class ProviderOriginDriftError extends Error {}

export async function launchLocalDedicatedProvider(input: LocalProviderLaunchInput): Promise<LocalProviderLaunchResult> {
  const explicitBrowserPath = input.browser_path || process.env.HARBOR_BROWSER_PATH || "";
  const persistedBinding = input.identity_environment?.provider_binding;
  if (persistedBinding && (
    !persistedBinding.selected_provider_id || !persistedBinding.selected_provider ||
    persistedBinding.selected_provider.provider_id !== persistedBinding.selected_provider_id ||
    (input.profile_ref !== input.identity_environment?.profile_ref) ||
    (input.provider_id && input.provider_id !== persistedBinding.selected_provider_id) ||
    (explicitBrowserPath && explicitBrowserPath !== persistedBinding.selected_provider.install.path) ||
    (input.profile_storage_ref !== input.identity_environment?.browser_storage.profile_storage_ref)
  )) {
    return unavailable("identity_environment_unavailable", "Requested provider or Profile does not match the managed identity binding.", [
      { key: "provider.binding", source: "observed", value: "provider_mismatch" }
    ]);
  }
  // Camoufox is admitted only through the owner-provided official source and
  // fixed pins. All other Camoufox/native/legacy requests remain fail-closed
  // before detection, profile preparation, or provider fallback.
  if (isCamoufoxLaunchRequest(input)) {
    return isOfficialCamoufoxLaunchRequest(input) ? launchCamoufoxUpstreamProvider(input) : retiredCamoufoxUnavailable();
  }
  const providerBinding = persistedBinding ?? (explicitBrowserPath ? null : resolveRuntimeProviderBinding(undefined));
  if (input.operation_scope === "profile_management") return unavailable("provider_unavailable", "This Provider does not support guarded management navigation.", []);
  const browserPath = explicitBrowserPath || providerBinding?.selected_provider?.install.path || "";
  if (!browserPath) {
    const diagnostic = providerBinding?.diagnostics[0] ?? diagnoseBrowserProviderFailure({ provider_id: "cloakbrowser", failure_class: "not_installed" });
    return unavailable("provider_unavailable", diagnostic.app_summary, providerBindingFacts(providerBinding));
  }
  const profileStorage = await prepareProfileStorage(input.profile_storage_ref);
  const providerConfiguration = input.identity_environment
    ? resolveIdentityEnvironmentLaunchConfiguration(input.identity_environment, input.resolve_proxy)
    : null;
  if (input.identity_environment && !providerConfiguration) {
    return unavailable("unsupported", "Identity environment configuration cannot be resolved by the selected local provider.", [
      ...providerBindingFacts(providerBinding),
      ...profileStorage.facts
    ]);
  }
  const args = providerLaunchArguments(input, profileStorage.profileDir, providerConfiguration);
  await removeStaleDevtoolsPort(profileStorage.profileDir);
  const child = spawn(browserPath, args, { stdio: "ignore" });
  const launchDeadline = Date.now() + Math.max(1, input.timeout_ms);
  try {
    const port = await waitForDevtoolsPort(profileStorage.profileDir, launchDeadline);
    const readbackSignal = AbortSignal.timeout(remainingLaunchTime(launchDeadline));
    const version = await fetchVersion(port, readbackSignal);
    const initialPageUrl = providerConfiguration ? providerConfigurationPageUrl(input) : input.url;
    const configurationFacts = providerConfiguration
      ? await applyAndReadbackProviderConfiguration(port, initialPageUrl, providerConfiguration, readbackSignal)
      : [];
    let currentPageTargetId: string | undefined;
    const page = isXhsCreatorPublishUrl(input)
      ? await openProviderUrl(port, input.url, readbackSignal, (target) => { currentPageTargetId = target.id; })
      : await readPageFacts(port, initialPageUrl, readbackSignal);
    let currentUrl = page.current_url ?? initialPageUrl;
    const evidence_ref = opaqueRef("validation");
    return {
      status: "ready",
      execution_surface: "local_provider",
      driver_ref: opaqueRef("driver"),
      driver_kind: "chromium_cdp",
      cdp_ref: opaqueRef("cdp"),
      viewer_entry: viewerEntry(input.headless),
      page,
      facts: [
        ...providerBindingFacts(providerBinding),
        ...configurationFacts,
        ...profileStorage.facts,
        { key: "browser.launch", source: "observed", value: "ready", evidence_ref },
        { key: "cdp.version", source: "validation_evidence", value: `${version.Browser} ${version["Protocol-Version"]}`, evidence_ref },
        ...page.facts
      ],
      observePage: trustManagedPageObserver(async () => {
        const signal = AbortSignal.timeout(Math.max(1, input.timeout_ms));
        const targets = await pageTargets(port, signal);
        const target = currentPageTargetId ? targets.find(item => item.id === currentPageTargetId) : targets.length === 1 ? targets[0] : undefined;
        if (!target?.webSocketDebuggerUrl) throw new Error("managed_page_unavailable");
        currentPageTargetId = target.id;
        return withCdp(target.webSocketDebuggerUrl, async client => {
          const evaluated = await client.send("Runtime.evaluate", { expression: managedPageObservationExpression, returnByValue: true });
          return normalizeManagedProviderObservation((evaluated.result as { value?: unknown } | undefined)?.value);
        }, signal);
      }),
      openUrl: async (url) => {
        const signal = AbortSignal.timeout(Math.max(1, input.timeout_ms));
        const existing = isXhsCreatorPublishUrl(input)
          ? await pageTargets(port, signal).then((pages) => selectPage(pages, url, currentPageTargetId)).catch(() => undefined)
          : undefined;
        const nextPage = existing
          ? await readTargetPageFacts(existing, url, signal)
          : await openProviderUrl(port, url, signal, (target) => { currentPageTargetId = target.id; });
        if (existing?.id) currentPageTargetId = existing.id;
        currentUrl = nextPage.current_url ?? url;
        return nextPage;
      },
      probeSiteResource: trustLocalProviderSiteResourceProbe((probe) => probeProviderSiteResource(port, currentUrl, probe)),
      probeReadOperation: trustLocalProviderReadProbe(async (probe) => {
        const result = await probeProviderReadOperation(port, probe);
        if (result.page?.current_url) currentUrl = result.page.current_url;
        return result;
      }),
      probeWritePrecheck: trustLocalProviderWritePrecheckProbe((probe) =>
        probeProviderWritePrecheck(port, currentUrl, probe, currentPageTargetId)
      ),
      executeMediaAction: trustLocalProviderMediaActionProbe((action) =>
        executeXhsMediaAction(port, currentUrl, action, currentPageTargetId)
      ),
      captureScreenshot: () => captureProviderScreenshot(port, currentUrl),
      close: () => closeBrowser(child, profileStorage.profileDir, !profileStorage.persistent)
    };
  } catch (error) {
    await closeBrowser(child, profileStorage.profileDir, !profileStorage.persistent);
    const diagnostic = diagnoseBrowserProviderFailure({
      provider_id: providerBinding?.selected_provider_id ?? providerConfiguration?.provider_id ?? "cloakbrowser",
      failure_class: classifyLaunchFailure(error),
      path: browserPath,
      message: error instanceof Error ? error.message : "Browser launch failed."
    });
    return unavailable("launch_failed", diagnostic.app_summary, [...providerBindingFacts(providerBinding), ...profileStorage.facts]);
  }
}

export function selectLocalProviderId(
  requested: string | undefined,
  bound: string | null | undefined,
  configured: string | undefined,
  camoufoxAvailable: boolean
): string | undefined {
  return requested ?? bound ?? (configured === "camoufox" ? "camoufox" : undefined) ?? (camoufoxAvailable ? "camoufox" : undefined);
}

const CAMOUFOX_LAUNCH_REASONS = new Set(["retired_binding", "unqualified"]);

export function isCamoufoxLaunchRequest(
  input: Pick<LocalProviderLaunchInput, "browser_path" | "provider_id" | "identity_environment">,
  env: Record<string, string | undefined> = process.env
): boolean {
  const bindingProvider = input.identity_environment?.provider_binding?.selected_provider_id;
  const explicitCamoufoxProvider = input.provider_id === "camoufox";
  const explicitNonCamoufoxProvider = input.provider_id !== undefined && input.provider_id !== "camoufox";
  // `browser_path` wins over HARBOR_BROWSER_PATH in the launcher. Only that
  // effective path can turn an explicit non-Camoufox request into a retired
  // Camoufox launch; unrelated Camoufox environment hints must not do so.
  const effectiveBrowserPath = input.browser_path || env.HARBOR_BROWSER_PATH;
  const effectiveCamoufoxPath = isCamoufoxPath(effectiveBrowserPath);

  // Persisted Camoufox bindings and explicit Camoufox requests are retired
  // unconditionally once the managed-binding consistency check has passed.
  // Explicit non-Camoufox requests remain eligible for the existing path and
  // provider selection flow when that effective path is not Camoufox,
  // including when unrelated Camoufox env flags are present.
  if (explicitCamoufoxProvider || bindingProvider === "camoufox") return true;
  if (effectiveCamoufoxPath) return true;
  if (explicitNonCamoufoxProvider) return false;
  if (bindingProvider !== undefined) return false;
  // With no explicit provider or binding, the configured Camoufox provider
  // owns even a path whose basename does not identify Camoufox. This keeps a
  // renamed/opaque configured binary from reaching the generic spawn path.
  if (env.HARBOR_BROWSER_PROVIDER === "camoufox") return true;
  if (env.HARBOR_BROWSER_PROVIDER) return false;
  if (effectiveBrowserPath) return false;
  if (env.HARBOR_CAMOUFOX_LAUNCH_STATE === "retired") return true;
  return Boolean(resolveCamoufoxOverride(env));
}

function isCamoufoxPath(path: string | undefined): boolean {
  return typeof path === "string" && /(?:^|[\\/])camoufox(?:$|[._\\/-])/i.test(path);
}

function retiredCamoufoxUnavailable(): LocalProviderLaunchResult {
  const reason = CAMOUFOX_LAUNCH_REASONS.has(process.env.HARBOR_CAMOUFOX_LAUNCH_REASON ?? "")
    ? process.env.HARBOR_CAMOUFOX_LAUNCH_REASON!
    : "unqualified";
  return unavailable("unsupported", "Camoufox 的旧补丁运行路线已退役，需要明确选择受支持版本；当前原版 Camoufox/Playwright 组合尚未通过 Qualification Gate。Harbor 不会启动 Camoufox 或自动切换 Provider。", [
    { key: "provider.camoufox.launch_state", source: "observed", value: "retired" },
    { key: "provider.camoufox.launch_reason", source: "observed", value: reason }
  ]);
}

type WritePrecheckObservation = {
  url?: string;
  origin?: string;
  pathname?: string;
  challenge_like?: boolean;
  login_like?: boolean;
  creator_app_owned?: boolean;
  creator_surface_state?: "observed" | "unknown" | "absent";
  creator_root_count?: number;
  upload_image_tab_active?: boolean;
  upload_image_entry_visible?: boolean;
  text_image_entry_visible?: boolean;
  composition_path?: XhsWritePrecheckCompositionPath;
  path_observed?: XhsWritePrecheckObservationStatus;
  path_entry_visible?: XhsWritePrecheckObservationStatus;
  composition_state?: XhsWritePrecheckCompositionState;
  composition_initialized?: boolean;
  field_states?: Record<string, XhsWritePrecheckFieldState>;
  media_state?: XhsWritePrecheckMediaState;
  validation_state?: XhsWritePrecheckFieldState;
  save_draft_control?: XhsWritePrecheckFieldState;
  publish_control?: XhsWritePrecheckFieldState;
  public_observation?: {
    account_source_kind?: unknown;
    account_candidates?: readonly { label?: unknown; ref?: unknown; stable_id?: unknown }[];
    business_target_candidates?: readonly { label?: unknown; ref?: unknown }[];
    business_target_kind?: unknown;
    media_source_kind?: unknown;
    image_count?: unknown;
    ordered_item_refs?: readonly unknown[];
    title_summary?: { state?: unknown; length?: unknown; fingerprint?: unknown };
    body_summary?: { state?: unknown; length?: unknown; fingerprint?: unknown };
    title_expected_match?: XhsPublicObservationExpectedMatch;
    body_expected_match?: XhsPublicObservationExpectedMatch;
    page_fingerprint?: unknown;
    page_diff?: "unchanged" | "changed" | "unknown";
  };
  selection_status?: "selected" | "not_performed" | "blocked" | "unknown";
};

type PublicFieldSummaryRaw = {
  state?: unknown;
  length?: unknown;
  fingerprint?: unknown;
};

const writePrecheckCompositionPaths = new Set<XhsWritePrecheckCompositionPath>([
  "image_text_upload", "image_text_generate", "video", "long_article", "podcast"
]);

const compositionPathLabels: Record<XhsWritePrecheckCompositionPath, readonly string[]> = {
  image_text_upload: ["上传图片", "上传图文"],
  image_text_generate: ["文字配图"],
  video: ["上传视频", "视频"],
  long_article: ["长文", "写长文"],
  podcast: ["播客"]
};
const mediaControlIds: Record<XhsWritePrecheckCompositionPath, readonly string[]> = {
  image_text_upload: ["upload_image"],
  image_text_generate: ["generate_image"],
  video: ["upload_video"],
  long_article: ["add_media"],
  podcast: ["upload_audio", "add_rss_subscription"]
};

function normalizedCompositionPath(value: XhsWritePrecheckCompositionPath | undefined): XhsWritePrecheckCompositionPath {
  return value && writePrecheckCompositionPaths.has(value) ? value : "image_text_upload";
}

function isCreatorPublishPath(pathname: string | undefined): boolean {
  return pathname?.replace(/\/$/, "") === "/publish/publish";
}

export function sameWritePrecheckUrl(observed: string | undefined, expected: string): boolean {
  if (!observed) return false;
  try {
    const actual = new URL(observed);
    const target = new URL(expected);
    if (actual.origin !== target.origin || actual.pathname.replace(/\/$/, "") !== target.pathname.replace(/\/$/, "") || actual.hash || target.hash) return false;
    const actualParams = [...actual.searchParams].sort(([a], [b]) => a.localeCompare(b));
    const targetParams = [...target.searchParams].sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(actualParams) === JSON.stringify(targetParams) ||
      (targetParams.length === 0 && (
        (actualParams.length === 1 && actual.searchParams.get("from") === "tab_switch") ||
        (actualParams.length === 2 && actual.searchParams.get("from") === "menu_left" && actual.searchParams.get("target") === "image")
      ));
  } catch {
    return false;
  }
}

function unknownFieldState(): XhsWritePrecheckFieldState {
  return { availability: "unknown", observation: "unknown" };
}

function safeFieldState(value: XhsWritePrecheckFieldState | undefined): XhsWritePrecheckFieldState {
  if (!value) return unknownFieldState();
  return {
    availability: value.availability,
    observation: value.observation,
    ...(value.required === undefined ? {} : { required: value.required }),
    ...(value.editable === undefined ? {} : { editable: value.editable }),
    ...(value.value_state === undefined ? {} : { value_state: value.value_state })
  };
}

function safeFieldStates(observation: WritePrecheckObservation): Record<string, XhsWritePrecheckFieldState> {
  return {
    title_input: safeFieldState(observation.field_states?.title_input),
    content_editor: safeFieldState(observation.field_states?.content_editor),
    publish_control: safeFieldState(observation.field_states?.publish_control ?? observation.publish_control)
  };
}

function safeMediaState(observation: WritePrecheckObservation, compositionPath: XhsWritePrecheckCompositionPath): XhsWritePrecheckMediaState {
  const media = observation.media_state;
  if (!media) return { availability: "unknown", observation: "unknown", controls: {} };
  const controls = media.controls ?? {};
  return {
    availability: media.availability,
    observation: media.observation,
    controls: Object.fromEntries(mediaControlIds[compositionPath]
      .filter((id) => controls[id] !== undefined)
      .map((id) => [id, safeFieldState(controls[id])]))
  };
}

const publicObservationIssueCodes = new Set<XhsPublicObservationPendingIssueCode>([
  "account_unknown", "account_mismatch", "business_target_unknown", "business_target_mismatch",
  "image_count_unknown", "image_order_unknown", "image_order_mismatch", "title_unknown", "title_mismatch",
  "body_unknown", "body_mismatch", "page_fingerprint_unknown", "page_changed", "page_diff_unknown"
]);

const publicObservationSensitive = /cookie|token|password|secret|credential|authorization|apikey|accesskey|session|profile|storage|raw.?dom|raw.?har|screenshot|network|cdp|验证码|校验码|安全验证/i;

function boundedPublicObservationLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 && normalized.length <= 96 && !/[\u0000-\u001f\u007f]/.test(normalized) &&
    !publicObservationSensitive.test(normalized) ? normalized : null;
}

function boundedPublicObservationRef(value: unknown): string | null {
  const label = boundedPublicObservationLabel(value);
  return label && /^[A-Za-z][A-Za-z0-9._:/-]{0,199}$/.test(label) ? label : null;
}

function expectedMatch(value: unknown): XhsPublicObservationExpectedMatch {
  return value === "matched" || value === "mismatched" || value === "unknown" ? value : "unknown";
}

function publicFieldSummary(
  value: PublicFieldSummaryRaw | undefined,
  match: unknown
): XhsPublicObservationFieldSummary {
  const state = value?.state === "empty" || value?.state === "present" ? value.state : "unknown";
  const length = typeof value?.length === "number" && Number.isInteger(value.length) && value.length >= 0 && value.length <= 2_000
    ? value.length
    : null;
  const fingerprint = typeof value?.fingerprint === "string" && /^fnv1a:[0-9a-f]{8}$/.test(value.fingerprint)
    ? value.fingerprint
    : null;
  const normalizedMatch = expectedMatch(match);
  const status = normalizedMatch === "mismatched" ? "mismatch" : state === "unknown" || length === null || fingerprint === null ? "unknown" : "observed";
  return {
    status,
    summary: status === "unknown"
      ? { state: "unknown", length: null, fingerprint: null }
      : { state, length, fingerprint },
    expected_match: normalizedMatch
  };
}

function publicLabelRef(
  candidates: readonly { label?: unknown; ref?: unknown }[] | undefined,
  expectedRef: string | undefined
): XhsPublicObservation["account"] {
  if (!candidates || candidates.length !== 1) {
    return { status: "unknown", label: null, ref: null, expected_match: "unknown" };
  }
  const candidate = candidates[0]!;
  const label = boundedPublicObservationLabel(candidate.label);
  const ref = boundedPublicObservationRef(candidate.ref);
  if (!label && !ref) return { status: "unknown", label: null, ref: null, expected_match: "unknown" };
  return {
    status: "observed",
    label,
    ref,
    expected_match: expectedRef === undefined ? "unknown" : ref === null ? "unknown" : ref === expectedRef ? "matched" : "mismatched"
  };
}

function publicObservationFromObservation(
  observation: WritePrecheckObservation,
  expected: XhsPublicObservationExpected | undefined
): XhsPublicObservation {
  const raw = observation.public_observation;
  const observedAccountCandidate = raw?.account_source_kind === "xiaohongshu.creator_auth_store.user_info/v1" &&
    raw.account_candidates?.length === 1 ? raw.account_candidates[0] : undefined;
  const observedAccountLabel = boundedPublicObservationLabel(observedAccountCandidate?.label);
  const observedAccountId = typeof observedAccountCandidate?.stable_id === "string" &&
    /^[A-Za-z0-9_-]{1,100}$/.test(observedAccountCandidate.stable_id)
    ? observedAccountCandidate.stable_id
    : null;
  const observedAccount = observedAccountLabel && observedAccountId
    ? [{
        label: observedAccountLabel,
        ref: `account:sha256:${createHash("sha256").update(JSON.stringify({ site_id: "xiaohongshu", stable_id: observedAccountId })).digest("hex")}`
      }]
    : raw?.account_candidates;
  const account = publicLabelRef(observedAccount, expected?.account_ref);
  // The page proves the concrete creator surface; Harbor independently
  // derives the same canonical BusinessTarget ref used by Core policy.
  const observedBusinessTarget = raw?.business_target_kind === "xiaohongshu.creator_publish_page/v1" &&
    raw.account_source_kind === "xiaohongshu.creator_auth_store.user_info/v1" && observedAccountId && observedAccountLabel &&
    observation.creator_root_count === 1
    ? [{
        label: "小红书创作页",
        ref: `target:sha256:${createHash("sha256").update(JSON.stringify({
          target_ref: "https://creator.xiaohongshu.com/publish/publish",
          target_type: "creator_publish_page"
        })).digest("hex")}`
      }]
    : undefined;
  const business_target = publicLabelRef(
    raw?.business_target_candidates?.length ? raw.business_target_candidates : observedBusinessTarget,
    expected?.business_target_ref
  );
  const imageCount = typeof raw?.image_count === "number" && Number.isInteger(raw.image_count) && raw.image_count >= 0 && raw.image_count <= 100
    ? raw.image_count
    : null;
  const refs = raw?.media_source_kind === "xiaohongshu.creator_publish_page.preview_image_source/v1" && Array.isArray(raw.ordered_item_refs)
    ? raw.ordered_item_refs.map(boundedPublicObservationRef)
    : [];
  const safeRefs = refs.every((ref): ref is string => ref !== null) && new Set(refs).size === refs.length ? refs : [];
  const order_status: XhsPublicObservation["media"]["order_status"] = imageCount === 0 || (imageCount !== null && safeRefs.length === imageCount) ? "observed" : "unknown";
  const expectedMediaRefs = expected?.media_refs;
  const mediaExpectedMatch = expectedMediaRefs === undefined
    ? "unknown"
    : imageCount === null || order_status !== "observed"
      ? "unknown"
      : imageCount !== expectedMediaRefs.length || safeRefs.some((ref, index) => ref !== expectedMediaRefs[index])
        ? "mismatched"
        : "matched";
  const media: XhsPublicObservation["media"] = {
    image_count: imageCount,
    order_status,
    ordered_item_refs: order_status === "observed" ? safeRefs : [],
    expected_match: mediaExpectedMatch
  };
  const fields = {
    title: publicFieldSummary(raw?.title_summary, raw?.title_expected_match),
    body: publicFieldSummary(raw?.body_summary, raw?.body_expected_match)
  };
  const fingerprint = typeof raw?.page_fingerprint === "string" && /^fnv1a:[0-9a-f]{8}$/.test(raw.page_fingerprint)
    ? raw.page_fingerprint
    : null;
  const diff = raw?.page_diff === "unchanged" || raw?.page_diff === "changed" ? raw.page_diff : "unknown";
  const pendingCandidates: (XhsPublicObservationPendingIssueCode | null)[] = [
    account.status === "unknown" || expected?.account_ref !== undefined && account.expected_match === "unknown"
      ? "account_unknown" : account.expected_match === "mismatched" ? "account_mismatch" : null,
    business_target.status === "unknown" || expected?.business_target_ref !== undefined && business_target.expected_match === "unknown"
      ? "business_target_unknown" : business_target.expected_match === "mismatched" ? "business_target_mismatch" : null,
    imageCount === null ? "image_count_unknown" : order_status === "unknown" ? "image_order_unknown" : media.expected_match === "mismatched" ? "image_order_mismatch" : null,
    fields.title.status === "unknown" || expected?.title !== undefined && fields.title.expected_match === "unknown"
      ? "title_unknown" : fields.title.status === "mismatch" ? "title_mismatch" : null,
    fields.body.status === "unknown" || expected?.body !== undefined && fields.body.expected_match === "unknown"
      ? "body_unknown" : fields.body.status === "mismatch" ? "body_mismatch" : null,
    fingerprint === null ? "page_fingerprint_unknown" : diff === "changed" ? "page_changed" : diff === "unknown" ? "page_diff_unknown" : null
  ];
  const pending_issue_codes = pendingCandidates.filter((code): code is XhsPublicObservationPendingIssueCode => code !== null && publicObservationIssueCodes.has(code)).slice(0, 8);
  return {
    schema_version: "harbor-xhs-public-observation/v0",
    status: pending_issue_codes.length === 0 ? "observed" : "unknown",
    account,
    business_target,
    media,
    fields,
    page: { fingerprint, diff },
    pending_issue_codes,
    submitted: false
  };
}

export function validXhsPublicObservation(value: unknown): value is XhsPublicObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const observation = value as Record<string, unknown>;
  const record = (candidate: unknown) => candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : undefined;
  const exact = (candidate: Record<string, unknown> | undefined, keys: string) => candidate !== undefined && Object.keys(candidate).sort().join(",") === keys;
  const match = (candidate: unknown) => candidate === "matched" || candidate === "mismatched" || candidate === "unknown";
  const labelRef = (candidate: unknown) => {
    const item = record(candidate);
    if (!item) return false;
    return exact(item, "expected_match,label,ref,status") && (item.status === "observed" || item.status === "unknown") &&
      (item.label === null || boundedPublicObservationLabel(item.label) !== null) &&
      (item.ref === null || boundedPublicObservationRef(item.ref) !== null) &&
      (item.status === "observed" ? item.label !== null || item.ref !== null : item.label === null && item.ref === null) &&
      match(item.expected_match);
  };
  const field = (candidate: unknown) => {
    const item = record(candidate);
    const summary = record(item?.summary);
    if (!item || !summary) return false;
    return exact(item, "expected_match,status,summary") && exact(summary, "fingerprint,length,state") &&
      ["observed", "unknown", "mismatch"].includes(String(item.status)) &&
      ["empty", "present", "unknown"].includes(String(summary.state)) &&
      (summary.length === null || typeof summary.length === "number" && Number.isInteger(summary.length) && summary.length >= 0 && summary.length <= 2_000) &&
      (summary.fingerprint === null || typeof summary.fingerprint === "string" && /^fnv1a:[0-9a-f]{8}$/.test(summary.fingerprint)) && match(item.expected_match);
  };
  const media = record(observation.media);
  if (!media) return false;
  const refs = Array.isArray(media?.ordered_item_refs) ? media.ordered_item_refs : [];
  const imageCount = media?.image_count;
  const mediaValid = exact(media, "expected_match,image_count,order_status,ordered_item_refs") && match(media.expected_match) &&
    (imageCount === null || typeof imageCount === "number" && Number.isInteger(imageCount) && imageCount >= 0 && imageCount <= 100) &&
    (media.order_status === "observed" || media.order_status === "unknown") && refs.every((ref) => boundedPublicObservationRef(ref) !== null) &&
    new Set(refs).size === refs.length && (media.order_status === "unknown" ? refs.length === 0 : typeof imageCount === "number" && refs.length === imageCount);
  const fields = record(observation.fields);
  if (!fields) return false;
  const page = record(observation.page);
  if (!page) return false;
  const pending = observation.pending_issue_codes;
  if (!Array.isArray(pending)) return false;
  const pendingValid = pending.length <= 8 && new Set(pending).size === pending.length && pending.every((code) => publicObservationIssueCodes.has(code));
  return exact(observation, "account,business_target,fields,media,page,pending_issue_codes,schema_version,status,submitted") &&
    observation.schema_version === "harbor-xhs-public-observation/v0" && (observation.status === "observed" || observation.status === "unknown") &&
    labelRef(observation.account) && labelRef(observation.business_target) && mediaValid && exact(fields, "body,title") && field(fields.title) && field(fields.body) &&
    exact(page, "diff,fingerprint") && (page.fingerprint === null || typeof page.fingerprint === "string" && /^fnv1a:[0-9a-f]{8}$/.test(page.fingerprint)) &&
    ["unchanged", "changed", "unknown"].includes(String(page.diff)) && pendingValid && observation.status === (pending.length === 0 ? "observed" : "unknown") && observation.submitted === false;
}

export const XHS_WRITE_PRECHECK_CDP_COMMANDS = [
  "Runtime.enable",
  "Runtime.evaluate",
  "Page.enable",
  "Page.captureScreenshot",
  "Page.setInterceptFileChooserDialog",
  "Fetch.enable",
  "Fetch.continueRequest",
  "Fetch.disable"
] as const;

type WritePrecheckCdpCommand = typeof XHS_WRITE_PRECHECK_CDP_COMMANDS[number];

export function observeXhsPathPrepareRequest(
  event: { requestId?: unknown; resourceType?: unknown; request?: unknown },
  continueRequest: (requestId: string) => void
): boolean {
  const requestId = typeof event.requestId === "string" ? event.requestId : "";
  if (!requestId) return false;
  continueRequest(requestId);
  const request = event.request && typeof event.request === "object"
    ? event.request as { method?: unknown }
    : undefined;
  const method = typeof request?.method === "string" ? request.method.toUpperCase() : "";
  const resourceType = typeof event.resourceType === "string" ? event.resourceType : "";
  return Boolean(method) &&
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    ["XHR", "Fetch", "Document"].includes(resourceType);
}

export function validateXhsWritePrecheckObservation(
  input: LocalProviderWritePrecheckProbeInput,
  observation: WritePrecheckObservation | undefined,
  failure_stage?: XhsPathPrepareFailureStage
): LocalProviderWritePrecheckProbeResult {
  if (!observation) return writePrecheckUnavailable("page_changed", "The creator page returned no public semantic observation.", true, failure_stage);
  if (observation.challenge_like) return writePrecheckUnavailable("safety_challenge", "The creator page shows a safety challenge.", false, failure_stage);
  if (observation.login_like) return writePrecheckUnavailable("login_required", "The creator page requires manual login.", true, failure_stage);
  if (
    observation.origin !== input.expected_origin ||
    !isCreatorPublishPath(observation.pathname) ||
    !sameWritePrecheckUrl(observation.url, input.target_url)
  ) return writePrecheckUnavailable("page_changed", "The current page is not the exact requested creator publish page.", true, failure_stage);
  // A missing semantic root can be selector drift just as easily as a page
  // without the creator surface. Keep the distinction unknown; only an
  // explicit absent classification may become target_not_writable.
  if (observation.creator_surface_state === "absent") {
    return writePrecheckUnavailable("target_not_writable", "The creator publish surface is explicitly absent.", false, failure_stage);
  }
  if (observation.creator_app_owned !== true) {
    return writePrecheckUnavailable("evidence_unavailable", "The creator publish surface could not be classified.", true, failure_stage);
  }
  const composition_path = normalizedCompositionPath(input.composition_path ?? observation.composition_path);
  const composition_state = observation.composition_state ?? (
    observation.composition_initialized === true
      ? "composition_initialized"
      : observation.composition_initialized === false
        ? "composition_not_initialized"
        : "composition_unknown"
  );
  const field_states = safeFieldStates(observation);
  const media_state = safeMediaState(observation, composition_path);
  const validation_state = safeFieldState(observation.validation_state);
  const save_draft_control = safeFieldState(observation.save_draft_control);
  const publish_control = safeFieldState(observation.publish_control ?? field_states.publish_control);
  return {
    status: "completed",
    observed_at: new Date().toISOString(),
    observed_url: observation.url!,
    page: readyPage(input.target_url, "Xiaohongshu creator publish precheck"),
    source_refs: [
      { kind: "creator_publish_page_summary", ref: opaqueRef("source") },
      { kind: "dom_snapshot_summary", ref: opaqueRef("source") }
    ],
    evidence_ref_kinds: [{ kind: "snapshot_ref", ref: opaqueRef("evidence") }],
    classification: "partial_result",
    precheck_scope: observation.path_observed === "observed" &&
      (observation.path_entry_visible === "observed" || observation.composition_state === "composition_initialized")
      ? "composition_observation"
      : "entrypoint_only",
    composition_path,
    composition_state,
    entrypoint_observations: {
      route_loaded: isCreatorPublishPath(observation.pathname),
      publish_vue_container_visible: observation.creator_root_count === undefined || observation.creator_root_count > 0,
      upload_image_tab_active: observation.upload_image_tab_active === true,
      upload_image_entry_visible: observation.upload_image_entry_visible === true,
      text_image_entry_visible: observation.text_image_entry_visible === true,
      path_observed: observation.path_observed ?? "unknown",
      path_entry_visible: observation.path_entry_visible ?? "unknown"
    },
    field_states,
    media_state,
    validation_state,
    save_draft_control,
    publish_control,
    prohibited_actions_observed: { upload: false, generate: false, save: false, publish: false },
    target_ref: input.target_ref,
    public_observation: publicObservationFromObservation(observation, input.expected)
  };
}

async function probeProviderWritePrecheck(
  port: string,
  currentUrl: string,
  input: LocalProviderWritePrecheckProbeInput,
  currentPageTargetId?: string
): Promise<LocalProviderWritePrecheckProbeResult> {
  let failureStage: XhsPathPrepareFailureStage | undefined = input.requested_path === undefined
    ? undefined
    : "provider_probe_initial";
  try {
    if (!sameWritePrecheckUrl(currentUrl, input.target_url)) {
      return writePrecheckUnavailable("page_changed", "The managed session is not on the requested creator publish page.", true, failureStage);
    }
    const page = await activePage(port, currentUrl, AbortSignal.timeout(3000), currentPageTargetId);
    if (!page.webSocketDebuggerUrl) {
      return writePrecheckUnavailable("provider_probe_unavailable", "The creator page has no controlled CDP target.", true, failureStage);
    }
    const webSocketUrl = page.webSocketDebuggerUrl;
    return withCdp(webSocketUrl, async (client) => {
      const observedAt = Date.now();
      await sendWritePrecheckCdp(client, "Runtime.enable");
      const path = input.requested_path ?? input.composition_path;
      const observation = await evaluateWritePrecheck(client, path, false, false, input.expected);
      const validation = validateXhsWritePrecheckObservation(input, observation, failureStage);
      if (validation.status === "unavailable") return validation;
      if (input.requested_path !== undefined) {
        failureStage = "provider_selection";
        await sendWritePrecheckCdp(client, "Page.enable");
        let fileChooserOpened = false;
        let unclassifiedExternalEffectCandidate = false;
        let continueRequestFailed = false;
        const continuedRequests: Promise<unknown>[] = [];
        const stopObservingFileChooser = client.on("Page.fileChooserOpened", () => { fileChooserOpened = true; });
        const stopObservingRequests = client.on("Fetch.requestPaused", (event) => {
          const candidate = observeXhsPathPrepareRequest(event, (requestId) => {
            continuedRequests.push(sendWritePrecheckCdp(client, "Fetch.continueRequest", { requestId }).catch(() => {
              continueRequestFailed = true;
            }));
          });
          if (candidate) unclassifiedExternalEffectCandidate = true;
        });
        let selected: WritePrecheckObservation | undefined;
        let completedPathPrepare: Extract<LocalProviderWritePrecheckProbeResult, { status: "completed" }> | undefined;
        try {
          await sendWritePrecheckCdp(client, "Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
          await sendWritePrecheckCdp(client, "Page.setInterceptFileChooserDialog", { enabled: true });
          selected = await evaluateWritePrecheck(client, input.requested_path, true, false, input.expected);
          if (fileChooserOpened) {
            return writePrecheckUnavailable("evidence_unavailable", "The requested control attempted to open a file chooser and was blocked.", false, failureStage);
          }
          if (unclassifiedExternalEffectCandidate) {
            return writePrecheckUnavailable("evidence_unavailable", "The requested control triggered an unclassified external-effect candidate; external-effect outcome remains unknown.", false, failureStage);
          }
          if (!selected || selected.selection_status !== "selected") {
            return writePrecheckUnavailable("page_changed", "The requested visible path control could not be selected.", true, failureStage);
          }
          const selectedValidation = validateXhsWritePrecheckObservation(input, selected, failureStage);
          if (selectedValidation.status === "unavailable") return selectedValidation;
          if (selected.path_observed !== "observed") {
            return writePrecheckUnavailable("page_changed", "The requested path did not become active after exact control selection.", false, failureStage);
          }
          failureStage = "provider_readback_freshness";
          if (input.capture_screenshot !== false) {
            const screenshot = await captureWritePrecheckScreenshot(client);
            if (!screenshot) {
              return writePrecheckUnavailable("evidence_unavailable", "The refs-only path-preparation snapshot evidence could not be captured.", true, failureStage);
            }
          }
          const after = await evaluateWritePrecheck(client, input.requested_path, false, true, input.expected);
          if (fileChooserOpened) {
            return writePrecheckUnavailable("evidence_unavailable", "The requested control attempted a prohibited external interaction and was blocked.", false, failureStage);
          }
          if (unclassifiedExternalEffectCandidate) {
            return writePrecheckUnavailable("evidence_unavailable", "The requested control triggered an unclassified external-effect candidate; external-effect outcome remains unknown.", false, failureStage);
          }
          if (!validWritePrecheckFreshness(input, selected, after, observedAt, Date.now(), true)) {
            return writePrecheckUnavailable("page_changed", "The creator page changed while path state was read back.", true, failureStage);
          }
          if (!after || after.path_observed !== "observed") {
            return writePrecheckUnavailable("page_changed", "The requested path readback is unknown or mismatched.", false, failureStage);
          }
          completedPathPrepare = {
            ...selectedValidation,
            observed_at: new Date(observedAt).toISOString(),
            evidence_ref_kinds: [{ kind: input.capture_screenshot === false ? "public_observation_ref" : "snapshot_ref", ref: opaqueRef("evidence") }],
            path_prepare: pathPrepareState(input.requested_path, observation, selected, after)
          };
        } finally {
          try {
            stopObservingRequests();
            await Promise.allSettled(continuedRequests);
            await withCdp(webSocketUrl, async (cleanupClient) => {
              await sendWritePrecheckCdp(cleanupClient, "Page.setInterceptFileChooserDialog", { enabled: false });
              await sendWritePrecheckCdp(cleanupClient, "Fetch.disable");
            },
            AbortSignal.timeout(1500));
          } finally {
            stopObservingFileChooser();
          }
        }
        if (fileChooserOpened || unclassifiedExternalEffectCandidate || continueRequestFailed || !completedPathPrepare) {
          return writePrecheckUnavailable("evidence_unavailable", "The requested control did not complete without a prohibited external interaction or unknown external-effect outcome.", false, failureStage);
        }
        return completedPathPrepare;
      }
      if (input.capture_screenshot !== false) {
        const screenshot = await captureWritePrecheckScreenshot(client);
        if (!screenshot) {
          return writePrecheckUnavailable("evidence_unavailable", "The refs-only precheck snapshot evidence could not be captured.");
        }
      }
      const after = await evaluateWritePrecheck(client, input.composition_path, false, false, input.expected);
      if (!validWritePrecheckFreshness(input, observation, after, observedAt, Date.now())) {
        return writePrecheckUnavailable("page_changed", "The creator page changed while snapshot evidence was captured.");
      }
      const afterFingerprint = after?.public_observation?.page_fingerprint;
      const beforeFingerprint = observation?.public_observation?.page_fingerprint;
      const public_observation = {
        ...validation.public_observation,
        page: {
          ...validation.public_observation.page,
          diff: beforeFingerprint && afterFingerprint
            ? beforeFingerprint === afterFingerprint ? "unchanged" as const : "changed" as const
            : "unknown" as const
        }
      };
      return {
        ...validation,
        observed_at: new Date(observedAt).toISOString(),
        evidence_ref_kinds: [{ kind: input.capture_screenshot === false ? "public_observation_ref" : "snapshot_ref", ref: opaqueRef("evidence") }],
        public_observation
      };
    }, AbortSignal.timeout(3000));
  } catch {
    return writePrecheckUnavailable("provider_probe_unavailable", "The creator write-precheck probe failed.", true, failureStage);
  }
}

const XHS_MEDIA_ACTION_CDP_COMMANDS = [
  "Runtime.enable",
  "Runtime.evaluate",
  "Accessibility.enable",
  "Accessibility.getFullAXTree",
  "Page.enable",
  "Page.bringToFront",
  "DOM.enable",
  "DOM.getBoxModel",
  "DOM.setFileInputFiles",
  "Input.dispatchMouseEvent",
  "Fetch.enable",
  "Fetch.continueRequest",
  "Fetch.failRequest",
  "Fetch.disable"
] as const;
type XhsMediaActionCdpCommand = typeof XHS_MEDIA_ACTION_CDP_COMMANDS[number];

type MediaPageObservation = {
  url?: string;
  origin?: string;
  pathname?: string;
  challenge_like?: boolean;
  login_like?: boolean;
  route_loaded?: boolean;
  media_count?: number;
  generated_result_visible?: boolean;
};

type MediaActionNetwork = {
  forbidden_commit: boolean;
};

type XhsCommitActionId = "xhs_publish_note_image_text_commit.save_draft" | "xhs_publish_note_image_text_commit.publish" | "xhs_publish_note_image_text_commit.cleanup";
const isCommitActionId = (value: LocalProviderMediaActionInput["action_id"]): value is XhsCommitActionId =>
  value.startsWith("xhs_publish_note_image_text_commit.");

export function blocksXhsMediaActionRequest(actionId: LocalProviderMediaActionInput["action_id"], method: string, url: string): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) return false;
  if (actionId.startsWith("xhs_publish_note_image_text_commit.")) return false;
  return actionId === "xhs_publish_note_image_text_fields.compose" || /(?:^|[/?_-])(save|draft|submit|publish)(?:[/?_-]|$)/i.test(url);
}

/**
 * Bounded Xiaohongshu adapter. It keeps explicit upload, generation, and
 * title/body branches rather than introducing a generic browser-action DSL.
 */
async function executeXhsMediaAction(
  port: string,
  currentUrl: string,
  input: LocalProviderMediaActionInput,
  currentPageTargetId?: string
): Promise<LocalProviderMediaActionResult> {
  const operationRef = opaqueRef("media_operation");
  const failure = (
    failure_class: Extract<LocalProviderMediaActionResult, { status: "unavailable" }>["failure_class"],
    message: string,
    retryable = false,
    page?: LocalProviderPageFacts,
    diagnostics?: Extract<LocalProviderMediaActionResult, { status: "unavailable" }>["diagnostics"],
    submitted = false
  ): LocalProviderMediaActionResult => {
    if (diagnostics) console.warn(JSON.stringify({ event: "xhs_media_action_unavailable", operation_ref: operationRef, failure_class, ...diagnostics }));
    return {
      status: "unavailable",
      failure_class,
      message,
      retryable,
      operation_ref: operationRef,
      ...(page === undefined ? {} : { page }),
      ...(diagnostics === undefined ? {} : { diagnostics }),
      submitted
    };
  };
  if (input.expected_origin !== "https://creator.xiaohongshu.com" || input.no_submit_guard !== "active" ||
    (input.action_id === "xhs_publish_note_image_text_media.image_upload" && input.requested_path !== "image_text_upload") ||
    (input.action_id === "xhs_publish_note_image_text_media.text_to_image_generate" && input.requested_path !== "image_text_generate") ||
    (input.action_id === "xhs_publish_note_image_text_fields.compose" && input.requested_path !== "image_text_upload") ||
    (input.action_id.startsWith("xhs_publish_note_image_text_commit.") && (input.requested_path !== "image_text_upload" || !input.marker || !input.visibility)) ||
    input.authorization_binding.action_id !== input.action_id || input.authorization_binding.target_ref !== input.target_ref) {
    return failure("invalid_contract", "The media action identity or authorization binding is not exact.", false);
  }
  const cleanup = input.action_id === "xhs_publish_note_image_text_commit.cleanup";
  if (!cleanup && !sameWritePrecheckUrl(currentUrl, input.target_url)) return failure("page_changed", "The managed session is not on the requested creator page for this action.", true);
  const pageTarget = cleanup
    ? await pageTargets(port, AbortSignal.timeout(3000)).then(selectCleanupPage).catch(() => undefined)
    : await activePage(port, input.target_url, AbortSignal.timeout(3000), currentPageTargetId).catch(() => undefined);
  if (!pageTarget?.webSocketDebuggerUrl) return failure("provider_probe_unavailable", "The managed creator page has no controlled target.", true);
  const page = readyPage(input.target_url, "Xiaohongshu creator media action");
  const resolvedFiles: string[] = [];
  let resolvedFields: readonly [string, string] | undefined;
  if (input.action_id === "xhs_publish_note_image_text_media.image_upload") {
    for (const ref of input.refs) {
      try {
        resolvedFiles.push(await resolveLocalMediaRef(ref));
      } catch {
        return failure("resource_unavailable", "An authorized local image reference could not be resolved.", false, page, {
          failure_stage: "media_ref_resolution",
          set_file_input_files: "not_called"
        });
      }
    }
  } else if (input.action_id === "xhs_publish_note_image_text_fields.compose") {
    try {
      const title = await resolveProtectedFieldRef(input.refs[0]!, "title", 20);
      const body = await resolveProtectedFieldRef(input.refs[1]!, "body", 1000);
      resolvedFields = [title, body];
    } catch {
      return failure("resource_unavailable", "An authorized field owner reference could not be resolved.", false, page);
    }
  }
  return withCdp(pageTarget.webSocketDebuggerUrl, async (client) => {
    await sendMediaActionCdp(client, "Runtime.enable");
    await sendMediaActionCdp(client, "Page.enable");
    await sendMediaActionCdp(client, "DOM.enable");
    await sendMediaActionCdp(client, "Accessibility.enable");
    const before = await evaluateMediaActionObservation(client);
    const pageFailure = mediaPageFailure(before, input.target_url, cleanup);
    if (pageFailure) return failure(pageFailure.failure_class, pageFailure.message, pageFailure.retryable, page);
    const network: MediaActionNetwork = { forbidden_commit: false };
    const stopFetch = client.on("Fetch.requestPaused", (event) => {
      const requestId = typeof event.requestId === "string" ? event.requestId : "";
      const request = event.request && typeof event.request === "object" ? event.request as { method?: unknown; url?: unknown } : {};
      const method = typeof request.method === "string" ? request.method.toUpperCase() : "";
      const url = typeof request.url === "string" ? request.url : "";
      if (!requestId) return;
      if (blocksXhsMediaActionRequest(input.action_id, method, url)) {
        network.forbidden_commit = true;
        void sendMediaActionCdp(client, "Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => undefined);
        return;
      }
      void sendMediaActionCdp(client, "Fetch.continueRequest", { requestId }).catch(() => undefined);
    });
    let after: MediaPageObservation | undefined;
    try {
      await sendMediaActionCdp(client, "Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
      if (input.action_id === "xhs_publish_note_image_text_media.image_upload") {
        const inputProbe = await ensureImageUploadPath(client);
        if (inputProbe.image_input_candidate_count !== 1) {
          return failure("media_ref_unavailable", inputProbe.image_input_candidate_count === 0
            ? "The creator page has no supported image upload input after selecting the image-text path."
            : "The creator page has multiple supported image upload inputs.", false, page, {
            failure_stage: inputProbe.image_input_candidate_count === 0 ? "file_input_missing" : "file_input_ambiguous",
            image_input_candidate_count: inputProbe.image_input_candidate_count,
            image_path_candidate_count: inputProbe.image_path_candidate_count,
            set_file_input_files: "not_called"
          });
        }
        const objectId = await findImageFileInput(client);
        if (!objectId) return failure("media_ref_unavailable", "The creator image file input object could not be resolved.", false, page, {
          failure_stage: "file_input_object_resolution",
          image_input_candidate_count: 1,
          image_path_candidate_count: inputProbe.image_path_candidate_count,
          set_file_input_files: "not_called"
        });
        try {
          await sendMediaActionCdp(client, "DOM.setFileInputFiles", { objectId, files: resolvedFiles });
        } catch {
          return failure("operation_result_unknown", "The image file-input operation did not return a reliable result.", false, page, {
            failure_stage: "set_file_input_files",
            image_input_candidate_count: 1,
            image_path_candidate_count: inputProbe.image_path_candidate_count,
            set_file_input_files: "unknown"
          });
        }
      } else if (input.action_id === "xhs_publish_note_image_text_media.text_to_image_generate") {
        const generated = await executeTextToImageControl(client, input.summary);
        if (!generated) return failure("generation_unavailable", "The visible text-to-image input or generate control is unavailable.", false, page);
      } else if (isCommitActionId(input.action_id)) {
        const commit = await executeCommitControl(client, input, operationRef);
        if (commit.status === "unavailable") return failure(commit.failure_class, commit.message, false, page, undefined, commit.submitted);
        return { ...commit, page };
      } else {
        const [title, body] = resolvedFields!;
        let fieldProbe = await evaluateFieldFill(client, title, body, true);
        if (fieldProbe?.title_candidate_count !== 1 || fieldProbe?.body_candidate_count !== 1) {
          return failure("field_unavailable", "The creator page does not expose one exact editable title and body control.", false, page);
        }
        for (let attempt = 0; attempt < 20 && (fieldProbe?.title_matched !== true || fieldProbe?.body_matched !== true); attempt += 1) {
          await abortableDelay(250);
          fieldProbe = await evaluateFieldFill(client, title, body, false);
        }
        after = await evaluateMediaActionObservation(client);
        const routeObserved = after?.origin === input.expected_origin && isCreatorPublishPath(after.pathname) && sameWritePrecheckUrl(after.url, input.target_url);
        const fieldReadback = fieldReadbackFromProbe(fieldProbe);
        const matched = fieldReadback.validation_status === "passed";
        const unknown = fieldReadback.validation_status === "unknown" || !routeObserved;
        const effectStatus = unknown ? "unknown" as const : matched && !network.forbidden_commit ? "observed" as const : "failed" as const;
        const operationStatus = unknown ? "unknown_outcome" as const : "terminal" as const;
        return {
          status: "completed" as const,
          observed_at: new Date().toISOString(),
          observed_url: after?.url ?? input.target_url,
          page,
          action_id: input.action_id,
          requested_path: "image_text_upload" as const,
          effect_kind: "modify" as const,
          effect_status: effectStatus,
          operation_status: operationStatus,
          operation_ref: operationRef,
          ...(operationStatus === "terminal" ? { terminal_state: effectStatus === "observed" ? "success" as const : "failure" as const } : {}),
          field_readback: fieldReadback,
          page_readback: {
            status: routeObserved ? "observed" as const : "unknown" as const,
            page_state_ref: opaqueRef("page_state"),
            route_state: routeObserved ? "observed" as const : "unknown" as const
          },
          source_refs: [
            { kind: "field_action_summary", ref: opaqueRef("source") },
            { kind: "creator_publish_page_summary", ref: opaqueRef("source") },
            { kind: "business_state_summary", ref: opaqueRef("source") }
          ],
          evidence_ref_kinds: [
            { kind: "operation_ref", ref: operationRef },
            { kind: "snapshot_ref", ref: opaqueRef("evidence") }
          ],
          submitted: false as const
        };
      }
      for (let attempt = 0; attempt < 20; attempt += 1) {
        after = await evaluateMediaActionObservation(client);
        if ((input.action_id.endsWith("image_upload") && (after?.media_count ?? 0) - (before?.media_count ?? 0) >= input.refs.length) ||
          (input.action_id.endsWith("text_to_image_generate") && before?.generated_result_visible !== true && after?.generated_result_visible === true)) break;
        await abortableDelay(250);
      }
    } finally {
      stopFetch();
      await sendMediaActionCdp(client, "Fetch.disable").catch(() => undefined);
    }
    const observed = after ?? await evaluateMediaActionObservation(client);
    const routeObserved = observed?.origin === input.expected_origin && isCreatorPublishPath(observed.pathname) && sameWritePrecheckUrl(observed.url, input.target_url);
    const expectedMediaObserved = input.action_id.endsWith("image_upload")
      ? (observed?.media_count ?? 0) - (before?.media_count ?? 0) >= input.refs.length
      : before?.generated_result_visible !== true && observed?.generated_result_visible === true;
    const effectStatus: "requested" | "observed" | "unknown" | "failed" = network.forbidden_commit
      ? "failed"
      : expectedMediaObserved ? "observed" : "unknown";
    const operationStatus = effectStatus === "observed" || effectStatus === "failed" ? "terminal" as const : "unknown_outcome" as const;
    const mediaReadback = input.action_id.endsWith("image_upload")
      ? {
          status: expectedMediaObserved ? "observed" as const : "unknown" as const,
          media_count: typeof observed?.media_count === "number" ? Math.max(0, observed.media_count - (before?.media_count ?? 0)) : null,
          order_status: "unknown" as const,
          ordered_item_refs: [],
          generation_result_ref: null
        }
      : {
          status: expectedMediaObserved ? "observed" as const : "unknown" as const,
          media_count: typeof observed?.media_count === "number" ? observed.media_count : null,
          order_status: "not_applicable" as const,
          generation_result_ref: expectedMediaObserved ? opaqueRef("generated_media") : null
        };
    return {
      status: "completed" as const,
      observed_at: new Date().toISOString(),
      observed_url: observed?.url ?? input.target_url,
      page,
      action_id: input.action_id,
      requested_path: input.requested_path,
      effect_kind: input.action_id.endsWith("image_upload") ? "upload" as const : "generate" as const,
      effect_status: effectStatus,
      operation_status: operationStatus,
      operation_ref: operationRef,
      ...(operationStatus === "terminal" ? { terminal_state: effectStatus === "observed" ? "success" as const : "failure" as const } : {}),
      media_readback: mediaReadback,
      page_readback: {
        status: routeObserved ? "observed" as const : "unknown" as const,
        page_state_ref: opaqueRef("page_state"),
        route_state: routeObserved ? "observed" as const : "unknown" as const
      },
      source_refs: [
        { kind: "media_action_summary", ref: opaqueRef("source") },
        { kind: "creator_publish_page_summary", ref: opaqueRef("source") },
        { kind: "business_state_summary", ref: opaqueRef("source") }
      ],
      evidence_ref_kinds: [
        { kind: "operation_ref", ref: operationRef },
        { kind: "snapshot_ref", ref: opaqueRef("evidence") }
      ],
      submitted: false as const
    };
  }, AbortSignal.timeout(input.action_id.startsWith("xhs_publish_note_image_text_commit.") ? 30_000 : 15_000))
    .catch(() => failure("operation_result_unknown", "The media action outcome could not be determined.", false, page, undefined,
      input.action_id.startsWith("xhs_publish_note_image_text_commit.")));
}

function mediaPageFailure(observation: MediaPageObservation | undefined, targetUrl: string, cleanup = false): { failure_class: "page_changed" | "login_required" | "safety_challenge"; message: string; retryable: boolean } | null {
  if (!observation) return { failure_class: "page_changed", message: "The creator page returned no semantic observation.", retryable: true };
  if (observation.challenge_like) return { failure_class: "safety_challenge", message: "The creator page shows a safety challenge.", retryable: false };
  if (observation.login_like) return { failure_class: "login_required", message: "The creator page requires manual login.", retryable: false };
  if (observation.origin !== "https://creator.xiaohongshu.com" || !(cleanup ? observation.pathname === "/publish/update" : isCreatorPublishPath(observation.pathname) && sameWritePrecheckUrl(observation.url, targetUrl))) {
    return { failure_class: "page_changed", message: "The current page is not the requested creator publish page.", retryable: true };
  }
  return null;
}

function isCreatorUpdateUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === "https://creator.xiaohongshu.com" && url.pathname === "/publish/update";
  } catch {
    return false;
  }
}

type AxNode = { role?: { value?: unknown }; name?: { value?: unknown }; backendDOMNodeId?: unknown };
type CommitProbe = {
  url: string;
  pathname: string;
  login_like: boolean;
  challenge_like: boolean;
  title_value: string;
  title_candidate_count: number;
  body_candidate_count: number;
  marker_count: number;
  marker_matched: boolean;
  fields_matched: boolean;
  media_count: number;
};
type ClickOutcome = "dispatched" | "not_dispatched" | "unknown";

async function accessibilityNodes(client: CdpClient): Promise<AxNode[]> {
  const tree = await sendMediaActionCdp(client, "Accessibility.getFullAXTree", { depth: 30 });
  return Array.isArray(tree.nodes) ? tree.nodes as AxNode[] : [];
}

async function clickBackendNode(client: CdpClient, backendNodeId: number): Promise<ClickOutcome> {
  try {
    const response = await sendMediaActionCdp(client, "DOM.getBoxModel", { backendNodeId });
    const quad = (response.model as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(quad) || quad.length !== 8 || !quad.every((value) => typeof value === "number" && Number.isFinite(value))) return "not_dispatched";
    const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
    const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
    return clickPoint(client, x, y);
  } catch {
    return "not_dispatched";
  }
}

async function clickExactAxButton(client: CdpClient, name: string): Promise<ClickOutcome> {
  const ids = [...new Set((await accessibilityNodes(client)).flatMap((node) =>
    node.role?.value === "button" && node.name?.value === name && typeof node.backendDOMNodeId === "number"
      ? [node.backendDOMNodeId]
      : []
  ))];
  return ids.length === 1 ? clickBackendNode(client, ids[0]!) : "not_dispatched";
}

export function commitProbeExpression(marker: string, expectedTitle?: string): string {
  const markerLiteral = JSON.stringify(marker);
  const titleLiteral = expectedTitle === undefined ? "undefined" : JSON.stringify(expectedTitle);
  return String.raw`(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      const text = document.body?.innerText || '';
      const roots = [...document.querySelectorAll('#app, [data-v-app]')];
      const unique = (values) => [...new Set(values)];
      const titles = unique(roots.flatMap((root) => [...root.querySelectorAll('input')]))
        .filter((el) => !el.closest('[data-decoy], [data-testid*="decoy"], .decoy') && visible(el) && /标题/.test(el.getAttribute('placeholder') || ''));
      const bodies = unique(roots.flatMap((root) => [...root.querySelectorAll('[contenteditable="true"]')]))
        .filter((el) => !el.closest('[data-decoy], [data-testid*="decoy"], .decoy') && visible(el) && (el.textContent || '').includes(${markerLiteral}));
      const imageInputs = unique(roots.flatMap((root) => [...root.querySelectorAll('input[type="file"][accept*="image"]')]))
        .filter((el) => !el.matches(':disabled') && !el.closest('[data-decoy], [data-testid*="decoy"], .decoy'));
      const title = titles.length === 1 ? titles[0] : undefined;
      const body = bodies.length === 1 ? bodies[0] : undefined;
      const bodyText = body?.textContent || '';
      const markerCount = bodyText.split(${markerLiteral}).length - 1;
      let scope = body;
      while (scope && title && !scope.contains(title)) scope = scope.parentElement;
      const compositionBound = Boolean(scope && !roots.includes(scope));
      let mediaScope = imageInputs.length === 1 ? imageInputs[0].parentElement : undefined;
      while (mediaScope && mediaScope !== scope && mediaScope.querySelectorAll('img.preview, img.preivew-image').length === 0) mediaScope = mediaScope.parentElement;
      const mediaBound = Boolean(compositionBound && mediaScope && mediaScope !== scope && scope.contains(mediaScope));
      const media = mediaBound ? unique([...mediaScope.querySelectorAll('img.preview, img.preivew-image')]).filter((el) => {
        const r = el.getBoundingClientRect();
        return !el.closest('[data-decoy], [data-testid*="decoy"], .decoy') && visible(el) && r.width >= 80 && r.height >= 80;
      }).length : 0;
      return {
        url: location.href,
        pathname: location.pathname,
        login_like: /登录|扫码登录/.test(text) && /\/login/.test(location.pathname),
        challenge_like: /验证码|安全验证|异常访问|请完成验证/.test(text),
        title_value: title?.value || '',
        title_candidate_count: titles.length,
        body_candidate_count: bodies.length,
        marker_count: markerCount,
        marker_matched: compositionBound && titles.length === 1 && bodies.length === 1 && markerCount === 1,
        fields_matched: compositionBound && titles.length === 1 && bodies.length === 1 && markerCount === 1 && title.value.length > 0 &&
          (${titleLiteral} === undefined || title.value === ${titleLiteral}),
        media_count: media
      };
    })()`;
}

export function xhsContentRef(marker: string, title: string): string {
  return `xhs_content_${createHash("sha256").update(`${marker}\0${title}`).digest("hex").slice(0, 32)}`;
}

async function evaluateCommitProbe(client: CdpClient, marker: string, expectedTitle?: string): Promise<CommitProbe | undefined> {
  const evaluated = await sendMediaActionCdp(client, "Runtime.evaluate", {
    expression: commitProbeExpression(marker, expectedTitle),
    returnByValue: true
  });
  return (evaluated.result as { value?: CommitProbe } | undefined)?.value;
}

type PointProbe = { status: "matched"; x: number; y: number } | { status: "not_found" | "ambiguous" };
type PublishedDetailProbe = { url: string; pathname: string; marker_matched: boolean; fields_matched: boolean; media_count: number; login_like: boolean; challenge_like: boolean };

export function draftEditPointExpression(title: string): string {
  const titleLiteral = JSON.stringify(title);
  return String.raw`(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const titles = [...document.querySelectorAll('*')]
      .filter((el) => visible(el) && el.children.length === 0 && (el.textContent || '').trim() === ${titleLiteral})
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
    const title = titles[0];
    if (!title) return { status: 'not_found' };
    let card = title;
    while (card && card !== document.body && !((card.textContent || '').includes('编辑') && (card.textContent || '').includes('删除'))) card = card.parentElement;
    if (!card || card === document.body) return { status: 'not_found' };
    const edits = [...card.querySelectorAll('*')].filter((el) => visible(el) && el.children.length === 0 && (el.textContent || '').trim() === '编辑');
    if (edits.length !== 1) return { status: 'ambiguous' };
    const rect = edits[0].getBoundingClientRect();
    return { status: 'matched', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
}

export function publishedActionPointExpression(title: string, action: "edit" | "delete"): string {
  const titleLiteral = JSON.stringify(title);
  const deleteAction = action === "delete";
  return String.raw`(() => {
    const titles = [...document.querySelectorAll('*')]
      .filter((el) => el.children.length === 0 && (el.textContent || '').trim() === ${titleLiteral} && el.getBoundingClientRect().width > 0);
    if (titles.length !== 1) return { status: titles.length === 0 ? 'not_found' : 'ambiguous' };
    const card = titles[0].closest('.note-card');
    const actions = card ? [...card.querySelectorAll('.note-card__action-btn')] : [];
    const target = actions.length > 1 && actions.at(-1)?.classList.contains('note-card__action-btn--del') ? actions.at(${deleteAction ? -1 : -2}) : undefined;
    if (!target || target.classList.contains('note-card__action-btn--disabled')) return { status: 'not_found' };
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { status: 'not_found' };
    return { status: 'matched', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
}

export function noteManagerNavigationPointExpression(): string {
  return String.raw`(() => {
    const links = [...document.querySelectorAll('.d-menu-item .menu-title-wrapper')]
      .filter((element) => (element.textContent || '').trim() === '笔记管理' && element.getBoundingClientRect().width > 0);
    if (links.length !== 1) return { status: links.length === 0 ? 'not_found' : 'ambiguous' };
    const rect = links[0].getBoundingClientRect();
    return { status: 'matched', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
}

async function evaluatePoint(client: CdpClient, expression: string): Promise<PointProbe | undefined> {
  const evaluated = await sendMediaActionCdp(client, "Runtime.evaluate", { expression, returnByValue: true });
  return (evaluated.result as { value?: PointProbe } | undefined)?.value;
}

export async function clickPoint(client: CdpClient, x: number, y: number): Promise<ClickOutcome> {
  let releaseAttempted = false;
  try {
    await client.send("Page.bringToFront");
    await sendMediaActionCdp(client, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await sendMediaActionCdp(client, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    releaseAttempted = true;
    await sendMediaActionCdp(client, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    return "dispatched";
  } catch {
    return releaseAttempted ? "unknown" : "not_dispatched";
  }
}

async function clickNewestDraftByTitle(client: CdpClient, title: string): Promise<"matched" | "not_found" | "ambiguous"> {
  const point = await evaluatePoint(client, draftEditPointExpression(title));
  if (!point || point.status !== "matched") return point?.status ?? "not_found";
  return await clickPoint(client, point.x, point.y) === "not_dispatched" ? "not_found" : "matched";
}

async function clickPublishedEditByTitle(client: CdpClient, title: string): Promise<"matched" | "not_found" | "ambiguous"> {
  const point = await evaluatePoint(client, publishedActionPointExpression(title, "edit"));
  if (!point || point.status !== "matched") return point?.status ?? "not_found";
  return await clickPoint(client, point.x, point.y) === "not_dispatched" ? "not_found" : "matched";
}

async function clickPublishedDeleteByTitle(client: CdpClient, title: string): Promise<"matched" | "not_found" | "ambiguous"> {
  const point = await evaluatePoint(client, publishedActionPointExpression(title, "delete"));
  if (!point || point.status !== "matched") return point?.status ?? "not_found";
  return await clickPoint(client, point.x, point.y) === "not_dispatched" ? "not_found" : "matched";
}

async function openNoteManager(client: CdpClient): Promise<boolean> {
  const point = await evaluatePoint(client, noteManagerNavigationPointExpression());
  return point?.status === "matched" && await clickPoint(client, point.x, point.y) !== "not_dispatched";
}

async function scrollExactTextIntoView(client: CdpClient, name: string): Promise<boolean> {
  const literal = JSON.stringify(name);
  const evaluated = await sendMediaActionCdp(client, "Runtime.evaluate", {
    expression: String.raw`(() => {
      const element = [...document.querySelectorAll('*')].find((candidate) => candidate.children.length === 0 && (candidate.textContent || '').trim() === ${literal} && candidate.getBoundingClientRect().width > 0);
      if (!element) return false;
      element.scrollIntoView({ block: 'center' });
      return true;
    })()`,
    returnByValue: true
  });
  return (evaluated.result as { value?: unknown } | undefined)?.value === true;
}

async function clickExactAxStaticText(client: CdpClient, name: string): Promise<boolean> {
  const ids = [...new Set((await accessibilityNodes(client)).flatMap((node) =>
    node.role?.value === "StaticText" && node.name?.value === name && typeof node.backendDOMNodeId === "number"
      ? [node.backendDOMNodeId]
      : []
  ))];
  return ids.length === 1 && await clickBackendNode(client, ids[0]!) !== "not_dispatched";
}

async function selectCommitVisibility(client: CdpClient, visibility: "only_me" | "public"): Promise<boolean> {
  const current = visibility === "only_me" ? "仅自己可见" : "公开可见";
  const names = (await accessibilityNodes(client)).flatMap((node) => node.role?.value === "StaticText" && typeof node.name?.value === "string" ? [node.name.value] : []);
  if (names.includes(current) && !names.includes(visibility === "only_me" ? "公开可见" : "仅自己可见")) return true;
  const displayed = names.includes("公开可见") ? "公开可见" : names.includes("仅自己可见") ? "仅自己可见" : undefined;
  if (!displayed || !await scrollExactTextIntoView(client, displayed) || !await clickExactAxStaticText(client, displayed)) return false;
  await abortableDelay(150);
  if (!await scrollExactTextIntoView(client, current) || !await clickExactAxStaticText(client, current)) return false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await abortableDelay(100);
    const after = (await accessibilityNodes(client)).flatMap((node) => node.role?.value === "StaticText" && typeof node.name?.value === "string" ? [node.name.value] : []);
    if (after.includes(current) && !after.includes(visibility === "only_me" ? "公开可见" : "仅自己可见")) return true;
  }
  return false;
}

async function evaluatePublishedDetailProbe(client: CdpClient, title: string, marker: string): Promise<PublishedDetailProbe | undefined> {
  const evaluated = await sendMediaActionCdp(client, "Runtime.evaluate", {
    expression: commitProbeExpression(marker, title),
    returnByValue: true
  });
  return (evaluated.result as { value?: PublishedDetailProbe } | undefined)?.value;
}

export function cleanupConfirmationPointExpression(title: string): string {
  const titleLiteral = JSON.stringify(title);
  return String.raw`(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const candidates = [...document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dialog"]')]
      .filter((element) => visible(element) && (element.innerText || element.textContent || '').includes('删除笔记'));
    const dialogs = candidates.filter((element) => !candidates.some((other) => other !== element && other.contains(element)));
    if (dialogs.length !== 1) return { status: dialogs.length === 0 ? 'not_found' : 'ambiguous' };
    const displayedTitle = (dialogs[0].innerText || dialogs[0].textContent || '').match(/确定要删除《([^》]+)》这篇笔记吗/)?.[1];
    const matchingTitles = displayedTitle ? [...document.querySelectorAll('.note-card .note-card__title')]
      .filter((element) => visible(element) && (element.textContent || '').trim().startsWith(displayedTitle)) : [];
    if (!${titleLiteral}.startsWith(displayedTitle || '') || matchingTitles.length !== 1 ||
        (matchingTitles[0].textContent || '').trim() !== ${titleLiteral}) return { status: 'ambiguous' };
    const buttons = [...dialogs[0].querySelectorAll('button')]
      .filter((element) => visible(element) && (element.innerText || element.textContent || '').trim() === '确定' && !element.disabled);
    if (buttons.length !== 1) return { status: buttons.length === 0 ? 'not_found' : 'ambiguous' };
    const rect = buttons[0].getBoundingClientRect();
    return { status: 'matched', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
}

async function exactVisibleTextCount(client: CdpClient, value: string): Promise<number> {
  const literal = JSON.stringify(value);
  const evaluated = await sendMediaActionCdp(client, "Runtime.evaluate", {
    expression: String.raw`(() => [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && (el.textContent || '').trim() === ${literal} && el.getBoundingClientRect().width > 0).length)()`,
    returnByValue: true
  });
  const count = (evaluated.result as { value?: unknown } | undefined)?.value;
  return Number.isSafeInteger(count) ? count as number : -1;
}

async function executeCleanupControl(
  client: CdpClient,
  input: LocalProviderMediaActionInput,
  operationRef: string,
  before: CommitProbe
): Promise<Extract<LocalProviderMediaActionResult, { status: "completed"; content_readback: unknown }> | Extract<LocalProviderMediaActionResult, { status: "unavailable" }>> {
  const managerUrl = "https://creator.xiaohongshu.com/new/note-manager?source=official";
  const contentRef = xhsContentRef(input.marker!, before.title_value);
  if (input.refs[0] !== contentRef) {
    return { status: "unavailable", failure_class: "commit_control_unavailable", message: "The cleanup provenance ref does not match the marker-bound page content.", retryable: false, submitted: false };
  }
  if (!await openNoteManager(client)) {
    return { status: "unavailable", failure_class: "commit_control_unavailable", message: "The exact note manager navigation is unavailable before cleanup.", retryable: false, submitted: false };
  }
  let manager: CommitProbe | undefined;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await abortableDelay(250);
    manager = await evaluateCommitProbe(client, input.marker!);
    if (manager?.login_like || manager?.challenge_like || manager?.pathname.includes("/new/note-manager")) break;
  }
  if (!manager?.pathname.includes("/new/note-manager")) {
    return { status: "unavailable", failure_class: "page_changed", message: "The exact note manager did not open before cleanup.", retryable: true, submitted: false };
  }
  if (await clickPublishedEditByTitle(client, before.title_value) !== "matched") {
    return { status: "unavailable", failure_class: "commit_control_unavailable", message: "The exact cleanup target could not be reopened for content verification.", retryable: false, submitted: false };
  }
  let verified: PublishedDetailProbe | undefined;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await abortableDelay(250);
    verified = await evaluatePublishedDetailProbe(client, before.title_value, input.marker!);
    if (verified?.login_like || verified?.challenge_like || verified?.pathname === "/publish/update" && verified.fields_matched && verified.media_count === before.media_count) break;
  }
  if (verified?.pathname !== "/publish/update" || !verified.marker_matched || !verified.fields_matched || verified.media_count !== before.media_count) {
    return { status: "unavailable", failure_class: "commit_control_unavailable", message: "The exact cleanup target did not match the authorized marker, fields and media.", retryable: false, submitted: false };
  }
  if (!await openNoteManager(client)) {
    return { status: "unavailable", failure_class: "commit_control_unavailable", message: "The exact note manager navigation is unavailable after content verification.", retryable: false, submitted: false };
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await abortableDelay(250);
    manager = await evaluateCommitProbe(client, input.marker!);
    if (manager?.login_like || manager?.challenge_like || manager?.pathname.includes("/new/note-manager")) break;
  }
  if (!manager?.pathname.includes("/new/note-manager")) {
    return { status: "unavailable", failure_class: "page_changed", message: "The exact note manager did not reopen after content verification.", retryable: true, submitted: false };
  }
  const deletePoint = await clickPublishedDeleteByTitle(client, before.title_value);
  if (deletePoint !== "matched") {
    return { status: "unavailable", failure_class: "commit_control_unavailable", message: "The exact marker-matched task content has no unique delete control.", retryable: false, submitted: false };
  }
  let confirmation: PointProbe | undefined;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await abortableDelay(100);
    confirmation = await evaluatePoint(client, cleanupConfirmationPointExpression(before.title_value));
    if (confirmation?.status === "matched") break;
  }
  if (!confirmation || confirmation.status !== "matched") {
    return { status: "unavailable", failure_class: "commit_control_unavailable", message: "The exact cleanup confirmation could not be verified.", retryable: false, submitted: false };
  }
  const confirmationClick = await clickPoint(client, confirmation.x, confirmation.y);
  if (confirmationClick === "not_dispatched") return { status: "unavailable", failure_class: "commit_control_unavailable", message: "The exact cleanup confirmation could not be dispatched.", retryable: false, submitted: false };
  if (confirmationClick === "unknown") return { status: "unavailable", failure_class: "operation_result_unknown", message: "The cleanup confirmation was dispatched without a reliable response.", retryable: false, submitted: true };
  let count = -1;
  let after: CommitProbe | undefined;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await abortableDelay(250);
    count = await exactVisibleTextCount(client, before.title_value);
    after = await evaluateCommitProbe(client, input.marker!);
    if (count === 0 && after?.pathname === "/new/note-manager" && !after.login_like && !after.challenge_like) break;
  }
  const observed = count === 0 && after?.pathname === "/new/note-manager" && !after.login_like && !after.challenge_like;
  return {
    status: "completed",
    observed_at: new Date().toISOString(),
    observed_url: managerUrl,
    page: readyPage(managerUrl, "Xiaohongshu creator cleanup action"),
    action_id: "xhs_publish_note_image_text_commit.cleanup",
    requested_path: "image_text_upload",
    effect_kind: "cleanup",
    effect_status: observed ? "observed" : "unknown",
    operation_status: observed ? "terminal" : "unknown_outcome",
    operation_ref: operationRef,
    ...(observed ? { terminal_state: "success" as const } : {}),
    marker_state: "matched",
    visibility_state: "not_applicable",
    content_readback: {
      state: observed ? "deleted" : "unknown",
      management_list_state: observed ? "not_found" : "unknown",
      detail_state: "not_run",
      fields_state: "matched",
      media_state: "matched",
      marker_state: "matched",
      content_ref: contentRef,
      canonical_url: observed ? managerUrl : null
    },
    page_readback: {
      status: observed ? "observed" : "unknown",
      page_state_ref: opaqueRef("page_state"),
      route_state: observed ? "observed" : "unknown"
    },
    source_refs: [
      { kind: "commit_action_summary", ref: opaqueRef("source") },
      { kind: "creator_publish_page_summary", ref: opaqueRef("source") },
      { kind: "business_state_summary", ref: opaqueRef("source") }
    ],
    evidence_ref_kinds: [
      { kind: "operation_ref", ref: operationRef },
      { kind: "snapshot_ref", ref: opaqueRef("evidence") }
    ],
    submitted: true
  };
}

async function executeCommitControl(
  client: CdpClient,
  input: LocalProviderMediaActionInput,
  operationRef: string
): Promise<Extract<LocalProviderMediaActionResult, { status: "completed"; content_readback: unknown }> | Extract<LocalProviderMediaActionResult, { status: "unavailable" }>> {
  const save = input.action_id === "xhs_publish_note_image_text_commit.save_draft";
  const marker = input.marker!;
  const before = await evaluateCommitProbe(client, marker);
  if (!before?.marker_matched || !before.fields_matched || before.media_count < 1) {
    return { status: "unavailable", failure_class: "commit_control_unavailable", message: "The current composition does not match the authorized marker, fields and media.", retryable: false, submitted: false };
  }
  if (input.action_id === "xhs_publish_note_image_text_commit.cleanup") return executeCleanupControl(client, input, operationRef, before);
  if (!save && !await selectCommitVisibility(client, input.visibility as "only_me" | "public")) {
    return { status: "unavailable", failure_class: "commit_control_unavailable", message: "The requested visibility could not be selected and verified exactly.", retryable: false, submitted: false };
  }
  const clicked = await clickExactAxButton(client, save ? "暂存离开" : "发布");
  if (clicked === "not_dispatched") return { status: "unavailable", failure_class: "commit_control_unavailable", message: "The exact commit control is unavailable or ambiguous.", retryable: false, submitted: false };
  if (clicked === "unknown") return { status: "unavailable", failure_class: "operation_result_unknown", message: "The exact commit control was dispatched without a reliable response.", retryable: false, submitted: true };
  let probe: CommitProbe | undefined;
  let listMatched = false;
  if (save) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await abortableDelay(250);
      probe = await evaluateCommitProbe(client, marker);
      if (probe?.login_like || probe?.challenge_like) break;
      const draft = await clickNewestDraftByTitle(client, before.title_value);
      if (draft === "matched") { listMatched = true; break; }
      if (draft === "ambiguous") break;
    }
    if (listMatched) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await abortableDelay(250);
        probe = await evaluateCommitProbe(client, marker, before.title_value);
        if (isCreatorPublishPath(probe?.pathname) && probe?.marker_matched && probe.fields_matched && probe.media_count === before.media_count) break;
      }
    }
  } else {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await abortableDelay(250);
      probe = await evaluateCommitProbe(client, marker);
      if (probe?.pathname.includes("/publish/success") || probe?.login_like || probe?.challenge_like) break;
    }
  }
  const detailMatched = save && listMatched && isCreatorPublishPath(probe?.pathname) && probe?.marker_matched === true && probe.fields_matched && probe.media_count === before.media_count;
  const publishObserved = !save && probe?.pathname.includes("/publish/success") === true;
  let publishedDetail: PublishedDetailProbe | undefined;
  if (publishObserved && await clickExactAxStaticText(client, "笔记管理")) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await abortableDelay(250);
      const manager = await evaluateCommitProbe(client, marker);
      if (manager?.login_like || manager?.challenge_like) break;
      if (manager?.pathname.includes("/new/note-manager") && await scrollExactTextIntoView(client, before.title_value)) {
        listMatched = true;
        break;
      }
    }
    if (listMatched && await clickPublishedEditByTitle(client, before.title_value) === "matched") {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await abortableDelay(250);
        publishedDetail = await evaluatePublishedDetailProbe(client, before.title_value, marker);
        if (publishedDetail?.login_like || publishedDetail?.challenge_like || publishedDetail?.fields_matched && publishedDetail.media_count === before.media_count) break;
      }
    }
  }
  const publishedDetailMatched = publishObserved && listMatched && publishedDetail?.marker_matched === true && publishedDetail.fields_matched && publishedDetail.media_count === before.media_count;
  const observed = detailMatched || publishedDetailMatched;
  const contentRef = observed ? xhsContentRef(marker, before.title_value) : null;
  return {
    status: "completed",
    observed_at: new Date().toISOString(),
    observed_url: publishedDetail?.url ?? probe?.url ?? input.target_url,
    page: readyPage(publishedDetail?.url ?? probe?.url ?? input.target_url, "Xiaohongshu creator commit action"),
    action_id: input.action_id as "xhs_publish_note_image_text_commit.save_draft" | "xhs_publish_note_image_text_commit.publish",
    requested_path: "image_text_upload",
    effect_kind: save ? "save_draft" : "publish",
    effect_status: observed ? "observed" : "unknown",
    operation_status: observed ? "terminal" : "unknown_outcome",
    operation_ref: operationRef,
    ...(observed ? { terminal_state: "success" as const } : {}),
    marker_state: save ? probe?.marker_matched ? "matched" : "unknown" : publishedDetail?.marker_matched ? "matched" : "unknown",
    visibility_state: save ? "not_applicable" : input.visibility ?? "unknown",
    content_readback: {
      state: detailMatched ? "draft_saved" : publishObserved ? "published" : "unknown",
      management_list_state: listMatched ? "matched" : "unknown",
      detail_state: detailMatched || publishedDetailMatched ? "matched" : "unknown",
      fields_state: detailMatched || publishedDetail?.fields_matched ? "matched" : "unknown",
      media_state: detailMatched || (publishedDetail?.media_count ?? 0) > 0 ? "matched" : "unknown",
      marker_state: save ? probe?.marker_matched ? "matched" : "unknown" : publishedDetail?.marker_matched ? "matched" : "unknown",
      content_ref: contentRef,
      canonical_url: observed ? publishedDetail?.url ?? probe?.url ?? null : null
    },
    page_readback: {
      status: observed ? "observed" : "unknown",
      page_state_ref: opaqueRef("page_state"),
      route_state: observed ? "observed" : "unknown"
    },
    source_refs: [
      { kind: "commit_action_summary", ref: opaqueRef("source") },
      { kind: "creator_publish_page_summary", ref: opaqueRef("source") },
      { kind: "business_state_summary", ref: opaqueRef("source") }
    ],
    evidence_ref_kinds: [
      { kind: "operation_ref", ref: operationRef },
      { kind: "snapshot_ref", ref: opaqueRef("evidence") }
    ],
    submitted: true
  };
}

async function resolveLocalMediaRef(localFileRef: string): Promise<string> {
  if (!/^local_file_ref_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(localFileRef)) throw new Error("media_ref_unavailable");
  const resolverUrl = process.env.HARBOR_MEDIA_REF_RESOLVER_URL ?? "";
  const token = process.env.HARBOR_MEDIA_REF_RESOLVER_TOKEN ?? "";
  if (!resolverUrl || !token) throw new Error("media_ref_unavailable");
  const response = await fetch(resolverUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ local_file_ref: localFileRef }),
    signal: AbortSignal.timeout(5_000)
  });
  if (response.status === 404) throw new Error("media_ref_unavailable");
  if (!response.ok) throw new Error("media_ref_request_invalid");
  const value = await response.json() as { path?: unknown };
  if (typeof value.path !== "string" || !isAbsolute(value.path)) throw new Error("media_ref_unavailable");
  return value.path;
}

async function resolveProtectedFieldRef(fieldOwnerRef: string, fieldId: "title" | "body", maxLength: number): Promise<string> {
  if (!new RegExp(`^draft:app-protected/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/${fieldId}$`, "i").test(fieldOwnerRef)) {
    throw new Error("field_ref_unavailable");
  }
  const resolverUrl = process.env.HARBOR_MEDIA_REF_RESOLVER_URL ?? "";
  const token = process.env.HARBOR_MEDIA_REF_RESOLVER_TOKEN ?? "";
  if (!resolverUrl || !token) throw new Error("field_ref_unavailable");
  const response = await fetch(resolverUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ field_owner_ref: fieldOwnerRef }),
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) throw new Error("field_ref_unavailable");
  const value = await response.json() as { value?: unknown };
  if (typeof value.value !== "string" || value.value.length < 1 || value.value.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.value)) {
    throw new Error("field_ref_unavailable");
  }
  return value.value;
}

type FieldFillProbe = {
  title_candidate_count: number;
  body_candidate_count: number;
  title_matched: boolean;
  body_matched: boolean;
};

async function evaluateFieldFill(client: CdpClient, title: string, body: string, write: boolean): Promise<FieldFillProbe | undefined> {
  const evaluated = await sendMediaActionCdp(client, "Runtime.evaluate", {
    expression: fieldFillProbeExpression(title, body, write),
    returnByValue: true,
    awaitPromise: true
  });
  return (evaluated.result as { value?: FieldFillProbe } | undefined)?.value;
}

function fieldReadbackFromProbe(probe: FieldFillProbe | undefined): Extract<LocalProviderMediaActionResult, { status: "completed"; action_id: "xhs_publish_note_image_text_fields.compose" }>["field_readback"] {
  if (!probe || probe.title_candidate_count !== 1 || probe.body_candidate_count !== 1) {
    return {
      status: "unknown",
      title: { status: "unknown", value_state: "unknown" },
      body: { status: "unknown", value_state: "unknown" },
      validation_status: "unknown"
    };
  }
  const title = probe.title_matched
    ? { status: "observed" as const, value_state: "matched" as const }
    : { status: "mismatch" as const, value_state: "mismatch" as const };
  const body = probe.body_matched
    ? { status: "observed" as const, value_state: "matched" as const }
    : { status: "mismatch" as const, value_state: "mismatch" as const };
  return {
    status: probe.title_matched && probe.body_matched ? "observed" : "mismatch",
    title,
    body,
    validation_status: probe.title_matched && probe.body_matched ? "passed" : "failed"
  };
}

// Observation and field execution must identify the same unique editable controls.
function creatorFieldCandidatesExpression(roots: string): string {
  return String.raw`const fieldCandidates = (selector, predicate) => [...new Set((${roots}).flatMap((root) => [...root.querySelectorAll(selector)]))]
      .filter((el) => visible(el) && predicate(el));
    const titles = fieldCandidates('input', (el) => !el.disabled && !el.readOnly && /标题/.test(el.getAttribute('placeholder') || ''));
    const bodies = fieldCandidates('[contenteditable="true"]', (el) => el.getAttribute('aria-disabled') !== 'true');`;
}

export function fieldFillProbeExpression(title: string, body: string, write: boolean): string {
  const titleLiteral = JSON.stringify(title);
  const bodyLiteral = JSON.stringify(body);
  return String.raw`(() => {
    const roots = [...new Set(document.querySelectorAll('#app, [data-v-app]'))];
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return !el.hidden && !el.closest('[aria-hidden="true"], [hidden], [data-decoy], [data-testid*="decoy"], .decoy') &&
        style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none' && Number(style.opacity) >= 0.01 &&
        rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight &&
        (typeof el.checkVisibility !== 'function' || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
    };
    ${creatorFieldCandidatesExpression("roots")}
    const titleValue = ${titleLiteral};
    const bodyValue = ${bodyLiteral};
    if (${write ? "true" : "false"} && titles.length === 1 && bodies.length === 1) {
      const titleInput = titles[0];
      const bodyInput = bodies[0];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('title_setter_unavailable');
      setter.call(titleInput, titleValue);
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new Event('change', { bubbles: true }));
      bodyInput.focus();
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(bodyInput);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (!document.execCommand('insertText', false, bodyValue)) bodyInput.textContent = bodyValue;
      bodyInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
      bodyInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return {
      title_candidate_count: titles.length,
      body_candidate_count: bodies.length,
      title_matched: titles.length === 1 && titles[0].value === titleValue,
      body_matched: bodies.length === 1 && (bodies[0].innerText || bodies[0].textContent || '') === bodyValue
    };
  })()`;
}

async function findImageFileInput(client: CdpClient): Promise<string | undefined> {
  const evaluated = await sendMediaActionCdp(client, "Runtime.evaluate", {
    expression: imageFileInputProbeExpression(),
    returnByValue: false,
    awaitPromise: true
  });
  return typeof (evaluated.result as { objectId?: unknown } | undefined)?.objectId === "string"
    ? (evaluated.result as { objectId: string }).objectId
    : undefined;
}

type ImageUploadPathProbe = {
  image_input_candidate_count: number;
  image_path_candidate_count: number;
};

async function ensureImageUploadPath(client: CdpClient): Promise<ImageUploadPathProbe> {
  const evaluated = await sendMediaActionCdp(client, "Runtime.evaluate", {
    expression: imageUploadPathProbeExpression(),
    returnByValue: true,
    awaitPromise: true
  });
  const value = (evaluated.result as { value?: Partial<ImageUploadPathProbe> } | undefined)?.value;
  return {
    image_input_candidate_count: typeof value?.image_input_candidate_count === "number" ? value.image_input_candidate_count : 0,
    image_path_candidate_count: typeof value?.image_path_candidate_count === "number" ? value.image_path_candidate_count : 0
  };
}

export function imageUploadPathProbeExpression(): string {
  return String.raw`(async () => {
    const supportedInput = (el) => (el.accept || '').split(',').some((value) => /^(?:image\/(?:\*|jpeg|png|webp)|\.jpe?g|\.png|\.webp)$/i.test(value.trim())) &&
      !el.matches(':disabled') && !el.closest('[aria-disabled="true"], [data-decoy], [data-testid*="decoy"], .decoy');
    const imageInputs = () => [...document.querySelectorAll('#app input[type="file"], [data-v-app] input[type="file"]')].filter(supportedInput);
    if (imageInputs().length === 0) {
      const actionable = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return !el.hidden && !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true' &&
          !el.closest('[aria-hidden="true"], [hidden], [data-decoy], [data-testid*="decoy"], .decoy') &&
          !el.querySelector('input[type="file"]') &&
          style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none' && Number(style.opacity) >= 0.01 &&
          rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight &&
          (hit === el || el.contains(hit)) &&
          (typeof el.checkVisibility !== 'function' || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
      };
      // Only image_upload consumes this current-page compatibility branch. It
      // prevents the default video input from being mistaken for an image
      // input; remove it once the formal entrypoint opens image-text directly.
      let pathEntries = [];
      for (let attempt = 0; attempt < 30 && imageInputs().length === 0; attempt += 1) {
        pathEntries = [...document.querySelectorAll('#app .header-tabs .creator-tab, [data-v-app] .header-tabs .creator-tab')]
          .filter((el) => (el.textContent || '').replace(/\s+/g, ' ').trim() === '上传图文' && actionable(el));
        if (pathEntries.length === 1) {
          pathEntries[0].click();
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      for (let attempt = 0; attempt < 30 && imageInputs().length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
      return { image_input_candidate_count: imageInputs().length, image_path_candidate_count: pathEntries.length };
    }
    return { image_input_candidate_count: imageInputs().length, image_path_candidate_count: 0 };
  })()`;
}

export function imageFileInputProbeExpression(): string {
  return String.raw`(() => {
    const candidates = [...document.querySelectorAll('#app input[type="file"], [data-v-app] input[type="file"]')]
      .filter((el) => (el.accept || '').split(',').some((value) => /^(?:image\/(?:\*|jpeg|png|webp)|\.jpe?g|\.png|\.webp)$/i.test(value.trim())) &&
        !el.matches(':disabled') && !el.closest('[aria-disabled="true"], [data-decoy], [data-testid*="decoy"], .decoy'));
    return candidates.length === 1 ? candidates[0] : null;
  })()`;
}

async function executeTextToImageControl(client: CdpClient, summary: string): Promise<boolean> {
  const summaryLiteral = JSON.stringify(summary);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const evaluated = await sendMediaActionCdp(client, "Runtime.evaluate", {
      expression: String.raw`(() => {
        const visible = (el) => { const style = getComputedStyle(el); const rect = el.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0; };
        const label = (el) => (el.getAttribute('aria-label') || el.getAttribute('name') || el.textContent || '').replace(/\s+/g, ' ').trim();
        const controls = [...document.querySelectorAll('button,[role="button"],a')].filter(visible);
        const path = controls.find((el) => label(el).includes('文字配图'));
        if (path) path.click();
        const inputs = [...document.querySelectorAll('textarea,input:not([type="file"]),[contenteditable="true"]')].filter(visible);
        const candidate = inputs.find((el) => /配图|描述|文字|prompt|image/i.test(label(el) + ' ' + (el.getAttribute('placeholder') || '')));
        if (candidate) {
          const value = ${summaryLiteral};
          if ('value' in candidate) { candidate.value = value; } else { candidate.textContent = value; }
          candidate.dispatchEvent(new Event('input', { bubbles: true }));
          candidate.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const generate = controls.find((el) => /^(生成|生成图片|立即生成|确认生成)$/.test(label(el)));
        if (generate) generate.click();
        return Boolean(path && candidate && generate);
      })()`,
      returnByValue: true,
      awaitPromise: true
    });
    if ((evaluated.result as { value?: unknown } | undefined)?.value === true) return true;
    await abortableDelay(250);
  }
  return false;
}

async function evaluateMediaActionObservation(client: CdpClient): Promise<MediaPageObservation | undefined> {
  const evaluated = await sendMediaActionCdp(client, "Runtime.evaluate", {
    expression: String.raw`(() => {
      const visible = (el) => { const style = getComputedStyle(el); const rect = el.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0; };
      const text = (document.body?.innerText || '').slice(0, 4000);
      const media = [...document.querySelectorAll('img')].filter((el) => visible(el) && (el.naturalWidth > 24 || /image|img|media|upload/i.test(el.className || '')));
      const generated = [...document.querySelectorAll('[data-testid*="generated"],[class*="generated"],[class*="ai-image"],img')].some((el) => visible(el) && /生成|配图|generated|ai-image/i.test((el.getAttribute('alt') || '') + ' ' + (el.getAttribute('class') || '')));
      return {
        url: location.href,
        origin: location.origin,
        pathname: location.pathname,
        route_loaded: document.readyState === 'interactive' || document.readyState === 'complete',
        challenge_like: /captcha|challenge|verify|verification|安全验证|风险验证/.test(text),
        login_like: /请先登录|立即登录|登录后/.test(text),
        media_count: media.length,
        generated_result_visible: generated
      };
    })()`,
    returnByValue: true,
    awaitPromise: true
  });
  return (evaluated.result as { value?: MediaPageObservation } | undefined)?.value;
}

function sendMediaActionCdp(client: CdpClient, method: XhsMediaActionCdpCommand, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  if (!XHS_MEDIA_ACTION_CDP_COMMANDS.includes(method)) throw new Error(`Media-action CDP command is not allowlisted: ${method}`);
  return client.send(method, params);
}

async function evaluateWritePrecheck(
  client: CdpClient,
  compositionPath?: XhsWritePrecheckCompositionPath,
  selectPath = false,
  exactPath = false,
  expected?: XhsPublicObservationExpected
): Promise<WritePrecheckObservation | undefined> {
  const evaluated = await sendWritePrecheckCdp(client, "Runtime.evaluate", {
    expression: writePrecheckProbeExpression(compositionPath, selectPath, exactPath),
    returnByValue: true,
    awaitPromise: true
  });
  const observation = (evaluated.result as { value?: WritePrecheckObservation } | undefined)?.value;
  if (!observation || (expected?.title === undefined && expected?.body === undefined)) return observation;
  const fieldProbe = await evaluateFieldFill(client, expected.title ?? "", expected.body ?? "", false);
  const titleExpectedMatch = expected.title === undefined
    ? "unknown" as const
    : fieldProbe?.title_candidate_count === 1
      ? fieldProbe.title_matched ? "matched" as const : "mismatched" as const
      : "unknown" as const;
  const bodyExpectedMatch = expected.body === undefined
    ? "unknown" as const
    : fieldProbe?.body_candidate_count === 1
      ? fieldProbe.body_matched ? "matched" as const : "mismatched" as const
      : "unknown" as const;
  return {
    ...observation,
    public_observation: {
      ...observation.public_observation,
      title_expected_match: titleExpectedMatch,
      body_expected_match: bodyExpectedMatch
    }
  };
}

function pathPrepareState(
  requestedPath: "image_text_upload" | "image_text_generate",
  before: WritePrecheckObservation | undefined,
  selected: WritePrecheckObservation | undefined,
  after: WritePrecheckObservation | undefined
): XhsPathPrepareNormalizedState {
  const requestedControl = requestedPath === "image_text_upload" ? "upload_image" : "generate_image";
  const businessState = (observation: WritePrecheckObservation | undefined): XhsPathPrepareNormalizedState["business_state_before"] => ({
    route_state: isCreatorPublishPath(observation?.pathname) ? "observed" : "mismatch",
    control_owner_state: observation?.creator_app_owned === true ? "observed" : "unknown",
    observed_path: observation?.path_observed === "observed" ? "observed" : observation?.path_observed === "unobserved" ? "mismatch" : "unknown",
    composition_state: observation?.composition_state === "composition_initialized" ? "initialized" : observation?.composition_state === "composition_not_initialized" ? "not_initialized" : "unknown",
    submitted: false
  });
  const afterState = businessState(after);
  const compositionState = afterState.composition_state;
  return {
    requested_path: requestedPath,
    observed_path: afterState.observed_path,
    composition_state: compositionState,
    business_state_before: businessState(before),
    business_state_after: afterState,
    interaction: {
      allowed_action: "exact_visible_path_control_selection" as const,
      requested_control: requestedControl as "upload_image" | "generate_image",
      selection_status: selected?.selection_status === "selected" ? "selected" as const : "unknown" as const,
      readback_status: afterState.observed_path === "observed" ? "read" as const : "unknown" as const
    },
    composition_state_proof: {
      basis: compositionState === "initialized" ? "business_state_readback" as const : "unknown" as const,
      path_entry_alone_proves_initialized: false as const
    },
    submitted: false,
    prohibited_actions_observed: {
      file_chooser: false as const,
      file_select: false as const,
      upload: false as const,
      generate: false as const,
      field_fill: false as const,
      save_draft: false as const,
      publish: false as const,
      submit: false as const,
      retry: false as const,
      bypass: false as const
    },
    no_submit_guard_status: "active" as const
  };
}

async function captureWritePrecheckScreenshot(client: CdpClient): Promise<LocalProviderScreenshotFacts | null> {
  const result = await sendWritePrecheckCdp(client, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  const data = typeof result.data === "string" ? result.data : "";
  return data ? screenshotFacts(Buffer.from(data, "base64")) : null;
}

function sendWritePrecheckCdp(
  client: CdpClient,
  method: WritePrecheckCdpCommand,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  if (!XHS_WRITE_PRECHECK_CDP_COMMANDS.includes(method)) throw new Error(`Write-precheck CDP command is not allowlisted: ${method}`);
  return client.send(method, params);
}

function writePrecheckUnavailable(
  failure_class: Extract<LocalProviderWritePrecheckProbeResult, { status: "unavailable" }>["failure_class"],
  message: string,
  retryable = true,
  failure_stage?: XhsPathPrepareFailureStage
): LocalProviderWritePrecheckProbeResult {
  return {
    status: "unavailable",
    failure_class,
    message,
    retryable,
    ...(failure_stage === undefined ? {} : { failure_stage })
  };
}

function pathSelectionProbeExpression(): string {
  return String.raw`    if (selectPath) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const ready = await observe();
        if (ready.creator_app_owned) {
          const normalizeControlLabel = (el) => (el?.getAttribute('aria-label') || el?.getAttribute('name') || el?.textContent || '').replace(/\s+/g, ' ').trim();
          const controlVisible = (el) => {
            const style = el ? getComputedStyle(el) : null;
            const rect = el?.getBoundingClientRect();
            return Boolean(el && style && style.visibility !== 'hidden' && style.display !== 'none' &&
              style.pointerEvents !== 'none' && rect && rect.width > 0 && rect.height > 0 &&
              style.zIndex !== '-1' && Number(style.opacity) >= 0.01 &&
              rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight &&
              !el.disabled && el.getAttribute('aria-disabled') !== 'true' &&
              !el.closest('[aria-hidden="true"], [hidden], [data-decoy], [data-testid*="decoy"], .decoy') &&
              (typeof el.checkVisibility !== 'function' || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })));
          };
          const controls = [...document.querySelectorAll('#app .header-tabs .creator-tab, [data-v-app] .header-tabs .creator-tab, [role="tab"], [role="tablist"] button, [role="tablist"] [role="button"], button[aria-controls], button[aria-selected], [role="button"][aria-controls], [role="button"][aria-selected]')]
            .filter((el) => controlVisible(el) && pathLabels.some((expected) => normalizeControlLabel(el) === expected) &&
              !(el instanceof HTMLInputElement) && !el.querySelector('input[type="file"]'));
          if (controls.length !== 1) return { ...ready, selection_status: 'blocked' };
          const control = controls[0];
          control.click();
          await new Promise((resolve) => setTimeout(resolve, 120));
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
`;
}

export function writePrecheckProbeExpression(compositionPath?: XhsWritePrecheckCompositionPath, selectPath = false, exactPath = false): string {
  const requestedPath = normalizedCompositionPath(compositionPath);
  const labels = (selectPath || exactPath) && (requestedPath === "image_text_upload" || requestedPath === "image_text_generate")
    ? [requestedPath === "image_text_upload" ? "上传图文" : "文字配图"]
    : compositionPathLabels[requestedPath];
  return `(async () => {
    const requestedPath = ${JSON.stringify(requestedPath)};
    const pathLabels = ${JSON.stringify(labels)};
    const selectPath = ${JSON.stringify(selectPath)};
    const strictPath = ${JSON.stringify(selectPath || exactPath)};
    const observe = async () => {
      const bodyText = (document.body?.innerText || '').slice(0, 20000);
      const visible = (el, allowDisabled = true) => {
        const s = el ? getComputedStyle(el) : null;
        const r = el?.getBoundingClientRect();
        return Boolean(el && !el.hidden && (allowDisabled || (!el.disabled && el.getAttribute('aria-disabled') !== 'true')) &&
          !el.closest('[aria-hidden="true"], [hidden], [data-decoy], [data-testid*="decoy"], .decoy') &&
          s && s.visibility !== 'hidden' && s.display !== 'none' && s.pointerEvents !== 'none' &&
          s.zIndex !== '-1' && Number(s.opacity) >= 0.01 && r && r.width > 0 && r.height > 0 &&
          r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight &&
          (typeof el.checkVisibility !== 'function' || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })));
      };
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const label = (el) => normalize(el?.getAttribute('aria-label') || el?.getAttribute('name') ||
        el?.getAttribute('placeholder') || el?.textContent || '');
      const fingerprint = (value) => {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
          hash ^= value.charCodeAt(index);
          hash = Math.imul(hash, 16777619);
        }
        return 'fnv1a:' + (hash >>> 0).toString(16).padStart(8, '0');
      };
      const interactive = [...document.querySelectorAll('button, [role="button"], [role="tab"], .header-tabs .creator-tab, input, textarea, [contenteditable="true"], [role="textbox"]')];
      const outermostRoots = (nodes) => nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
      const apps = outermostRoots([...document.querySelectorAll('#app, [data-v-app]')].filter((el) => visible(el)));
      const app = apps.length === 1 ? apps[0] : undefined;
      const appVisible = Boolean(app);
      const controls = interactive.filter((el) => appVisible && app.contains(el) && visible(el));
      const allControls = interactive.filter((el) => appVisible && app.contains(el) && visible(el, true));
      const hasLabel = (patterns, includeDisabled = false, scopedControls = includeDisabled ? allControls : controls) => scopedControls
        .some((el) => patterns.some((pattern) => pattern.test(label(el))));
      const findControl = (patterns, includeDisabled = false, scopedControls = includeDisabled ? allControls : controls) => scopedControls
        .find((el) => patterns.some((pattern) => pattern.test(label(el))));
      const creatorLabel = /上传图文|上传图片|文字配图|上传视频|长文|播客|标题|正文|内容|简介|描述|发布|保存草稿|保存/;
      const creatorControls = controls.filter((el) => creatorLabel.test(label(el)));
      const isSelected = (el) => el.getAttribute('aria-selected') === 'true' || el.getAttribute('data-active') === 'true' ||
        /(^|\\s)(active|selected|current)(\\s|$)/i.test(el.className || '');
      const isRequestedPath = (el) => pathLabels.some((expected) => label(el) === expected || (!strictPath && label(el).includes(expected)));
      const requestedPathControls = strictPath ? controls.filter((el) => visible(el, false)) : controls;
      const selectedRequestedPath = requestedPathControls.find((el) => isSelected(el) && isRequestedPath(el));
      const semanticRoots = appVisible ? [...app.querySelectorAll('[id*="publish"], [class*="publish"], [data-page*="publish"], [data-component*="creator"], [class*="creator"]')]
        .filter((el) => visible(el)) : [];
      const creatorRoots = semanticRoots.filter((root) => creatorControls.some((control) => root.contains(control)));
      // Nested containers describe one surface; disjoint creator roots are ambiguous.
      const roots = outermostRoots(creatorRoots);
      const creatorSurface = roots.length === 1 ? roots[0] : undefined;
      const surfaceControls = creatorSurface ? controls.filter((el) => creatorSurface.contains(el)) : [];
      const pathControls = strictPath ? surfaceControls.filter((el) => visible(el, false)) : surfaceControls;
      const pathEntryVisible = strictPath
        ? pathControls.some((el) => pathLabels.some((expected) => label(el) === expected))
        : pathLabels.some((expected) => hasLabel([new RegExp(expected)], false, surfaceControls));
      const activePath = Boolean(selectedRequestedPath && pathControls.includes(selectedRequestedPath));
      const imageCompositionSurfaces = requestedPath === 'image_text_upload' && creatorSurface
        ? [...creatorSurface.querySelectorAll('.publish-page-content-media')].filter((el) => visible(el))
        : [];
      const imageCompositionSurface = imageCompositionSurfaces.length === 1 ? imageCompositionSurfaces[0] : undefined;
      const imageComposition = Boolean(imageCompositionSurface &&
        [...imageCompositionSurface.querySelectorAll('img')].some((el) => visible(el)) &&
        /图片编辑/.test(imageCompositionSurface.textContent || ''));
      const observedPath = activePath || imageComposition;
      const path_observed = observedPath ? 'observed' : pathEntryVisible ? 'unobserved' : 'unknown';
      const path_entry_visible = pathEntryVisible ? 'observed' : 'unknown';
      ${creatorFieldCandidatesExpression("creatorSurface ? [creatorSurface] : []")}
      const titleControl = titles.length === 1 ? titles[0] : undefined;
      const contentControl = bodies.length === 1 ? bodies[0] : undefined;
      const publishControl = findControl([/^发布$|发布笔记|立即发布|publish/i], false, surfaceControls);
      const saveControl = findControl([/保存草稿|保存|save draft/i], false, surfaceControls);
      const publishHosts = creatorSurface ? [...creatorSurface.querySelectorAll('xhs-publish-btn')].filter((el) => visible(el, true)) : [];
      const publishHost = publishHosts.length === 1 ? publishHosts[0] : undefined;
      const hostControlState = (kind) => {
        const isPublish = kind === 'publish';
        const present = publishHost?.getAttribute(isPublish ? 'is-publish' : 'is-save-draft') === 'true';
        const text = publishHost?.getAttribute(isPublish ? 'submit-text' : 'save-text') || '';
        const expected = isPublish ? /^发布$|发布笔记|立即发布|publish/i : /暂存|保存草稿|保存|save draft/i;
        if (!present || !expected.test(text)) return { availability: 'unknown', observation: 'unknown' };
        const disabledState = publishHost?.getAttribute(isPublish ? 'submit-disabled' : 'save-disabled');
        if (disabledState !== 'true' && disabledState !== 'false') return { availability: 'unknown', observation: 'unknown' };
        const disabled = disabledState === 'true';
        return { availability: disabled ? 'unavailable' : 'available', observation: 'observed', editable: disabled ? 'unobserved' : 'observed', value_state: 'unknown' };
      };
      const validationControl = [...(creatorSurface?.querySelectorAll('[aria-invalid="true"], [role="alert"], [class*="error"], [class*="valid"]') || [])]
        .find((el) => visible(el, true));
      const fieldState = (el) => {
        // A selector miss is not proof that the control is unavailable; keep
        // both dimensions unknown until a semantic control is observed.
        if (!el) return { availability: 'unknown', observation: 'unknown' };
        const editable = !el.disabled && !el.readOnly && el.getAttribute('aria-disabled') !== 'true';
        return { availability: editable ? 'available' : 'unavailable', observation: 'observed', editable: editable ? 'observed' : 'unobserved', value_state: 'unknown' };
      };
      const title = fieldState(titleControl);
      const content = fieldState(contentControl);
      const publish = publishControl ? fieldState(publishControl) : hostControlState('publish');
      const save = saveControl ? fieldState(saveControl) : hostControlState('save');
      const validation = fieldState(validationControl);
      const mediaDefinitions = {
        image_text_upload: [['upload_image', [/上传图片/]]],
        image_text_generate: [['generate_image', [/文字配图/]]],
        video: [['upload_video', [/上传视频|视频/]]],
        long_article: [['add_media', [/添加媒体|上传图片|上传视频/]]],
        podcast: [['upload_audio', [/上传音频/]], ['add_rss_subscription', [/添加 RSS 订阅|RSS/]]]
      };
      const mediaControls = {};
      for (const [id, patterns] of mediaDefinitions[requestedPath] || []) {
        const control = findControl(patterns, false, surfaceControls);
        mediaControls[id] = control ? fieldState(control) : id === 'upload_image' && imageComposition
          ? { availability: 'available', observation: 'observed', editable: 'observed', value_state: 'unknown' }
          : fieldState(control);
      }
      const mediaControl = (mediaDefinitions[requestedPath] || []).map(([, patterns]) => findControl(patterns, false, surfaceControls)).find(Boolean);
      const titleValue = titleControl?.value || '';
      const bodyValue = contentControl ? (contentControl.innerText || contentControl.textContent || '') : '';
      const fieldSummary = (available, value) => {
        if (!available) return { state: 'unknown', length: null, fingerprint: null };
        const bounded = String(value).slice(0, 2000);
        return { state: bounded.length === 0 ? 'empty' : 'present', length: bounded.length, fingerprint: fingerprint(bounded) };
      };
      const accountRoots = appVisible ? [...app.querySelectorAll('.user-info')].filter((el) => visible(el, true)) : [];
      const accountLabels = accountRoots.length === 1
        ? [...accountRoots[0].querySelectorAll('.name-box')].filter((el) => visible(el, true)).map((el) => label(el)).filter(Boolean)
        : [];
      const uniqueAccountLabels = [...new Set(accountLabels)];
      const accountLabel = uniqueAccountLabels.length === 1 && uniqueAccountLabels[0].length <= 96 ? uniqueAccountLabels[0] : null;
      const authStoreUser = app?.__vue_app__?.config?.globalProperties?.$store?.state?.Auth?.userInfo;
      const authStoreUserId = typeof authStoreUser?.userId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(authStoreUser.userId)
        ? authStoreUser.userId
        : null;
      const authStoreUserName = typeof authStoreUser?.userName === 'string' ? authStoreUser.userName.trim() : null;
      const accountCandidates = accountLabel && authStoreUserId && authStoreUserName === accountLabel
        ? [{ label: accountLabel, stable_id: authStoreUserId }]
        : [];
      const accountSourceKind = accountCandidates.length === 1 ? 'xiaohongshu.creator_auth_store.user_info/v1' : null;
      const businessTargetCandidates = [];
      const businessTargetKind = location.origin === 'https://creator.xiaohongshu.com' &&
        location.pathname === '/publish/publish' && creatorSurface && accountCandidates.length === 1
        ? 'xiaohongshu.creator_publish_page/v1'
        : null;
      const imageElements = imageCompositionSurface
        ? [...imageCompositionSurface.querySelectorAll('img')].filter((el) => visible(el) && (el.naturalWidth > 24 || el.getBoundingClientRect().width >= 24))
        : [];
      const imageRef = async (el) => {
        const source = typeof el.currentSrc === 'string' && el.currentSrc || el.getAttribute('src') || '';
        if (!source || source.length > 8192 || !globalThis.crypto?.subtle) return null;
        let canonical;
        try {
          canonical = new URL(source, location.href);
        } catch {
          return null;
        }
        if (!['https:', 'http:', 'blob:', 'data:'].includes(canonical.protocol)) return null;
        const signal = JSON.stringify([canonical.href, el.naturalWidth || 0, el.naturalHeight || 0]);
        const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(signal));
        return 'media:sha256:' + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      };
      // A source digest gives each visible app-owned preview an identity while
      // keeping its URL in the page. DOM position only orders those identities.
      const imageRefs = await Promise.all(imageElements.map(imageRef));
      // Merely seeing an upload control is the entrypoint, not an initialized
      // composition. Initialization is observable only once an editing or
      // publication control is present; file selection is intentionally not
      // performed by this read-only probe.
      const editableControl = (el) => Boolean(el && !el.disabled && !el.readOnly && el.getAttribute('aria-disabled') !== 'true');
      const composition_initialized = Boolean(observedPath && ([titleControl, contentControl, publishControl, saveControl].some(editableControl) ||
        publish.observation === 'observed' || save.observation === 'observed'));
      const selectedPathLabels = surfaceControls.filter((el) => isSelected(el) && ${JSON.stringify(Object.values(compositionPathLabels).flat())}.includes(label(el))).map(label).sort();
      const pageFingerprint = fingerprint([
        location.origin,
        location.pathname,
        requestedPath,
        JSON.stringify(selectedPathLabels),
        path_observed,
        String(composition_initialized),
        String(roots.length),
        JSON.stringify(accountCandidates),
        JSON.stringify(businessTargetCandidates),
        JSON.stringify(imageRefs),
        JSON.stringify(fieldSummary(Boolean(titleControl), titleValue)),
        JSON.stringify(fieldSummary(Boolean(contentControl), bodyValue)),
        String(publishControl ? 1 : 0),
        String(saveControl ? 1 : 0)
      ].join('|'));
      const loginSurface = location.pathname.startsWith('/login') || [...document.querySelectorAll('[class*="login"], [class*="qrcode"], [class*="qr-code"]')]
        .some((el) => visible(el, true) && /扫码登录|手机号登录|登录二维码/.test(el.textContent || ''));
      return {
        url: location.href,
        origin: location.origin,
        pathname: location.pathname,
        challenge_like: /验证码|安全验证|访问受限|captcha/i.test(bodyText),
        login_like: loginSurface,
        creator_app_owned: Boolean(creatorSurface),
        creator_surface_state: creatorSurface ? 'observed' : 'unknown',
        creator_root_count: roots.length,
        upload_image_tab_active: Boolean(observedPath && requestedPath === 'image_text_upload'),
        upload_image_entry_visible: hasLabel([/上传图片/], false, surfaceControls),
        text_image_entry_visible: hasLabel([/文字配图/], false, surfaceControls),
        composition_path: requestedPath,
        path_observed,
        path_entry_visible,
        composition_state: observedPath ? (composition_initialized ? 'composition_initialized' : 'composition_not_initialized') : 'composition_unknown',
        field_states: { title_input: title, content_editor: content, publish_control: publish },
        media_state: { availability: mediaControl || imageComposition ? 'available' : 'unknown', observation: mediaControl || imageComposition ? 'observed' : 'unknown', controls: mediaControls },
        validation_state: validation,
        save_draft_control: save,
        publish_control: publish,
        public_observation: {
          account_source_kind: accountSourceKind,
          account_candidates: accountCandidates,
          business_target_candidates: businessTargetCandidates,
          business_target_kind: businessTargetKind,
          media_source_kind: 'xiaohongshu.creator_publish_page.preview_image_source/v1',
          image_count: imageCompositionSurface ? imageElements.length : null,
          ordered_item_refs: imageRefs,
          title_summary: fieldSummary(Boolean(titleControl), titleValue),
          body_summary: fieldSummary(Boolean(contentControl), bodyValue),
          page_fingerprint: pageFingerprint
        }
      };
    };
    ${selectPath ? pathSelectionProbeExpression() : ""}
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const observation = await observe();
      if (observation.challenge_like || observation.login_like || observation.creator_app_owned) return { ...observation, selection_status: selectPath ? 'selected' : 'not_performed' };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ...(await observe()), selection_status: selectPath ? 'unknown' : 'not_performed' };
  })()`;
}

export function validWritePrecheckFreshness(
  input: LocalProviderWritePrecheckProbeInput,
  before: WritePrecheckObservation | undefined,
  after: WritePrecheckObservation | undefined,
  startedAt: number,
  completedAt: number,
  allowPathTransition = false
): boolean {
  if (completedAt < startedAt || completedAt - startedAt > 2000) return false;
  if (allowPathTransition) {
    return validateXhsWritePrecheckObservation(input, before).status === "completed" &&
      validateXhsWritePrecheckObservation(input, after).status === "completed" &&
      before?.url === after?.url && before?.origin === after?.origin &&
      before?.pathname === after?.pathname && before?.creator_app_owned === after?.creator_app_owned;
  }
  if (
    validateXhsWritePrecheckObservation(input, before).status !== "completed" ||
    validateXhsWritePrecheckObservation(input, after).status !== "completed"
  ) return false;
  return JSON.stringify(before) === JSON.stringify(after);
}

export function resolveRuntimeProviderBinding(
  identityEnvironment: LocalProviderLaunchInput["identity_environment"],
  detection: BrowserProviderDetectionInput = {}
): IdentityEnvironmentProviderBinding {
  const persisted = identityEnvironment?.provider_binding;
  return bindIdentityEnvironmentDefaultProvider({
    ...detection,
    ...(persisted?.selected_provider_id ? { requested_provider_id: persisted.selected_provider_id } : {}),
    execution_identity_ref: identityEnvironment?.execution_identity_ref,
    profile_ref: identityEnvironment?.profile_ref
  });
}

export interface LocalProviderLaunchVerification {
  browser_version: string;
}

export async function verifyLocalProviderLaunch(
  browserPath: string,
  options: { expected_version?: string; timeout_ms?: number; signal?: AbortSignal } = {}
): Promise<LocalProviderLaunchVerification> {
  const profileDir = await mkdtemp(join(tmpdir(), "harbor-provider-verify-"));
  const child = spawn(browserPath, providerLaunchArguments({ headless: true, url: "about:blank" }, profileDir, null), { stdio: "ignore" });
  const deadline = Date.now() + Math.max(1, options.timeout_ms ?? 10_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, options.timeout_ms ?? 10_000))])
    : AbortSignal.timeout(Math.max(1, options.timeout_ms ?? 10_000));
  try {
    const port = await waitForDevtoolsPort(profileDir, deadline, signal);
    const versionFacts = await fetchVersion(port, signal);
    const browserVersion = observedBrowserVersion(versionFacts);
    if (options.expected_version && !compatibleBrowserVersion(browserVersion, options.expected_version)) {
      throw new Error(`Provider version ${browserVersion} does not match target ${options.expected_version}.`);
    }
    const page = await readPageFacts(port, "about:blank", signal);
    if (page.status !== "ready") throw new Error("Provider launch readback was not ready.");
    return { browser_version: browserVersion };
  } finally {
    await closeBrowser(child, profileDir, true);
  }
}

export function providerLaunchArguments(
  input: Pick<LocalProviderLaunchInput, "headless" | "url">,
  profileDir: string,
  configuration: ResolvedIdentityEnvironmentLaunchConfiguration | null
): string[] {
  return [
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-default-browser-check",
    "--no-first-run",
    ...(input.headless ? ["--headless=new"] : []),
    ...(configuration?.proxy_server ? [`--proxy-server=${configuration.proxy_server}`] : []),
    ...(configuration?.language ? [`--lang=${configuration.language}`] : []),
    ...(configuration?.viewport ? [`--window-size=${configuration.viewport.width},${configuration.viewport.height}`] : []),
    configuration ? "about:blank" : input.url
  ];
}

export function providerConfigurationPageUrl(input: LocalProviderLaunchInput): string {
  try {
    const url = new URL(input.url);
    if (
      input.identity_environment?.site_binding.site_id === "xiaohongshu" &&
      ((url.origin === "https://www.xiaohongshu.com" && ["/search_result", "/search_result/"].includes(url.pathname)) ||
        (url.origin === "https://creator.xiaohongshu.com" && ["/publish/publish", "/publish/publish/"].includes(url.pathname)))
    ) return "https://www.xiaohongshu.com/explore";
  } catch {
    // URL validation remains owned by the Runtime Session boundary.
  }
  return input.url;
}

function isXhsCreatorPublishUrl(input: LocalProviderLaunchInput): boolean {
  try {
    const url = new URL(input.url);
    return input.identity_environment?.site_binding.site_id === "xiaohongshu" &&
      url.origin === "https://creator.xiaohongshu.com" && ["/publish/publish", "/publish/publish/"].includes(url.pathname);
  } catch {
    return false;
  }
}

const SITE_RESOURCE_PROBE_DEADLINE_MS = 3000;

export async function probeProviderSiteResource(
  port: string,
  requestedUrl: string,
  input: LocalProviderSiteResourceProbeInput,
  deadlineMs = SITE_RESOURCE_PROBE_DEADLINE_MS
): Promise<LocalProviderSiteResourceProbeResult> {
  if (
    (input.site_id === "boss" && input.task_kind !== "job_search" && input.task_kind !== "boss_job_search") ||
    (input.site_id === "xiaohongshu" &&
      input.task_kind !== "authentication_recovery" &&
      input.task_kind !== "search_notes" &&
      input.task_kind !== "xhs_search_notes" &&
      input.task_kind !== "read_note_detail" &&
      input.task_kind !== "xhs_read_note_detail")
  ) {
    return siteResourceProbeUnavailable("unknown", "provider_probe_unavailable", "The local provider has no safe probe for this site resource.");
  }
  const deadline = AbortSignal.timeout(Math.max(1, Math.min(deadlineMs, SITE_RESOURCE_PROBE_DEADLINE_MS)));
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  try {
    const page = await activePage(port, requestedUrl, signal);
    if (!page.webSocketDebuggerUrl) {
      return siteResourceProbeUnavailable("unknown", "provider_probe_unavailable", "The site page has no controlled CDP target.");
    }
    return await withCdp(page.webSocketDebuggerUrl, async (client) => {
      await client.send("Runtime.enable");
      const observe = async () => {
        const evaluated = await client.send("Runtime.evaluate", {
          expression: input.site_id === "boss"
            ? readProbeExpression("boss", "")
            : xiaohongshuSiteResourceProbeExpression(),
          returnByValue: true
        });
        return (evaluated.result as { value?: ReadProbeObservation } | undefined)?.value;
      };
      if (input.site_id === "boss") return validateBossSpaResourceProbe(await observe());
      if (input.task_kind === "authentication_recovery") return validateXiaohongshuAuthenticationProbe(await observe());
      return waitForXiaohongshuSiteResourceReadiness(observe, signal);
    }, signal);
  } catch {
    return siteResourceProbeUnavailable("unknown", "provider_probe_unavailable", "The site readiness surface could not be verified through the controlled CDP probe.");
  }
}

function validateXiaohongshuAuthenticationProbe(observation: ReadProbeObservation | undefined): LocalProviderSiteResourceProbeResult {
  if (!observation || observation.origin !== "https://www.xiaohongshu.com" || !observation.ready) {
    return siteResourceProbeUnavailable("unavailable", "page_not_ready", "The active page is not a ready canonical Xiaohongshu surface.");
  }
  if (observation.challenge_like) return siteResourceProbeUnavailable("blocked", "safety_challenge", "The Xiaohongshu page shows a verification or safety challenge.");
  if (observation.login_like) return siteResourceProbeUnavailable("blocked", "not_logged_in", "The Xiaohongshu page requires manual login.");
  return { status: "available", observed_at: new Date().toISOString(), evidence_ref: opaqueRef("validation"), verified_fact_keys: [] };
}

export function validateBossSpaResourceProbe(observation: ReadProbeObservation | undefined): LocalProviderSiteResourceProbeResult {
  if (!observation) return siteResourceProbeUnavailable("unknown", "provider_probe_unavailable", "The BOSS SPA probe returned no public observation.");
  if (observation.challenge_like) return siteResourceProbeUnavailable("blocked", "safety_challenge", "The BOSS page shows a verification or safety challenge.");
  if (observation.login_like) return siteResourceProbeUnavailable("blocked", "not_logged_in", "The BOSS page requires manual login.");
  if (observation.origin !== "https://www.zhipin.com" || observation.pathname !== "/web/geek/job") {
    return siteResourceProbeUnavailable("unavailable", "page_not_ready", "The active page is not the canonical BOSS job-search surface.");
  }
  if (!observation.ready || !observation.vue_owned || !observation.rendered_surface || !observation.job_cards_valid || !observation.job_card_count) {
    return siteResourceProbeUnavailable("unavailable", "page_not_ready", "The canonical BOSS page has no verified SPA job-search surface.");
  }
  return {
    status: "available",
    observed_at: new Date().toISOString(),
    evidence_ref: opaqueRef("validation"),
    verified_fact_keys: ["page.boss_spa.ready"]
  };
}

export function validateXiaohongshuSiteResourceProbe(observation: ReadProbeObservation | undefined): LocalProviderSiteResourceProbeResult {
  if (!observation) {
    return siteResourceProbeUnavailable("unknown", "provider_probe_unavailable", "The Xiaohongshu readiness probe returned no public observation.");
  }
  if (observation.origin !== "https://www.xiaohongshu.com") {
    return siteResourceProbeUnavailable("unavailable", "page_not_ready", "The active page is not on the canonical Xiaohongshu origin.");
  }
  if (observation.challenge_like) {
    return siteResourceProbeUnavailable("blocked", "safety_challenge", "The Xiaohongshu page shows a verification or safety challenge.");
  }
  if (observation.login_like) {
    return siteResourceProbeUnavailable("blocked", "not_logged_in", "The Xiaohongshu page requires manual login.");
  }
  const verifiedFactKeys = [
    ...(observation.vue_ready ? ["page.vue_app.ready" as const] : []),
    ...(observation.pinia_ready ? ["page.pinia_store.ready" as const] : [])
  ];
  if (!observation.ready || !observation.vue_ready || !observation.pinia_ready) {
    return siteResourceProbeUnavailable("unavailable", "page_not_ready", "The Xiaohongshu Vue app or Pinia store is not ready.", verifiedFactKeys);
  }
  return {
    status: "available",
    observed_at: new Date().toISOString(),
    evidence_ref: opaqueRef("validation"),
    verified_fact_keys: verifiedFactKeys
  };
}

export async function waitForXiaohongshuSiteResourceReadiness(
  observe: () => Promise<ReadProbeObservation | undefined>,
  signal: AbortSignal,
  retryDelayMs = 100
): Promise<LocalProviderSiteResourceProbeResult> {
  while (true) {
    signal.throwIfAborted();
    const observation = await observe();
    const result = validateXiaohongshuSiteResourceProbe(observation);
    if (!isPendingXiaohongshuInitialization(observation)) return result;
    await abortableDelay(retryDelayMs, signal);
  }
}

function isPendingXiaohongshuInitialization(observation: ReadProbeObservation | undefined): boolean {
  return observation?.origin === "https://www.xiaohongshu.com" &&
    observation.login_like === false &&
    observation.challenge_like === false &&
    typeof observation.ready === "boolean" &&
    typeof observation.vue_ready === "boolean" &&
    typeof observation.pinia_ready === "boolean" &&
    (!observation.ready || !observation.vue_ready || !observation.pinia_ready);
}

export function xiaohongshuSiteResourceProbeExpression(): string {
  return `(() => {
    const text = document.body?.innerText || "";
    const challengeSurface = typeof document.querySelectorAll === 'function' && Array.from(document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="challenge"], [id*="challenge"], [class*="security-check"], [id*="security-check"]')).some((element) => {
      const view = document.defaultView;
      if (!view) return false;
      const style = view.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth;
    });
    const challenge = /验证码|安全验证|访问异常|captcha|challenge required|verification challenge|security check|verification required|complete verification/i.test(text) || challengeSurface;
    const login = /登录后|扫码登录|手机号登录/.test(text) || location.pathname.startsWith('/login') || Boolean(document.querySelector('.login-dialog, [class*="login"] form, [class*="login"] [class*="qrcode"]'));
    const app = document.querySelector('#app');
    const vue = app?.__vue_app__;
    const pinia = window.__PINIA__ || window.__pinia || vue?.config?.globalProperties?.$pinia;
    return {
      origin: location.origin,
      ready: document.readyState !== 'loading',
      login_like: login,
      challenge_like: challenge,
      vue_ready: Boolean(vue),
      pinia_ready: pinia?._s instanceof Map
    };
  })()`;
}

function siteResourceProbeUnavailable(
  status: "blocked" | "unavailable" | "unknown",
  failure_class: Extract<LocalProviderSiteResourceProbeResult, { status: "blocked" | "unavailable" | "unknown" }>["failure_class"],
  message: string,
  verified_fact_keys: Extract<LocalProviderSiteResourceProbeResult, { status: "blocked" | "unavailable" | "unknown" }>["verified_fact_keys"] = []
): LocalProviderSiteResourceProbeResult {
  return {
    status,
    failure_class,
    message,
    verified_fact_keys,
    ...(verified_fact_keys.length > 0 ? { evidence_ref: opaqueRef("validation") } : {})
  };
}

export function createFixtureLauncher(status: "ready" | "unavailable" | "profile_locked" | "session_lost" = "ready"): LocalProviderLauncher {
  return async (input) => {
    if (status === "unavailable") return unavailable("provider_unavailable", "Fixture provider unavailable.");
    if (status === "profile_locked") return unavailable("profile_locked", "Fixture profile is locked by another local browser process.");
    if (status === "session_lost") return unavailable("session_lost", "Fixture Runtime Session was lost before validation could complete.");
    const configuration = input.identity_environment
      ? resolveIdentityEnvironmentLaunchConfiguration(input.identity_environment, input.resolve_proxy)
      : null;
    if (input.identity_environment && !configuration) return unavailable("unsupported", "Fixture provider could not resolve identity environment configuration.");
    const evidence_ref = opaqueRef("validation");
    const page = readyPage(input.url, `Fixture page for ${input.url}`);
    return {
      status: "ready",
      execution_surface: "fixture",
      driver_ref: opaqueRef("driver"),
      driver_kind: "chromium_cdp",
      cdp_ref: opaqueRef("cdp"),
      viewer_entry: viewerEntry(input.headless),
      page,
      facts: [
        ...fixtureIdentityEnvironmentConfigurationFacts(configuration, evidence_ref),
        { key: "browser.launch", source: "observed", value: "ready", evidence_ref },
        { key: "cdp.version", source: "validation_evidence", value: "FixtureBrowser 1.0", evidence_ref },
        ...page.facts
      ],
      openUrl: async (url) => readyPage(url, `Fixture page for ${url}`),
      captureScreenshot: async () => fixtureScreenshot(input.url),
      close: async () => {}
    };
  };
}

function unavailable(code: RuntimeErrorCode, message: string, facts: RuntimeFact[] = []): LocalProviderLaunchResult {
  return {
    status: "unavailable",
    error: { code, message, retryable: code !== "unsupported" },
    facts: [...facts, { key: "browser.launch", source: "observed", value: code }]
  };
}

function error(code: RuntimeErrorCode, message: string, retryable = true): RuntimeErrorFact {
  return { code, message, retryable };
}

function readyPage(current_url: string, title: string | null): LocalProviderPageFacts {
  const evidence_ref = opaqueRef("validation");
  return {
    current_url,
    title,
    status: "ready",
    facts: [
      { key: "page.current_url", source: "observed", value: current_url, evidence_ref },
      { key: "page.title", source: "observed", value: title ?? "unavailable", evidence_ref },
      { key: "page.status", source: "validation_evidence", value: "ready", evidence_ref }
    ]
  };
}

function providerBindingFacts(binding: IdentityEnvironmentProviderBinding | null): RuntimeFact[] {
  const facts: RuntimeFact[] = [
    { key: "provider.management.registered", source: "configured", value: "cloakbrowser,chrome_official,camoufox" },
    { key: "provider.default", source: "configured", value: "cloakbrowser" },
    { key: "provider.excluded.chromium", source: "configured", value: "not_user_selectable" },
    { key: "provider.reference.donut_browser", source: "configured", value: "mechanism_reference_only" }
  ];
  if (!binding) return facts;
  facts.push(
    { key: "identity_environment.provider_selection", source: "configured", value: binding.selection_reason },
    { key: "identity_environment.provider_notice_required", source: "configured", value: String(binding.requires_user_notice) }
  );
  if (binding.selected_provider) {
    facts.push(
      { key: "provider.id", source: "configured", value: binding.selected_provider.provider_id },
      { key: "provider.role", source: "configured", value: binding.selected_provider.role }
    );
  }
  return facts;
}

function fixtureIdentityEnvironmentConfigurationFacts(
  configuration: ResolvedIdentityEnvironmentLaunchConfiguration | null,
  evidence_ref: string
): RuntimeFact[] {
  if (!configuration) return [];
  const facts: RuntimeFact[] = [
    { key: "identity_environment.provider_id", source: "validation_evidence", value: configuration.provider_id, evidence_ref }
  ];
  if (configuration.proxy_server) facts.push({ key: "identity_environment.proxy", source: "configured", value: "provider_argument_applied" });
  if (configuration.language) facts.push({ key: "identity_environment.language", source: "observed", value: configuration.language, evidence_ref });
  if (configuration.timezone) facts.push({ key: "identity_environment.timezone", source: "observed", value: configuration.timezone, evidence_ref });
  if (configuration.viewport) facts.push({ key: "identity_environment.viewport", source: "observed", value: `${configuration.viewport.width}x${configuration.viewport.height}`, evidence_ref });
  return facts;
}

async function applyAndReadbackProviderConfiguration(
  port: string,
  requestedUrl: string,
  configuration: ResolvedIdentityEnvironmentLaunchConfiguration,
  signal: AbortSignal
): Promise<RuntimeFact[]> {
  const evidence_ref = opaqueRef("validation");
  const facts: RuntimeFact[] = [
    { key: "identity_environment.provider_id", source: "validation_evidence", value: configuration.provider_id, evidence_ref }
  ];
  if (configuration.proxy_server) {
    facts.push({ key: "identity_environment.proxy", source: "configured", value: "provider_argument_applied" });
  }

  const opened = await openProviderUrl(port, requestedUrl, signal);
  if (opened.status !== "ready") {
    throw new Error(`Identity environment configuration could not open the requested page: ${opened.error?.message ?? "unknown failure"}`);
  }
  const page = await activePage(port, requestedUrl, signal);
  if (!page.webSocketDebuggerUrl) throw new Error("Identity environment configuration has no controlled CDP page target.");
  const observed = await withCdp(page.webSocketDebuggerUrl, async (client) => {
    if (configuration.language) await client.send("Emulation.setLocaleOverride", { locale: configuration.language });
    if (configuration.timezone) await client.send("Emulation.setTimezoneOverride", { timezoneId: configuration.timezone });
    if (configuration.viewport) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: configuration.viewport.width,
        height: configuration.viewport.height,
        deviceScaleFactor: 1,
        mobile: false
      });
    }
    const result = await client.send("Runtime.evaluate", {
      expression: `(() => ({ language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, width: window.innerWidth, height: window.innerHeight }))()`,
      returnByValue: true
    });
    const value = (result.result as { value?: { language?: unknown; timezone?: unknown; width?: unknown; height?: unknown } } | undefined)?.value;
    return value;
  }, signal);
  if (!observed) throw new Error("Provider environment readback returned no observation.");
  if (configuration.language) {
    if (observed.language !== configuration.language) throw new Error("Provider locale readback did not match configured language.");
    facts.push({ key: "identity_environment.language", source: "observed", value: configuration.language, evidence_ref });
  }
  if (configuration.timezone) {
    if (observed.timezone !== configuration.timezone) throw new Error("Provider timezone readback did not match configured timezone.");
    facts.push({ key: "identity_environment.timezone", source: "observed", value: configuration.timezone, evidence_ref });
  }
  if (configuration.viewport) {
    if (observed.width !== configuration.viewport.width || observed.height !== configuration.viewport.height) {
      throw new Error("Provider viewport readback did not match configured dimensions.");
    }
    facts.push({
      key: "identity_environment.viewport",
      source: "observed",
      value: `${configuration.viewport.width}x${configuration.viewport.height}`,
      evidence_ref
    });
  }
  return facts;
}

function viewerEntry(headless: boolean): Exclude<LocalProviderLaunchResult, { status: "unavailable" }>["viewer_entry"] {
  return headless ? {
    availability: "unsupported",
    access_mode: "none",
    transport: "not_applicable",
    input_capabilities: [],
    unavailable_reason: "unsupported"
  } : {
    availability: "available",
    access_mode: "interactive",
    transport: "local_window",
    input_capabilities: ["keyboard_mouse"]
  };
}

async function waitForDevtoolsPort(profileDir: string, deadline: number, signal?: AbortSignal): Promise<string> {
  const portFile = join(profileDir, "DevToolsActivePort");
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    try {
      const [port] = (await readFile(portFile, "utf8")).trim().split("\n");
      if (port) return port;
    } catch {
      await abortableDelay(25, signal);
    }
  }
  throw new Error("Timed out waiting for local browser CDP readiness.");
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function remainingLaunchTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Timed out reading local browser CDP readiness.");
  return remaining;
}

async function removeStaleDevtoolsPort(profileDir: string): Promise<void> {
  const portFile = join(profileDir, "DevToolsActivePort");
  let port = "";
  try {
    [port] = (await readFile(portFile, "utf8")).trim().split("\n");
  } catch {
    return;
  }
  if (port && await isDevtoolsPortReachable(port)) return;
  await rm(portFile, { force: true });
}

async function isDevtoolsPortReachable(port: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
    return response.ok && hasCdpWebSocketEndpoint(await response.json());
  } catch {
    return false;
  }
}

function hasCdpWebSocketEndpoint(version: unknown): boolean {
  const endpoint = typeof version === "object" && version !== null
    ? (version as Record<string, unknown>).webSocketDebuggerUrl
    : null;
  if (typeof endpoint !== "string") return false;
  try {
    const url = new URL(endpoint);
    return (url.protocol === "ws:" || url.protocol === "wss:") && url.hostname !== "";
  } catch {
    return false;
  }
}

async function fetchVersion(port: string, signal?: AbortSignal): Promise<Record<string, string>> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal });
  if (!response.ok) throw new Error(`CDP readiness probe failed: ${response.status}`);
  return (await response.json()) as Record<string, string>;
}

function observedBrowserVersion(facts: Record<string, string>): string {
  const product = facts.Browser ?? "";
  const match = product.match(/(?:^|\/)([0-9]+(?:\.[0-9]+){3,4})$/);
  if (!match) throw new Error("Provider launch did not report a supported browser version.");
  return match[1]!;
}

function compatibleBrowserVersion(observed: string, target: string): boolean {
  const observedParts = observed.split(".");
  const targetParts = target.split(".");
  return observed === target || observedParts.slice(0, 4).join(".") === targetParts.slice(0, 4).join(".");
}

async function openProviderUrl(
  port: string,
  url: string,
  signal?: AbortSignal,
  onTarget?: (target: CdpPageTarget) => void
): Promise<LocalProviderPageFacts> {
  try {
    const target = await createProviderPage(port, url, signal);
    onTarget?.(target);
    return readTargetPageFacts(target, url, signal);
  } catch (cause) {
    return unavailablePageFacts("url_unreachable", url, cause);
  }
}

async function probeProviderReadOperation(port: string, input: LocalProviderReadProbeInput): Promise<LocalProviderReadProbeResult> {
  try {
    const bootstrapUrl = input.site_id === "xiaohongshu" ? "https://www.xiaohongshu.com/explore" : "about:blank";
    const page = await createProviderPage(port, bootstrapUrl, undefined, input.expected_origin);
    if (!page.id || !page.webSocketDebuggerUrl) throw new Error("Read-operation page has no target id or CDP websocket.");
    const observation = await withCdp(page.webSocketDebuggerUrl, async (client) => {
      await client.send("Page.enable");
      await client.send("Runtime.enable");
      await client.send("Network.enable", {
        maxTotalBufferSize: 20_000_000,
        maxResourceBufferSize: 5_000_000,
        enableDurableMessages: true
      });
      await client.send("Network.setCacheDisabled", { cacheDisabled: true });
      await client.send("Network.setBypassServiceWorker", { bypass: true });
      let blockedRedirect = false;
      let xhsFetchResponse: Promise<XhsSearchResponseSummary | XhsSearchResponseFailure> | null = null;
      await client.send("Fetch.enable", {
        patterns: [{ urlPattern: "*", requestStage: "Request" }]
      });
      const stopIntercepting = client.on("Fetch.requestPaused", (event) => {
        const requestId = typeof event.requestId === "string" ? event.requestId : "";
        const request = event.request as { url?: unknown; method?: unknown } | undefined;
        const url = typeof request?.url === "string" ? request.url : "";
        const method = typeof request?.method === "string" ? request.method : "";
        if (!requestId) return;
        if (shouldBlockReadOperationDocumentNavigation(event.resourceType, url, input.expected_origin)) {
          blockedRedirect = true;
          void client.send("Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => undefined);
          return;
        }
        if (
          typeof event.responseStatusCode === "number" &&
          input.operation_id === "xhs_search_notes" &&
          method === "POST" &&
          isOperationReadNetworkUrl(input, url)
        ) {
          xhsFetchResponse = readXhsSearchResponseSummary(client, requestId, "Fetch")
            .finally(() => client.send("Fetch.continueRequest", { requestId }).catch(() => undefined));
          return;
        }
        if (input.operation_id === "xhs_search_notes" && method === "POST" && isOperationReadNetworkUrl(input, url)) {
          void client.send("Fetch.continueRequest", { requestId, interceptResponse: true }).catch(() => undefined);
          return;
        }
        void client.send("Fetch.continueRequest", { requestId }).catch(() => undefined);
      });
      let navigationStarted = false;
      let operationResponse: { requestId: string; status: number; url: string } | null = null;
      let bossDetailResponse: { requestId: string; status: number; url: string } | null = null;
      const requestMethods = new Map<string, string>();
      const completedResponseRequests = new Set<string>();
      const stopObservingRequests = client.on("Network.requestWillBeSent", (event) => {
        const requestId = typeof event.requestId === "string" ? event.requestId : "";
        const request = event.request as { method?: unknown } | undefined;
        if (requestId && typeof request?.method === "string") requestMethods.set(requestId, request.method);
      });
      const stopObservingResponses = client.on("Network.responseReceived", (event) => {
        const response = event.response as { url?: unknown; status?: unknown } | undefined;
        const status = typeof response?.status === "number" ? response.status : null;
        const requestId = typeof event.requestId === "string" ? event.requestId : "";
        if (navigationStarted && input.operation_id === "boss_read_job_detail" && status !== null && status >= 200 && status < 300 && requestId && isBossJobDetailWapiUrl(input, response?.url)) {
          bossDetailResponse = { requestId, status, url: response!.url as string };
        } else if (
          navigationStarted &&
          status !== null &&
          status >= 200 &&
          status < 300 &&
          requestId &&
          (input.operation_id !== "xhs_search_notes" || requestMethods.get(requestId) === "POST") &&
          isOperationReadNetworkUrl(input, response?.url)
        ) operationResponse = { requestId, status, url: response!.url as string };
      });
      const stopObservingLoading = client.on("Network.loadingFinished", (event) => {
        if (typeof event.requestId === "string") completedResponseRequests.add(event.requestId);
      });
      const stopObservingNetwork = () => {
        stopObservingRequests();
        stopObservingResponses();
        stopObservingLoading();
      };
      navigationStarted = true;
      await navigateProviderPage(client, input.target_url);
      for (let attempt = 0; attempt < 20; attempt++) {
        if (blockedRedirect) {
          stopObservingNetwork();
          stopIntercepting();
          return { blocked_redirect: true };
        }
        const evaluated = await client.send("Runtime.evaluate", {
          expression: readProbeExpression(input.site_id, input.query ?? "", input.city_code, input.operation_id),
          returnByValue: true
        });
        const value = (evaluated.result as { value?: {
          origin?: string;
          pathname?: string;
          search?: string;
          ready?: boolean;
          rendered_surface?: boolean;
          login_like?: boolean;
          challenge_like?: boolean;
          vue_ready?: boolean;
          pinia_ready?: boolean;
          list_valid?: boolean;
          list_failure?: "empty_result" | "page_not_ready" | "field_missing" | "site_changed";
          note_count?: number;
          normalized?: ObservedDetailPublicSummary;
          detail_urls?: string[];
          search_items?: XiaohongshuSearchPublicFields[];
        } } | undefined)?.value;
        const observedResponse = operationResponse as { requestId: string; status: number; url: string } | null;
        const observedBossDetailResponse = bossDetailResponse as { requestId: string; status: number; url: string } | null;
        const operationBodyReady = input.operation_id !== "xhs_search_notes" && input.operation_id !== "boss_job_search" ||
          observedResponse !== null && completedResponseRequests.has(observedResponse.requestId);
        const bossDetailBodyReady = input.operation_id !== "boss_read_job_detail" ||
          observedBossDetailResponse !== null && completedResponseRequests.has(observedBossDetailResponse.requestId);
        if (value?.origin && (value.challenge_like || value.login_like)) {
          stopObservingNetwork();
          stopIntercepting();
          return { validation: validateReadOperationProbe(input, value) };
        }
        if (value?.origin && value.ready && observedResponse !== null && operationBodyReady && bossDetailBodyReady) {
          const xhsResponse = input.operation_id === "xhs_search_notes"
            ? await (xhsFetchResponse ?? readXhsSearchResponseSummary(client, observedResponse.requestId))
            : null;
          const bossResponse = input.operation_id === "boss_job_search"
            ? await readBossJobSearchResponseSummary(client, observedResponse.requestId)
            : null;
          const bossDetailSummary = input.operation_id === "boss_read_job_detail" && observedBossDetailResponse
            ? await readBossJobDetailResponseSummary(client, observedBossDetailResponse.requestId, bossDetailTargetId(input.target_url))
            : null;
          const validation = validateReadOperationProbe(input, {
            ...value,
            operation_response_status: observedResponse.status,
            operation_response_url: observedResponse.url,
            xhs_response: xhsResponse,
            boss_response: bossResponse,
            boss_detail_response: bossDetailSummary,
            boss_detail_response_status: observedBossDetailResponse?.status,
            boss_detail_response_url: observedBossDetailResponse?.url
          });
          if (
            input.operation_id === "xhs_read_note_detail" &&
            validation.status === "unavailable" &&
            validation.failure_class === "page_not_ready" &&
            value.pathname === new URL(input.target_url).pathname &&
            value.login_like === false &&
            value.challenge_like === false
          ) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          if (
            input.operation_id === "xhs_search_notes" &&
            validation.status === "unavailable" &&
            validation.failure_class === "page_not_ready" &&
            (value.pathname === "/search_result" || value.pathname === "/search_result/")
          ) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          stopObservingNetwork();
          stopIntercepting();
          if (validation.status === "unavailable") return { validation };
          const screenshot = await captureProbeScreenshot(client);
          return screenshot ? {
            validation,
            screenshot_ref: screenshot.screenshot_ref
          } : { evidence_missing: true };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      stopObservingNetwork();
      stopIntercepting();
      return null;
    }).finally(() => closeProviderPage(port, page.id!, page.webSocketDebuggerUrl).catch(() => undefined));
    const pageFacts = readOperationPageFacts(input.target_url);
    if (!observation) return probeUnavailable("page_not_ready", "The read-operation page did not reach a ready state.", true, pageFacts);
    if (observation.blocked_redirect) return probeUnavailable("origin_drift", "A cross-origin document redirect was blocked before navigation.", false, pageFacts);
    if (observation.evidence_missing) return probeUnavailable("evidence_refs_missing", "The local provider could not capture required refs-only evidence.", true, pageFacts);
    const validation = observation.validation;
    if (!validation || validation.status === "unavailable") {
      return probeUnavailable(validation?.failure_class ?? "page_not_ready", validation?.message ?? "The read-operation page did not reach a ready state.", validation?.retryable ?? true, pageFacts);
    }
    const source_refs = validation.source_kinds.map((kind) => ({ kind, ref: opaqueRef("source") }));
    const evidence_ref_kinds = [
      { kind: "snapshot_ref", ref: observation.screenshot_ref! },
      ...(input.operation_id === "boss_job_search" ? [{ kind: "network_summary_ref", ref: opaqueRef("evidence") }] : [])
    ];
    return {
      status: "completed",
      observed_at: new Date().toISOString(),
      observed_origin: input.expected_origin,
      page: pageFacts,
      source_refs,
      evidence_ref_kinds,
      public_summary_source_ref: source_refs.find((source) => source.kind === "network_summary" || source.kind === "wapi_job_detail_summary")?.ref ?? source_refs[0]!.ref,
      public_summary: validation.public_summary,
      detail_targets: validation.detail_urls?.map((canonical_url) => ({ canonical_url })),
      search_items: validation.search_items
    };
  } catch (cause) {
    if (cause instanceof ProviderOriginDriftError) {
      return probeUnavailable("origin_drift", cause.message, false);
    }
    return probeUnavailable(
      cause instanceof ProviderPageCommitError ? "page_not_ready" : "network_resource_unavailable",
      cause instanceof Error ? cause.message : "The provider read-only probe failed.",
      true
    );
  }
}

function probeUnavailable(
  failure_class: Extract<LocalProviderReadProbeResult, { status: "unavailable" }>["failure_class"],
  message: string,
  retryable: boolean,
  page?: LocalProviderPageFacts
): LocalProviderReadProbeResult {
  return { status: "unavailable", failure_class, message, retryable, page };
}

interface ReadProbeObservation {
  origin?: string;
  pathname?: string;
  search?: string;
  ready?: boolean;
  rendered_surface?: boolean;
  vue_owned?: boolean;
  job_card_count?: number;
  job_cards_valid?: boolean;
  login_like?: boolean;
  challenge_like?: boolean;
  vue_ready?: boolean;
  pinia_ready?: boolean;
  list_valid?: boolean;
  list_failure?: "empty_result" | "page_not_ready" | "field_missing" | "site_changed";
  note_count?: number;
  normalized?: ObservedDetailPublicSummary;
  detail_urls?: string[];
  search_items?: XiaohongshuSearchPublicFields[];
  operation_response_status?: number;
  operation_response_url?: string;
  xhs_response?: XhsSearchResponseSummary | XhsSearchResponseFailure | null;
  boss_response?: BossJobSearchResponseSummary | BossJobSearchResponseFailure | null;
  boss_detail_response?: BossJobDetailResponseSummary | BossJobSearchResponseFailure | null;
  boss_detail_response_status?: number;
  boss_detail_response_url?: string;
  blocked_redirect?: boolean;
  evidence_missing?: boolean;
  screenshot_ref?: string;
  validation?: ReturnType<typeof validateReadOperationProbe>;
}

async function createProviderPage(
  port: string,
  url: string,
  signal?: AbortSignal,
  expectedOrigin?: string
): Promise<CdpPageTarget> {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT", signal });
  if (!response.ok) throw new Error(`CDP read-operation target creation failed: ${response.status}`);
  const page = await response.json() as CdpPageTarget;
  if (!page.id) throw new Error("Created page has no target id.");
  try {
    if (!page.webSocketDebuggerUrl) throw new Error("Created page has no CDP websocket.");
    if (url === "about:blank") return page;
    const committedUrl = await withCdp(page.webSocketDebuggerUrl, async (client) => {
      await client.send("Page.enable");
      let blockedRedirect = false;
      const stopIntercepting = expectedOrigin
        ? await interceptProviderDocumentNavigation(client, expectedOrigin, () => { blockedRedirect = true; })
        : () => undefined;
      await navigateProviderPage(client, url);
      try {
        const committedUrl = await waitForProviderPageCommit(client, signal, () => blockedRedirect);
        if (blockedRedirect) throw new ProviderOriginDriftError("A cross-origin bootstrap redirect was blocked before navigation.");
        if (!committedUrl) throw new ProviderPageCommitError("Created page did not commit the requested URL.");
        return committedUrl;
      } finally {
        stopIntercepting();
      }
    }, signal);
    return { ...page, url: committedUrl };
  } catch (cause) {
    await closeProviderPage(port, page.id, page.webSocketDebuggerUrl).catch(() => undefined);
    throw cause;
  }
}

async function navigateProviderPage(client: CdpClient, url: string): Promise<void> {
  await client.send("Runtime.enable");
  void client.send("Runtime.evaluate", {
    expression: `location.assign(${JSON.stringify(url)})`,
    returnByValue: true
  }).catch(() => undefined);
}

async function waitForProviderPageCommit(
  client: CdpClient,
  signal?: AbortSignal,
  shouldStop: () => boolean = () => false
): Promise<string | null> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (shouldStop()) return null;
    signal?.throwIfAborted();
    let result: Record<string, unknown>;
    try {
      result = await client.send("Page.getFrameTree", {}, Math.min(500, Math.max(1, deadline - Date.now())));
    } catch {
      signal?.throwIfAborted();
      continue;
    }
    const frame = (result.frameTree as { frame?: { url?: unknown } } | undefined)?.frame;
    if (typeof frame?.url === "string" && isCommittedHttpPage(frame.url)) return frame.url;
    await abortableDelay(Math.min(250, Math.max(1, deadline - Date.now())), signal);
  }
  return null;
}

async function closeProviderPage(port: string, targetId: string, webSocketUrl?: string): Promise<void> {
  if (webSocketUrl) {
    try {
      const signal = AbortSignal.timeout(1000);
      await withCdp(webSocketUrl, (client) => client.send("Page.close", {}, 1000), signal);
      return;
    } catch {
      // Fall back to the browser target endpoint when the page session cannot close itself.
    }
  }
  const response = await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(targetId)}`, {
    signal: AbortSignal.timeout(1000)
  });
  if (!response.ok) throw new Error(`CDP read-operation target cleanup failed: ${response.status}`);
}

function isCommittedHttpPage(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

async function interceptProviderDocumentNavigation(
  client: CdpClient,
  expectedOrigin: string,
  onBlocked: () => void
): Promise<() => void> {
  await client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  return client.on("Fetch.requestPaused", (event) => {
    const requestId = typeof event.requestId === "string" ? event.requestId : "";
    const resourceType = event.resourceType;
    const request = event.request as { url?: unknown } | undefined;
    const url = typeof request?.url === "string" ? request.url : "";
    if (!requestId) return;
    if (shouldBlockReadOperationDocumentNavigation(resourceType, url, expectedOrigin)) {
      onBlocked();
      void client.send("Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => undefined);
      return;
    }
    void client.send("Fetch.continueRequest", { requestId }).catch(() => undefined);
  });
}

export function shouldBlockReadOperationDocumentNavigation(resourceType: unknown, value: string, expectedOrigin: string): boolean {
  if (resourceType !== "Document") return false;
  try {
    return new URL(value).origin !== expectedOrigin;
  } catch {
    return true;
  }
}

async function captureProbeScreenshot(client: CdpClient): Promise<LocalProviderScreenshotFacts | null> {
  try {
    const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const data = typeof result.data === "string" ? result.data : "";
    return data ? screenshotFacts(Buffer.from(data, "base64")) : null;
  } catch {
    return null;
  }
}

export function validateReadOperationProbe(
  input: LocalProviderReadProbeInput,
  observation: ReadProbeObservation
):
  | { status: "completed"; source_kinds: string[]; public_summary: LocalProviderReadProbePublicSummary; detail_urls?: string[]; search_items?: XiaohongshuSearchPublicFields[] }
  | { status: "unavailable"; failure_class: Extract<LocalProviderReadProbeResult, { status: "unavailable" }>["failure_class"]; message: string; retryable: boolean } {
  if (observation.origin !== input.expected_origin) return { status: "unavailable", failure_class: "origin_drift", message: "The read-operation page left the pinned allowed origin.", retryable: false };
  if (observation.challenge_like) return { status: "unavailable", failure_class: "safety_challenge", message: "The read-operation page shows a verification or safety challenge.", retryable: false };
  if (observation.login_like) return { status: "unavailable", failure_class: "not_logged_in", message: "The read-operation page requires a manual login refresh.", retryable: true };
  if (!observation.ready) return { status: "unavailable", failure_class: "page_not_ready", message: "The read-operation page did not reach the expected operation surface.", retryable: true };
  if (input.operation_id === "xhs_read_note_detail" || input.operation_id === "boss_read_job_detail") {
    const xhs = input.operation_id === "xhs_read_note_detail";
    const expectedPath = new URL(input.target_url).pathname;
    const pathMatches = observation.pathname === expectedPath;
    const rendered = observation.rendered_surface === true;
    if (!pathMatches || !rendered || !isSuccessfulReadResponse(observation.operation_response_status) || !isOperationReadNetworkUrl(input, observation.operation_response_url)) {
      return { status: "unavailable", failure_class: rendered ? "site_changed" : "empty_result", message: "The bound detail page did not expose the expected read-only surface.", retryable: true };
    }
    if (xhs && (!observation.vue_ready || !observation.pinia_ready)) {
      return { status: "unavailable", failure_class: "page_not_ready", message: "The Xiaohongshu detail Vue app or Pinia note store is not ready.", retryable: true };
    }
    const normalized = validateDetailNormalizedSummary(input, observation.normalized);
    if (!normalized) return { status: "unavailable", failure_class: "field_missing", message: "Required bounded public detail fields are missing.", retryable: true };
    if (!xhs) {
      if (!isSuccessfulReadResponse(observation.boss_detail_response_status) || !isBossJobDetailWapiUrl(input, observation.boss_detail_response_url)) {
        return { status: "unavailable", failure_class: "network_resource_unavailable", message: "The bound BOSS detail WAPI response was not observed.", retryable: true };
      }
      if (!observation.boss_detail_response || observation.boss_detail_response.status === "unavailable") {
        return observation.boss_detail_response ?? { status: "unavailable", failure_class: "network_resource_unavailable", message: "The BOSS detail WAPI summary is unavailable.", retryable: true };
      }
      if (!sameBossDetailSummary(normalized, observation.boss_detail_response)) {
        return { status: "unavailable", failure_class: "site_changed", message: "The BOSS detail WAPI and rendered summary do not match.", retryable: true };
      }
    }
    return {
      status: "completed",
      source_kinds: xhs
        ? ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]
        : ["wapi_job_detail_summary", "dom_snapshot_summary"],
      public_summary: {
        schema_version: "harbor-read-operation-public-summary/v0",
        operation_id: input.operation_id,
        result_kind: xhs ? "xiaohongshu_note_detail_surface" : "boss_job_detail_surface",
        surface: xhs ? "note_detail" : "job_detail",
        result_state: "operation_read_response_observed",
        response_status: observation.operation_response_status,
        normalized,
        source_signals: xhs
          ? ["pinia_note_store_ready", "xhs_note_detail_document", "xhs_note_detail_rendered"]
          : ["boss_job_detail_document"]
      }
    };
  }
  if (input.operation_id === "xhs_search_notes") {
    const xhsSurface = observation.pathname === "/search_result" || observation.pathname === "/search_result/";
    if (!xhsSurface || !hasExactPublicQuery(observation.search, "keyword", input.query ?? "") || !observation.pinia_ready || !isSuccessfulReadResponse(observation.operation_response_status) || !isOperationReadNetworkUrl(input, observation.operation_response_url)) {
      return { status: "unavailable", failure_class: "page_not_ready", message: "Xiaohongshu search/note, Pinia, or operation-specific read signal is unavailable.", retryable: true };
    }
    const detailUrls = observation.detail_urls ?? [];
    const searchItems = observation.search_items ?? [];
    if (!observation.xhs_response) {
      return { status: "unavailable", failure_class: "network_resource_unavailable", message: "The Xiaohongshu search response summary is unavailable.", retryable: true };
    }
    if (observation.xhs_response.status === "unavailable") {
      if (observation.xhs_response.failure_class !== "empty_result" || observation.list_failure === "empty_result") {
        return observation.xhs_response;
      }
      if (observation.list_failure === "page_not_ready") {
        return { status: "unavailable", failure_class: "page_not_ready", message: "The Xiaohongshu search page is still settling after an empty response.", retryable: true };
      }
      return { status: "unavailable", failure_class: "site_changed", message: "The Xiaohongshu search response and rendered page disagree about whether results exist.", retryable: false };
    }
    if (observation.list_failure === "empty_result") {
      return { status: "unavailable", failure_class: "page_not_ready", message: "The Xiaohongshu search response has results while the rendered page is still hydrating.", retryable: true };
    }
    if (observation.list_failure) {
      return { status: "unavailable", failure_class: observation.list_failure, message: "Xiaohongshu search did not expose a valid page-matched note list.", retryable: observation.list_failure === "page_not_ready" };
    }
    if (!observation.list_valid) {
      return { status: "unavailable", failure_class: "page_not_ready", message: "Xiaohongshu search note results are not correlated with the rendered page.", retryable: true };
    }
    const resultLimit = input.limit ?? 15;
    if (!Number.isInteger(observation.note_count) || observation.note_count! < 1 || detailUrls.length !== observation.note_count || searchItems.length !== detailUrls.length || !validXhsSearchTargets(detailUrls)) {
      return { status: "unavailable", failure_class: "site_changed", message: "Xiaohongshu search note targets do not match the expected public shape.", retryable: false };
    }
    if (!validXhsSearchTargets(observation.xhs_response.detail_urls)) {
      return { status: "unavailable", failure_class: "site_changed", message: "The Xiaohongshu search response contains invalid detail navigation targets.", retryable: false };
    }
    const correlated = correlateXhsSearchResults(detailUrls, searchItems, observation.xhs_response.detail_urls, observation.xhs_response.search_items, resultLimit);
    if (!correlated) {
      return { status: "unavailable", failure_class: "site_changed", message: "The Xiaohongshu search response and Pinia public fields do not match.", retryable: false };
    }
    return {
      status: "completed",
      source_kinds: ["pinia_store_summary", "network_summary", "dom_snapshot_summary"],
      public_summary: {
        schema_version: "harbor-read-operation-public-summary/v0",
        operation_id: "xhs_search_notes",
        result_kind: "xiaohongshu_search_notes_surface",
        surface: "search_result",
        result_state: "operation_read_response_observed",
        response_status: observation.operation_response_status,
        result_count: correlated.detail_urls.length,
        source_signals: ["pinia_store", "xhs_search_read_network"]
      },
      detail_urls: correlated.detail_urls,
      search_items: correlated.search_items
    };
  }
  const bossJobsSurface = observation.pathname === "/web/geek/job";
  if (!hasExactPublicQuery(observation.search, "city", input.city_code ?? "")) {
    return { status: "unavailable", failure_class: "city_unresolved", message: "BOSS search city does not match the admitted city code.", retryable: true };
  }
  if (!bossJobsSurface || !hasExactBossSearch(observation.search, input.query ?? "", input.city_code ?? "") || !observation.rendered_surface || !isSuccessfulReadResponse(observation.operation_response_status) || !isOperationReadNetworkUrl(input, observation.operation_response_url)) {
    return { status: "unavailable", failure_class: "page_not_ready", message: "BOSS jobs surface or required WAPI read signal is unavailable.", retryable: true };
  }
  if (!observation.boss_response) return { status: "unavailable", failure_class: "site_changed", message: "BOSS WAPI response summary is unavailable.", retryable: true };
  if (observation.boss_response.status === "unavailable") return observation.boss_response;
  return {
    status: "completed",
    source_kinds: ["network_summary"],
    public_summary: {
      schema_version: "harbor-read-operation-public-summary/v0",
      operation_id: "boss_job_search",
      result_kind: "boss_job_search_surface",
      surface: "web_geek_jobs",
      result_state: "operation_read_response_observed",
      response_status: observation.operation_response_status,
      query: input.query,
      city_code: input.city_code,
      business_code: observation.boss_response.business_code,
      job_count: observation.boss_response.job_count,
      source_signals: ["boss_wapi_zpgeek_read_network"]
    },
    detail_urls: observation.boss_response.detail_urls
  };
}

function validXhsSearchTargets(values: readonly string[]): boolean {
  if (new Set(values).size !== values.length) return false;
  return values.every((value) => isCanonicalDetailUrl("xiaohongshu", value));
}

function correlateXhsSearchResults(
  renderedUrls: readonly string[],
  renderedItems: readonly XiaohongshuSearchPublicFields[],
  networkUrls: readonly string[],
  networkItems: readonly XiaohongshuSearchPublicFields[],
  limit: number
): { detail_urls: string[]; search_items: XiaohongshuSearchPublicFields[] } | null {
  if (networkUrls.length !== networkItems.length || renderedUrls.length !== renderedItems.length) return null;
  const entries = networkUrls.map((value, index) => {
    const url = new URL(value);
    return [`${url.origin}${url.pathname}`, { url: value, item: networkItems[index]! }] as const;
  });
  const byPath = new Map(entries);
  if (byPath.size !== entries.length) return null;
  const correlated: Array<{ url: string; item: XiaohongshuSearchPublicFields }> = [];
  for (const [index, value] of renderedUrls.entries()) {
    const url = new URL(value);
    const result = byPath.get(`${url.origin}${url.pathname}`);
    if (!result) continue;
    if (!sameXhsSearchFields(renderedItems[index]!, result.item)) return null;
    correlated.push(result);
  }
  const bounded = correlated.slice(0, limit);
  return bounded.length > 0
    ? { detail_urls: bounded.map((value) => value.url), search_items: bounded.map((value) => value.item) }
    : null;
}

function sameXhsSearchFields(left: XiaohongshuSearchPublicFields, right: XiaohongshuSearchPublicFields): boolean {
  return left.title === right.title &&
    left.author_display_name === right.author_display_name &&
    JSON.stringify(left.interaction_metrics ?? {}) === JSON.stringify(right.interaction_metrics ?? {});
}

function isSuccessfulReadResponse(status: unknown): status is number {
  return typeof status === "number" && Number.isInteger(status) && status >= 200 && status < 300;
}

function validateDetailNormalizedSummary(
  input: LocalProviderReadProbeInput,
  value: ObservedDetailPublicSummary | undefined
): LocalProviderDetailPublicSummary | null {
  const target = new URL(input.target_url);
  const canonical_url = `${target.origin}${target.pathname}`;
  if (input.operation_id === "xhs_read_note_detail") {
    const noteId = target.pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (value?.kind !== "xiaohongshu_note_detail" || value.canonical_url !== canonical_url || value.note_id !== noteId || !/^[a-f0-9]{24}$/i.test(value.note_id) ||
      !boundedText(value.title, 200) || !boundedText(value.summary, 500) || !boundedText(value.body_summary, 2000) ||
      !boundedText(value.author.display_name, 100) || !boundedText(value.author.author_id, 100) ||
      !validPublicProfileUrl(value.author.profile_url, value.author.author_id) || !validMetrics(value.interaction_metrics) ||
      (value.source_status !== "located" && value.source_status !== "partially_located")) return null;
    return {
      kind: value.kind,
      canonical_url,
      note_id: value.note_id,
      title: value.title,
      summary: value.summary,
      body_summary: value.body_summary,
      author: { display_name: value.author.display_name, author_id: value.author.author_id, profile_url: value.author.profile_url },
      interaction_metrics: { ...value.interaction_metrics },
      source_citation: {
        kind: "xhs_note_detail_ref",
        note_id: value.note_id,
        url: canonical_url,
        // Lode v0 has one aggregate citation for all validated public fields.
        field_sources: ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]
      },
      source_status: value.source_status
    };
  }
  if (value?.kind !== "boss_job_detail" || value.canonical_url !== canonical_url ||
    !boundedText(value.title, 200) || !boundedText(value.summary, 500) || !boundedText(value.job.title, 200) ||
    !boundedText(value.job.description, 4000) || !boundedText(value.job.status, 100) || !optionalBoundedText(value.job.salary, 100) || !optionalBoundedText(value.job.location, 100) ||
    !boundedText(value.company.name, 200) || !boundedText(value.recruiter.name, 100) || !boundedText(value.recruiter.title, 100) ||
    (value.source_status !== "located" && value.source_status !== "partially_located")) return null;
  if (!input.detail_ref || !/^detail_ref_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.detail_ref)) return null;
  return {
    kind: value.kind,
    canonical_url,
    detail_ref: input.detail_ref,
    title: value.title,
    summary: value.summary,
    job: {
      title: value.job.title,
      description: value.job.description,
      status: value.job.status,
      ...(value.job.salary ? { salary: value.job.salary } : {}),
      ...(value.job.location ? { location: value.job.location } : {})
    },
    company: { name: value.company.name },
    recruiter: { name: value.recruiter.name, title: value.recruiter.title },
    source_citation: {
      kind: "boss_job_detail_ref",
      detail_ref: input.detail_ref,
      url: canonical_url,
      field_sources: ["wapi_job_detail_summary", "dom_snapshot_summary"]
    },
    source_status: value.source_status
  };
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function optionalBoundedText(value: unknown, max: number): boolean {
  return value === undefined || boundedText(value, max);
}

function validPublicProfileUrl(value: string, authorId: string): boolean {
  return value === `https://www.xiaohongshu.com/user/profile/${authorId}` && /^[A-Za-z0-9_]+$/.test(authorId);
}

function validMetrics(value: XiaohongshuNoteDetailPublicSummary["interaction_metrics"]): boolean {
  return [value.likes, value.comments, value.collects, value.shares].every((entry) =>
    typeof entry === "string" && entry.length > 0 && entry.length <= 40 && entry.trim() === entry && !/[\u0000-\u001f\u007f]/.test(entry)
  );
}

function sameBossDetailSummary(value: LocalProviderDetailPublicSummary, source: BossJobDetailResponseSummary): boolean {
  return value.kind === "boss_job_detail" && value.title === source.title && value.summary === source.summary &&
    value.job.title === source.title && value.job.description === source.description && value.job.status === source.job_status &&
    value.job.salary === source.salary && value.job.location === source.location && value.company.name === source.company_name &&
    value.recruiter.name === source.recruiter_name && value.recruiter.title === source.recruiter_title;
}

export function readProbeExpression(siteId: LocalProviderReadProbeInput["site_id"], query: string, cityCode?: string, operationId?: LocalProviderReadProbeInput["operation_id"]): string {
  if (operationId === "xhs_read_note_detail" || operationId === "boss_read_job_detail") return `(() => {
    const text = document.body?.innerText || "";
    const clean = (value, max) => {
      if (typeof value !== "string") return "";
      const truncated = value.replace(/\\s+/g, " ").trim().slice(0, max);
      return /[\\uD800-\\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
    };
    const pick = (selectors, max) => clean(document.querySelector(selectors)?.textContent, max);
    const challengeSurface = typeof document.querySelectorAll === 'function' && Array.from(document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="challenge"], [id*="challenge"], [class*="security-check"], [id*="security-check"]')).some((element) => {
      const view = document.defaultView;
      if (!view) return false;
      const style = view.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth;
    });
    const challenge = /验证码|安全验证|访问异常|captcha|challenge required|verification challenge|security check|verification required|complete verification/i.test(text) || challengeSurface;
    const login = /登录后|扫码登录|手机号登录/.test(text) || Boolean(document.querySelector('.login-dialog, [class*="login"] form, [class*="login"] [class*="qrcode"]'));
    const canonicalUrl = location.origin + location.pathname;
    const rendered = ${operationId === "xhs_read_note_detail"
      ? "Boolean(document.querySelector('#detail-desc, .note-detail-mask, [class*=note-content], [class*=interaction-container]'))"
      : "Boolean(document.querySelector('.job-detail-box, .job-detail-container, [class*=job-detail], .job-sec-text'))"};
    ${operationId === "xhs_read_note_detail" ? `
    const app = document.querySelector('#app');
    const vue = app?.__vue_app__;
    const pinia = window.__PINIA__ || window.__pinia || vue?.config?.globalProperties?.$pinia;
    const stores = pinia?._s;
    const unwrap = (value) => value && typeof value === "object" && "value" in value ? value.value : value;
    const sameBoundedBody = (rendered, stored) => {
      const compact = (value) => value.replace(/\\[话题\\]#/g, "").replace(/[\\s\\u200B-\\u200D\\uFEFF]+/g, "");
      const renderedCompact = compact(rendered);
      const storedCompact = compact(stored);
      const renderedCharacters = Array.from(renderedCompact);
      const storedCharacters = Array.from(storedCompact);
      if (renderedCompact === storedCompact) return true;
      if (storedCharacters.length >= 8 && storedCharacters.length * 2 >= renderedCharacters.length && renderedCompact.includes(storedCompact)) return true;
      if (renderedCharacters.length < 8 || renderedCharacters.length * 2 < storedCharacters.length) return false;
      const withoutPresentationCharacters = storedCompact.replace(/[\\p{Extended_Pictographic}\\uFE00-\\uFE0F\\u200D\\u{1F3FB}-\\u{1F3FF}\\u{E0100}-\\u{E01EF}]/gu, "");
      return renderedCompact === withoutPresentationCharacters;
    };
    const detailRoot = document.querySelector('#noteContainer') || document.querySelector('.note-detail-mask, [class*="note-detail"]');
    const pickDetail = (selectors, max) => clean(detailRoot?.querySelector(selectors)?.textContent, max);
    const title = pickDetail('.note-content .title, #detail-title, [class*="note-title"]', 200);
    const body = pickDetail('#detail-desc, .note-content .desc, [class*="note-desc"]', 2000);
    const author = clean(detailRoot?.querySelector('.author-container .name, .author-wrapper .name, [class*="author"] [class*="name"]')?.textContent, 100);
    const authorLink = detailRoot?.querySelector('.author-container a[href*="/user/profile/"], .author-wrapper a[href*="/user/profile/"], [class*="author"] a[href*="/user/profile/"]');
    const profilePath = authorLink ? new URL(authorLink.getAttribute('href'), location.origin).pathname : "";
    const authorId = profilePath.startsWith('/user/profile/') ? profilePath.slice('/user/profile/'.length).split('/')[0] : "";
    const profileUrl = authorId ? location.origin + '/user/profile/' + authorId : "";
    const engagementRoot = detailRoot?.querySelector('.interactions.engage-bar');
    const pickMetric = (selectors) => clean(engagementRoot?.querySelector(selectors)?.textContent, 40);
    const likes = pickMetric('[class*="like"] [class*="count"], .like-wrapper .count');
    const comments = pickMetric('[class*="comment"] [class*="count"], .comment-wrapper .count');
    const collects = pickMetric('[class*="collect"] [class*="count"], .collect-wrapper .count');
    const shares = pickMetric('[class*="share"] [class*="count"], .share-wrapper .count');
    const noteId = location.pathname.split('/').filter(Boolean).at(-1) || "";
    const noteStores = stores instanceof Map ? Array.from(stores.entries()).filter(([key]) => /note|detail/i.test(String(key))) : [];
    let matchedMetrics;
    const matchesStore = ([, candidate]) => {
      const state = unwrap(candidate?.$state) || candidate;
      const detailMap = unwrap(state?.noteDetailMap);
      const mappedDetail = detailMap instanceof Map ? unwrap(detailMap.get(noteId)) : unwrap(detailMap?.[noteId]);
      const details = [unwrap(mappedDetail?.note), unwrap(state?.currentNote), unwrap(state?.noteDetail), unwrap(state?.detail), unwrap(state?.note), state].filter((value) => value && typeof value === "object");
      return details.some((detail) => {
        const storeAuthor = unwrap(detail.author) || unwrap(detail.user) || {};
        const storeMetrics = unwrap(detail.interaction_metrics) || unwrap(detail.interactInfo) || unwrap(detail.metrics) || {};
        const metric = (...values) => {
          const value = values.map(unwrap).find((entry) => entry !== undefined && entry !== null);
          return typeof value === "number" && Number.isFinite(value) ? String(value).slice(0, 40) : clean(value, 40);
        };
        const metrics = {
          likes: metric(storeMetrics.likes, storeMetrics.likedCount, storeMetrics.liked_count),
          comments: metric(storeMetrics.comments, storeMetrics.commentCount, storeMetrics.comment_count),
          collects: metric(storeMetrics.collects, storeMetrics.collectedCount, storeMetrics.collected_count),
          shares: metric(storeMetrics.shares, storeMetrics.shareCount, storeMetrics.share_count)
        };
        const matches = clean(unwrap(detail.note_id) || unwrap(detail.noteId) || unwrap(detail.id), 64) === noteId &&
          clean(unwrap(detail.title), 200) === title && sameBoundedBody(body, clean(unwrap(detail.body_summary) || unwrap(detail.desc) || unwrap(detail.description) || unwrap(detail.body), 2000)) &&
          clean(unwrap(storeAuthor.display_name) || unwrap(storeAuthor.nickname) || unwrap(storeAuthor.name), 100) === author &&
          clean(unwrap(storeAuthor.author_id) || unwrap(storeAuthor.userId) || unwrap(storeAuthor.id), 100) === authorId &&
          (!likes || metrics.likes === likes) && (!comments || metrics.comments === comments) &&
          (!collects || metrics.collects === collects) && (!shares || metrics.shares === shares);
        if (matches) matchedMetrics = metrics;
        return matches;
      });
    };
    const piniaReady = noteStores.length > 0;
    const storeMatched = noteStores.some(matchesStore);
    const interactionMetrics = matchedMetrics ? { likes: likes || matchedMetrics.likes, comments: comments || matchedMetrics.comments, collects: collects || matchedMetrics.collects, shares: shares || matchedMetrics.shares } : undefined;
    const publicInteractionMetrics = interactionMetrics ? {
      likes: interactionMetrics.likes || "未显示",
      comments: interactionMetrics.comments || "未显示",
      collects: interactionMetrics.collects || "未显示",
      shares: interactionMetrics.shares || "未显示"
    } : undefined;
    const metricsLocated = Boolean(likes && comments && collects && shares);
    const normalizedTitle = title || clean(body, 200);
    const normalized = storeMatched && normalizedTitle && body && author && authorId && profileUrl && publicInteractionMetrics && /^[A-Za-z0-9]+$/.test(noteId) ? { kind: "xiaohongshu_note_detail", canonical_url: canonicalUrl, note_id: noteId, title: normalizedTitle, summary: clean(body, 500), body_summary: body, author: { display_name: author, author_id: authorId, profile_url: profileUrl }, interaction_metrics: publicInteractionMetrics, source_status: metricsLocated ? "located" : "partially_located" } : undefined;
    return { origin: location.origin, pathname: location.pathname, ready: document.readyState !== 'loading', rendered_surface: rendered, login_like: login, challenge_like: challenge, vue_ready: Boolean(vue), pinia_ready: piniaReady, normalized };`
      : `
    const title = pick('.job-name, .job-detail-box h1, [class*="job-title"]', 200);
    const description = pick('.job-sec-text, .job-detail-section, [class*="job-description"]', 4000);
    const company = pick('.company-info .name, .company-name, [class*="company"] [class*="name"]', 200);
    const recruiter = pick('.boss-name, .job-boss-info .name, [class*="recruiter"] [class*="name"]', 100);
    const recruiterTitle = pick('.boss-info-attr, .job-boss-info .boss-info-attr, [class*="recruiter"] [class*="title"]', 100);
    const salary = pick('.salary, [class*="salary"]', 100);
    const locationText = pick('.location-address, [class*="job-address"], [class*="location"]', 100);
    const status = /职位已关闭|停止招聘|已下线/.test(text) ? "closed" : "available";
    const normalized = title && description && company && recruiter && recruiterTitle ? { kind: "boss_job_detail", canonical_url: canonicalUrl, title, summary: description.slice(0, 500), job: { title, description, status, ...(salary ? { salary } : {}), ...(locationText ? { location: locationText } : {}) }, company: { name: company }, recruiter: { name: recruiter, title: recruiterTitle }, source_status: "located" } : undefined;
    return { origin: location.origin, pathname: location.pathname, ready: document.readyState !== 'loading', rendered_surface: rendered, login_like: login, challenge_like: challenge, normalized };`}
  })()`;
  if (siteId === "boss") return `(() => {
    const text = document.body?.innerText || "";
    const challengeSurface = Array.from(document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="challenge"], [id*="challenge"], [class*="security-check"], [id*="security-check"]')).some((element) => {
      const view = document.defaultView;
      if (!view) return false;
      const style = view.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth;
    });
    const challenge = /验证码|安全验证|访问异常|captcha|challenge required|verification challenge|security check|verification required|complete verification/i.test(text) || challengeSurface;
    const login = /登录后|扫码登录|手机号登录/.test(text) || location.pathname.startsWith('/web/user/') || Boolean(document.querySelector('.login-dialog, [class*="login"] form, [class*="login"] [class*="qrcode"]'));
    const app = document.querySelector('#wrap, #app');
    const vue3App = app?.__vue_app__;
    const rootComponent = app?._vnode?.component;
    const mountedElement = rootComponent?.vnode?.el || rootComponent?.subTree?.el;
    const vue3Owned = typeof vue3App?.version === 'string' &&
      typeof vue3App?.config?.globalProperties === 'object' &&
      vue3App?._container === app &&
      rootComponent === vue3App?._instance &&
      rootComponent?.appContext?.app === vue3App &&
      Boolean(mountedElement && (mountedElement === app || app.contains(mountedElement)));
    const vue2Instance = app?.__vue__;
    const vue2Owned = Boolean(vue2Instance?._isMounted === true && vue2Instance?.$root === vue2Instance && vue2Instance?.$el === app);
    const vueOwned = vue3Owned || vue2Owned;
    const list = app?.querySelector('.job-list-box, .job-list, [class*="job-list"]');
    const cards = list ? Array.from(list.querySelectorAll('.job-card-wrapper, li.job-card-box, [ka^="search_list_"]')).slice(0, 20) : [];
    const validCards = cards.length > 0 && cards.every((card) => {
      if (!app.contains(list) || !list.contains(card)) return false;
      const jobName = (card.querySelector('.job-name, .job-title, [class*="job-name"]')?.textContent || '').trim();
      const companyName = (card.querySelector('.company-name, [class*="company-name"]')?.textContent || '').trim();
      const link = card.querySelector('a[href*="/job_detail/"]');
      let validLink = false;
      try {
        const href = new URL(link?.getAttribute('href') || '', location.origin);
        validLink = href.origin === location.origin && href.pathname.startsWith('/job_detail/');
      } catch {}
      return jobName.length > 0 && jobName.length <= 200 && companyName.length > 0 && companyName.length <= 200 && validLink;
    });
    return {
      origin: location.origin,
      pathname: location.pathname,
      search: location.search,
      ready: document.readyState !== 'loading' && vueOwned && Boolean(list) && app.contains(list),
      vue_owned: vueOwned,
      rendered_surface: vueOwned && Boolean(list) && app.contains(list) && validCards,
      job_card_count: cards.length,
      job_cards_valid: validCards,
      login_like: login,
      challenge_like: challenge
    };
  })()`;
  return `(() => {
    const expectedQuery = ${JSON.stringify(query)};
    const pinia = window.__PINIA__ || window.__pinia || document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia;
    const store = pinia?._s instanceof Map ? pinia._s.get("search") : undefined;
    const unwrap = (value) => value && typeof value === "object" && "value" in value ? value.value : value;
    const clean = (value, max) => {
      if (typeof value !== 'string') return '';
      const text = value.replace(/\\s+/g, ' ').trim();
      if (!text || text.length > max || /[\\u0000-\\u001f\\u007f]/.test(text)) return '';
      if (/(?:^|[^a-z0-9_-])(?:[a-z0-9_-]*token|cookie|authorization|password|passwd|secret|credential|profile[_-]?storage|raw[_-]?(?:dom|har)|network[_-]?response[_-]?body)\\s*[=:]\\s*\\S+/i.test(text) || /\\bbearer\\s+\\S+/i.test(text)) return '';
      return text;
    };
    const metric = (...values) => {
      for (const raw of values) {
        const value = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
        if (value && value.length <= 40 && /^[0-9０-９.,+\\-\\s万千百wWkKmM]+$/u.test(value)) return value;
      }
      return '';
    };
    const feeds = unwrap(store?.feeds);
    const boundedFeeds = Array.isArray(feeds) ? feeds.slice(0, 60) : [];
    const noteCandidate = (feed) => {
      const card = unwrap(feed?.noteCard) || unwrap(feed?.note_card) || {};
      const values = [unwrap(feed?.id), unwrap(feed?.noteId), unwrap(feed?.note_id), unwrap(card?.id), unwrap(card?.noteId), unwrap(card?.note_id)];
      const noteIds = values.filter((entry) => typeof entry === "string" && /^[a-f0-9]{24}$/i.test(entry)).map((entry) => entry.toLowerCase());
      const value = noteIds[0];
      const tokenValues = [unwrap(feed?.xsecToken), unwrap(feed?.xsec_token), unwrap(card?.xsecToken), unwrap(card?.xsec_token)];
      const tokens = tokenValues.filter((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 512 && /^[A-Za-z0-9_-]+={0,2}$/.test(entry));
      const xsecToken = tokens[0];
      const user = unwrap(card?.user) || {};
      const interactions = unwrap(card?.interactInfo) || unwrap(card?.interact_info) || {};
      const title = clean(unwrap(card?.displayTitle) || unwrap(card?.display_title) || unwrap(card?.title), 200);
      const author = clean(unwrap(user?.nickname) || unwrap(user?.displayName) || unwrap(user?.display_name) || unwrap(user?.name), 100);
      const likes = metric(unwrap(interactions?.likedCount), unwrap(interactions?.liked_count), unwrap(interactions?.likes));
      const comments = metric(unwrap(interactions?.commentCount), unwrap(interactions?.comment_count), unwrap(interactions?.comments));
      const collects = metric(unwrap(interactions?.collectedCount), unwrap(interactions?.collected_count), unwrap(interactions?.collects));
      const interactionMetrics = { ...(likes ? { likes } : {}), ...(comments ? { comments } : {}), ...(collects ? { collects } : {}) };
      const publicItem = title ? { title, ...(author ? { author_display_name: author } : {}), ...(Object.keys(interactionMetrics).length ? { interaction_metrics: interactionMetrics } : {}) } : undefined;
      const noteLike = Boolean(feed?.noteCard || feed?.note_card || values.some((entry) => entry !== undefined));
      if (!noteLike) return { kind: 'other' };
      if (new Set(noteIds).size > 1 || new Set(tokens).size > 1) return { kind: 'malformed' };
      return typeof value === "string"
        ? { kind: 'note', id: value, xsecToken, publicItem }
        : { kind: 'nonstandard' };
    };
    const candidates = boundedFeeds.map(noteCandidate);
    const hasMalformedFeed = candidates.some((candidate) => candidate.kind === 'malformed');
    const hasNonstandardFeed = candidates.some((candidate) => candidate.kind === 'nonstandard');
    const allFeedIds = candidates.filter((candidate) => candidate.kind === 'note' && candidate.publicItem).map((candidate) => candidate.id);
    const feedIds = Array.from(new Set(allFeedIds));
    const feedTokenEntries = candidates.filter((candidate) => candidate.kind === 'note' && candidate.xsecToken).map((candidate) => [candidate.id, candidate.xsecToken]);
    const hasCrossFeedTokenConflict = feedTokenEntries.some(([id, token], index) =>
      feedTokenEntries.slice(0, index).some(([previousId, previousToken]) => previousId === id && previousToken !== token));
    const feedTokens = new Map(feedTokenEntries);
    const feedPublicItems = new Map(candidates.filter((candidate) => candidate.kind === 'note' && candidate.publicItem).map((candidate) => [candidate.id, candidate.publicItem]));
    const anchors = typeof document.querySelectorAll === "function" ? Array.from(document.querySelectorAll('a[href*="/explore/"]')).slice(0, 60) : [];
    const pageTargets = new Map();
    for (const anchor of anchors) {
      try {
        const url = new URL(anchor.getAttribute?.('href') || anchor.href || '', location.origin);
        const match = new RegExp('^/explore/([a-f0-9]{24})$', 'i').exec(url.pathname);
        const validQuery = !url.hash &&
          Array.from(url.searchParams.keys()).every((key) => key === 'xsec_token' || key === 'xsec_source') &&
          url.searchParams.getAll('xsec_token').length <= 1 &&
          url.searchParams.getAll('xsec_source').length <= 1;
        if (url.origin !== location.origin || url.username || url.password || !match || !validQuery) continue;
        const id = match[1].toLowerCase();
        pageTargets.set(id, url.href);
      } catch {}
    }
    const detailUrls = feedIds.flatMap((id) => {
      const target = pageTargets.get(id);
      if (!target) return [];
      const targetUrl = new URL(target);
      const token = feedTokens.get(id);
      if (token && !targetUrl.searchParams.has('xsec_token')) {
        targetUrl.searchParams.set('xsec_token', token);
        targetUrl.searchParams.set('xsec_source', 'pc_search');
      }
      return [targetUrl.href];
    });
    const searchItems = detailUrls.flatMap((value) => {
      const id = new URL(value).pathname.split('/').at(-1);
      const item = feedPublicItems.get(id);
      return item ? [item] : [];
    });
    // A note card commonly exposes the same canonical target through both its
    // card wrapper and title link. Duplicate anchors are presentation detail,
    // not evidence that the feed contract changed.
    // The feed can include promoted or non-note entries alongside valid note
    // cards. Only the canonical ids and targets consumed below are trusted.
    const listFailure = hasMalformedFeed || hasCrossFeedTokenConflict
      ? 'page_not_ready'
      : feedIds.length === 0
      ? !hasNonstandardFeed && pageTargets.size === 0 ? 'empty_result' : 'page_not_ready'
      : detailUrls.length === 0 || searchItems.length !== detailUrls.length ? 'page_not_ready' : undefined;
    const listValid = listFailure === undefined && detailUrls.length > 0;
    const text = document.body?.innerText || "";
    const challengeSurface = typeof document.querySelectorAll === 'function' && Array.from(document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="challenge"], [id*="challenge"], [class*="security-check"], [id*="security-check"]')).some((element) => {
      const view = document.defaultView;
      if (!view) return false;
      const style = view.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth;
    });
    const challenge = /验证码|安全验证|访问异常|captcha|challenge required|verification challenge/i.test(text) || challengeSurface;
    const login = /登录后|扫码登录|手机号登录/.test(text) || location.pathname.startsWith('/login') || Boolean(document.querySelector?.('.login-dialog, [class*="login"] form, [class*="login"] [class*="qrcode"]'));
    return {
      origin: location.origin,
      pathname: location.pathname,
      search: location.search,
      ready: document.readyState !== 'loading',
      pinia_ready: unwrap(store?.searchValue) === expectedQuery && Array.isArray(feeds),
      list_valid: listValid,
      list_failure: listFailure,
      note_count: listValid ? detailUrls.length : 0,
      detail_urls: detailUrls,
      search_items: searchItems,
      login_like: login,
      challenge_like: challenge
    };
  })()`;
}

function hasExactPublicQuery(search: unknown, key: string, expected: string): boolean {
  if (typeof search !== "string") return false;
  const values = new URLSearchParams(search).getAll(key);
  return values.length === 1 && values[0] === expected;
}

function hasExactBossSearch(search: unknown, query: string, cityCode: string): boolean {
  if (typeof search !== "string") return false;
  const params = new URLSearchParams(search);
  return [...params.keys()].join(",") === "query,city" &&
    params.getAll("query").length === 1 && params.get("query") === query &&
    params.getAll("city").length === 1 && params.get("city") === cityCode;
}

function isOperationReadNetworkUrl(input: LocalProviderReadProbeInput, value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (input.operation_id === "xhs_read_note_detail" || input.operation_id === "boss_read_job_detail") return value === input.target_url;
  if (input.operation_id === "xhs_search_notes") {
    try {
      const observed = new URL(value);
      return observed.origin === "https://so.xiaohongshu.com" && observed.pathname === "/api/sns/web/v2/search/notes";
    } catch {
      return false;
    }
  }
  const expected = { pathname: "/wapi/zpgeek/search/joblist.json", query: "query" };
  const canonical = new URL(expected.pathname, input.expected_origin);
  canonical.searchParams.set(expected.query, input.query ?? "");
  canonical.searchParams.set("city", input.city_code ?? "");
  return value === canonical.href;
}

function bossJobDetailWapiUrl(targetUrl: string): string {
  const securityId = bossDetailTargetId(targetUrl);
  const url = new URL("/wapi/zpgeek/job/detail.json", "https://www.zhipin.com");
  url.searchParams.set("securityId", securityId);
  return url.href;
}

function isBossJobDetailWapiUrl(input: LocalProviderReadProbeInput, value: unknown): boolean {
  return input.operation_id === "boss_read_job_detail" && typeof value === "string" && value === bossJobDetailWapiUrl(input.target_url);
}

function bossDetailTargetId(targetUrl: string): string {
  return new URL(targetUrl).pathname.split("/").at(-1)?.replace(/\.html$/, "") ?? "";
}

interface BossJobSearchResponseSummary {
  status: "completed";
  business_code: 0;
  job_count: number;
  detail_urls?: string[];
}

interface XhsSearchResponseSummary {
  status: "completed";
  detail_urls: string[];
  search_items: XiaohongshuSearchPublicFields[];
}

type XhsSearchResponseFailure = {
  status: "unavailable";
  failure_class: "permission_denied" | "empty_result" | "field_missing" | "site_changed" | "network_resource_unavailable";
  message: string;
  retryable: boolean;
};

interface BossJobDetailResponseSummary {
  status: "completed";
  title: string;
  summary: string;
  description: string;
  job_status: string;
  salary?: string;
  location?: string;
  company_name: string;
  recruiter_name: string;
  recruiter_title: string;
}

type BossJobSearchResponseFailure = {
  status: "unavailable";
  failure_class: "permission_denied" | "empty_result" | "site_changed" | "network_resource_unavailable";
  message: string;
  retryable: boolean;
};

const MAX_BOSS_RESPONSE_BYTES = 512 * 1024;
const MAX_XHS_RESPONSE_BYTES = 512 * 1024;

async function readXhsSearchResponseSummary(
  client: CdpClient,
  requestId: string,
  domain: "Network" | "Fetch" = "Network"
): Promise<XhsSearchResponseSummary | XhsSearchResponseFailure> {
  try {
    const response = await client.send(`${domain}.getResponseBody`, { requestId });
    const encoded = typeof response.body === "string" ? response.body : "";
    const bytes = response.base64Encoded === true ? Buffer.from(encoded, "base64") : Buffer.from(encoded, "utf8");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_XHS_RESPONSE_BYTES) return xhsResponseFailure("network_resource_unavailable", "Xiaohongshu search response is empty or exceeds the summary read limit.", true);
    return summarizeXhsSearchResponse(bytes.toString("utf8"));
  } catch {
    return xhsResponseFailure("network_resource_unavailable", "Xiaohongshu search response summary could not be read.", true);
  }
}

export function summarizeXhsSearchResponse(body: string): XhsSearchResponseSummary | XhsSearchResponseFailure {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return xhsResponseFailure("site_changed", "Xiaohongshu search response is not valid JSON.", false); }
  if (!isPlainRecord(parsed)) return xhsResponseFailure("site_changed", "Xiaohongshu search response has an unexpected shape.", false);
  if (parsed.success === false || typeof parsed.code === "number" && parsed.code !== 0) return xhsResponseFailure("permission_denied", "Xiaohongshu search response rejected the request.", false);
  if (parsed.success !== true || parsed.code !== 0) return xhsResponseFailure("site_changed", "Xiaohongshu search response has no explicit success state.", false);
  const data = isPlainRecord(parsed.data) ? parsed.data : null;
  if (!data || !Array.isArray(data.items)) return xhsResponseFailure("site_changed", "Xiaohongshu search response has no item list.", false);
  if (data.items.length === 0) return xhsResponseFailure("empty_result", "Xiaohongshu search returned no notes.", false);
  const detail_urls: string[] = [];
  const search_items: XiaohongshuSearchPublicFields[] = [];
  let missingPublicTitle = false;
  for (const item of data.items.slice(0, 60)) {
    if (!isPlainRecord(item)) continue;
    const card = isPlainRecord(item.note_card) ? item.note_card : isPlainRecord(item.noteCard) ? item.noteCard : {};
    const noteIds = [item.id, item.note_id, item.noteId, card.id, card.note_id, card.noteId]
      .filter((value): value is string => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value))
      .map((value) => value.toLowerCase());
    if (new Set(noteIds).size > 1) return xhsResponseFailure("site_changed", "Xiaohongshu search item identifiers do not match.", false);
    const tokens = [item.xsec_token, item.xsecToken, card.xsec_token, card.xsecToken]
      .filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && /^[A-Za-z0-9_-]+={0,2}$/.test(value));
    if (new Set(tokens).size > 1) return xhsResponseFailure("site_changed", "Xiaohongshu search item navigation tokens do not match.", false);
    const noteId = noteIds[0];
    const token = tokens[0];
    if (typeof noteId !== "string" || typeof token !== "string") continue;
    const title = firstSafeSearchText([card.display_title, card.displayTitle, card.title], 200);
    if (!title) {
      missingPublicTitle = true;
      continue;
    }
    const user = isPlainRecord(card.user) ? card.user : {};
    const author = firstSafeSearchText([user.nickname, user.display_name, user.displayName, user.name], 100);
    const interactions = isPlainRecord(card.interact_info) ? card.interact_info : isPlainRecord(card.interactInfo) ? card.interactInfo : {};
    const interaction_metrics = compactMetrics({
      likes: firstMetric([interactions.liked_count, interactions.likedCount, interactions.likes]),
      comments: firstMetric([interactions.comment_count, interactions.commentCount, interactions.comments]),
      collects: firstMetric([interactions.collected_count, interactions.collectedCount, interactions.collects])
    });
    const target = new URL(`/explore/${noteId.toLowerCase()}`, "https://www.xiaohongshu.com");
    target.searchParams.set("xsec_token", token);
    target.searchParams.set("xsec_source", "pc_search");
    detail_urls.push(target.href);
    search_items.push({
      title,
      ...(author ? { author_display_name: author } : {}),
      ...(interaction_metrics ? { interaction_metrics } : {})
    });
  }
  return detail_urls.length > 0
    ? { status: "completed", detail_urls, search_items }
    : missingPublicTitle
    ? xhsResponseFailure("field_missing", "Xiaohongshu search items have no bounded public title.", false)
    : xhsResponseFailure("site_changed", "Xiaohongshu search items have no valid detail navigation targets.", false);
}

function firstSafeSearchText(values: unknown[], max: number): string | undefined {
  return values.find((value): value is string => safeSearchPublicText(value, max));
}

function safeSearchPublicText(value: unknown, max: number): value is string {
  return boundedText(value, max) &&
    !/(?:^|[^a-z0-9_-])(?:[a-z0-9_-]*token|cookie|authorization|password|passwd|secret|credential|profile[_-]?storage|raw[_-]?(?:dom|har)|network[_-]?response[_-]?body)\s*[=:]\s*\S+/i.test(value) &&
    !/\bbearer\s+\S+/i.test(value);
}

function firstMetric(values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = typeof value === "number" && Number.isFinite(value) && value >= 0
      ? String(value)
      : typeof value === "string" ? value.trim() : "";
    if (normalized && normalized.length <= 40 && /^[0-9０-９.,+\-\s万千百wWkKmM]+$/u.test(normalized)) return normalized;
  }
  return undefined;
}

function compactMetrics(metrics: XiaohongshuSearchPublicFields["interaction_metrics"]): XiaohongshuSearchPublicFields["interaction_metrics"] {
  const entries = Object.entries(metrics ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function xhsResponseFailure(failure_class: XhsSearchResponseFailure["failure_class"], message: string, retryable: boolean): XhsSearchResponseFailure {
  return { status: "unavailable", failure_class, message, retryable };
}

async function readBossJobSearchResponseSummary(client: CdpClient, requestId: string): Promise<BossJobSearchResponseSummary | BossJobSearchResponseFailure> {
  try {
    const response = await client.send("Network.getResponseBody", { requestId });
    const encoded = typeof response.body === "string" ? response.body : "";
    const bytes = response.base64Encoded === true ? Buffer.from(encoded, "base64") : Buffer.from(encoded, "utf8");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BOSS_RESPONSE_BYTES) return bossResponseFailure("network_resource_unavailable", "BOSS WAPI response is empty or exceeds the summary read limit.", true);
    return summarizeBossJobSearchResponse(bytes.toString("utf8"));
  } catch {
    return bossResponseFailure("network_resource_unavailable", "BOSS WAPI response summary could not be read.", true);
  }
}

async function readBossJobDetailResponseSummary(client: CdpClient, requestId: string, targetId: string): Promise<BossJobDetailResponseSummary | BossJobSearchResponseFailure> {
  try {
    const response = await client.send("Network.getResponseBody", { requestId });
    const encoded = typeof response.body === "string" ? response.body : "";
    const bytes = response.base64Encoded === true ? Buffer.from(encoded, "base64") : Buffer.from(encoded, "utf8");
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BOSS_RESPONSE_BYTES) return bossResponseFailure("network_resource_unavailable", "BOSS detail WAPI response is empty or exceeds the summary read limit.", true);
    return summarizeBossJobDetailResponse(bytes.toString("utf8"), targetId);
  } catch {
    return bossResponseFailure("network_resource_unavailable", "BOSS detail WAPI response summary could not be read.", true);
  }
}

export function summarizeBossJobDetailResponse(body: string, targetId: string): BossJobDetailResponseSummary | BossJobSearchResponseFailure {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return bossResponseFailure("site_changed", "BOSS detail WAPI response is not valid JSON.", true);
  }
  if (!isPlainRecord(value) || value.code !== 0) return bossResponseFailure("permission_denied", "BOSS detail WAPI rejected the read request.", false);
  const zpData = isPlainRecord(value.zpData) ? value.zpData : null;
  const job = zpData && isPlainRecord(zpData.jobInfo) ? zpData.jobInfo : null;
  const company = zpData && isPlainRecord(zpData.brandComInfo) ? zpData.brandComInfo : null;
  const recruiter = zpData && isPlainRecord(zpData.bossInfo) ? zpData.bossInfo : null;
  if (!zpData || !job || !company || !recruiter) return bossResponseFailure("site_changed", "BOSS detail WAPI public summary shape is unavailable.", true);
  const internalIds = [zpData.securityId, zpData.encryptJobId, job.securityId, job.encryptJobId].filter((entry): entry is string => typeof entry === "string");
  if (!/^[A-Za-z0-9_-]+$/.test(targetId) || !internalIds.includes(targetId)) return bossResponseFailure("site_changed", "BOSS detail WAPI target binding does not match the selected result.", false);
  const title = publicResponseText(job.jobName ?? job.title, 200);
  const description = publicResponseText(job.postDescription ?? job.description ?? job.jobDescription, 4000);
  const job_status = publicResponseText(job.jobStatus ?? job.status, 100);
  const company_name = publicResponseText(company.brandName ?? company.name, 200);
  const recruiter_name = publicResponseText(recruiter.name ?? recruiter.bossName, 100);
  const recruiter_title = publicResponseText(recruiter.title ?? recruiter.bossTitle, 100);
  if (!title || !description || !job_status || !company_name || !recruiter_name || !recruiter_title) return bossResponseFailure("site_changed", "BOSS detail WAPI required public fields are unavailable.", true);
  const salary = publicResponseText(job.salaryDesc ?? job.salary, 100);
  const location = publicResponseText(job.locationName ?? job.location, 100);
  return {
    status: "completed",
    title,
    summary: description.slice(0, 500),
    description,
    job_status,
    ...(salary ? { salary } : {}),
    ...(location ? { location } : {}),
    company_name,
    recruiter_name,
    recruiter_title
  };
}

function publicResponseText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, max);
  return normalized || null;
}

export function summarizeBossJobSearchResponse(body: string): BossJobSearchResponseSummary | BossJobSearchResponseFailure {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return bossResponseFailure("site_changed", "BOSS WAPI response is not valid JSON.", true);
  }
  if (!isPlainRecord(value) || value.code !== 0) return bossResponseFailure("permission_denied", "BOSS WAPI rejected the read request.", false);
  const zpData = isPlainRecord(value.zpData) ? value.zpData : null;
  if (!zpData || !Array.isArray(zpData.jobList)) return bossResponseFailure("site_changed", "BOSS WAPI job list shape is unavailable.", true);
  const jobCount = zpData.jobList.filter(isPlainRecord).length;
  if (jobCount === 0) return bossResponseFailure("empty_result", "BOSS WAPI returned no jobs for the bound query and city.", false);
  const detail_urls = zpData.jobList.filter(isPlainRecord).slice(0, 15).flatMap((job) => {
    const securityId = typeof job.securityId === "string" ? job.securityId : typeof job.encryptJobId === "string" ? job.encryptJobId : "";
    return /^[A-Za-z0-9_-]+$/.test(securityId) ? [`https://www.zhipin.com/job_detail/${securityId}.html`] : [];
  });
  return detail_urls.length > 0
    ? { status: "completed", business_code: 0, job_count: jobCount, detail_urls }
    : { status: "completed", business_code: 0, job_count: jobCount };
}

function bossResponseFailure(failure_class: BossJobSearchResponseFailure["failure_class"], message: string, retryable: boolean): BossJobSearchResponseFailure {
  return { status: "unavailable", failure_class, message, retryable };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readOperationPageFacts(targetUrl: string): LocalProviderPageFacts {
  const evidence_ref = opaqueRef("validation");
  const publicUrl = publicReadOperationUrl(targetUrl);
  return {
    current_url: publicUrl,
    title: null,
    status: "ready",
    facts: [
      { key: "page.current_url", source: "observed", value: publicUrl, evidence_ref },
      { key: "page.title", source: "observed", value: "not_read", evidence_ref },
      { key: "page.status", source: "validation_evidence", value: "operation_probe_ready", evidence_ref }
    ]
  };
}

function publicReadOperationUrl(targetUrl: string): string {
  const url = new URL(targetUrl);
  if (url.origin === "https://www.xiaohongshu.com" && /^\/explore\/[a-f0-9]{24}$/i.test(url.pathname)) {
    url.search = "";
    url.hash = "";
  }
  return url.href;
}

async function readPageFacts(port: string, requested_url: string, signal?: AbortSignal): Promise<LocalProviderPageFacts> {
  try {
    const page = await activePage(port, requested_url, signal);
    return readTargetPageFacts(page, requested_url, signal);
  } catch (cause) {
    return unavailablePageFacts("cdp_unavailable", requested_url, cause);
  }
}

export async function readTargetPageFacts(page: CdpPageTarget | undefined, requested_url: string, signal?: AbortSignal): Promise<LocalProviderPageFacts> {
  if (!page) return unavailablePageFacts("url_unreachable", requested_url, new Error("Requested page target is unavailable."));
  let observed: { title: string; url: string } | null = null;
  if (page?.webSocketDebuggerUrl) {
    try {
      observed = await readPageTitle(page.webSocketDebuggerUrl, requested_url, signal);
    } catch {
      // Page-list facts remain useful for login/challenge handoff when a page target rejects deeper CDP commands.
    }
  }
  return readyPage(observed?.url ?? page?.url ?? requested_url, observed?.title ?? page?.title ?? null);
}

async function captureProviderScreenshot(port: string, requested_url: string): Promise<LocalProviderScreenshotFacts | RuntimeErrorFact> {
  try {
    const page = await activePage(port, requested_url);
    if (!page.webSocketDebuggerUrl) return error("cdp_unavailable", "Active page has no CDP websocket.", true);
    const data = await withCdp(page.webSocketDebuggerUrl, async (client) => {
      await client.send("Page.bringToFront");
      await client.send("Page.enable");
      const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      return String(result.data ?? "");
    });
    return screenshotFacts(Buffer.from(data, "base64"));
  } catch (cause) {
    return error("cdp_unavailable", cause instanceof Error ? cause.message : "Unable to capture screenshot.", true);
  }
}

async function activePage(port: string, requested_url: string, signal?: AbortSignal, preferredPageId?: string): Promise<CdpPageTarget> {
  const readinessSignal = signal ?? AbortSignal.timeout(1000);
  while (true) {
    readinessSignal.throwIfAborted();
    const page = selectPage(await pageTargets(port, readinessSignal), requested_url, preferredPageId);
    if (page && (requested_url === "about:blank" || (page.url && page.url !== "about:blank"))) return page;
    await abortableDelay(25, readinessSignal);
  }
}

async function pageTargets(port: string, signal?: AbortSignal): Promise<CdpPageTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal });
  if (!response.ok) throw new Error(`CDP page-list probe failed: ${response.status}`);
  return (await response.json()) as CdpPageTarget[];
}

export function selectPage(pages: CdpPageTarget[], requested_url?: string, preferredPageId?: string) {
  if (requested_url) {
    const pageTargets = pages.filter((candidate) => candidate.type === "page");
    const creatorImageTextPages = pageTargets.filter((candidate) => isCreatorImageTextRedirect(candidate.url, requested_url));
    const preferredImageTextPage = creatorImageTextPages.find((candidate) => candidate.id === preferredPageId);
    if (preferredImageTextPage) return preferredImageTextPage;
    if (creatorImageTextPages[0]) return creatorImageTextPages[0];
    const preferred = pageTargets.find((candidate) => candidate.id === preferredPageId &&
      (candidate.url === requested_url || urlsReferToSamePage(candidate.url, requested_url)));
    if (preferred) return preferred;
    return pages.find((candidate) => candidate.type === "page" && candidate.url === requested_url) ??
      pages.find((candidate) => candidate.type === "page" && urlsReferToSamePage(candidate.url, requested_url)) ??
      (pageTargets.length === 1 ? pageTargets[0] : undefined);
  }
  return pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl) ??
    pages.find((candidate) => candidate.type === "page") ??
    pages[0];
}

export function selectCleanupPage(pages: CdpPageTarget[]) {
  const candidates = pages.filter((candidate) => candidate.type === "page" && isCreatorUpdateUrl(candidate.url ?? ""));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function isCreatorImageTextRedirect(candidateUrl: string | undefined, requestedUrl: string) {
  try {
    const candidate = new URL(candidateUrl ?? "");
    const requested = new URL(requestedUrl);
    return requested.origin === "https://creator.xiaohongshu.com" && requested.pathname.replace(/\/$/, "") === "/publish/publish" &&
      !requested.search && candidate.search !== "" && sameWritePrecheckUrl(candidateUrl, requestedUrl);
  } catch {
    return false;
  }
}

function urlsReferToSamePage(candidate_url?: string, requested_url?: string): boolean {
  if (!candidate_url || !requested_url) return false;
  try {
    const candidate = new URL(candidate_url);
    const requested = new URL(requested_url);
    if (!["http:", "https:"].includes(candidate.protocol) || !["http:", "https:"].includes(requested.protocol)) return false;
    return candidate.origin === requested.origin && candidate.hash === requested.hash && (
      (candidate.pathname === requested.pathname &&
        (normalizedQuery(candidate) === normalizedQuery(requested) || isBoundedXiaohongshuSearchRedirect(candidate, requested))) ||
      (candidate.origin === "https://creator.xiaohongshu.com" &&
        ["/publish/publish", "/publish/publish/"].includes(candidate.pathname) &&
        sameWritePrecheckUrl(candidate_url, requested_url))
    );
  } catch {
    return candidate_url === requested_url;
  }
}

function isBoundedXiaohongshuSearchRedirect(candidate: URL, requested: URL): boolean {
  if (
    candidate.origin !== "https://www.xiaohongshu.com" ||
    !["/search_result", "/search_result/"].includes(candidate.pathname) ||
    requested.searchParams.has("type") ||
    candidate.searchParams.getAll("type").join() !== "51"
  ) return false;
  const withoutType = new URL(candidate);
  withoutType.searchParams.delete("type");
  return normalizedQuery(withoutType) === normalizedQuery(requested);
}

function normalizedQuery(url: URL): string {
  return JSON.stringify([...url.searchParams.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)));
}

async function readPageTitle(webSocketUrl: string, requested_url: string, signal?: AbortSignal): Promise<{ title: string; url: string } | null> {
  return withCdp(webSocketUrl, async (client) => {
    await client.send("Runtime.enable");
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await client.send("Runtime.evaluate", {
        expression: "({ title: document.title, url: location.href, readyState: document.readyState })",
        returnByValue: true
      });
      const value = (result.result as { value?: { title?: string; url?: string; readyState?: string } } | undefined)?.value;
      const url = value?.url ?? "";
      const navigated = url === requested_url || (url !== "" && url !== "about:blank");
      if (navigated && (value?.title || value?.readyState === "complete")) return { title: value.title ?? "", url };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }, signal);
}

async function withCdp<T>(webSocketUrl: string, callback: (client: CdpClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const ws = new WebSocket(webSocketUrl);
  ws.binaryType = "arraybuffer";
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      ws.close();
      finish(new Error("CDP probe aborted."));
    };
    const onOpen = () => finish();
    const onError = () => finish(new Error("CDP websocket connection failed."));
    const timer = setTimeout(() => {
      ws.close();
      finish(new Error("Timed out connecting to CDP websocket."));
    }, 5000);
    ws.addEventListener("open", onOpen, { once: true });
    ws.addEventListener("error", onError, { once: true });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
  const client = new CdpClient(ws, signal);
  try {
    return await callback(client);
  } finally {
    client.dispose();
    ws.close();
  }
}

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, {
    resolve: (result: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private readonly listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();

  constructor(private readonly ws: WebSocket, private readonly signal?: AbortSignal) {
    ws.addEventListener("message", this.handleMessage);
    signal?.addEventListener("abort", this.handleAbort, { once: true });
  }

  on(method: string, listener: (params: Record<string, unknown>) => void): () => void {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(method);
    };
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 20000): Promise<Record<string, unknown>> {
    if (this.signal?.aborted) return Promise.reject(new Error(`CDP command aborted: ${method}`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, Math.max(1, timeoutMs));
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  private readonly handleMessage = (event: MessageEvent) => {
    const text = typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer).toString("utf8");
    const payload = JSON.parse(text) as { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string } };
    if (payload.id !== undefined) {
      const pending = this.pending.get(payload.id);
      if (!pending) return;
      this.pending.delete(payload.id);
      clearTimeout(pending.timer);
      if (payload.error) pending.reject(new Error(payload.error.message ?? "CDP command failed."));
      else pending.resolve(payload.result ?? {});
      return;
    }
    if (!payload.method) return;
    for (const listener of this.listeners.get(payload.method) ?? []) listener(payload.params ?? {});
  };

  private readonly handleAbort = () => {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error("CDP probe aborted."));
    }
    this.ws.close();
  };

  dispose(): void {
    this.signal?.removeEventListener("abort", this.handleAbort);
    this.ws.removeEventListener("message", this.handleMessage);
    this.handleAbort();
  }
}

function fixtureScreenshot(seed: string): LocalProviderScreenshotFacts {
  return screenshotFacts(Buffer.from(`fixture screenshot for ${seed}`, "utf8"));
}

function screenshotFacts(bytes: Buffer): LocalProviderScreenshotFacts {
  const evidence_ref = opaqueRef("validation");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    screenshot_ref: opaqueRef("screenshot"),
    mime_type: "image/png",
    byte_length: bytes.byteLength,
    sha256,
    captured_at: new Date().toISOString(),
    facts: [
      { key: "screenshot.capture", source: "validation_evidence", value: "ready", evidence_ref },
      { key: "screenshot.mime_type", source: "observed", value: "image/png", evidence_ref },
      { key: "screenshot.byte_length", source: "observed", value: String(bytes.byteLength), evidence_ref },
      { key: "screenshot.sha256", source: "validation_evidence", value: sha256, evidence_ref }
    ]
  };
}

function unavailablePageFacts(code: RuntimeErrorCode, requested_url: string, cause: unknown): LocalProviderPageFacts {
  const current_error = error(code, cause instanceof Error ? cause.message : `Unable to open ${requested_url}.`, true);
  return {
    current_url: null,
    title: null,
    status: "unavailable",
    error: current_error,
    facts: [
      { key: "page.current_url", source: "observed", value: "unavailable" },
      { key: "page.title", source: "observed", value: "unavailable" },
      { key: "page.status", source: "observed", value: code }
    ]
  };
}

async function closeBrowser(child: ChildProcess, profileDir: string, removeProfileDir: boolean): Promise<void> {
  if (!hasExited(child)) child.kill("SIGTERM");
  await waitForExit(child, 1000);
  if (!hasExited(child)) child.kill("SIGKILL");
  await waitForExit(child, 500);
  if (removeProfileDir) await rm(profileDir, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (hasExited(child)) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
