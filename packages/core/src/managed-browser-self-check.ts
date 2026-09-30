import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileManagedAccessStore, managedFileOperations, managedOperations, managedBusinessTargetOperations, managedInteractionOperations, managedScopeConfirmationSchemaVersion } from "./managed-access.js";
import { createManagedBrowserService } from "./managed-browser.js";
import { projectManagedProviderCatalogFacts } from "./managed-provider-facts.js";
import { createFileRunRecordStore } from "./run-record-store.js";
import { createFileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import { createFileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import { executionPolicyMutationSchemaVersion } from "./execution-policy-config.js";
import { createManagedRecoveryService } from "./profile-recovery.js";

const directory = await mkdtemp(join(tmpdir(), "managed-browser-check-"));
const profiles: Record<string, unknown>[] = [];
let creates = 0;
let malformedCreateReply = false;
let identityEnvironmentReads = 0;
let managedOperationCatalogReads = 0;
let copies = 0;
let dropCopyResponse = false;
let malformedCopyReply = false;
let malformedUnrelatedProfile = false;
let archives = 0;
let malformedArchiveReply = false;
let rejectArchiveAsActive = false;
let archiveReceiptReads = 0;
const activeArchiveReceiptKeys = new Set<string>();
let deletes = 0;
let dropDeleteResponse = false;
let repairDelete = false;
const mutationReceipt = (input: {
  operation: string; status: "completed" | "rejected" | "repair_required"; identity_environment_ref?: unknown;
  source_identity_environment_ref?: unknown; record?: unknown; provider_selection?: unknown;
  effects?: { index: string; local_data: string; login_state: string }; failure?: { code: string; retryable: boolean; recovery_actions: string[] } | null;
}) => ({
  schema_version: "harbor-identity-environment-mutation/v1", operation: input.operation, status: input.status,
  identity_environment_ref: input.identity_environment_ref ?? null, source_identity_environment_ref: input.source_identity_environment_ref ?? null,
  record: input.record ?? null, provider_selection: input.provider_selection ?? null,
  effects: input.effects ?? { index: "unchanged", local_data: "unchanged", login_state: "unchanged" },
  failure: input.failure ?? null,
  public_boundary: { output: "status_and_redacted_refs_only", raw_material: "not_exposed", not_exposed: ["cookie", "token", "password", "profile_storage", "local_path"] }
});
let navigations = 0, observations = 0, sessionReads = 0;
let diagnostics = 0, lockAttempts = 0, dropDiagnosticsResponse = false;
let capabilityDescriptions = 0;
const forwardedCapabilityOrigins: string[][] = [];
  let capabilityDescriptionMode: "normal" | "human" | "stale" | "stopped" | "unknown" | "page_selection" = "normal";
  let capabilityDescriptionShape: "valid" | "wrong_schema" | "wrong_operation" | "wrong_profile" | "unknown_state" | "profile_missing" | "provider_evidence_stale" = "valid";
  let afterCapabilityDescription: (() => Promise<void>) | undefined;
const forwardedDiagnosticsOrigins: string[][] = [];
let managedSession: Record<string, unknown>;
let sessionStopped = false;
let dropResponse = false, omitProviderSelection = false;
let metadataUpdates = 0, dropMetadataResponse = false, malformedMetadataReply = false;
let interactions = 0, dropInteractionResponse = false, refuseInteraction = false, waitConditionTimeout = false, crossOriginInteraction = false;
const forwardedInteractionOrigins: string[][] = [];
const forwardedInteractionInputs: Record<string, unknown>[] = [];
const receipts = new Map<string, unknown>();
let pageLists = 0, pageMutations = 0, dropPageResponse = false;
const pageReceipts = new Map<string, Record<string, unknown>>();
let accountBindingPosts = 0, malformedAccountBindingResponse = false;
const accountBindingReceipts = new Map<string, Record<string, unknown>>();
let environmentReads = 0, environmentUpdates = 0, dropEnvironmentResponse = false, environmentUnavailable = false;
let environmentConfigured = { timezone: "UTC", language: "en-US", viewport: "1280x720" };
let environmentEffective = { ...environmentConfigured };
let environmentPending: Record<string, string> | null = null;
const environmentReceipts = new Map<string, Record<string, unknown>>();
let recoveryExpectedProfileRef: string | undefined;
let afterCreate: (() => Promise<void>) | undefined;
let afterProfileList: (() => Promise<void>) | undefined;
let afterIdentityEnvironmentSnapshot: (() => Promise<void>) | undefined;
let principalId: string | undefined;
let browserPreference: string | null = null, preferenceMutations = 0, dropPreferenceResponse = false;
const preferenceReceipts = new Map<string, unknown>();
let providerCatalogReads = 0;
const providerCatalog = {
  schema_version: "harbor-browser-provider-status/v0",
  providers: [
    {
      provider_id: "cloakbrowser", display_name: "CloakBrowser", role: "restricted_fallback", selectable: true, project_recommended: false,
      availability: { state: "unavailable", unavailable_reason: "provider_not_installed" },
      install: { status: "missing", path: "/private/provider/path", launchability: "not_checked", executable_sha256: "private-hash" },
      capabilities: [{ key: "persistent_profile", state: "limited", source: "configured", note: "專用 Profile 能力有限。" }],
      limitations: ["缺少已安裝的執行環境。"], download_guide: { primary_url: "https://example.test", install_hint: "not exposed" },
      diagnostics: [{ summary: "not exposed" }]
    },
    {
      provider_id: "chrome_official", display_name: "官方 Chrome", role: "qualification", selectable: true, project_recommended: false,
      availability: { state: "available", unavailable_reason: null },
      install: { status: "installed", path: "/private/chrome/path", launchability: "launchable", executable_sha256: "private-hash" },
      capabilities: [{ key: "persistent_profile", state: "supported", source: "validation_evidence", note: "Harbor 管理独立持久化 Profile。" }],
      limitations: [], download_guide: { primary_url: "https://example.test", install_hint: "not exposed" },
      diagnostics: []
    },
    {
      // The Camoufox CDP note and limitations mirror Harbor's official capability catalog.
      provider_id: "camoufox", display_name: "Camoufox", role: "primary", selectable: true, project_recommended: true,
      availability: { state: "available", unavailable_reason: null },
      install: { status: "installed", path: "/private/camoufox/path", launchability: "launchable", executable_sha256: "private-hash" },
      capabilities: [{ key: "cdp", state: "unsupported", source: "validation_evidence", note: "原版 JSONL Driver 不暴露 CDP endpoint；Harbor 使用公开 Playwright Page。" }],
      limitations: [
        "仅接受 owner 提供且重新验证的 official_release source、Camoufox 0.5.6、browser 152.0.4-beta.30、Playwright 1.60.0 和 properties hash。",
        "Driver 只调用公开 launch_options、sync_playwright、persistent context 和 Page API；不恢复旧 patched/native adapter/browser builder。",
        "popup 首请求在无法建立可信 Page 归属时本地拒绝；原生焦点是可选 Viewer，不能替代 task Page。",
        "不暴露 CDP、原始 endpoint、raw DOM、HAR 或反检测成功保证。"
      ], download_guide: { primary_url: "https://example.test", install_hint: "not exposed" },
      diagnostics: []
    }
  ], excluded_providers: []
};
const requestedProviders: Array<string | undefined> = [];
const preferenceSnapshot = (providerId: string | null) => ({
  schema_version: "harbor-browser-provider-preference/v1",
  project_recommendation: { provider_id: "camoufox", availability: "available", unavailable_reason: null },
  user_creation_default: { provider_id: providerId, availability: providerId ? "available" : "unset", unavailable_reason: null, updated_at: providerId ? new Date().toISOString() : null }
});
const server = createServer((req, res) => { void (async () => {
  assert.equal(req.headers.authorization, "Bearer fixture-supervisor");
  let value: unknown;
  if (req.url === "/runtime/managed-operation-catalog") { managedOperationCatalogReads++; value = {
    schema_version: "webenvoy.harbor-operation-catalog.v0", catalog_ref: "harbor://managed-operations", catalog_version: "10",
    operations: [...managedOperations.filter(op => !(managedInteractionOperations as readonly string[]).includes(op) && !(managedBusinessTargetOperations as readonly string[]).includes(op) && !op.startsWith("provider.preference.")).map(operation_id => ({ operation_id, category: (managedFileOperations as readonly string[]).includes(operation_id) || operation_id === "environment.update" || operation_id === "recovery.request" || ["page.open", "page.activate", "page.close", "page.navigate", "page.reload", "page.back", "page.forward"].includes(operation_id) ? "prepare" : operation_id === "profile.delete" ? "destructive" : ["profile.create", "profile.copy_environment", "profile.archive", "profile.metadata.update", "account.bind"].includes(operation_id) ? "commit" : "read", target_scope: { target_types: ["managed_profile"] }, resource_requirement_refs: (managedFileOperations as readonly string[]).includes(operation_id) ? ["harbor://managed-profile", "harbor://controlled-page", "harbor://managed-file"] : ["harbor://managed-profile"] })),
      ...["provider.preference.read", "provider.preference.set", "provider.preference.clear"].map(operation_id => ({ operation_id, category: operation_id === "provider.preference.read" ? "read" : "commit", target_scope: { target_types: ["provider_preference"] }, resource_requirement_refs: ["harbor://browser-provider-preference"] })),
      ...["controlled-page.observe", "controlled-page.interact"].map(operation_id => ({ operation_id, category: operation_id === "controlled-page.interact" ? "prepare" : "read", target_scope: { target_types: ["managed_profile"] }, resource_requirement_refs: ["harbor://managed-profile", "harbor://controlled-page"] }))]
  }; }
  else if (req.url === "/runtime/capabilities/describe") {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body) as { operation: string; profile_ref: string; authorized_origins: string[]; runtime_session_ref?: string; page_id?: string; page_ref?: string; document_generation?: number };
    forwardedCapabilityOrigins.push(input.authorized_origins);
    capabilityDescriptions++;
    const state = capabilityDescriptionMode;
    await afterCapabilityDescription?.();
    afterCapabilityDescription = undefined;
    value = {
      schema_version: capabilityDescriptionShape === "wrong_schema" ? "harbor-capability-description/v2" : "harbor-capability-description/v1",
      operation: capabilityDescriptionShape === "wrong_operation" ? "instance.read" : input.operation,
      profile_ref: capabilityDescriptionShape === "wrong_profile" ? "profile:other" : input.profile_ref,
      provider: { state: capabilityDescriptionShape === "unknown_state" ? "future_state" : state === "unknown" || capabilityDescriptionShape === "provider_evidence_stale" ? "unknown" : "supported", provider_id: "camoufox", reason_codes: state === "unknown" ? ["provider_not_qualified"] : capabilityDescriptionShape === "provider_evidence_stale" ? ["provider_evidence_stale"] : capabilityDescriptionShape === "profile_missing" ? ["profile_missing"] : [], limitations: [], facts_at: "2026-09-09T00:00:00.000Z" },
      availability: {
        state: capabilityDescriptionShape === "unknown_state" ? "future_state" : state === "unknown" ? "unknown" : state === "normal" ? "no_known_blocker" : "blocked",
        reason_codes: state === "human" ? ["human_control"] : state === "stale" ? ["stale_reference"] : state === "page_selection" ? ["page_selection_required"] : state === "stopped" ? ["instance_not_running"] : state === "unknown" ? ["runtime_facts_unavailable"] : [],
        facts_at: "2026-09-09T00:00:00.000Z"
      },
      execution_checks: ["reauthorize", "verify_page_and_target"]
    };
  }
  else if (req.url === "/runtime/browser-provider-preference") {
    if (req.method === "POST") {
      let body = ""; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body) as { operation: "set" | "clear"; idempotency_key: string; provider_id?: string };
      preferenceMutations++;
      browserPreference = input.operation === "set" ? input.provider_id! : null;
      value = { schema_version: "harbor-browser-provider-preference-mutation/v1", operation: input.operation, status: "completed", preference: preferenceSnapshot(browserPreference), failure: null };
      preferenceReceipts.set(input.idempotency_key, value);
      if (dropPreferenceResponse) { req.socket.destroy(); return; }
    } else value = preferenceSnapshot(browserPreference);
  } else if (req.url === "/runtime/browser-providers") {
    providerCatalogReads++;
    value = providerCatalog;
  }
  else if (req.url?.startsWith("/runtime/browser-provider-preference-mutations/")) value = preferenceReceipts.get(decodeURIComponent(req.url.split("/").at(-1)!));
  else if (req.url === "/runtime/identity-environment-mutations") {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    if (input.operation === "profile.metadata.update") {
      const record = profiles.find(item => item.identity_environment_ref === input.identity_environment_ref);
      if (!record) value = mutationReceipt({ operation: input.operation, status: "rejected", identity_environment_ref: input.identity_environment_ref,
        failure: { code: "identity_environment_missing", retryable: true, recovery_actions: ["refresh_identity_list"] } });
      else {
        metadataUpdates++;
        if (input.name !== undefined) record.name = input.name.trim();
        if (input.tags !== undefined) record.tags = [...new Set(input.tags.map((tag: string) => tag.trim()))];
        value = mutationReceipt({ operation: input.operation, status: "completed", identity_environment_ref: input.identity_environment_ref, record,
          effects: { index: "updated", local_data: "unchanged", login_state: "unchanged" } });
      }
      receipts.set(input.idempotency_key, value);
      if (malformedMetadataReply) { res.setHeader("content-type", "application/json"); res.end("[]"); return; }
      if (dropMetadataResponse) { req.socket.destroy(); return; }
    } else if (input.operation === "archive") {
      archives++;
      const record = profiles.find(item => item.identity_environment_ref === input.identity_environment_ref);
      if (rejectArchiveAsActive && record) {
        value = mutationReceipt({ operation: input.operation, status: "rejected", identity_environment_ref: null,
          failure: { code: "active_session", retryable: false, recovery_actions: [] } });
        activeArchiveReceiptKeys.add(input.idempotency_key);
      } else if (!record) value = mutationReceipt({ operation: input.operation, status: "rejected", identity_environment_ref: input.identity_environment_ref,
        failure: { code: "identity_environment_missing", retryable: true, recovery_actions: ["refresh_identity_list"] } });
      else {
        record.lifecycle_state = "archived";
        value = mutationReceipt({ operation: input.operation, status: "completed", identity_environment_ref: record.identity_environment_ref,
          source_identity_environment_ref: record.identity_environment_ref, record,
          effects: { index: "updated", local_data: "unchanged", login_state: "unchanged" } });
      }
      receipts.set(input.idempotency_key, value);
      if (malformedArchiveReply) { res.setHeader("content-type", "application/json"); res.end("[]"); return; }
    } else if (input.operation === "delete") {
      deletes++;
      const index = profiles.findIndex(item => item.identity_environment_ref === input.identity_environment_ref);
      if (index < 0) value = mutationReceipt({ operation: input.operation, status: "rejected", identity_environment_ref: input.identity_environment_ref,
        failure: { code: "identity_environment_missing", retryable: true, recovery_actions: ["refresh_identity_list"] } });
      else if (repairDelete) {
        const record = profiles[index]!;
        value = mutationReceipt({ status: "repair_required", operation: input.operation, identity_environment_ref: record.identity_environment_ref,
          source_identity_environment_ref: record.identity_environment_ref, record,
          effects: { index: "unchanged", local_data: "residual", login_state: "unchanged" },
          failure: { code: "profile_cleanup_failed", retryable: true, recovery_actions: ["open_repair"] } });
      }
      else {
        const record = profiles.splice(index, 1)[0]!;
        value = mutationReceipt({ status: "completed", operation: input.operation, identity_environment_ref: record.identity_environment_ref,
          source_identity_environment_ref: record.identity_environment_ref, record: null,
          effects: { index: "removed", local_data: "deleted", login_state: "unchanged" } });
      }
      receipts.set(input.idempotency_key, value);
      if (dropDeleteResponse) { req.socket.destroy(); return; }
    } else if (input.operation === "copy_environment") {
      copies++;
      const source = profiles.find(item => item.identity_environment_ref === input.identity_environment_ref);
      const expected = input.expected_environment_template;
      const sourceSite = source?.site as Record<string, unknown> | undefined;
      const sourceEnvironment = source?.environment_summary as Record<string, unknown> | undefined;
      if (!source || !expected || sourceEnvironment?.provider_id !== expected.provider_id ||
          sourceSite?.site_id !== expected.site.site_id || sourceSite?.origin !== expected.site.origin ||
          sourceSite?.display_name !== expected.site.display_name || sourceEnvironment?.language !== expected.language ||
          sourceEnvironment?.timezone !== expected.timezone) {
        value = mutationReceipt({ status: "rejected", operation: input.operation, identity_environment_ref: null,
          failure: { code: source ? "copy_template_mismatch" : "identity_environment_missing", retryable: false, recovery_actions: [] } });
      } else {
        const id = copies;
        const record = { schema_version: "harbor-local-identity-environment-store/v1", lifecycle_state: "active",
          refs: { profile_ref: `profile:copied-${id}`, profile_storage_ref: `storage:copied-${id}` }, identity_environment_ref: `identity:copied-${id}`,
          name: `profile:copied-${id}`, tags: [], site: structuredClone(expected.site), status: { readiness: "needs_auth" }, account_bindings: [],
          environment_summary: { provider_id: expected.provider_id, language: expected.language, timezone: expected.timezone } };
        profiles.push(record);
        value = mutationReceipt({ status: "completed", operation: input.operation, identity_environment_ref: record.identity_environment_ref,
          source_identity_environment_ref: source.identity_environment_ref, record,
          effects: { index: "registered", local_data: "excluded", login_state: "excluded" } });
      }
      receipts.set(input.idempotency_key, value);
      if (malformedCopyReply) { res.setHeader("content-type", "application/json"); res.end("[]"); return; }
      if (dropCopyResponse) { req.socket.destroy(); return; }
    } else {
    requestedProviders.push(input.identity_environment.requested_provider_id);
    const selectedProvider = input.identity_environment.requested_provider_id ?? browserPreference;
    if (!selectedProvider) {
      value = mutationReceipt({ status: "rejected", operation: input.operation, identity_environment_ref: null,
        failure: { code: "provider_selection_required", retryable: false, recovery_actions: [] } });
      receipts.set(input.idempotency_key, value);
      if (dropResponse) { req.socket.destroy(); return; }
      res.statusCode = 409;
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value)); return;
    }
    creates++;
    const record = { refs: { profile_ref: `profile:${creates}` }, identity_environment_ref: `identity:${creates}`, name: `profile:${creates}`, tags: [], site: { origin: "https://example.com", display_name: "Example" }, status: { readiness: "ready" }, account_bindings: [], environment_summary: { provider_id: selectedProvider } };
    profiles.push(record); value = mutationReceipt({ status: "completed", operation: input.operation,
      identity_environment_ref: record.identity_environment_ref, record,
      provider_selection: omitProviderSelection ? null : { schema_version: "harbor-provider-selection/v1", source: input.identity_environment.requested_provider_id ? "explicit_request" : "user_default", selected_provider_id: selectedProvider },
      effects: { index: "registered", local_data: "created", login_state: "unchanged" } });
    receipts.set(input.idempotency_key, value);
    await afterCreate?.();
    if (malformedCreateReply) { res.setHeader("content-type", "application/json"); res.end("[]"); return; }
    if (dropResponse) { req.socket.destroy(); return; }
    }
  } else if (req.url?.startsWith("/runtime/identity-environment-mutations/")) {
    const receiptKey = decodeURIComponent(req.url.split("/").at(-1)!);
    if (req.method === "GET" && activeArchiveReceiptKeys.has(receiptKey)) {
      archiveReceiptReads++;
      // Model Harbor's non-2xx lookup for a rejected active-session archive.
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ failure: { code: "managed_browser_runtime_refused" } }));
      return;
    }
    const receipt = receipts.get(receiptKey) ?? environmentReceipts.get(receiptKey);
    if (req.method === "GET" && receipt && typeof receipt === "object" && (receipt as { operation?: unknown }).operation === "archive") archiveReceiptReads++;
    value = receipt;
  }
  else if (req.url === "/runtime/identity-environments") {
    identityEnvironmentReads++;
    await afterProfileList?.();
    value = { identity_environments: structuredClone(malformedUnrelatedProfile ? [{ refs: { profile_ref: "profile:unrelated-malformed" } }, ...profiles] : profiles) };
    await afterIdentityEnvironmentSnapshot?.();
    afterIdentityEnvironmentSnapshot = undefined;
  }
  else if (req.url === "/runtime/identity-environments/identity%3A1/environment") {
    if (req.method === "GET") {
      environmentReads++;
      value = environmentUnavailable ? { status: "unavailable", failure_class: "provider_unavailable", retryable: true } :
        { status: "completed", identity_environment_ref: "identity:1", profile_ref: "profile:1",
          configured: { ...environmentConfigured }, effective: { ...environmentEffective }, pending: environmentPending === null ? null : { ...environmentPending },
          drift: "none", last_verified_at: "2026-09-09T00:00:00.000Z",
          provider: { provider_id: "camoufox", provider_version: "0.5.6", browser_version: "135.0", support: "supported" },
          observed: { language: environmentEffective.language, timezone: environmentEffective.timezone, viewport: environmentEffective.viewport } };
    } else {
      let body = ""; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body) as { idempotency_key?: string; configuration?: Record<string, string> };
      assert.equal(typeof input.idempotency_key, "string");
      assert.ok(input.configuration && typeof input.configuration === "object");
      const key = input.idempotency_key!;
      const existing = environmentReceipts.get(key);
      if (existing) value = existing;
      else {
        environmentUpdates++;
        const configuration = { ...input.configuration };
        environmentConfigured = { ...environmentConfigured, ...configuration };
        environmentPending = configuration;
        const receipt = { status: "completed", idempotency_key: key, identity_environment_ref: "identity:1", configuration };
        environmentReceipts.set(key, receipt); value = receipt;
      }
      if (dropEnvironmentResponse) { req.socket.destroy(); return; }
    }
  } else if (req.url === "/runtime/identity-environments/identity%3A1/session") {
    sessionReads++;
    value = sessionStopped ? { status: "unavailable", failure_class: "instance_not_running" } : { runtime_session: managedSession };
  } else if (req.url === "/runtime/profile-recovery/inspect") {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body) as { profile_ref?: string };
    value = { schema_version: "harbor-profile-recovery/v1", profile_ref: input.profile_ref, status: "compatible" };
  }
  else if (req.url === "/runtime/sessions/session%3Aone/observe") {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.holder_ref, principalId);
    assert.equal(input.expected_origin, "https://example.com");
    assert.equal(input.page_id, "page-id:one");
    assert.equal(input.page_ref, "page:one");
    assert.equal(input.document_generation, 1);
    observations++;
    value = { status: "completed", page: { current_url: (managedSession.current_page as { current_url?: string }).current_url, title: "Fixture", status: "ready" } };
  }
  else if (req.url === "/runtime/sessions/session%3Aone/diagnostics") {
    diagnostics++;
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.origin, "https://example.com");
    assert.ok(Array.isArray(input.authorized_origins));
    forwardedDiagnosticsOrigins.push([...input.authorized_origins]);
    if (input.cursor) { assert.equal(input.page_ref, "page:one"); assert.equal(input.limit, 1); }
    if (dropDiagnosticsResponse) { req.socket.destroy(); return; }
    value = { status: "completed", schema_version: "harbor-runtime-diagnostics/v1", runtime_session_ref: "session:one", profile_ref: "profile:1", page_ref: "page:one", document_generation: 1, page: { current_url: "https://example.com/", title: "Fixture", status: "ready" }, cursor: "cursor:2", next_cursor: "cursor:2", truncated: false, observed_at: new Date().toISOString(), network: [{ event_ref: "event:1", kind: "response", observed_at: new Date().toISOString(), method: "GET", url: "https://example.com/health", origin: "https://example.com", resource_kind: "fetch", status: 503, duration_ms: 4 }], console: [{ event_ref: "event:2", level: "error", observed_at: new Date().toISOString(), page_ref: "page:one", document_generation: 1, text: "fixture error", truncated: false }] };
  }
  else if (req.url === "/runtime/sessions/session%3Aone/pages") {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body) as { operation?: string; operation_ref?: string; holder_ref?: string; page_ref?: string; url?: string };
    if (input.operation === "page.list") {
      assert.equal(input.holder_ref, principalId);
      pageLists++;
      value = { status: "completed", schema_version: "harbor-page-list/v2", runtime_session_ref: "session:one", active_page_id: "page-id:one", filtered_page_count: 0, observed_at: new Date().toISOString(), pages: [{ page_id: "page-id:one", page_ref: "page:one", document_generation: 1, requested_url: "https://example.com/", current_url: "https://example.com/", origin: "https://example.com", title: "Fixture", status: "ready", active: true, error_reason: null, observed_at: new Date().toISOString() }] };
    } else {
      assert.ok(input.operation_ref);
      if (managedSession.control_owner !== "core_task" || (managedSession.control_lock as { state?: unknown } | undefined)?.state !== "held") value = { status: "unavailable", dispatch_state: "not_dispatched", failure_class: "control_lock_conflict", operation_ref: input.operation_ref, runtime_session_ref: "session:one", observed_at: new Date().toISOString() };
      else {
        const previous = pageReceipts.get(input.operation_ref!);
        if (previous) value = previous;
        else {
          pageMutations++;
          const page = { page_id: "page-id:opened", page_ref: "page:opened", document_generation: 1, requested_url: input.url ?? "https://example.com/", current_url: input.url ?? "https://example.com/", origin: "https://example.com", title: "Opened", status: "ready", active: true, error_reason: null, observed_at: new Date().toISOString() };
          const receipt = { status: "completed", dispatch_state: "dispatched", operation_ref: input.operation_ref!, runtime_session_ref: "session:one", page, observed_at: new Date().toISOString() };
          pageReceipts.set(input.operation_ref!, receipt); value = receipt;
        }
      }
      if (dropPageResponse) { req.socket.destroy(); return; }
    }
  }
  else if (req.url?.startsWith("/runtime/managed-pages/")) value = pageReceipts.get(decodeURIComponent(req.url.split("/").at(-1)!));
  else if (req.url?.startsWith("/runtime/identity-environments/identity%3A1/account-bindings")) {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body) as Record<string, unknown>;
    assert.equal(input.runtime_session_ref, "session:one");
    assert.equal(input.page_id, "page-id:one");
    assert.equal(input.page_ref, "page:one");
    assert.equal(input.document_generation, 1);
    assert.equal(input.holder_ref, principalId);
    accountBindingPosts++;
    const bindingResult = {
      ...profiles[0]!, account_bindings: [{ account_system_ref: input.account_system_ref, account_ref: input.account_ref,
        observation_ref: input.observation_ref, bound_at: new Date().toISOString() }],
      observation: { status: "completed", observation_ref: input.observation_ref, observed_at: new Date().toISOString(),
        runtime_session_ref: "session:one", profile_ref: "profile:1", control_generation: 3,
        page: { page_id: "page-id:one", page_ref: "page:one", document_generation: 1 },
        account: { status: "verified", account_system_ref: input.account_system_ref, account_ref: input.account_ref } }
    };
    accountBindingReceipts.set(String(input.idempotency_key), { status: "completed", result: bindingResult });
    value = malformedAccountBindingResponse ? { status: "completed" } : bindingResult;
  }
  else if (req.url?.startsWith("/runtime/account-binding-operations/")) {
    const key = decodeURIComponent(req.url.split("/").at(-1)!);
    value = accountBindingReceipts.get(key);
  }
  else if (req.url === "/runtime/sessions/session%3Aone/lock") {
    lockAttempts++;
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body) as { control_owner?: string; holder_ref?: string };
    if (managedSession.control_owner === "user" && (managedSession.control_lock as { state?: unknown } | undefined)?.state === "held") value = { status: "unavailable", failure_class: "session_locked", current_error: { code: "session_locked" } };
    else {
      managedSession.control_owner = input.control_owner ?? "core_task";
      managedSession.control_lock = { state: "held", holder_ref: input.holder_ref };
      value = { ...managedSession };
    }
  }
  else if (["/runtime/sessions/session%3Aone/navigate", "/runtime/sessions/session%3Aone/read"].includes(req.url ?? "")) {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    if (req.url!.endsWith("/navigate")) { navigations++; managedSession.current_page = { current_url: input.url }; }
    value = { status: "completed", session: managedSession, observed_at: new Date().toISOString(), ...(req.url!.endsWith("/read") ? { text: "Example Domain is for use in documentation examples.", truncated: false } : {}) };
  }
  else if (req.url === "/runtime/sessions/session%3Aone/interactions") {
    let body = ""; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    assert.equal(input.controlled_origin, input.expected_origin);
    assert.equal(input.expected_origin, "http://127.0.0.1:18794");
    assert.ok(Array.isArray(input.authorized_origins));
    forwardedInteractionOrigins.push([...input.authorized_origins]);
    forwardedInteractionInputs.push(input);
    const timedOut = waitConditionTimeout && input.action === "wait";
    if (!refuseInteraction && !timedOut && !(input.action === "snapshot" && input.cursor)) interactions++;
    value = timedOut
      ? { status: "unavailable", dispatch_state: "dispatched", failure_class: "wait_condition_timeout", operation_ref: input.operation_ref, runtime_session_ref: "session:one", page: { current_url: "http://127.0.0.1:18794/fixture", title: "Fixture", status: "ready" } }
      : { status: refuseInteraction ? "unavailable" : "completed", dispatch_state: refuseInteraction ? "not_dispatched" : "dispatched",
        operation_ref: input.operation_ref, runtime_session_ref: "session:one", ...(refuseInteraction ? { failure_class: "managed_interaction_observation_stale" } : {
          page: { page_ref: input.page_ref ?? "page:one", current_url: crossOriginInteraction ? "https://outside.example/private?token=secret" : input.expected_origin, title: crossOriginInteraction ? "Private title" : "Fixture" },
          snapshot: { page_ref: input.page_ref ?? "page:one", observation_ref: `observation:${interactions}`, controls: [], text: crossOriginInteraction ? "Private body" : "Ready", truncated: false }
        }) };
    receipts.set(input.operation_ref, value);
    if (dropInteractionResponse) { req.socket.destroy(); return; }
  } else if (req.url?.startsWith("/runtime/managed-interactions/")) value = receipts.get(decodeURIComponent(req.url.split("/").at(-1)!));
  else { res.writeHead(404); res.end('{}'); return; }
  if (value && typeof value === "object" && (value as { status?: unknown }).status === "repair_required") res.statusCode = 409;
  res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value));
})().catch(() => { res.writeHead(500); res.end('{}'); }); });
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const accessStore = createFileManagedAccessStore({ directory: join(directory, "access"), withStoppedProfile: async (_profileRef, _operationRef, action) => action() });
  const runRecordStore = createFileRunRecordStore({ directory: join(directory, "runs") });
  const executionPolicyConfigStore = createFileExecutionPolicyConfigStore({ directory: join(directory, "policy") });
  await executionPolicyConfigStore.putGlobalConfiguration({ schema_version: executionPolicyMutationSchemaVersion, idempotency_key: "allow", expected_source_version: null, modes: { read: "auto", prepare: "confirm", commit: "auto", destructive: "deny" } });
  const recoveryStatus = { ok: true, operation_ref: "recovery:status-fixture", status: "apply_completed", run_id: `managed-${"0".repeat(64)}` };
  const recoveryService = {
    inspect: async () => recoveryStatus,
    backup: async () => recoveryStatus,
    plan: async () => recoveryStatus,
    apply: async () => recoveryStatus,
    request: async () => recoveryStatus,
    status: async (_input: unknown, expectedProfileRef?: string) => { recoveryExpectedProfileRef = expectedProfileRef; return recoveryStatus; }
  };
  const authorizationDecisionStore = createFileAuthorizationDecisionStore({ directory: join(directory, "decisions"), runRecordStore });
  const service = createManagedBrowserService({ accessStore, runRecordStore, executionPolicyConfigStore,
    authorizationDecisionStore,
    harborBaseUrl: `http://127.0.0.1:${address.port}`, supervisorToken: "fixture-supervisor", recoveryService });
  const credentialHash = createHash("sha256").update("fixture-agent").digest("hex");
  const principal = await accessStore.registerPrincipal({ idempotency_key: "register", display_name: "Fixture Agent", credential_hash: credentialHash });
  principalId = principal.principal_id;
  const connection = await accessStore.connect(credentialHash);
  const legacyOperations = managedOperations.filter(op => op !== "account.bind" && op !== "account_system.import_template" && !(managedBusinessTargetOperations as readonly string[]).includes(op));
  const grant = await accessStore.createGrant({ idempotency_key: "grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: legacyOperations, allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 2,
    creation_template: { template_ref: "template:example", provider_id: "camoufox", site: { site_id: "example", origin: "https://example.com", display_name: "Example" }, language: "en-US", timezone: "UTC", permission_ceiling: { allowed_operations: ["profile.list", "profile.read"], allowed_origins: ["https://example.com"] } } });
  const request = { idempotency_key: "create-one", connection_id: connection.connection_id, grant_id: grant.grant_id, operation: "profile.create", template_ref: "template:example", task_scope: { operations: legacyOperations, profile_refs: ["profile:1", "profile:2"], origins: ["https://example.com"] } };
  const first = await service.submit(credentialHash, request);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(await service.submit(credentialHash, request), first);
  assert.equal(creates, 1);
  assert.equal(requestedProviders[0], "camoufox");
  profiles[0]!.identity_ownership = {
    schema_version: "webenvoy.profile-identity-ownership/v1",
    current: { status: "conflict", observed_at: "2026-09-30T07:30:00.000Z", account_system_ref: "account-system:example", account_ref: "account:sha256:current" },
    history: { bindings: [{ status: "bound", verification: "verified_at_binding", account_system_ref: "account-system:example", account_ref: "account:sha256:bound", bound_at: "2026-09-01T07:30:00.000Z" }], declared: null },
    ownership: { status: "conflict" }
  };
  profiles.push({ refs: { profile_ref: "profile:outside" }, identity_environment_ref: "identity:outside", site: { display_name: "OUTSIDE_PROFILE_SECRET" }, identity_ownership: { malformed: true } });
  await assert.rejects(service.submit(credentialHash, { ...request, template_ref: "template:wider" }), /idempotency_conflict/);
  const listed = await service.submit(credentialHash, { ...request, idempotency_key: "list", operation: "profile.list", template_ref: undefined });
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.equal((listed.result as { profiles: unknown[] }).profiles.length, 1);
  assert.equal(JSON.stringify(listed.result).includes("OUTSIDE_PROFILE_SECRET"), false, "out-of-scope Profile details must be filtered before projection");
  const listedProfile = ((listed.result as { profiles: Record<string, unknown>[] }).profiles[0]!);
  assert.equal(((listedProfile.identity_ownership as Record<string, unknown>).current as Record<string, unknown>).status, "conflict");
  assert.equal(JSON.stringify(listedProfile.identity_ownership).includes("identity:outside"), false);
  const readConflict = await service.submit(credentialHash, { ...request, idempotency_key: "read-conflict", operation: "profile.read", template_ref: undefined, profile_ref: "profile:1" });
  assert.equal(readConflict.ok, true, "identity conflict does not block public Profile reads");
  assert.equal((((readConflict.result as { profile: Record<string, unknown> }).profile.identity_ownership as Record<string, unknown>).ownership as Record<string, unknown>).status, "conflict");
  assert.equal(((((readConflict.result as { profile: Record<string, unknown> }).profile.identity_ownership as Record<string, unknown>).history as Record<string, unknown>).bindings as Array<Record<string, unknown>>)[0]?.ownership_status, "unknown",
    "legacy aggregate conflict remains readable but does not infer the individual binding status");
  const savedProjection = profiles[0]!.identity_ownership;
  const malformedOwnershipCases: Array<(projection: Record<string, unknown>) => void> = [
    projection => { (projection.current as Record<string, unknown>).account_ref = "account: bad"; },
    projection => { ((projection.history as Record<string, unknown>).bindings as Array<Record<string, unknown>>)[0]!.account_ref = "x".repeat(257); },
    projection => { ((projection.history as Record<string, unknown>).bindings as Array<Record<string, unknown>>)[0]!.account_ref = null; },
    projection => { ((projection.history as Record<string, unknown>).bindings as Array<Record<string, unknown>>)[0]!.ownership_status = "ambiguous"; },
    projection => { (projection.history as Record<string, unknown>).declared = { status: "declared", account_system_ref: "account-system:example", account_ref: "account declared" }; },
    projection => { (projection.history as Record<string, unknown>).declared = { status: "declared", account_system_ref: null, account_ref: "account:legacy" }; },
    projection => { (projection.current as Record<string, unknown>).observed_at = null; }
  ];
  for (const [index, corrupt] of malformedOwnershipCases.entries()) {
    const malformed = structuredClone(savedProjection) as Record<string, unknown>;
    corrupt(malformed);
    profiles[0]!.identity_ownership = malformed;
    const rejected = await service.submit(credentialHash, { ...request, idempotency_key: `malformed-identity-${index}`, operation: "profile.read", template_ref: undefined, profile_ref: "profile:1" });
    assert.equal(rejected.failure?.code, "managed_browser_runtime_invalid", `malformed Harbor identity projection ${index} must fail closed`);
  }
  profiles[0]!.identity_ownership = savedProjection;
  delete profiles[0]!.identity_ownership;
  const readLegacyHarbor = await service.submit(credentialHash, { ...request, idempotency_key: "read-legacy-harbor", operation: "profile.read", template_ref: undefined, profile_ref: "profile:1" });
  const legacyIdentity = (readLegacyHarbor.result as { profile: Record<string, unknown> }).profile.identity_ownership as Record<string, unknown>;
  assert.equal(readLegacyHarbor.ok, true);
  assert.equal((legacyIdentity.current as Record<string, unknown>).status, "unknown");
  assert.equal((legacyIdentity.ownership as Record<string, unknown>).status, "unknown", "missing Harbor projection must not infer ownership from bindings");
  profiles[0]!.identity_ownership = savedProjection;
  const beforeOutOfScopeRead = identityEnvironmentReads;
  await assert.rejects(service.submit(credentialHash, { ...request, idempotency_key: "read-outside", operation: "profile.read", template_ref: undefined, profile_ref: "profile:outside" }), /managed_access_denied/);
  assert.equal(identityEnvironmentReads, beforeOutOfScopeRead, "out-of-scope read must be rejected before Harbor identity data is read");
  const fixedConflict = await service.submit(credentialHash, { ...request, idempotency_key: "fixed-conflict", provider_id: "chrome_official" });
  assert.equal(fixedConflict.failure?.code, "managed_browser_template_provider_conflict");
  assert.equal(creates, 1);
  await assert.rejects(service.submit(credentialHash, { ...request, idempotency_key: "elevate", operation: "instance.start", template_ref: undefined, profile_ref: "profile:1", origin: "https://example.com" }), /managed_access_denied/);
  afterCreate = async () => { await accessStore.revokeGrant({ idempotency_key: "revoke-in-flight", grant_id: grant.grant_id }); };
  const second = await service.submit(credentialHash, { ...request, idempotency_key: "create-two" });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(creates, 2);
  assert.equal((await accessStore.list()).grants[0]!.created_profile_refs.length, 2);
  const reconnect = await accessStore.connect(credentialHash);
  await assert.rejects(service.submit(credentialHash, { ...request, idempotency_key: "after-revoke", connection_id: reconnect.connection_id }), /grant_unavailable/);
  assert.deepEqual(await service.query(credentialHash, second.run_id), second);
  assert.equal((await runRecordStore.listRunRecords()).filter(run => run.status === "succeeded").length, 5);


  const copySourceProfileRef = "profile:copy-source";
  const copySourceIdentityRef = "identity:copy-source";
  await accessStore.setProfilePolicy({ idempotency_key: "copy-source-policy", profile_ref: copySourceProfileRef,
    allowed_operations: ["profile.copy_environment", "profile.read", "instance.start", "instance.stop", "instance.click"],
    allowed_origins: ["https://example.com", "https://source-only.example"],
    controlled_interaction_origins: ["https://example.com", "https://source-only.example"] });
  profiles.push({ schema_version: "harbor-local-identity-environment-store/v1", lifecycle_state: "active",
    identity_environment_ref: copySourceIdentityRef, refs: { profile_ref: copySourceProfileRef }, name: "Copy source", tags: [],
    site: { site_id: "example", origin: "https://example.com", display_name: "Example" }, status: { readiness: "needs_auth" }, account_bindings: [],
    environment_summary: { provider_id: "camoufox", language: "en-US", timezone: "UTC" } });
  const copyTemplate = { template_ref: "template:copy", provider_id: "camoufox", site: { site_id: "example", origin: "https://example.com", display_name: "Example" },
    language: "en-US", timezone: "UTC", permission_ceiling: { allowed_operations: ["profile.copy_environment", "profile.read", "instance.start", "instance.click"],
      allowed_origins: ["https://example.com", "https://template-only.example"], controlled_interaction_origins: ["https://example.com"] } };
  const copyGrant = await accessStore.createGrant({ idempotency_key: "copy-grant", principal_id: principal.principal_id,
    profile_refs: [copySourceProfileRef], allowed_operations: ["profile.copy_environment", "profile.read", "instance.start", "instance.stop", "instance.click"],
    allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 1, creation_template: copyTemplate });
  const copyRequest = { idempotency_key: "copy-one", connection_id: connection.connection_id, grant_id: copyGrant.grant_id,
    operation: "profile.copy_environment", profile_ref: copySourceProfileRef, template_ref: copyTemplate.template_ref,
    task_scope: { operations: ["profile.copy_environment"], profile_refs: [copySourceProfileRef], origins: [] } } as const;
  malformedUnrelatedProfile = true;
  const copied = await service.submit(credentialHash, copyRequest);
  malformedUnrelatedProfile = false;
  assert.equal(copied.status, "succeeded", JSON.stringify(copied));
  assert.equal(copies, 1);
  const copiedResult = copied.result as { profile: { profile_ref: string; lifecycle_state: string; environment_summary: Record<string, unknown> } };
  assert.notEqual(copiedResult.profile.profile_ref, copySourceProfileRef);
  assert.equal(copiedResult.profile.lifecycle_state, "active");
  assert.equal(copiedResult.profile.environment_summary.provider_id, "camoufox");
  const copiedPolicy = (await accessStore.list()).profile_policies.find(item => item.profile_ref === copiedResult.profile.profile_ref)!;
  assert.deepEqual(copiedPolicy.allowed_operations, ["profile.copy_environment", "profile.read", "instance.start", "instance.click"]);
  assert.deepEqual(copiedPolicy.allowed_origins, ["https://example.com"]);
  assert.deepEqual(copiedPolicy.controlled_interaction_origins, ["https://example.com"]);
  await assert.rejects(service.submit(credentialHash, { ...copyRequest, idempotency_key: "copy-after-quota" }), /managed_access_creation_denied/);
  assert.equal(copies, 1, "the completed copy consumes the Grant quota before another Harbor mutation");

  const mismatchTemplate = { ...copyTemplate, template_ref: "template:copy-mismatch", site: { ...copyTemplate.site, display_name: "Other" } };
  const mismatchGrant = await accessStore.createGrant({ idempotency_key: "copy-mismatch-grant", principal_id: principal.principal_id,
    profile_refs: [copySourceProfileRef], allowed_operations: ["profile.copy_environment"], allowed_origins: ["https://example.com"],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 1, creation_template: mismatchTemplate });
  const mismatch = await service.submit(credentialHash, { ...copyRequest, idempotency_key: "copy-mismatch", grant_id: mismatchGrant.grant_id, template_ref: mismatchTemplate.template_ref });
  assert.equal(mismatch.failure?.code, "managed_browser_copy_template_mismatch");
  assert.equal(copies, 1, "a source/template mismatch must fail before Harbor dispatch");

  const unknownCopyGrant = await accessStore.createGrant({ idempotency_key: "unknown-copy-grant", principal_id: principal.principal_id,
    profile_refs: [copySourceProfileRef], allowed_operations: ["profile.copy_environment"], allowed_origins: ["https://example.com"],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 1, creation_template: copyTemplate });
  dropCopyResponse = true;
  const unknownCopy = await service.submit(credentialHash, { ...copyRequest, idempotency_key: "copy-lost-response", grant_id: unknownCopyGrant.grant_id });
  dropCopyResponse = false;
  assert.equal(unknownCopy.status, "unknown_outcome");
  const copyCountAfterDispatch = copies;
  const blockedUnknownCopy = await service.submit(credentialHash, { ...copyRequest, idempotency_key: "copy-do-not-repeat", grant_id: unknownCopyGrant.grant_id });
  assert.equal(blockedUnknownCopy.failure?.code, "managed_browser_creation_reconciliation_required");
  assert.equal(copies, copyCountAfterDispatch);
  const reconciledCopy = await service.query(credentialHash, unknownCopy.run_id);
  assert.equal(reconciledCopy.status, "unknown_outcome");
  assert.equal((reconciledCopy.result as { profile: { profile_ref: string } }).profile.profile_ref, "profile:copied-2");
  assert.equal(copies, copyCountAfterDispatch, "receipt query must not replay Harbor copy");
  assert.deepEqual((await accessStore.list()).grants.find(item => item.grant_id === unknownCopyGrant.grant_id)?.created_profile_refs, ["profile:copied-2"]);

  const malformedCopyGrant = await accessStore.createGrant({ idempotency_key: "malformed-copy-grant", principal_id: principal.principal_id,
    profile_refs: [copySourceProfileRef], allowed_operations: ["profile.copy_environment"], allowed_origins: ["https://example.com"],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 1, creation_template: copyTemplate });
  malformedCopyReply = true;
  const malformedCopy = await service.submit(credentialHash, { ...copyRequest, idempotency_key: "malformed-copy-response", grant_id: malformedCopyGrant.grant_id });
  malformedCopyReply = false;
  assert.equal(malformedCopy.status, "unknown_outcome", "a non-object HTTP reply after committed copy is unknown");
  const copiesAfterMalformedDispatch = copies;
  const blockedMalformedCopy = await service.submit(credentialHash, { ...copyRequest, idempotency_key: "copy-after-malformed-response", grant_id: malformedCopyGrant.grant_id });
  assert.equal(blockedMalformedCopy.failure?.code, "managed_browser_creation_reconciliation_required");
  assert.equal(copies, copiesAfterMalformedDispatch, "a fresh key cannot dispatch while the malformed copy response is unreconciled");
  const queriedMalformedCopy = await service.query(credentialHash, malformedCopy.run_id);
  assert.equal(queriedMalformedCopy.status, "unknown_outcome");
  assert.equal((queriedMalformedCopy.result as { profile: { profile_ref: string } }).profile.profile_ref, "profile:copied-3");
  assert.deepEqual((await accessStore.list()).grants.find(item => item.grant_id === malformedCopyGrant.grant_id)?.created_profile_refs, ["profile:copied-3"]);
  await assert.rejects(service.submit(credentialHash, { ...copyRequest, idempotency_key: "copy-after-malformed-reconciliation", grant_id: malformedCopyGrant.grant_id }), /managed_access_creation_denied/);
  assert.equal(copies, copiesAfterMalformedDispatch, "receipt reconciliation consumes the only quota slot without replay");

  const mismatchedReceiptGrant = await accessStore.createGrant({ idempotency_key: "mismatched-copy-receipt-grant", principal_id: principal.principal_id,
    profile_refs: [copySourceProfileRef], allowed_operations: ["profile.copy_environment"], allowed_origins: ["https://example.com"],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 1, creation_template: copyTemplate });
  dropCopyResponse = true;
  const mismatchedReceiptCopy = await service.submit(credentialHash, { ...copyRequest, idempotency_key: "mismatched-copy-receipt", grant_id: mismatchedReceiptGrant.grant_id });
  dropCopyResponse = false;
  assert.equal(mismatchedReceiptCopy.status, "unknown_outcome");
  const mismatchedCopyProfile = profiles.find(item => (item.refs as Record<string, unknown> | undefined)?.profile_ref === "profile:copied-4")!;
  const copiedEnvironment = mismatchedCopyProfile.environment_summary as Record<string, unknown>;
  mismatchedCopyProfile.environment_summary = { ...copiedEnvironment, timezone: "Etc/GMT+12" };
  const mismatchedReceiptQuery = await service.query(credentialHash, mismatchedReceiptCopy.run_id);
  mismatchedCopyProfile.environment_summary = copiedEnvironment;
  assert.equal(mismatchedReceiptQuery.status, "unknown_outcome", "a completed copy receipt outside the authorized source/template tuple is not reconciled");
  assert.deepEqual((await accessStore.list()).grants.find(item => item.grant_id === mismatchedReceiptGrant.grant_id)?.created_profile_refs, [],
    "Core must not consume quota for a receipt that does not match the frozen copy tuple");
  const blockedMismatchedCopy = await service.submit(credentialHash, { ...copyRequest, idempotency_key: "copy-after-mismatched-receipt", grant_id: mismatchedReceiptGrant.grant_id });
  assert.equal(blockedMismatchedCopy.failure?.code, "managed_browser_creation_reconciliation_required");

  const sourceRecord = profiles.find(item => item.identity_environment_ref === copySourceIdentityRef)!;
  const retainedBinding = { account_system_ref: "account-system:copy-source", account_ref: "account:sha256:copy-source" };
  sourceRecord.account_bindings = [retainedBinding];
  await accessStore.setProfilePolicy({ idempotency_key: "lifecycle-source-policy", profile_ref: copySourceProfileRef,
    allowed_operations: ["profile.copy_environment", "profile.read", "profile.archive", "profile.delete", "instance.start"],
    allowed_origins: ["https://example.com"], controlled_interaction_origins: ["https://example.com"] });
  const lifecycleGrant = await accessStore.createGrant({ idempotency_key: "lifecycle-grant", principal_id: principal.principal_id,
    profile_refs: [copySourceProfileRef], allowed_operations: ["profile.archive", "profile.delete", "instance.start"],
    allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const archiveRequest = { idempotency_key: "archive-profile", connection_id: connection.connection_id, grant_id: lifecycleGrant.grant_id,
    operation: "profile.archive", profile_ref: copySourceProfileRef,
    task_scope: { operations: ["profile.archive"], profile_refs: [copySourceProfileRef], origins: [] } } as const;
  malformedArchiveReply = true;
  const archived = await service.submit(credentialHash, archiveRequest);
  malformedArchiveReply = false;
  assert.equal(archived.status, "unknown_outcome", "a non-object HTTP reply after commit must not classify archive as rejected");
  const queriedArchive = await service.query(credentialHash, archived.run_id);
  assert.equal(queriedArchive.status, "unknown_outcome");
  assert.equal((queriedArchive.result as { profile: { lifecycle_state: string; account_bindings: unknown[] } }).profile.lifecycle_state, "archived");
  assert.deepEqual((queriedArchive.result as { profile: { account_bindings: unknown[] } }).profile.account_bindings, [retainedBinding]);
  assert.equal(archives, 1);
  const activeArchiveProfileRef = "profile:active-archive";
  const activeArchiveIdentityRef = "identity:active-archive";
  profiles.push({ schema_version: "harbor-local-identity-environment-store/v1", lifecycle_state: "active",
    identity_environment_ref: activeArchiveIdentityRef, refs: { profile_ref: activeArchiveProfileRef }, name: "Active archive fixture", tags: [],
    site: { site_id: "example", origin: "https://example.com", display_name: "Example" }, status: { readiness: "ready" }, account_bindings: [],
    environment_summary: { provider_id: "camoufox", language: "en-US", timezone: "UTC" } });
  await accessStore.setProfilePolicy({ idempotency_key: "active-archive-policy", profile_ref: activeArchiveProfileRef,
    allowed_operations: ["profile.archive"], allowed_origins: [] });
  const activeArchiveGrant = await accessStore.createGrant({ idempotency_key: "active-archive-grant", principal_id: principal.principal_id,
    profile_refs: [activeArchiveProfileRef], allowed_operations: ["profile.archive"], allowed_origins: [],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const rejectedArchiveRequest = { ...archiveRequest, idempotency_key: "archive-active-session", grant_id: activeArchiveGrant.grant_id,
    profile_ref: activeArchiveProfileRef,
    task_scope: { operations: ["profile.archive"], profile_refs: [activeArchiveProfileRef], origins: [] } } as const;
  rejectArchiveAsActive = true;
  const rejectedArchive = await service.submit(credentialHash, rejectedArchiveRequest);
  rejectArchiveAsActive = false;
  assert.equal(rejectedArchive.status, "failed");
  assert.equal(rejectedArchive.failure?.code, "active_session");
  const archivePostCount = archives;
  const receiptReadCount = archiveReceiptReads;
  const sameKeyArchive = await service.submit(credentialHash, rejectedArchiveRequest);
  assert.equal(sameKeyArchive.status, "failed");
  assert.equal(sameKeyArchive.failure?.code, "active_session", "the same idempotency key returns the original final rejection");
  const rejectedArchiveQuery = await service.query(credentialHash, rejectedArchive.run_id);
  const repeatedRejectedArchiveQuery = await service.query(credentialHash, rejectedArchive.run_id);
  for (const queried of [rejectedArchiveQuery, repeatedRejectedArchiveQuery]) {
    assert.equal(queried.status, "failed");
    assert.equal(queried.failure?.code, "active_session", "a final Harbor rejection must remain unchanged by query");
  }
  assert.equal(archives, archivePostCount, "query must never replay the original archive mutation");
  assert.equal(archiveReceiptReads, receiptReadCount, "a final failure does not need receipt lookup; non-2xx cannot rewrite it");
  const startArchived = await service.submit(credentialHash, { ...archiveRequest, idempotency_key: "start-archived", operation: "instance.start",
    origin: "https://example.com", task_scope: { operations: ["instance.start"], profile_refs: [copySourceProfileRef], origins: ["https://example.com"] } });
  assert.equal(startArchived.failure?.code, "managed_browser_profile_archived");

  const deleteRequest = { idempotency_key: "delete-profile-denied", connection_id: connection.connection_id, grant_id: lifecycleGrant.grant_id,
    operation: "profile.delete", profile_ref: copySourceProfileRef, confirmation: "delete_local_data",
    task_scope: { operations: ["profile.delete"], profile_refs: [copySourceProfileRef], origins: [] } } as const;
  const deleteDenied = await service.submit(credentialHash, deleteRequest);
  assert.equal(deleteDenied.failure?.code, "managed_browser_policy_refused");
  assert.equal(deletes, 0, "the Profile Grant and confirmation do not bypass destructive ExecutionPolicy");
  const globalPolicy = await executionPolicyConfigStore.getGlobalConfiguration();
  assert.ok(globalPolicy);
  await executionPolicyConfigStore.putGlobalConfiguration({ schema_version: executionPolicyMutationSchemaVersion, idempotency_key: "allow-profile-delete",
    expected_source_version: globalPolicy.source_version, modes: { ...globalPolicy.modes, destructive: "auto" } });
  dropDeleteResponse = true;
  const deleted = await service.submit(credentialHash, { ...deleteRequest, idempotency_key: "delete-profile-allowed" });
  dropDeleteResponse = false;
  assert.equal(deleted.status, "unknown_outcome", JSON.stringify(deleted));
  assert.equal(deletes, 1);
  assert.equal(profiles.some(item => item.identity_environment_ref === copySourceIdentityRef), false);
  const queriedDelete = await service.query(credentialHash, deleted.run_id);
  assert.equal(queriedDelete.status, "unknown_outcome", "reconciling an unknown delete must keep the original Run outcome visible");
  const deleteReceipt = (queriedDelete.result as { receipt: { operation: string; identity_environment_ref: string } }).receipt;
  assert.equal(deleteReceipt.operation, "delete");
  assert.equal(deleteReceipt.identity_environment_ref, copySourceIdentityRef);
  assert.equal(deletes, 1, "query may inspect the original receipt but must never replay deletion");

  const repairProfileRef = "profile:repair-required";
  const repairIdentityRef = "identity:repair-required";
  profiles.push({ schema_version: "harbor-local-identity-environment-store/v1", lifecycle_state: "active",
    identity_environment_ref: repairIdentityRef, refs: { profile_ref: repairProfileRef }, name: "Repair required", tags: [],
    site: { site_id: "example", origin: "https://example.com", display_name: "Example" }, status: { readiness: "ready" }, account_bindings: [],
    environment_summary: { provider_id: "camoufox", language: "en-US", timezone: "UTC" } });
  await accessStore.setProfilePolicy({ idempotency_key: "repair-profile-policy", profile_ref: repairProfileRef,
    allowed_operations: ["profile.delete"], allowed_origins: [] });
  const repairGrant = await accessStore.createGrant({ idempotency_key: "repair-delete-grant", principal_id: principal.principal_id,
    profile_refs: [repairProfileRef], allowed_operations: ["profile.delete"], allowed_origins: [],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const repairRequest = { idempotency_key: "repair-delete", connection_id: connection.connection_id, grant_id: repairGrant.grant_id,
    operation: "profile.delete", profile_ref: repairProfileRef, confirmation: "delete_local_data",
    task_scope: { operations: ["profile.delete"], profile_refs: [repairProfileRef], origins: [] } } as const;
  repairDelete = true;
  const repairSubmitted = await service.submit(credentialHash, repairRequest);
  repairDelete = false;
  assert.equal(repairSubmitted.status, "unknown_outcome", "HTTP 409 repair_required is not a completed rejection");
  const repairQueried = await service.query(credentialHash, repairSubmitted.run_id);
  assert.equal(repairQueried.status, "unknown_outcome");
  const repairReceipt = (repairQueried.result as { receipt: { status: string; failure: { code: string } } }).receipt;
  assert.equal(repairReceipt.status, "repair_required");
  assert.equal(repairReceipt.failure.code, "profile_cleanup_failed");
  assert.equal(deletes, 2, "query reads the original repair receipt without replaying deletion");
  assert.equal(profiles.some(item => item.identity_environment_ref === repairIdentityRef), true, "repair-required retains the Profile reference for recovery");

  const recoveryGrant = await accessStore.createGrant({ idempotency_key: "recovery-grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: grant.allowed_operations, allowed_origins: grant.allowed_origins, expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 2, creation_template: grant.creation_template });
  afterCreate = undefined; dropResponse = true;
  const unknown = await service.submit(credentialHash, { ...request, idempotency_key: "lost-response", grant_id: recoveryGrant.grant_id });
  assert.equal(unknown.status, "unknown_outcome");
  assert.equal(creates, 3);
  dropResponse = false;
  const blocked = await service.submit(credentialHash, { ...request, idempotency_key: "do-not-repeat", grant_id: recoveryGrant.grant_id });
  assert.equal(blocked.failure?.code, "managed_browser_creation_reconciliation_required");
  assert.equal(creates, 3);
  await accessStore.revokeGrant({ idempotency_key: "revoke-before-query", grant_id: recoveryGrant.grant_id });
  const reconciled = await service.query(credentialHash, unknown.run_id);
  assert.equal(reconciled.status, "unknown_outcome", "original unknown history must remain visible");
  assert.equal((reconciled.result as { profile: { profile_ref: string } }).profile.profile_ref, "profile:3");
  assert.equal(creates, 3, "receipt query must not replay creation");
  assert.equal((await accessStore.list()).grants.find(item => item.grant_id === recoveryGrant.grant_id)?.created_profile_refs.length, 1);

  const accountSystemRef = "account-system:example";
  const accountRefA = `account:sha256:${"a".repeat(64)}`;
  const accountRefB = `account:sha256:${"b".repeat(64)}`;
  const ownership = (accountRef: string, status: "unique" | "conflict" | "not_runnable" = "unique", additionalBindings: { account_system_ref?: string; account_ref: string; ownership_status: "unique" | "conflict" | "not_runnable" }[] = []) => ({
    schema_version: "webenvoy.profile-identity-ownership/v1",
    current: { status: "unknown", observed_at: null, account_system_ref: null, account_ref: null },
    history: { bindings: [
      { status: "bound", verification: "verified_at_binding", ownership_status: "unique", account_system_ref: accountSystemRef, account_ref: accountRef, bound_at: new Date().toISOString() },
      ...additionalBindings.map(binding => ({ status: "bound", verification: "verified_at_binding", ...binding, account_system_ref: binding.account_system_ref ?? accountSystemRef, bound_at: new Date().toISOString() }))
    ], declared: null },
    ownership: { status }
  });
  const targetProfileRef = "profile:business-target";
  const profileOne = { refs: { profile_ref: targetProfileRef }, identity_environment_ref: "identity:business-target", name: "Business target fixture", tags: [],
    site: { origin: "https://example.com", display_name: "Example" }, status: { readiness: "ready" }, account_bindings: [],
    environment_summary: { provider_id: "camoufox" }, identity_ownership: ownership(accountRefA, "conflict", [{ account_system_ref: "account-system:other", account_ref: accountRefB, ownership_status: "conflict" }]) };
  profiles.push(profileOne);
  async function issueBusinessTargetGrant(profileRef: string, suffix: string, selectedAccountRef = accountRefA) {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await accessStore.setProfilePolicy({ idempotency_key: `${suffix}-legacy-policy`, profile_ref: profileRef, allowed_operations: ["profile.read"], allowed_origins: [] });
    const sourceGrant = await accessStore.createGrant({ idempotency_key: `${suffix}-source-grant`, principal_id: principal.principal_id,
      profile_refs: [profileRef], allowed_operations: ["profile.read"], allowed_origins: [], expires_at: expiresAt, max_created_profiles: 0, creation_template: null });
    await accessStore.confirmAgentOperationsV2({
      idempotency_key: `${suffix}-confirm-v2`, source_grant_id: sourceGrant.grant_id, profile_ref: profileRef,
      confirmation: { schema_version: managedScopeConfirmationSchemaVersion, confirmation_ref: `confirmation:${suffix}`, profile_ref: profileRef,
        confirmed_at: new Date().toISOString(), confirmed_by: "owner", idempotency_key: `${suffix}-confirm-v2`, decision: "apply" },
      new_grant: { principal_id: principal.principal_id, profile_refs: [profileRef], allowed_operations: ["profile.read"], allowed_origins: [],
        expires_at: expiresAt, creation_template: null, max_created_profiles: 0 },
      new_profile_policy: { profile_ref: profileRef, allowed_operations: ["profile.read"], allowed_origins: [] }
    });
    const state = await accessStore.list();
    const currentPolicy = state.profile_policies.find(item => item.profile_ref === profileRef)!;
    await accessStore.updateAgentOperationsV2ProfilePolicy({ idempotency_key: `${suffix}-enable-business-target-policy`, profile_ref: profileRef,
      current_policy_digest: currentPolicy.policy_digest, allowed_operations: ["profile.read", ...managedBusinessTargetOperations], allowed_origins: [], controlled_interaction_origins: [] });
    const policyDigest = (await accessStore.list()).profile_policies.find(item => item.profile_ref === profileRef)!.policy_digest;
    return accessStore.issueAgentOperationsV2Grant({
      idempotency_key: `${suffix}-target-grant`, principal_id: principal.principal_id, profile_refs: [profileRef], policy_digest: policyDigest,
      allowed_operations: ["profile.read", ...managedBusinessTargetOperations], allowed_origins: [], expires_at: expiresAt,
      account_scope_selections: [{ account_system_ref: accountSystemRef, account_ref: selectedAccountRef }]
    }, service.resolveBusinessTargetAccountScopes);
  }
  // The unrelated profile:outside above deliberately has a malformed ownership projection.
  // Selecting the valid Account A tuple must validate only its own raw Profile before projection.
  assert.deepEqual(await service.resolveBusinessTargetAccountScopes(targetProfileRef, [{ account_system_ref: accountSystemRef, account_ref: accountRefA }]),
    [{ profile_ref: targetProfileRef, account_system_ref: accountSystemRef, account_ref: accountRefA }]);
  await assert.rejects(service.resolveBusinessTargetAccountScopes(targetProfileRef, [{ account_system_ref: "account-system:other", account_ref: accountRefB }]), /business_target_account_binding_conflict/);
  const businessTargetGrant = await issueBusinessTargetGrant(targetProfileRef, "business-target-profile-one");
  assert.deepEqual(businessTargetGrant.business_target_account_scopes, [{ profile_ref: targetProfileRef, account_system_ref: accountSystemRef, account_ref: accountRefA }]);
  const targetScope = (operation: string, profileRef = targetProfileRef) => ({ operations: [operation], profile_refs: [profileRef], origins: [] });
  const targetBase = { connection_id: connection.connection_id, grant_id: businessTargetGrant.grant_id, profile_ref: targetProfileRef };
  const targetCreate = { idempotency_key: "business-target-create", ...targetBase, operation: "business_target.create", account_system_ref: accountSystemRef,
    account_ref: accountRefA, label: "  Spring campaign  ", declared_external_id: "external-123", task_scope: targetScope("business_target.create") };
  const createdTarget = await service.submit(credentialHash, targetCreate);
  assert.equal(createdTarget.status, "succeeded", JSON.stringify(createdTarget));
  const targetRecord = (createdTarget.result as { business_target: Record<string, unknown> }).business_target;
  assert.equal(targetRecord.label, "Spring campaign");
  assert.equal(targetRecord.declared_external_id, "external-123");
  assert.equal(targetRecord.verification_state, "unverified");
  assert.equal(targetRecord.created_by_profile_ref, targetProfileRef);
  assert.match(String(targetRecord.business_target_ref), /^business-target:[0-9a-f-]{36}$/);
  const targetDescribeContext = { grant_id: businessTargetGrant.grant_id, profile_ref: targetProfileRef,
    task_scope: { operations: ["profile.read", "business_target.list"], profile_refs: [targetProfileRef], origins: [] } };
  const beforeTargetDescribeCatalog = managedOperationCatalogReads, beforeTargetDescribeCapabilities = capabilityDescriptions;
  const beforeTargetDescribeSessionReads = sessionReads, beforeTargetDescribeRuns = (await runRecordStore.listRunRecords()).length;
  const beforeTargetDescribeDecisions = (await authorizationDecisionStore.queryAuthorizationDecisions({ limit: 100 })).authorization_decisions.length;
  const localTargetStaticDescription = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "business_target.list" });
  assert.equal(localTargetStaticDescription.mode, "definition_only");
  assert.deepEqual(localTargetStaticDescription.execution_checks, ["reauthorize"]);
  sessionStopped = true;
  const localTargetDescription = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "business_target.list",
    context: targetDescribeContext, arguments: { account_system_ref: accountSystemRef, account_ref: accountRefA } });
  sessionStopped = false;
  assert.equal(localTargetDescription.mode, "contextual");
  assert.equal((localTargetDescription.authorization as { state: string }).state, "allowed");
  assert.equal((localTargetDescription.provider as { state: string }).state, "not_applicable", "Core-local metadata has no Provider runtime dependency");
  assert.equal((localTargetDescription.availability as { state: string }).state, "no_known_blocker",
    "a unique selected Account remains available when another binding makes the Profile aggregate conflicted");
  assert.deepEqual(localTargetDescription.execution_checks, ["reauthorize"]);
  const capabilityDescriptionSchema = JSON.parse(await readFile(new URL("../../schemas/schemas/capability-description.schema.json", import.meta.url), "utf8")) as {
    properties?: { execution_checks?: { items?: { enum?: unknown[] } } }
  };
  const formalExecutionChecks = new Set((capabilityDescriptionSchema.properties?.execution_checks?.items?.enum ?? [])
    .filter((check): check is string => typeof check === "string"));
  assert(formalExecutionChecks.size > 0, "the formal capability-description schema must declare execution_checks");
  for (const [label, description] of [["definition-only", localTargetStaticDescription], ["authorized contextual", localTargetDescription]] as const) {
    assert(Array.isArray(description.execution_checks), `${label} BusinessTarget description must return execution_checks`);
    for (const check of description.execution_checks) {
      assert.equal(typeof check, "string", `${label} execution check must be a string`);
      assert(formalExecutionChecks.has(check), `${label} execution check ${check} must be allowed by the formal response schema`);
    }
  }
  assert.equal(managedOperationCatalogReads, beforeTargetDescribeCatalog, "Core-local metadata description does not require Harbor's operation catalog");
  assert.equal(capabilityDescriptions, beforeTargetDescribeCapabilities, "Core-local metadata description does not query Harbor capability availability");
  assert.equal(sessionReads, beforeTargetDescribeSessionReads, "Core-local metadata description does not require a running Instance");
  assert.equal((await runRecordStore.listRunRecords()).length, beforeTargetDescribeRuns, "description remains read-only");
  assert.equal((await authorizationDecisionStore.queryAuthorizationDecisions({ limit: 100 })).authorization_decisions.length, beforeTargetDescribeDecisions);
  const beforeDeniedTargetIdentityReads = identityEnvironmentReads;
  const deniedConflictBindingDescription = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "business_target.list",
    context: targetDescribeContext, arguments: { account_system_ref: "account-system:other", account_ref: accountRefB } });
  assert.equal((deniedConflictBindingDescription.authorization as { state: string }).state, "denied");
  assert.equal((deniedConflictBindingDescription.availability as { state: string }).state, "blocked");
  assert.equal(identityEnvironmentReads, beforeDeniedTargetIdentityReads, "an ungranted conflicting Account is refused before identity facts are read");
  assert.deepEqual(await service.submit(credentialHash, targetCreate), createdTarget, "same-key target creation returns the original Core Run result");
  await assert.rejects(service.submit(credentialHash, { ...targetCreate, label: "Changed" }), /idempotency_conflict/);
  const targetList = await service.submit(credentialHash, { idempotency_key: "business-target-list", ...targetBase, operation: "business_target.list",
    account_system_ref: accountSystemRef, account_ref: accountRefA, task_scope: targetScope("business_target.list") });
  assert.equal((targetList.result as { business_targets: unknown[] }).business_targets.length, 1);
  const targetRef = String(targetRecord.business_target_ref);
  const targetRead = await service.submit(credentialHash, { idempotency_key: "business-target-read", ...targetBase, operation: "business_target.read",
    business_target_ref: targetRef, task_scope: targetScope("business_target.read") });
  assert.equal((targetRead.result as { business_target: { business_target_ref: string } }).business_target.business_target_ref, targetRef);
  const businessTargetRestartedService = createManagedBrowserService({ accessStore, runRecordStore, authorizationDecisionStore, executionPolicyConfigStore,
    harborBaseUrl: `http://127.0.0.1:${address.port}`, supervisorToken: "fixture-supervisor", recoveryService });
  const restartedRead = await businessTargetRestartedService.submit(credentialHash, { idempotency_key: "business-target-read-after-restart", ...targetBase, operation: "business_target.read",
    business_target_ref: targetRef, task_scope: targetScope("business_target.read") });
  assert.equal((restartedRead.result as { business_target: { business_target_ref: string; label: string } }).business_target.label, "Spring campaign",
    "a recreated Core service reads the same durable BusinessTarget record");
  assert.deepEqual(await businessTargetRestartedService.query(credentialHash, targetRead.run_id), targetRead, "existing Run query returns the original BusinessTarget result after service recreation");
  let interruptBusinessTargetCompletion = true;
  const interruptedRunStore = Object.create(runRecordStore) as typeof runRecordStore;
  const updateRunRecord = runRecordStore.updateRunRecord.bind(runRecordStore);
  interruptedRunStore.updateRunRecord = async (runId, patch) => {
    if (interruptBusinessTargetCompletion && patch.status === "succeeded") {
      interruptBusinessTargetCompletion = false;
      throw new Error("injected interruption after local BusinessTarget commit");
    }
    return updateRunRecord(runId, patch);
  };
  const interruptedService = createManagedBrowserService({ accessStore, runRecordStore: interruptedRunStore, authorizationDecisionStore, executionPolicyConfigStore,
    harborBaseUrl: `http://127.0.0.1:${address.port}`, supervisorToken: "fixture-supervisor", recoveryService });
  const interruptedCreate = await interruptedService.submit(credentialHash, { idempotency_key: "business-target-commit-result-lost", ...targetBase, operation: "business_target.create",
    account_system_ref: accountSystemRef, account_ref: accountRefA, label: "Persisted after interruption", task_scope: targetScope("business_target.create") });
  assert.equal(interruptedCreate.status, "unknown_outcome", "a lost Core result projection preserves the original unknown Run");
  const reconciledBusinessTarget = await businessTargetRestartedService.query(credentialHash, interruptedCreate.run_id);
  assert.equal(reconciledBusinessTarget.status, "unknown_outcome", "receipt reconciliation does not relabel the original unknown Run as success");
  assert.equal(reconciledBusinessTarget.reconciliation, "completed");
  assert.equal((reconciledBusinessTarget.result as { business_target: { label: string } }).business_target.label, "Persisted after interruption",
    "query reads the atomic local receipt without replaying the creation");
  const targetUpdate = await service.submit(credentialHash, { idempotency_key: "business-target-update", ...targetBase, operation: "business_target.metadata.update",
    business_target_ref: targetRef, label: "Updated campaign", task_scope: targetScope("business_target.metadata.update") });
  assert.equal((targetUpdate.result as { business_target: { label: string; declared_external_id: string } }).business_target.label, "Updated campaign");
  assert.equal((targetUpdate.result as { business_target: { declared_external_id: string } }).business_target.declared_external_id, "external-123");
  await assert.rejects(service.submit(credentialHash, { idempotency_key: "business-target-other-account", ...targetBase, operation: "business_target.list",
    account_system_ref: accountSystemRef, account_ref: accountRefB, task_scope: targetScope("business_target.list") }), /managed_access_denied/);
  const otherAccountProfile = { refs: { profile_ref: "profile:business-target-other-account" }, identity_environment_ref: "identity:business-target-other-account", name: "Other Account", tags: [],
    site: { origin: "https://example.com", display_name: "Example" }, status: { readiness: "ready" }, account_bindings: [],
    environment_summary: { provider_id: "camoufox" }, identity_ownership: ownership(accountRefB) };
  profiles.push(otherAccountProfile);
  const otherAccountGrant = await issueBusinessTargetGrant(otherAccountProfile.refs.profile_ref, "business-target-other-account", accountRefB);
  const otherAccountScope = { connection_id: connection.connection_id, grant_id: otherAccountGrant.grant_id, profile_ref: otherAccountProfile.refs.profile_ref };
  const otherAccountList = await service.submit(credentialHash, { idempotency_key: "business-target-list-isolated", ...otherAccountScope, operation: "business_target.list",
    account_system_ref: accountSystemRef, account_ref: accountRefB, task_scope: targetScope("business_target.list", otherAccountProfile.refs.profile_ref) });
  assert.deepEqual((otherAccountList.result as { business_targets: unknown[] }).business_targets, [], "another Account cannot enumerate a target record or infer its count");
  const otherAccountRead = await service.submit(credentialHash, { idempotency_key: "business-target-read-isolated", ...otherAccountScope, operation: "business_target.read",
    business_target_ref: targetRef, task_scope: targetScope("business_target.read", otherAccountProfile.refs.profile_ref) });
  assert.equal(otherAccountRead.failure?.code, "business_target_unavailable", "another Account cannot resolve an opaque ref to the original target record");
  profiles.splice(profiles.indexOf(otherAccountProfile), 1);
  const disabledTarget = await service.submit(credentialHash, { idempotency_key: "business-target-disable", ...targetBase, operation: "business_target.disable",
    business_target_ref: targetRef, task_scope: targetScope("business_target.disable") });
  assert.equal((disabledTarget.result as { business_target: { status: string } }).business_target.status, "disabled");
  profileOne.identity_ownership = ownership(accountRefB);
  const reboundTarget = await service.submit(credentialHash, { idempotency_key: "business-target-rebound", ...targetBase, operation: "business_target.list",
    account_system_ref: accountSystemRef, account_ref: accountRefA, task_scope: targetScope("business_target.list") });
  assert.equal(reboundTarget.failure?.code, "business_target_account_binding_changed");
  profileOne.identity_ownership = ownership(accountRefA, "not_runnable");
  const nonRunnableTarget = await service.submit(credentialHash, { idempotency_key: "business-target-not-runnable", ...targetBase, operation: "business_target.read",
    business_target_ref: targetRef, task_scope: targetScope("business_target.read") });
  assert.equal(nonRunnableTarget.failure?.code, "business_target_account_not_runnable");
  assert.equal((await accessStore.list()).grants.find(item => item.grant_id === grant.grant_id)?.business_target_account_scopes, undefined, "old Grants are never backfilled with Account scope");
  const migratedProfile = { refs: { profile_ref: "profile:migrated" }, identity_environment_ref: "identity:migrated", name: "Migrated", tags: [],
    site: { origin: "https://example.com", display_name: "Example" }, status: { readiness: "ready" }, account_bindings: [],
    environment_summary: { provider_id: "camoufox" }, identity_ownership: ownership(accountRefA) };
  profiles.push(migratedProfile);
  const migratedGrant = await issueBusinessTargetGrant("profile:migrated", "business-target-profile-migrated");
  const migratedRead = await service.submit(credentialHash, { idempotency_key: "business-target-migrated-read", connection_id: connection.connection_id,
    grant_id: migratedGrant.grant_id, profile_ref: "profile:migrated", operation: "business_target.read", business_target_ref: targetRef,
    task_scope: targetScope("business_target.read", "profile:migrated") });
  const migratedRecord = (migratedRead.result as { business_target: Record<string, unknown> }).business_target;
  assert.equal(migratedRecord.business_target_ref, targetRef);
  assert.equal(migratedRecord.created_by_profile_ref, targetProfileRef, "same Account migration keeps original Profile only as provenance");
  assert.equal(migratedRecord.status, "disabled", "disabled target history remains readable under a newly authorized Profile");
  profileOne.identity_ownership = ownership(accountRefA);
  const currentTargetDescribeContext = { grant_id: businessTargetGrant.grant_id, profile_ref: targetProfileRef,
    task_scope: { operations: ["profile.read", "business_target.list"], profile_refs: [targetProfileRef], origins: [] } };
  const changedOwnership = ownership(accountRefA, "conflict");
  (changedOwnership.history.bindings[0] as { ownership_status: string }).ownership_status = "conflict";
  afterIdentityEnvironmentSnapshot = async () => { profileOne.identity_ownership = changedOwnership; };
  const changedBindingDescription = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "business_target.list",
    context: currentTargetDescribeContext, arguments: { account_system_ref: accountSystemRef, account_ref: accountRefA } });
  assert.equal((changedBindingDescription.provider as { state: string }).state, "not_applicable");
  assert.equal((changedBindingDescription.availability as { state: string }).state, "unknown",
    "a binding conflict appearing during description cannot be reported as available");
  assert.deepEqual((changedBindingDescription.availability as { reason_codes: string[] }).reason_codes, ["facts_changed"]);
  profileOne.identity_ownership = ownership(accountRefA);
  afterIdentityEnvironmentSnapshot = async () => {
    await accessStore.revokeGrant({ idempotency_key: "revoke-business-target-during-description", grant_id: businessTargetGrant.grant_id });
  };
  const revokedTargetDescription = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "business_target.list",
    context: currentTargetDescribeContext, arguments: { account_system_ref: accountSystemRef, account_ref: accountRefA } });
  assert.equal((revokedTargetDescription.provider as { state: string }).state, "not_applicable");
  assert.equal((revokedTargetDescription.authorization as { state: string }).state, "unknown");
  assert.equal((revokedTargetDescription.availability as { state: string }).state, "unknown",
    "a Grant revoked while Harbor facts are being read cannot be reported as available");
  assert.deepEqual((revokedTargetDescription.availability as { reason_codes: string[] }).reason_codes, ["facts_changed"]);
  profiles.splice(profiles.indexOf(profileOne), 1);
  profiles.splice(profiles.indexOf(migratedProfile), 1);

  const preferenceOperations = ["provider.preference.read", "provider.preference.set", "provider.preference.clear"] as const;
  const preferenceGrant = await accessStore.createGrant({ idempotency_key: "preference-grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: [...preferenceOperations], allowed_origins: [], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const preferenceRequest = { idempotency_key: "preference-read", connection_id: connection.connection_id, grant_id: preferenceGrant.grant_id, operation: "provider.preference.read" as const, task_scope: { operations: [...preferenceOperations], profile_refs: [], origins: [] } };
  const providerReadsBefore = providerCatalogReads;
  const createsBeforeProviderRead = creates;
  const readPreference = await service.submit(credentialHash, preferenceRequest);
  assert.equal(readPreference.status, "succeeded", JSON.stringify(readPreference));
  assert.equal(providerCatalogReads, providerReadsBefore + 1, "authorized no-profile preference read includes the current Harbor Provider catalog");
  assert.equal(creates, createsBeforeProviderRead, "Provider discovery must not create a Profile or start an Instance");
  const providerFactsResult = readPreference.result as { preference: ReturnType<typeof preferenceSnapshot>; provider_facts: { schema_version: string; providers: Array<Record<string, unknown>> } };
  assert.equal(providerFactsResult.preference.project_recommendation.provider_id, "camoufox");
  assert.equal(providerFactsResult.preference.user_creation_default.availability, "unset");
  assert.equal(providerFactsResult.provider_facts.schema_version, "webenvoy.provider-catalog-facts/v1");
  assert.equal(providerFactsResult.provider_facts.providers.find(provider => provider.provider_id === "camoufox")?.role, "primary");
  const camoufoxProjection = providerFactsResult.provider_facts.providers.find(provider => provider.provider_id === "camoufox")!;
  assert.equal((camoufoxProjection.capabilities as Array<Record<string, unknown>>)[0]?.summary, "原版 JSONL Driver 不暴露远程调试接口；Harbor 使用公开 Playwright Page。");
  assert.deepEqual(camoufoxProjection.limitations, [
    "仅接受 owner 提供且重新验证的 official_release source、Camoufox 0.5.6、browser 152.0.4-beta.30、Playwright 1.60.0 和 properties hash。",
    "Driver 只调用公开 launch_options、sync_playwright、persistent context 和 Page API；不恢复旧 patched/native adapter/browser builder。",
    "popup 首请求在无法建立可信 Page 归属时本地拒绝；原生焦点是可选 Viewer，不能替代 task Page。",
    "不暴露远程调试接口、页面标记内容、网络归档或反检测成功保证。"
  ]);
  assert.equal(((providerFactsResult.provider_facts.providers.find(provider => provider.provider_id === "cloakbrowser")?.availability as Record<string, unknown>).unavailable_reason), "provider_not_installed");
  assert.equal(JSON.stringify(readPreference.result).includes("/private/"), false, "Core must not expose Provider install paths");
  assert.equal(JSON.stringify(readPreference.result).includes("private-hash"), false, "Core must not expose executable hashes");
  assert.equal(JSON.stringify(readPreference.result).includes("download_guide"), false, "Core must not expose installation guides through Agent operation facts");
  const unsafeCatalogWithPath = structuredClone(providerCatalog);
  unsafeCatalogWithPath.providers[2]!.limitations = ["Harbor configuration path: /private/provider/secret-profile"];
  assert.equal(projectManagedProviderCatalogFacts(unsafeCatalogWithPath), undefined, "raw Provider paths must remain rejected");
  const unsafeCatalogWithSecret = structuredClone(providerCatalog);
  unsafeCatalogWithSecret.providers[2]!.limitations = ["Provider token=private-secret-value"];
  assert.equal(projectManagedProviderCatalogFacts(unsafeCatalogWithSecret), undefined, "secret-bearing Provider summaries must remain rejected");
  const recommendedCatalogProvider = providerCatalog.providers.find(provider => provider.provider_id === "camoufox")!;
  recommendedCatalogProvider.project_recommended = false;
  const malformedProviderFacts = await service.submit(credentialHash, { ...preferenceRequest, idempotency_key: "malformed-provider-facts" });
  recommendedCatalogProvider.project_recommended = true;
  assert.equal(malformedProviderFacts.failure?.code, "managed_browser_provider_facts_malformed", "inconsistent Harbor recommendation facts fail closed");
  assert.equal(JSON.stringify(malformedProviderFacts).includes("/private/"), false, "malformed Harbor catalog contents are not persisted into a failed Run");
  const previousPreferenceValue = browserPreference;
  browserPreference = "/private/profile";
  const malformedPreference = await service.submit(credentialHash, { ...preferenceRequest, idempotency_key: "malformed-provider-default" });
  browserPreference = previousPreferenceValue;
  assert.equal(malformedPreference.failure?.code, "managed_browser_provider_facts_malformed", "a malformed Harbor default reference is not returned to the Agent");
  assert.equal(JSON.stringify(malformedPreference).includes("/private/profile"), false, "malformed Harbor preference values are not persisted into a failed Run");
  const providerReadsBeforeDenied = providerCatalogReads;
  await assert.rejects(service.submit(credentialHash, { ...preferenceRequest, idempotency_key: "preference-bad-scope", task_scope: { ...preferenceRequest.task_scope, origins: ["https://example.com"] } }), /managed_access_denied/);
  assert.equal(providerCatalogReads, providerReadsBeforeDenied, "denied Agent scope must not read Harbor Provider facts");
  const setPreference = await service.submit(credentialHash, { ...preferenceRequest, idempotency_key: "preference-set", operation: "provider.preference.set" as const, provider_id: "chrome_official" as const });
  assert.equal(setPreference.status, "succeeded", JSON.stringify(setPreference));
  assert.equal(browserPreference, "chrome_official");
  const updatedPreference = await service.submit(credentialHash, { ...preferenceRequest, idempotency_key: "preference-read-after-set" });
  assert.equal(updatedPreference.status, "succeeded", JSON.stringify(updatedPreference));
  assert.equal((updatedPreference.result as { preference: ReturnType<typeof preferenceSnapshot> }).preference.user_creation_default.provider_id, "chrome_official");
  assert.equal(providerCatalogReads, providerReadsBeforeDenied + 1, "a later authorized read observes the Harbor-owned user default");

  const dynamicTemplate = { ...grant.creation_template!, template_ref: "template:dynamic", provider_id: null };
  const dynamicGrant = await accessStore.createGrant({ idempotency_key: "dynamic-grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: ["profile.create"], allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 2, creation_template: dynamicTemplate });
  const dynamicRequest = { ...request, idempotency_key: "dynamic-default", grant_id: dynamicGrant.grant_id, template_ref: dynamicTemplate.template_ref, provider_id: undefined, task_scope: { operations: ["profile.create" as const], profile_refs: [], origins: ["https://example.com"] } };
  const dynamicDefault = await service.submit(credentialHash, dynamicRequest);
  assert.equal(dynamicDefault.status, "succeeded", JSON.stringify(dynamicDefault));
  assert.equal((dynamicDefault.result as { profile: { environment_summary: { provider_id: string } } }).profile.environment_summary.provider_id, "chrome_official");
  assert.equal((dynamicDefault.result as { provider_selection: { source: string } }).provider_selection.source, "user_default");
  assert.equal(requestedProviders.at(-1), undefined, "dynamic omission leaves Harbor to snapshot the user default");
  const dynamicExplicit = await service.submit(credentialHash, { ...dynamicRequest, idempotency_key: "dynamic-explicit", provider_id: "camoufox" as const });
  assert.equal((dynamicExplicit.result as { profile: { environment_summary: { provider_id: string } } }).profile.environment_summary.provider_id, "camoufox");
  assert.equal((dynamicExplicit.result as { provider_selection: { source: string } }).provider_selection.source, "explicit_request");

  dropPreferenceResponse = true;
  const lostPreference = await service.submit(credentialHash, { ...preferenceRequest, idempotency_key: "preference-lost", operation: "provider.preference.clear" as const });
  dropPreferenceResponse = false;
  assert.equal(lostPreference.status, "unknown_outcome");
  const preferenceMutationCount = preferenceMutations;
  const queriedPreference = await service.query(credentialHash, lostPreference.run_id);
  assert.equal(queriedPreference.status, "unknown_outcome");
  assert.equal(queriedPreference.result !== undefined, true);
  assert.equal(preferenceMutations, preferenceMutationCount, "preference receipt query must not replay the write");
  const noDefaultGrant = await accessStore.createGrant({ idempotency_key: "no-default-grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: ["profile.create"], allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 1, creation_template: dynamicTemplate });
  const noDefault = await service.submit(credentialHash, { ...dynamicRequest, idempotency_key: "dynamic-no-default", grant_id: noDefaultGrant.grant_id });
  assert.equal(noDefault.failure?.code, "provider_selection_required");

  const rejectedRecoveryGrant = await accessStore.createGrant({ idempotency_key: "rejected-recovery-grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: ["profile.create"], allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 1, creation_template: dynamicTemplate });
  dropResponse = true;
  const lostRejection = await service.submit(credentialHash, { ...dynamicRequest, idempotency_key: "lost-selection-rejection", grant_id: rejectedRecoveryGrant.grant_id });
  dropResponse = false;
  assert.equal(lostRejection.status, "unknown_outcome");
  const reconciledRejection = await service.query(credentialHash, lostRejection.run_id);
  assert.equal(reconciledRejection.status, "unknown_outcome", "query keeps the original unknown history");
  assert.equal(reconciledRejection.reconciliation, "completed");
  assert.equal((reconciledRejection.result as { receipt: { failure: { code: string } } }).receipt.failure.code, "provider_selection_required");
  browserPreference = "chrome_official";
  assert.equal((await service.submit(credentialHash, { ...dynamicRequest, idempotency_key: "create-after-rejected-reconciliation", grant_id: rejectedRecoveryGrant.grant_id })).status, "succeeded");

  const invalidSelectionGrant = await accessStore.createGrant({ idempotency_key: "invalid-selection-grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: ["profile.create"], allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 1, creation_template: dynamicTemplate });
  omitProviderSelection = true;
  const invalidSelection = await service.submit(credentialHash, { ...dynamicRequest, idempotency_key: "missing-provider-selection", grant_id: invalidSelectionGrant.grant_id });
  omitProviderSelection = false;
  assert.equal(invalidSelection.status, "unknown_outcome");
  assert.equal(invalidSelection.failure?.code, "managed_browser_provider_selection_invalid");
  assert.equal((await accessStore.list()).grants.find(item => item.grant_id === invalidSelectionGrant.grant_id)?.created_profile_refs.length, 0);
  const invalidSelectionCreates = creates;
  const blockedAfterInvalidSelection = await service.submit(credentialHash, { ...dynamicRequest, idempotency_key: "blocked-after-missing-provider-selection", grant_id: invalidSelectionGrant.grant_id });
  assert.equal(blockedAfterInvalidSelection.failure?.code, "managed_browser_creation_reconciliation_required");
  assert.equal(creates, invalidSelectionCreates);

  const invalidSelectionQueryGrant = await accessStore.createGrant({ idempotency_key: "invalid-selection-query-grant", principal_id: principal.principal_id, profile_refs: [], allowed_operations: ["profile.create"], allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 1, creation_template: dynamicTemplate });
  omitProviderSelection = true;
  dropResponse = true;
  const lostInvalidSelection = await service.submit(credentialHash, { ...dynamicRequest, idempotency_key: "lost-missing-provider-selection", grant_id: invalidSelectionQueryGrant.grant_id });
  omitProviderSelection = false;
  dropResponse = false;
  assert.equal(lostInvalidSelection.status, "unknown_outcome");
  const queriedInvalidSelection = await service.query(credentialHash, lostInvalidSelection.run_id);
  assert.equal(queriedInvalidSelection.status, "unknown_outcome");
  assert.equal(queriedInvalidSelection.failure?.code, "managed_browser_provider_selection_invalid");
  const blockedAfterInvalidSelectionQuery = await service.submit(credentialHash, { ...dynamicRequest, idempotency_key: "blocked-after-query-missing-provider-selection", grant_id: invalidSelectionQueryGrant.grant_id });
  assert.equal(blockedAfterInvalidSelectionQuery.failure?.code, "managed_browser_creation_reconciliation_required");
  assert.equal((await accessStore.list()).grants.find(item => item.grant_id === invalidSelectionQueryGrant.grant_id)?.created_profile_refs.length, 0);

  const malformedCreateGrant = await accessStore.createGrant({ idempotency_key: "malformed-create-grant", principal_id: principal.principal_id,
    profile_refs: [], allowed_operations: ["profile.create"], allowed_origins: ["https://example.com"],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 1, creation_template: dynamicTemplate });
  const malformedCreateRequest = { ...dynamicRequest, idempotency_key: "malformed-create-response", grant_id: malformedCreateGrant.grant_id,
    task_scope: { operations: ["profile.create" as const], profile_refs: [], origins: ["https://example.com"] } };
  const createCountBeforeMalformedReply = creates;
  malformedCreateReply = true;
  const malformedCreate = await service.submit(credentialHash, malformedCreateRequest);
  malformedCreateReply = false;
  assert.equal(malformedCreate.status, "unknown_outcome", "a non-object HTTP reply after create dispatch is unknown");
  const blockedMalformedCreate = await service.submit(credentialHash, { ...malformedCreateRequest, idempotency_key: "create-after-malformed-response" });
  assert.equal(blockedMalformedCreate.failure?.code, "managed_browser_creation_reconciliation_required");
  assert.equal(creates, createCountBeforeMalformedReply + 1);
  const queriedMalformedCreate = await service.query(credentialHash, malformedCreate.run_id);
  assert.equal(queriedMalformedCreate.status, "unknown_outcome");
  assert.equal((queriedMalformedCreate.result as { profile: { profile_ref: string } }).profile.profile_ref, `profile:${createCountBeforeMalformedReply + 1}`);
  assert.deepEqual((await accessStore.list()).grants.find(item => item.grant_id === malformedCreateGrant.grant_id)?.created_profile_refs,
    [`profile:${createCountBeforeMalformedReply + 1}`]);
  await assert.rejects(service.submit(credentialHash, { ...malformedCreateRequest, idempotency_key: "create-after-malformed-reconciliation" }), /managed_access_creation_denied/);
  assert.equal(creates, createCountBeforeMalformedReply + 1, "receipt reconciliation consumes the only quota slot without replay");

  const browserOps = ["instance.navigate", "instance.read", "instance.observe"];
  await accessStore.setProfilePolicy({ idempotency_key: "public-policy", profile_ref: "profile:1", allowed_operations: browserOps, allowed_origins: ["https://example.com"] });
  const publicGrant = await accessStore.createGrant({ idempotency_key: "public-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: browserOps, allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  managedSession = { runtime_session_ref: "session:one", identity_environment_ref: "identity:1", execution_identity_ref: "identity:1:execution",
    profile_ref: "profile:1", provider_ref: "harbor:provider/camoufox", provider_mode: "local_dedicated_profile", lifecycle_state: "active",
    control_owner: "core_task", control_lock: { state: "held", holder_ref: principal.principal_id }, current_page: { current_url: "https://example.com/" } };
  const diagnosticsOps = ["instance.diagnostics"];
  await accessStore.setProfilePolicy({ idempotency_key: "diagnostics-policy", profile_ref: "profile:1", allowed_operations: [...diagnosticsOps, ...browserOps], allowed_origins: ["https://example.com"] });
  const diagnosticsGrant = await accessStore.createGrant({ idempotency_key: "diagnostics-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: diagnosticsOps, allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  managedSession.control_owner = "user";
  managedSession.control_lock = { state: "released", holder_ref: null };
  const diagnosticResult = await service.submit(credentialHash, { idempotency_key: "diagnostics-one", connection_id: connection.connection_id, grant_id: diagnosticsGrant.grant_id, operation: "instance.diagnostics", profile_ref: "profile:1", origin: "https://example.com", runtime_session_ref: "session:one", task_scope: { operations: diagnosticsOps, profile_refs: ["profile:1"], origins: ["https://example.com"] } });
  assert.equal(diagnosticResult.status, "succeeded", JSON.stringify(diagnosticResult));
  assert.equal((diagnosticResult.result as { network: { status: number }[] }).network[0]?.status, 503);
  const diagnosticBinding = (await runRecordStore.getRunRecord(diagnosticResult.run_id))?.admission.runtime_session_binding;
  assert.equal(diagnosticBinding?.control_owner, "user");
  assert.equal(diagnosticBinding?.session_use, "manual_browsing", "binding retains the Harbor owner rather than claiming Core holds the lease");
  assert.equal(diagnostics, 1);
  assert.equal(lockAttempts, 0, "diagnostics must not acquire ControlLease");
  const diagnosticRequest = { idempotency_key: "diagnostics-page", connection_id: connection.connection_id, grant_id: diagnosticsGrant.grant_id, operation: "instance.diagnostics", profile_ref: "profile:1", origin: "https://example.com", runtime_session_ref: "session:one", page_ref: "page:one", cursor: "cursor:1", limit: 1, task_scope: { operations: diagnosticsOps, profile_refs: ["profile:1"], origins: ["https://example.com"] } };
  assert.equal((await service.submit(credentialHash, diagnosticRequest)).status, "succeeded");
  for (const invalid of [{ limit: 65 }, { limit: 0 }, { target_ref: "target:one" }, { body: "not allowed" }, { headers: { authorization: "fixture" } }]) {
    await assert.rejects(service.submit(credentialHash, { ...diagnosticRequest, ...invalid, idempotency_key: "invalid-diagnostics" }), /invalid_input/);
  }
  for (const override of [{ profile_ref: "profile:2" }, { origin: "https://denied.example" }, { grant_id: publicGrant.grant_id }, { task_scope: { ...diagnosticRequest.task_scope, operations: [] } }]) {
    await assert.rejects(service.submit(credentialHash, { ...diagnosticRequest, ...override, idempotency_key: "denied-diagnostics" }), /managed_access_denied/);
  }
  assert.equal((await service.submit(credentialHash, { ...diagnosticRequest, idempotency_key: "wrong-instance-diagnostics", runtime_session_ref: "session:wrong" })).failure?.code, "managed_browser_session_mismatch");
  assert.equal(diagnostics, 2, "denials must not reach the provider");
  dropDiagnosticsResponse = true;
  const lostDiagnostics = await service.submit(credentialHash, { ...diagnosticRequest, idempotency_key: "lost-diagnostics" });
  dropDiagnosticsResponse = false;
  const diagnosticReconnect = await accessStore.connect(credentialHash);
  assert.deepEqual(await service.query(credentialHash, lostDiagnostics.run_id), lostDiagnostics);
  assert.equal((await service.submit(credentialHash, { ...diagnosticRequest, connection_id: diagnosticReconnect.connection_id, idempotency_key: "fresh-diagnostics" })).status, "succeeded");
  assert.equal(navigations, 0, "diagnostic response loss and reconnect never generate a page action");
  assert.equal(lockAttempts, 0);
  const diagnosticsExtraOrigin = "https://second.example";
  const diagnosticsScopeOperations = ["instance.diagnostics"];
  await accessStore.setProfilePolicy({ idempotency_key: "diagnostics-scope-wide", profile_ref: "profile:1",
    allowed_operations: diagnosticsScopeOperations, allowed_origins: ["https://example.com", diagnosticsExtraOrigin] });
  const diagnosticsScopeGrant = await accessStore.createGrant({ idempotency_key: "diagnostics-scope-grant", principal_id: principal.principal_id,
    profile_refs: ["profile:1"], allowed_operations: diagnosticsScopeOperations, allowed_origins: ["https://example.com", diagnosticsExtraOrigin],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const diagnosticsScopeRequest = { idempotency_key: "diagnostics-scope", connection_id: connection.connection_id, grant_id: diagnosticsScopeGrant.grant_id,
    operation: "instance.diagnostics", profile_ref: "profile:1", origin: "https://example.com", runtime_session_ref: "session:one",
    task_scope: { operations: diagnosticsScopeOperations, profile_refs: ["profile:1"], origins: [diagnosticsExtraOrigin, "https://example.com"] } };
  afterProfileList = async () => { await accessStore.setProfilePolicy({ idempotency_key: "diagnostics-scope-narrow", profile_ref: "profile:1",
    allowed_operations: diagnosticsScopeOperations, allowed_origins: ["https://example.com"] }); };
  let diagnosticsScopeResult;
  try {
    diagnosticsScopeResult = await service.submit(credentialHash, diagnosticsScopeRequest);
  } finally {
    afterProfileList = undefined;
  }
  assert.equal(diagnosticsScopeResult.status, "succeeded", JSON.stringify(diagnosticsScopeResult));
  assert.deepEqual(forwardedDiagnosticsOrigins.at(-1), ["https://example.com"], "diagnostics forwards the latest checked origin scope");
  await accessStore.revokeGrant({ idempotency_key: "revoke-diagnostics-scope", grant_id: diagnosticsScopeGrant.grant_id });
  await accessStore.setProfilePolicy({ idempotency_key: "diagnostics-scope-restore", profile_ref: "profile:1",
    allowed_operations: [...diagnosticsOps, ...browserOps], allowed_origins: ["https://example.com"] });
  await accessStore.revokeGrant({ idempotency_key: "revoke-diagnostics", grant_id: diagnosticsGrant.grant_id });
  await assert.rejects(service.submit(credentialHash, { ...diagnosticRequest, idempotency_key: "revoked-diagnostics" }), /grant_unavailable/);
  managedSession.control_owner = "core_task";
  managedSession.control_lock = { state: "held", holder_ref: principal.principal_id };
  const navigation = { idempotency_key: "navigate-one", connection_id: connection.connection_id, grant_id: publicGrant.grant_id, operation: "instance.navigate", profile_ref: "profile:1", origin: "https://example.com", url: "https://example.com/one", runtime_session_ref: "session:one", page_id: "page-id:one", page_ref: "page:one", document_generation: 1, task_scope: { operations: browserOps, profile_refs: ["profile:1"], origins: ["https://example.com"] } };
  await assert.rejects(service.submit(credentialHash, { ...navigation, runtime_session_ref: undefined }), /invalid_input/);
  const stale = await service.submit(credentialHash, { ...navigation, idempotency_key: "old-session", runtime_session_ref: "session:old" });
  assert.equal(stale.failure?.code, "managed_browser_session_mismatch");
  const managedRunId = (key: string) => `managed-${createHash("sha256").update(`${principal.principal_id}:${key}`).digest("hex")}`;
  assert.equal((await runRecordStore.getRunRecord(managedRunId("old-session")))?.admission.runtime_session_binding, undefined,
    "an unverified request session ref must not create a durable session binding");
  assert.equal(navigations, 0);
  const navigated = await service.submit(credentialHash, navigation);
  assert.equal(navigated.status, "succeeded", JSON.stringify(navigated));
  assert.equal((await runRecordStore.getRunRecord(navigated.run_id))?.admission.runtime_session_binding?.runtime_session_ref, "session:one",
    "managed operations persist only the exact Harbor-confirmed session");
  assert.equal(navigations, 1);
  assert.equal(observations, 1, "fresh observation precedes navigation after reconnect or handback");
  assert.deepEqual(await service.query(credentialHash, navigated.run_id), navigated);
  assert.deepEqual(await service.submit(credentialHash, navigation), navigated);
  assert.equal(navigations, 1, "query and duplicate submission never replay navigation");
  const content = await service.submit(credentialHash, { ...navigation, idempotency_key: "read-one", operation: "instance.read", url: undefined });
  assert.equal((content.result as { text: string }).text, "Example Domain is for use in documentation examples.");
  const observed = await service.submit(credentialHash, { ...navigation, idempotency_key: "observe-one", operation: "instance.observe", url: undefined });
  assert.equal(observed.status, "succeeded", JSON.stringify(observed));
  assert.equal((observed.result as { observation: { page: { current_url: string } } }).observation.page.current_url, "https://example.com/one");
  const accountSystemRef = "account-system:github";
  const accountRef = `account:sha256:${"a".repeat(64)}`;
  const accountBindingScopes = [{ profile_ref: "profile:1", account_system_ref: accountSystemRef, account_ref: accountRef }];
  await accessStore.setProfilePolicy({ idempotency_key: "account-bind-policy", profile_ref: "profile:1", allowed_operations: ["account.bind"], allowed_origins: ["https://example.com"] });
  const accountBindGrant = await accessStore.createGrant({ idempotency_key: "account-bind-grant", principal_id: principal.principal_id,
    profile_refs: ["profile:1"], allowed_operations: ["account.bind"], allowed_origins: ["https://example.com"],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null,
    account_binding_scopes: accountBindingScopes });
  const accountBindRequest = { idempotency_key: "account-bind-lost-response", connection_id: connection.connection_id, grant_id: accountBindGrant.grant_id,
    operation: "account.bind", profile_ref: "profile:1", origin: "https://example.com", runtime_session_ref: "session:one",
    page_id: "page-id:one", page_ref: "page:one", document_generation: 1, observation_ref: "observation:trusted",
    account_system_ref: accountSystemRef, account_ref: accountRef,
    task_scope: { operations: ["account.bind"], profile_refs: ["profile:1"], origins: ["https://example.com"], account_binding_scopes: accountBindingScopes } };
  malformedAccountBindingResponse = true;
  const lostBindingResponse = await service.submit(credentialHash, accountBindRequest);
  malformedAccountBindingResponse = false;
  assert.equal(lostBindingResponse.status, "unknown_outcome", "a malformed post-bind success body cannot become a known failure");
  assert.equal(lostBindingResponse.dispatch_state, "dispatched");
  const observedBeforeBindingQuery = observations;
  const reconciledBinding = await service.query(credentialHash, lostBindingResponse.run_id);
  assert.equal(reconciledBinding.status, "unknown_outcome", "receipt recovery preserves the Run's historical unknown status");
  assert.equal(reconciledBinding.reconciliation, "completed", JSON.stringify(reconciledBinding));
  assert.equal((reconciledBinding.result as { observation: { account: { account_ref: string } } }).observation.account.account_ref, accountRef);
  assert.equal(accountBindingPosts, 1, "binding query never replays Harbor's mutation");
  assert.equal(observations, observedBeforeBindingQuery, "binding query never creates a fresh observation");
  assert.deepEqual(await service.submit(credentialHash, accountBindRequest), reconciledBinding, "the same key retains its recovered original result");
  await assert.rejects(service.submit(credentialHash, { ...accountBindRequest, account_ref: `account:sha256:${"b".repeat(64)}` }), /idempotency_conflict/);
  for (const denied of [{ ...navigation, profile_ref: "profile:2" }, { ...navigation, origin: "https://denied.example", url: "https://denied.example/" }, { ...navigation, task_scope: { ...navigation.task_scope, operations: ["instance.read"] } }]) {
    await assert.rejects(service.submit(credentialHash, { ...denied, idempotency_key: "denied" }), /managed_access_denied/);
  }
  await accessStore.revokeGrant({ idempotency_key: "revoke-public", grant_id: publicGrant.grant_id });
  const publicReconnect = await accessStore.connect(credentialHash);
  await assert.rejects(service.submit(credentialHash, { ...navigation, connection_id: publicReconnect.connection_id, idempotency_key: "after-public-revoke" }), /grant_unavailable/);
  assert.equal(navigations, 1);
  assert.deepEqual(await service.query(credentialHash, navigated.run_id), navigated);
  const origin = "http://127.0.0.1:18794";
  const interactionOps = [...managedInteractionOperations];
  const policy = { profile_ref: "profile:1", allowed_operations: interactionOps, allowed_origins: [origin] };
  await accessStore.setProfilePolicy({ idempotency_key: "no-declaration", ...policy });
  const interactiveGrant = await accessStore.createGrant({ idempotency_key: "controlled-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: interactionOps, allowed_origins: [origin], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const interactive = { idempotency_key: "snapshot", connection_id: connection.connection_id, grant_id: interactiveGrant.grant_id,
    operation: "instance.snapshot", profile_ref: "profile:1", origin, runtime_session_ref: "session:one", page_id: "page-id:one", page_ref: "page:one", document_generation: 1, limit: 128,
    task_scope: { operations: interactionOps, profile_refs: ["profile:1"], origins: [origin] } };
  await assert.rejects(service.submit(credentialHash, interactive), /controlled_origin_required/);
  await assert.rejects(accessStore.setProfilePolicy({ idempotency_key: "invalid-declaration", ...policy, controlled_interaction_origins: ["http://127.0.0.1:18795"] }), /invalid_input/);
  await accessStore.setProfilePolicy({ idempotency_key: "controlled-declaration", ...policy, controlled_interaction_origins: [origin] });
  const snapshot = await service.submit(credentialHash, interactive);
  assert.equal(snapshot.status, "succeeded", JSON.stringify(snapshot));
  const beforeSnapshotReplay = interactions;
  const restartedStore = createFileRunRecordStore({ directory: runRecordStore.directory });
  const restartedService = createManagedBrowserService({ accessStore, runRecordStore: restartedStore, executionPolicyConfigStore,
    authorizationDecisionStore, harborBaseUrl: `http://127.0.0.1:${address.port}`, supervisorToken: "fixture-supervisor", recoveryService });
  assert.deepEqual(await restartedService.submit(credentialHash, interactive), snapshot, "a completed result is queryable after Core restart");
  assert.equal(interactions, beforeSnapshotReplay, "same-key result lookup after restart must not redispatch the observation");
  const continuation = await service.submit(credentialHash, { ...interactive, idempotency_key: "snapshot-continuation", observation_ref: "observation:1", cursor: "cursor:next", limit: 32 });
  assert.equal(continuation.status, "succeeded", JSON.stringify(continuation));
  assert.deepEqual(Object.fromEntries(["page_id", "page_ref", "document_generation", "observation_ref", "cursor", "limit"].map(key => [key, forwardedInteractionInputs.at(-1)![key]])), {
    page_id: "page-id:one", page_ref: "page:one", document_generation: 1, observation_ref: "observation:1", cursor: "cursor:next", limit: 32
  }, "Core must forward the complete continuation binding instead of starting a new snapshot");
  const { limit: _snapshotLimit, ...interactiveWithoutLimit } = interactive;
  const input = { ...interactiveWithoutLimit, idempotency_key: "input-one", operation: "instance.input", page_ref: "page:one", observation_ref: "observation:1", target_ref: "target:one", text: "ordinary test" };
  const deniedPolicy = await service.submit(credentialHash, { ...input, idempotency_key: "prepare-not-allowed" });
  assert.equal(deniedPolicy.failure?.code, "managed_browser_policy_refused");
  assert.equal(deniedPolicy.dispatch_state, "not_dispatched");
  assert.equal(interactions, 1);
  const pageOps = ["page.list", "page.open", "page.navigate"] as const;
  await accessStore.setProfilePolicy({ idempotency_key: "page-policy", profile_ref: "profile:1", allowed_operations: [...browserOps, ...pageOps], allowed_origins: ["https://example.com"] });
  const pageGrant = await accessStore.createGrant({ idempotency_key: "page-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: [...pageOps], allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const pageRequest = { idempotency_key: "page-list", connection_id: connection.connection_id, grant_id: pageGrant.grant_id, operation: "page.list" as const, profile_ref: "profile:1", runtime_session_ref: "session:one", task_scope: { operations: [...pageOps], profile_refs: ["profile:1"], origins: ["https://example.com"] } };
  const prepareDeniedPage = await service.submit(credentialHash, { ...pageRequest, idempotency_key: "page-prepare-denied", operation: "page.open" as const, origin: "https://example.com", url: "https://example.com/denied" });
  assert.equal(prepareDeniedPage.status, "failed", JSON.stringify(prepareDeniedPage));
  assert.equal(prepareDeniedPage.failure?.code, "managed_browser_policy_refused");
  assert.equal(prepareDeniedPage.dispatch_state, "not_dispatched");
  assert.equal(pageMutations, 0, "prepare refusal must not reach the Page provider");
  await service.putManagementPolicy({ schema_version: executionPolicyMutationSchemaVersion, idempotency_key: "allow-controlled", expected_source_version: null, modes: { read: "auto", prepare: "auto", commit: "auto" } });
  managedSession.control_owner = "none";
  managedSession.control_lock = { state: "released", holder_ref: null };
  const pageLockAttempts = lockAttempts;
  const listedPages = await service.submit(credentialHash, pageRequest);
  assert.equal(listedPages.status, "succeeded", JSON.stringify(listedPages));
  assert.equal((listedPages.result as { pages: unknown[] }).pages.length, 1);
  assert.equal(listedPages.dispatch_state, undefined, "page.list remains observation-only");
  assert.equal(lockAttempts, pageLockAttempts, "page.list must not acquire ControlLease");
  const pageOpen = { ...pageRequest, idempotency_key: "page-open", operation: "page.open" as const, origin: "https://example.com", url: "https://example.com/two" };
  const openedPage = await service.submit(credentialHash, pageOpen);
  assert.equal(openedPage.status, "succeeded", JSON.stringify(openedPage));
  assert.equal(openedPage.dispatch_state, "dispatched");
  assert.equal(lockAttempts, pageLockAttempts + 1, "page.open acquires the Instance ControlLease after handback");
  assert.equal(managedSession.control_owner, "core_task");
  const openedPageFacts = (openedPage.result as { page: { page_ref: string } }).page;
  const pageNavigate = { ...pageRequest, idempotency_key: "page-navigate", operation: "page.navigate" as const, origin: "https://example.com", page_ref: openedPageFacts.page_ref, url: "https://example.com/three" };
  const navigatedPage = await service.submit(credentialHash, pageNavigate);
  assert.equal(navigatedPage.status, "succeeded", JSON.stringify(navigatedPage));
  assert.equal(navigatedPage.dispatch_state, "dispatched");
  const pageMutationsBeforeLoss = pageMutations;
  dropPageResponse = true;
  const lostPage = await service.submit(credentialHash, { ...pageNavigate, idempotency_key: "page-lost" });
  dropPageResponse = false;
  assert.equal(lostPage.status, "unknown_outcome", JSON.stringify(lostPage));
  assert.equal(lostPage.dispatch_state, "dispatched");
  assert.equal(pageMutations, pageMutationsBeforeLoss + 1);
  const reconciledPage = await service.query(credentialHash, lostPage.run_id);
  assert.equal(reconciledPage.status, "unknown_outcome", "page receipt must not rewrite the original unknown history");
  assert.equal(reconciledPage.reconciliation, "completed");
  assert.equal((reconciledPage.result as { page: { page_ref: string } }).page.page_ref, openedPageFacts.page_ref);
  assert.equal(pageMutations, pageMutationsBeforeLoss + 1, "page query must not replay the original mutation");
  assert.deepEqual(await service.submit(credentialHash, { ...pageNavigate, idempotency_key: "page-lost" }), reconciledPage);
  managedSession.control_owner = "user";
  managedSession.control_lock = { state: "held", holder_ref: "human" };
  const humanPage = await service.submit(credentialHash, { ...pageNavigate, idempotency_key: "page-human-held" });
  assert.equal(humanPage.status, "failed", JSON.stringify(humanPage));
  assert.equal(humanPage.failure?.code, "control_lock_conflict");
  assert.equal(humanPage.dispatch_state, "not_dispatched");
  assert.equal(pageMutations, pageMutationsBeforeLoss + 1, "human-held Page mutation must not reach the provider");
  managedSession.control_owner = "core_task";
  managedSession.control_lock = { state: "held", holder_ref: principal.principal_id };
  const metadataOperations = ["profile.metadata.update"] as const;
  await accessStore.setProfilePolicy({ idempotency_key: "metadata-policy", profile_ref: "profile:1", allowed_operations: [...metadataOperations], allowed_origins: [] });
  const metadataGrant = await accessStore.createGrant({ idempotency_key: "metadata-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: [...metadataOperations], allowed_origins: [], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const metadataRequest = { idempotency_key: "metadata-update", connection_id: connection.connection_id, grant_id: metadataGrant.grant_id,
    operation: "profile.metadata.update", profile_ref: "profile:1", name: "  GitHub research  ", tags: [" team ", "github", "team"],
    task_scope: { operations: [...metadataOperations], profile_refs: ["profile:1"], origins: [] } };
  const sessionsBeforeMetadata = sessionReads;
  const providersBeforeMetadata = providerCatalogReads;
  sessionStopped = true;
  const metadataUpdated = await service.submit(credentialHash, metadataRequest);
  assert.equal(metadataUpdated.status, "succeeded", JSON.stringify(metadataUpdated));
  assert.equal((metadataUpdated.result as { profile: { name: string } }).profile.name, "GitHub research");
  assert.deepEqual((metadataUpdated.result as { profile: { tags: string[] } }).profile.tags, ["team", "github"]);
  assert.equal((metadataUpdated.result as { profile: { site: { display_name: string } } }).profile.site.display_name, "Example");
  assert.equal(metadataUpdates, 1);
  assert.equal(sessionReads, sessionsBeforeMetadata, "Profile metadata does not require a Runtime Session");
  assert.equal(providerCatalogReads, providersBeforeMetadata, "Profile metadata does not require Provider availability");
  const metadataReplay = await service.submit(credentialHash, metadataRequest);
  assert.equal(metadataReplay.run_id, metadataUpdated.run_id, "same wire key returns the original metadata Run");
  assert.equal(metadataUpdates, 1, "same-key metadata replay does not post another Harbor mutation");
  await assert.rejects(service.submit(credentialHash, { ...metadataRequest, name: "Different name" }), /managed_browser_idempotency_conflict/);
  await assert.rejects(service.submit(credentialHash, { ...metadataRequest, name: "GitHub research" }), /managed_browser_idempotency_conflict/, "wire-distinct input is not silently normalized before idempotency comparison");
  await assert.rejects(service.submit(credentialHash, { ...metadataRequest, idempotency_key: "metadata-task-scope-denied", task_scope: { ...metadataRequest.task_scope, operations: ["profile.read"] } }), /managed_access_denied/);
  await assert.rejects(service.submit(credentialHash, { ...metadataRequest, idempotency_key: "metadata-origin-scope-denied", task_scope: { ...metadataRequest.task_scope, origins: ["https://example.com"] } }), /managed_access_denied/);
  await assert.rejects(service.submit(credentialHash, { ...metadataRequest, idempotency_key: "metadata-origin-denied", origin: "https://example.com" }), /managed_browser_invalid_input/);
  await assert.rejects(service.submit(credentialHash, { ...metadataRequest, idempotency_key: "metadata-profile-denied", profile_ref: "profile:2", task_scope: { ...metadataRequest.task_scope, profile_refs: ["profile:2"] } }), /managed_access_denied/);
  const oldReadGrant = await accessStore.createGrant({ idempotency_key: "metadata-old-read-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: ["profile.read"], allowed_origins: [], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  await assert.rejects(service.submit(credentialHash, { ...metadataRequest, idempotency_key: "metadata-old-grant-denied", grant_id: oldReadGrant.grant_id }), /managed_access_denied/);
  await assert.rejects(service.submit(credentialHash, { ...metadataRequest, idempotency_key: "metadata-fields-forbidden-on-read", grant_id: oldReadGrant.grant_id, operation: "profile.read", name: "unexpected", tags: [] }), /managed_browser_invalid_input/);
  const lostMetadataRequest = { ...metadataRequest, idempotency_key: "metadata-lost-response", name: "Confirmed after query", tags: [] };
  dropMetadataResponse = true;
  const unknownMetadata = await service.submit(credentialHash, lostMetadataRequest);
  assert.equal(unknownMetadata.status, "unknown_outcome");
  assert.equal(metadataUpdates, 2);
  dropMetadataResponse = false;
  const reconciledMetadata = await service.query(credentialHash, unknownMetadata.run_id);
  assert.equal(reconciledMetadata.status, "unknown_outcome");
  assert.equal(reconciledMetadata.reconciliation, "completed");
  assert.equal((reconciledMetadata.result as { profile: { name: string } }).profile.name, "Confirmed after query");
  assert.deepEqual((reconciledMetadata.result as { profile: { tags: string[] } }).profile.tags, []);
  assert.equal(metadataUpdates, 2, "query reads the original Harbor mutation receipt without replay");
  const malformedMetadataRequest = { ...metadataRequest, idempotency_key: "metadata-malformed-response", name: "Recovered from malformed response", tags: ["safe"] };
  malformedMetadataReply = true;
  const malformedMetadata = await service.submit(credentialHash, malformedMetadataRequest);
  malformedMetadataReply = false;
  assert.equal(malformedMetadata.status, "unknown_outcome", "a non-object post-success metadata projection is unknown, not a retryable failure");
  assert.equal(metadataUpdates, 3);
  const recoveredMalformedMetadata = await service.query(credentialHash, malformedMetadata.run_id);
  assert.equal(recoveredMalformedMetadata.status, "unknown_outcome");
  assert.equal(recoveredMalformedMetadata.reconciliation, "completed");
  assert.equal((recoveredMalformedMetadata.result as { profile: { profile_ref: string; identity_environment_ref: string; name: string } }).profile.profile_ref, "profile:1");
  assert.equal((recoveredMalformedMetadata.result as { profile: { identity_environment_ref: string } }).profile.identity_environment_ref, "identity:1");
  assert.equal((recoveredMalformedMetadata.result as { profile: { name: string } }).profile.name, "Recovered from malformed response");
  assert.equal(metadataUpdates, 3, "GET-only metadata recovery validates the original receipt without another POST");
  await accessStore.setProfilePolicy({ idempotency_key: "metadata-policy-ceiling-removed", profile_ref: "profile:1", allowed_operations: ["profile.read"], allowed_origins: [] });
  await assert.rejects(service.submit(credentialHash, { ...metadataRequest, idempotency_key: "metadata-profile-ceiling-denied", name: "Must not dispatch" }), /managed_access_denied/);
  assert.equal(metadataUpdates, 3, "Profile ceiling denial must happen before the Harbor mutation owner");
  sessionStopped = false;
  await accessStore.setProfilePolicy({ idempotency_key: "metadata-policy-restore", profile_ref: "profile:1", allowed_operations: ["profile.list", "profile.read"], allowed_origins: ["https://example.com"] });
  const environmentOps = ["environment.read", "environment.update"];
  await accessStore.setProfilePolicy({ idempotency_key: "environment-policy", profile_ref: "profile:1", allowed_operations: environmentOps, allowed_origins: ["https://example.com"] });
  const environmentGrant = await accessStore.createGrant({ idempotency_key: "environment-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: environmentOps, allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const environmentRead = { idempotency_key: "environment-read", connection_id: connection.connection_id, grant_id: environmentGrant.grant_id,
    operation: "environment.read", profile_ref: "profile:1", origin: "https://example.com", task_scope: { operations: environmentOps, profile_refs: ["profile:1"], origins: ["https://example.com"] } };
  const sessionReadsBeforeEnvironment = sessionReads;
  const environmentResult = await service.submit(credentialHash, environmentRead);
  assert.equal(environmentResult.status, "succeeded", JSON.stringify(environmentResult));
  assert.equal((environmentResult.result as { status: string }).status, "completed");
  assert.equal(environmentReads, 1);
  assert.equal(sessionReads, sessionReadsBeforeEnvironment, "environment reads do not require or create an Instance session");
  environmentUnavailable = true;
  const unavailableEnvironment = await service.submit(credentialHash, { ...environmentRead, idempotency_key: "environment-unavailable" });
  assert.equal(unavailableEnvironment.status, "failed", "a Harbor unavailable envelope is a failed Core Run, not a successful result");
  assert.equal(unavailableEnvironment.failure?.code, "provider_unavailable");
  environmentUnavailable = false;
  const environmentUpdate = { ...environmentRead, idempotency_key: "environment-update", operation: "environment.update", configuration: { timezone: "Asia/Shanghai" } };
  const environmentUpdated = await service.submit(credentialHash, environmentUpdate);
  assert.equal(environmentUpdated.status, "succeeded", JSON.stringify(environmentUpdated));
  assert.equal(environmentUpdates, 1);
  const observedEnvironment = (await service.submit(credentialHash, { ...environmentRead, idempotency_key: "environment-read-after-update" })).result as { configured: { timezone: string }; effective: { timezone: string }; pending: { timezone: string } };
  assert.equal(observedEnvironment.configured.timezone, "Asia/Shanghai");
  assert.equal(observedEnvironment.effective.timezone, "UTC", "configuration does not masquerade as active effective state");
  assert.equal(observedEnvironment.pending.timezone, "Asia/Shanghai");
  for (const invalidConfiguration of [{}, { timezone: "UTC", unknown: "value" }, { timezone: "x".repeat(129) }]) {
    await assert.rejects(service.submit(credentialHash, { ...environmentUpdate, idempotency_key: `environment-invalid-${environmentUpdates}`, configuration: invalidConfiguration }), /managed_browser_invalid_input/);
  }
  assert.equal(environmentUpdates, 1, "invalid configuration does not reach Harbor or mutate the Profile");
  await assert.rejects(service.submit(credentialHash, { ...environmentRead, idempotency_key: "environment-config-on-read", operation: "profile.read", configuration: { timezone: "UTC" } }), /managed_browser_invalid_input/);
  await assert.rejects(service.submit(credentialHash, { ...environmentUpdate, idempotency_key: "environment-denied-task", task_scope: { ...environmentUpdate.task_scope, operations: ["environment.read"] } }), /managed_access_denied/);
  await assert.rejects(service.submit(credentialHash, { ...environmentUpdate, idempotency_key: "environment-denied-profile", profile_ref: "profile:2" }), /managed_access_denied/);
  await assert.rejects(service.submit(credentialHash, { ...environmentUpdate, idempotency_key: "environment-denied-origin", origin: "https://denied.example" }), /managed_access_denied/);
  await assert.rejects(service.submit(credentialHash, { ...environmentUpdate, idempotency_key: "environment-missing-origin", origin: undefined }), /managed_browser_invalid_input/);
  const lostEnvironment = { ...environmentUpdate, idempotency_key: "environment-lost-response", configuration: { language: "zh-CN" } };
  dropEnvironmentResponse = true;
  const unknownEnvironment = await service.submit(credentialHash, lostEnvironment);
  assert.equal(unknownEnvironment.status, "unknown_outcome");
  assert.equal(environmentUpdates, 2);
  dropEnvironmentResponse = false;
  const reconciledEnvironment = await service.query(credentialHash, unknownEnvironment.run_id);
  assert.equal(reconciledEnvironment.status, "unknown_outcome", "recovery preserves the original lost-response history");
  assert.equal(reconciledEnvironment.reconciliation, "completed");
  assert.equal((reconciledEnvironment.result as { receipt: { configuration: { language: string } } }).receipt.configuration.language, "zh-CN");
  assert.equal(environmentUpdates, 2, "query uses the Runtime receipt and never replays the update");
  assert.deepEqual(await service.submit(credentialHash, lostEnvironment), reconciledEnvironment);
  assert.equal(environmentUpdates, 2, "duplicate submission of an unknown key never replays the update");
  for (const operation of environmentOps) {
    const key = `environment-revoked-in-flight-${operation}`;
    const grant = await accessStore.createGrant({ idempotency_key: key, principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: environmentOps, allowed_origins: ["https://example.com"], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
    const before: { environmentReads: number; environmentUpdates: number; configured: typeof environmentConfigured } = { environmentReads, environmentUpdates, configured: { ...environmentConfigured } };
    afterProfileList = async () => { await accessStore.revokeGrant({ idempotency_key: `${key}-revoke`, grant_id: grant.grant_id }); };
    const refused = await service.submit(credentialHash, { ...environmentRead, idempotency_key: key, grant_id: grant.grant_id, operation, ...(operation === "environment.update" ? { configuration: { timezone: "Asia/Tokyo" } } : {}) });
    afterProfileList = undefined;
    assert.equal(refused.status, "failed", "revocation during Profile lookup must block environment dispatch");
    assert.equal(refused.failure?.code, "managed_access_grant_unavailable");
    assert.deepEqual({ environmentReads, environmentUpdates, configured: environmentConfigured }, before);
  }
  await accessStore.revokeGrant({ idempotency_key: "revoke-environment", grant_id: environmentGrant.grant_id });
  await accessStore.setProfilePolicy({ idempotency_key: "controlled-declaration-after-environment", ...policy, controlled_interaction_origins: [origin] });
  for (const override of [{ task_scope: { ...input.task_scope, operations: ["instance.snapshot"] } }, { profile_ref: "profile:2" }, { origin: "http://127.0.0.1:18795" }]) {
    await assert.rejects(service.submit(credentialHash, { ...input, ...override }), /managed_access_denied/);
  }
  const readOnlyGrant = await accessStore.createGrant({ idempotency_key: "read-only-controlled", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: ["instance.snapshot"], allowed_origins: [origin], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  await assert.rejects(service.submit(credentialHash, { ...input, grant_id: readOnlyGrant.grant_id }), /managed_access_denied/);
  const wrongInstance = await service.submit(credentialHash, { ...input, idempotency_key: "wrong-instance", runtime_session_ref: "session:other" });
  assert.equal(wrongInstance.dispatch_state, "not_dispatched");
  assert.equal(interactions, 1);
  refuseInteraction = true;
  const refused = await service.submit(credentialHash, { ...input, idempotency_key: "stale-target" });
  assert.equal(refused.status, "failed"); assert.equal(refused.dispatch_state, "not_dispatched");
  assert.equal(interactions, 1);
  refuseInteraction = false;
  dropInteractionResponse = true;
  const lost = await service.submit(credentialHash, input);
  assert.equal(lost.status, "unknown_outcome"); assert.equal(lost.dispatch_state, "dispatched");
  assert.equal(interactions, 2);
  dropInteractionResponse = false;
  const afterLostRestart = await restartedService.query(credentialHash, lost.run_id);
  assert.equal(afterLostRestart.status, "unknown_outcome", "Core restart preserves the original unknown result");
  assert.equal(afterLostRestart.reconciliation, "completed");
  assert.equal(interactions, 2, "query after Core restart may reconcile but cannot redispatch input");
  assert.deepEqual(await restartedService.submit(credentialHash, input), afterLostRestart, "same key cannot replay input after Core restart");
  assert.equal(interactions, 2);
  waitConditionTimeout = true;
  const timedOutWait = await service.submit(credentialHash, { ...interactiveWithoutLimit, idempotency_key: "wait-timeout", operation: "instance.wait",
    page_ref: "page:one", observation_ref: "observation:1", wait_for: "text", text: "never", timeout_ms: 50 });
  waitConditionTimeout = false;
  assert.equal(timedOutWait.status, "failed", JSON.stringify(timedOutWait));
  assert.equal(timedOutWait.dispatch_state, "dispatched");
  assert.equal(timedOutWait.failure?.code, "wait_condition_timeout");
  assert.equal((timedOutWait.result as { failure_class: string }).failure_class, "wait_condition_timeout");
  assert.deepEqual(await service.query(credentialHash, timedOutWait.run_id), timedOutWait, "query preserves the known wait failure");

  waitConditionTimeout = true;
  dropInteractionResponse = true;
  const timedOutLost = await service.submit(credentialHash, { ...interactiveWithoutLimit, idempotency_key: "wait-timeout-lost", operation: "instance.wait",
    page_ref: "page:one", observation_ref: "observation:1", wait_for: "text", text: "never", timeout_ms: 50 });
  dropInteractionResponse = false;
  waitConditionTimeout = false;
  assert.equal(timedOutLost.status, "unknown_outcome", JSON.stringify(timedOutLost));
  assert.equal(timedOutLost.dispatch_state, "dispatched");
  assert.equal((await service.query(credentialHash, timedOutLost.run_id)).status, "unknown_outcome", "a lost response remains unknown");
  await accessStore.revokeGrant({ idempotency_key: "revoke-controlled", grant_id: interactiveGrant.grant_id });
  const interactiveReconnect = await accessStore.connect(credentialHash);
  await assert.rejects(service.submit(credentialHash, { ...input, idempotency_key: "after-controlled-revoke", connection_id: interactiveReconnect.connection_id }), /grant_unavailable/);
  const queried = await service.query(credentialHash, lost.run_id);
  assert.equal(queried.status, "unknown_outcome", "receipt adds fact without erasing lost-response history");
  assert.equal(queried.reconciliation, "completed");
  assert.equal((queried.result as { snapshot: { text: string } }).snapshot.text, "Ready");
  assert.equal(interactions, 2, "query after revocation does not replay input");
  const interactionExtraOrigin = "http://127.0.0.1:18795";
  const interactionScopePolicy = { profile_ref: "profile:1", allowed_operations: interactionOps,
    allowed_origins: [origin, interactionExtraOrigin], controlled_interaction_origins: [origin, interactionExtraOrigin] };
  await accessStore.setProfilePolicy({ idempotency_key: "interaction-scope-wide", ...interactionScopePolicy });
  const interactionScopeGrant = await accessStore.createGrant({ idempotency_key: "interaction-scope-grant", principal_id: principal.principal_id,
    profile_refs: ["profile:1"], allowed_operations: interactionOps, allowed_origins: [origin, interactionExtraOrigin],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const interactionScopeRequest = { ...interactive, idempotency_key: "interaction-scope", grant_id: interactionScopeGrant.grant_id,
    task_scope: { operations: interactionOps, profile_refs: ["profile:1"], origins: [interactionExtraOrigin, origin] } };
  afterProfileList = async () => { await accessStore.setProfilePolicy({ idempotency_key: "interaction-scope-narrow", profile_ref: "profile:1",
    allowed_operations: interactionOps, allowed_origins: [origin], controlled_interaction_origins: [origin] }); };
  let interactionScopeResult;
  try {
    interactionScopeResult = await service.submit(credentialHash, interactionScopeRequest);
  } finally {
    afterProfileList = undefined;
  }
  assert.equal(interactionScopeResult.status, "succeeded", JSON.stringify(interactionScopeResult));
  assert.deepEqual(forwardedInteractionOrigins.at(-1), [origin], "interaction forwards the latest checked origin scope");
  await accessStore.revokeGrant({ idempotency_key: "revoke-interaction-scope", grant_id: interactionScopeGrant.grant_id });
  const recoveryOperations = ["recovery.status"] as const;
  await accessStore.setProfilePolicy({ idempotency_key: "recovery-status-policy", profile_ref: "profile:1", allowed_operations: [...recoveryOperations], allowed_origins: [] });
  const statusGrant = await accessStore.createGrant({ idempotency_key: "recovery-status-grant", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: [...recoveryOperations], allowed_origins: [], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const recoveryStatusRequest = { idempotency_key: "recovery-status", connection_id: connection.connection_id, grant_id: statusGrant.grant_id,
    operation: "recovery.status" as const, profile_ref: "profile:1", operation_ref: "recovery:target", task_scope: { operations: [...recoveryOperations], profile_refs: ["profile:1"], origins: [] } };
  const recoveryStatusResult = await service.submit(credentialHash, recoveryStatusRequest);
  assert.equal(recoveryStatusResult.status, "succeeded", JSON.stringify(recoveryStatusResult));
  assert.equal(recoveryExpectedProfileRef, "profile:1", "recovery status must enforce the Agent's Profile scope");
  const actualRecoveryService = createManagedRecoveryService({ runRecordStore, harborBaseUrl: `http://127.0.0.1:${address.port}`, supervisorToken: "fixture-supervisor" });
  const actualInspection = await actualRecoveryService.inspect({ idempotency_key: "recovery-real-inspect", profile_ref: "profile:owner" });
  assert.equal(actualInspection.ok, true, JSON.stringify(actualInspection));
  const crossProfileRecoveryOperations = ["recovery.status"] as const;
  await accessStore.setProfilePolicy({ idempotency_key: "recovery-cross-profile-policy", profile_ref: "profile:other", allowed_operations: [...crossProfileRecoveryOperations], allowed_origins: [] });
  const crossProfileGrant = await accessStore.createGrant({ idempotency_key: "recovery-cross-profile-grant", principal_id: principal.principal_id, profile_refs: ["profile:other"], allowed_operations: [...crossProfileRecoveryOperations], allowed_origins: [], expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const actualRecoveryBrowser = createManagedBrowserService({ accessStore, runRecordStore, executionPolicyConfigStore,
    authorizationDecisionStore: createFileAuthorizationDecisionStore({ directory: join(directory, "cross-profile-decisions"), runRecordStore }),
    harborBaseUrl: `http://127.0.0.1:${address.port}`, supervisorToken: "fixture-supervisor", recoveryService: actualRecoveryService });
  const crossProfileResult = await actualRecoveryBrowser.submit(credentialHash, { ...recoveryStatusRequest, idempotency_key: "recovery-real-cross-profile", grant_id: crossProfileGrant.grant_id, profile_ref: "profile:other", operation_ref: actualInspection.operation_ref, task_scope: { operations: [...crossProfileRecoveryOperations], profile_refs: ["profile:other"], origins: [] } });
  assert.equal(crossProfileResult.status, "failed", JSON.stringify(crossProfileResult));
  assert.equal(crossProfileResult.failure?.code, "recovery_operation_not_found", JSON.stringify(crossProfileResult));

  // D5: a successful description is not a capability token. Stop or hand
  // control to the user after help, then the original execution rechecks the
  // current Runtime/Control facts and refuses dispatch.
  const d5Origin = "http://127.0.0.1:18794";
  const d5Operations = ["profile.read", "instance.input"] as const;
  await accessStore.setProfilePolicy({ idempotency_key: "d5-policy", profile_ref: "profile:1", allowed_operations: [...d5Operations], allowed_origins: [d5Origin], controlled_interaction_origins: [d5Origin] });
  const d5Grant = await accessStore.createGrant({ idempotency_key: "d5-grant", principal_id: principal.principal_id,
    profile_refs: ["profile:1"], allowed_operations: [...d5Operations], allowed_origins: [d5Origin],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const d5Context = { grant_id: d5Grant.grant_id, profile_ref: "profile:1",
    task_scope: { operations: [...d5Operations], profile_refs: ["profile:1"], origins: [d5Origin] } };
  const d5Arguments = { origin: d5Origin, runtime_session_ref: "session:one", page_ref: "page:one", observation_ref: "observation:1", target_ref: "target:one", text: "d5 test" };
  const d5Execution = { idempotency_key: "d5-input", connection_id: connection.connection_id, grant_id: d5Grant.grant_id, operation: "instance.input" as const,
    profile_ref: "profile:1", ...d5Arguments, task_scope: d5Context.task_scope };
  capabilityDescriptionMode = "normal";
  const beforeD5Runs = (await runRecordStore.listRunRecords()).length;
  const d5Description = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.input", context: d5Context, arguments: d5Arguments });
  assert.equal((d5Description.availability as { state: string }).state, "no_known_blocker");
  assert.equal((await runRecordStore.listRunRecords()).length, beforeD5Runs, "describe must not create a Run before D5 state changes");
  sessionStopped = true;
  const stoppedExecution = await service.submit(credentialHash, { ...d5Execution, idempotency_key: "d5-after-stop" });
  assert.equal(stoppedExecution.status, "failed", JSON.stringify(stoppedExecution));
  assert.equal(stoppedExecution.failure?.code, "instance_not_running");
  assert.equal(stoppedExecution.dispatch_state, "not_dispatched");
  sessionStopped = false;
  managedSession.control_owner = "user";
  managedSession.control_lock = { state: "held", holder_ref: "human" };
  const takeoverExecution = await service.submit(credentialHash, { ...d5Execution, idempotency_key: "d5-during-takeover" });
  assert.equal(takeoverExecution.status, "failed", JSON.stringify(takeoverExecution));
  assert.equal(takeoverExecution.failure?.code, "control_lock_conflict");
  assert.equal(takeoverExecution.dispatch_state, "not_dispatched");
  managedSession.control_owner = "core_task";
  managedSession.control_lock = { state: "held", holder_ref: principal.principal_id };
  await accessStore.setProfilePolicy({ idempotency_key: "d5-restore-policy", profile_ref: "profile:1", allowed_operations: interactionOps, allowed_origins: [origin], controlled_interaction_origins: [origin] });

  const v2ExpiresAt = new Date(Date.now() + 60_000).toISOString();
  await accessStore.setProfilePolicy({ idempotency_key: "v2-browser-policy", profile_ref: "profile:1", allowed_operations: interactionOps, allowed_origins: [origin], controlled_interaction_origins: [origin] });
  const v2Source = await accessStore.createGrant({ idempotency_key: "v2-browser-source", principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: interactionOps, allowed_origins: [origin], expires_at: v2ExpiresAt, max_created_profiles: 0, creation_template: null });
  const v2 = await accessStore.confirmAgentOperationsV2({
    idempotency_key: "v2-browser-confirm", source_grant_id: v2Source.grant_id, profile_ref: "profile:1",
    confirmation: { schema_version: managedScopeConfirmationSchemaVersion, confirmation_ref: "confirmation:browser-v2", profile_ref: "profile:1", confirmed_at: new Date().toISOString(), confirmed_by: "owner", idempotency_key: "v2-browser-confirm", decision: "apply" },
    new_grant: { principal_id: principal.principal_id, profile_refs: ["profile:1"], allowed_operations: interactionOps, allowed_origins: [origin], expires_at: v2ExpiresAt, max_created_profiles: 0, creation_template: null },
    new_profile_policy: { profile_ref: "profile:1", allowed_operations: interactionOps, allowed_origins: [origin], controlled_interaction_origins: [origin] }
  });
  managedSession.control_owner = "core_task";
  managedSession.control_lock = { state: "held", holder_ref: principal.principal_id };
  managedSession.current_page = { current_url: origin };
  crossOriginInteraction = true;
  const boundary = await service.submit(credentialHash, { ...interactive, idempotency_key: "v2-natural-boundary", grant_id: v2.grant.grant_id });
  crossOriginInteraction = false;
  assert.equal(boundary.status, "failed", JSON.stringify(boundary));
  assert.equal(boundary.dispatch_state, "dispatched");
  assert.equal((boundary.result as { page: { origin: string } }).page.origin, "https://outside.example");
  assert.equal(JSON.stringify(boundary).includes("token=secret"), false);
  assert.equal(JSON.stringify(boundary).includes("Private title"), false);
  assert.equal(JSON.stringify(boundary).includes("Private body"), false);

  // Capability description is read-only help. It may use a connected Agent
  // without a metadata Grant, but it must never create a Run or decision.
  const beforeHelpRuns = (await runRecordStore.listRunRecords()).length;
  const beforeHelpDecisions = (await authorizationDecisionStore.queryAuthorizationDecisions({ limit: 100 })).authorization_decisions.length;
  const beforeHelpLocks = lockAttempts;
  const beforeHelpDescriptions = capabilityDescriptions;
  const staticHelp = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.snapshot" });
  assert.equal(staticHelp.mode, "definition_only");
  assert.equal((staticHelp.provider as { state: string }).state, "not_evaluated");
  assert.equal((staticHelp.authorization as { state: string }).state, "not_evaluated");
  assert.equal(capabilityDescriptions, beforeHelpDescriptions, "definition-only help must not query Harbor");
  assert.equal((await runRecordStore.listRunRecords()).length, beforeHelpRuns, "description must not create a Run");
  assert.equal((await authorizationDecisionStore.queryAuthorizationDecisions({ limit: 100 })).authorization_decisions.length, beforeHelpDecisions, "description must not record a decision");
  assert.equal(lockAttempts, beforeHelpLocks, "description must not acquire a ControlLease");
  const helpExecution = await service.submit(credentialHash, { ...preferenceRequest, idempotency_key: "after-static-help" });
  assert.equal(helpExecution.status, "succeeded", "static help is not an execution gate");

  await accessStore.setProfilePolicy({ idempotency_key: "discovery-policy", profile_ref: "profile:2",
    allowed_operations: ["profile.read", "instance.observe"], allowed_origins: ["https://example.com"] });
  const visibleGrant = await accessStore.createGrant({ idempotency_key: "discovery-visible-grant", principal_id: principal.principal_id,
    profile_refs: ["profile:2"], allowed_operations: ["profile.read"], allowed_origins: ["https://example.com"],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const context = { grant_id: visibleGrant.grant_id, profile_ref: "profile:2",
    task_scope: { operations: ["profile.read", "instance.snapshot"], profile_refs: ["profile:2"], origins: ["https://example.com", "https://outside.example"] } };
  const descriptionArguments = { origin: "https://example.com", runtime_session_ref: "session:one", page_id: "page-id:one", page_ref: "page:one", document_generation: 1 };
  const beforeDeniedRuns = (await runRecordStore.listRunRecords()).length;
  const beforeDeniedDecisions = (await authorizationDecisionStore.queryAuthorizationDecisions({ limit: 100 })).authorization_decisions.length;
  const beforeDeniedLocks = lockAttempts;
  const beforeDeniedDescriptions = capabilityDescriptions;
  const beforeDeniedOriginForwards = forwardedCapabilityOrigins.length;
  const deniedDescription = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.snapshot", context, arguments: descriptionArguments });
  assert.equal((deniedDescription.authorization as { state: string }).state, "denied", "visible Profile and target operation permission are separate");
  assert.equal((deniedDescription.provider as { state: string }).state, "supported");
  assert.equal(capabilityDescriptions, beforeDeniedDescriptions + 2, "visible denied target may still receive owner facts and a final Harbor recheck");
  assert.deepEqual(forwardedCapabilityOrigins.slice(beforeDeniedOriginForwards), [["https://example.com"], ["https://example.com"]], "Harbor receives only the current Grant/Profile/task intersection");
  assert.equal((await runRecordStore.listRunRecords()).length, beforeDeniedRuns);
  assert.equal((await authorizationDecisionStore.queryAuthorizationDecisions({ limit: 100 })).authorization_decisions.length, beforeDeniedDecisions);
  assert.equal(lockAttempts, beforeDeniedLocks);

  await accessStore.setProfilePolicy({ idempotency_key: "discovery-list-policy", profile_ref: "profile:3",
    allowed_operations: ["profile.list", "instance.snapshot"], allowed_origins: ["https://example.com"] });
  const listGrant = await accessStore.createGrant({ idempotency_key: "discovery-list-grant", principal_id: principal.principal_id,
    profile_refs: ["profile:3"], allowed_operations: ["profile.list", "instance.snapshot"], allowed_origins: ["https://example.com", "https://outside.example"],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const listContext = { grant_id: listGrant.grant_id, profile_ref: "profile:3",
    task_scope: { operations: ["profile.list", "instance.snapshot"], profile_refs: ["profile:3"], origins: ["https://example.com", "https://outside.example"] } };
  const beforeListOriginForwards = forwardedCapabilityOrigins.length;
  const listDescription = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.snapshot", context: listContext,
    arguments: { runtime_session_ref: "session:one", page_id: "page-id:one", page_ref: "page:one", document_generation: 1 } });
  assert.equal((listDescription.authorization as { state: string }).state, "unknown", "missing target origin remains an execution-time input question");
  assert.deepEqual(forwardedCapabilityOrigins.slice(beforeListOriginForwards), [["https://example.com"], ["https://example.com"]], "profile.list visibility also applies the Profile policy intersection");

  for (const shape of ["wrong_schema", "wrong_operation", "wrong_profile"] as const) {
    capabilityDescriptionShape = shape;
    await assert.rejects(() => service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.snapshot", context, arguments: descriptionArguments }), /discovery_version_mismatch/);
  }
  capabilityDescriptionShape = "profile_missing";
  await assert.rejects(() => service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.snapshot", context, arguments: descriptionArguments }), /discovery_context_unavailable/);
  capabilityDescriptionShape = "unknown_state";
  const unknownHarborState = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.snapshot", context, arguments: descriptionArguments });
  assert.equal((unknownHarborState.provider as { state: string }).state, "unknown");
  capabilityDescriptionShape = "valid";

  const invisibleContext = { ...context, profile_ref: "profile:hidden", task_scope: { ...context.task_scope, profile_refs: ["profile:hidden"] } };
  const beforeInvisibleDescriptions = capabilityDescriptions;
  await assert.rejects(() => service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.snapshot", context: invisibleContext, arguments: descriptionArguments }), /discovery_context_unavailable/);
  assert.equal(capabilityDescriptions, beforeInvisibleDescriptions, "invisible Profile must not reach Harbor");
  assert.equal(JSON.stringify(invisibleContext).includes("provider"), false);

  const otherCredential = "other-discovery-agent";
  const otherHash = createHash("sha256").update(otherCredential).digest("hex");
  const otherPrincipal = await accessStore.registerPrincipal({ idempotency_key: "register-discovery-other", display_name: "Other Discovery Agent", credential_hash: otherHash });
  const otherGrant = await accessStore.createGrant({ idempotency_key: "discovery-other-grant", principal_id: otherPrincipal.principal_id,
    profile_refs: ["profile:2"], allowed_operations: ["profile.read"], allowed_origins: ["https://example.com"],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const beforeCrossPrincipalDescriptions = capabilityDescriptions;
  await assert.rejects(() => service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.snapshot",
    context: { ...context, grant_id: otherGrant.grant_id }, arguments: descriptionArguments }), /discovery_context_unavailable/);
  assert.equal(capabilityDescriptions, beforeCrossPrincipalDescriptions, "cross-principal context must not reach Harbor");

  const allowedGrant = await accessStore.createGrant({ idempotency_key: "discovery-allowed-grant", principal_id: principal.principal_id,
    profile_refs: ["profile:2"], allowed_operations: ["profile.read", "instance.observe"], allowed_origins: ["https://example.com"],
    expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  const allowedContext = { grant_id: allowedGrant.grant_id, profile_ref: "profile:2",
    task_scope: { operations: ["profile.read", "instance.observe"], profile_refs: ["profile:2"], origins: ["https://example.com"] } };
  const allowedArguments = { origin: "https://example.com", runtime_session_ref: "session:one", page_id: "page-id:one", page_ref: "page:one", document_generation: 1 };
  capabilityDescriptionShape = "provider_evidence_stale";
  const staleProviderDescription = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.observe", context: allowedContext, arguments: allowedArguments });
  assert.equal((staleProviderDescription.provider as { state: string }).state, "unknown");
  assert.deepEqual((staleProviderDescription.provider as { reason_codes: string[] }).reason_codes, ["provider_evidence_stale"]);
  assert.deepEqual(staleProviderDescription.next_steps, [{ code: "owner_review_provider", actor: "owner", operation: null, fields: [] }]);
  capabilityDescriptionShape = "valid";
  for (const mode of ["human", "stale", "unknown"] as const) {
    capabilityDescriptionMode = mode;
    const described = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.observe", context: allowedContext, arguments: allowedArguments });
    const availability = described.availability as { state: string; reason_codes: string[] };
    assert.equal(availability.state, mode === "unknown" ? "unknown" : "blocked");
    assert.equal(availability.reason_codes[0], mode === "human" ? "human_control" : mode === "stale" ? "stale_reference" : "runtime_facts_unavailable");
    assert.deepEqual(described.next_steps, mode === "human"
      ? [{ code: "wait_for_owner_return", actor: "owner", operation: "instance.observe", fields: [] }]
      : mode === "stale"
        ? [{ code: "observe_page", actor: "agent", operation: "instance.observe", fields: [] }]
        : [{ code: "owner_review_provider", actor: "owner", operation: null, fields: [] }]);
  }
  capabilityDescriptionMode = "page_selection";
  const ambiguousDescription = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.observe", context: allowedContext, arguments: allowedArguments });
  assert.equal((ambiguousDescription.availability as { state: string }).state, "blocked");
  assert.deepEqual((ambiguousDescription.availability as { reason_codes: string[] }).reason_codes, ["page_selection_required"]);
  assert.deepEqual(ambiguousDescription.next_steps, [{ code: "choose_page", actor: "agent", operation: "page.list", fields: [] }]);

  const misplacedFileDraft = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "file.download",
    arguments: { file_ref: "attachment:runtime/11111111-1111-4111-8111-111111111111" } });
  assert.equal((misplacedFileDraft.inputs as { state: string }).state, "invalid");
  assert.deepEqual((misplacedFileDraft.inputs as { invalid: { path: string; code: string }[] }).invalid, [{ path: "/arguments/file_ref", code: "unknown_field" }]);
  assert.equal((misplacedFileDraft.next_steps as { fields: string[] }[])[0]?.fields.includes("/arguments/file_ref"), true);

  capabilityDescriptionMode = "stopped";
  const stoppedDescription = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.observe", context: allowedContext, arguments: allowedArguments });
  assert.equal((stoppedDescription.availability as { state: string }).state, "blocked");
  assert.deepEqual((stoppedDescription.availability as { reason_codes: string[] }).reason_codes, ["instance_not_running"]);
  assert.deepEqual(stoppedDescription.next_steps, [{ code: "start_profile", actor: "agent", operation: "instance.start", fields: ["/arguments/origin"] }]);

  capabilityDescriptionMode = "normal";
  afterCapabilityDescription = async () => { capabilityDescriptionMode = "stale"; };
  const changedControlDescription = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.observe", context: allowedContext, arguments: allowedArguments });
  assert.equal((changedControlDescription.availability as { state: string }).state, "unknown");
  assert.deepEqual((changedControlDescription.availability as { reason_codes: string[] }).reason_codes, ["facts_changed"]);

  capabilityDescriptionMode = "normal";
  afterCapabilityDescription = async () => {
    await accessStore.revokeGrant({ idempotency_key: "revoke-discovery-replaced", grant_id: allowedGrant.grant_id });
    await accessStore.createGrant({ idempotency_key: "discovery-replacement", principal_id: principal.principal_id,
      profile_refs: ["profile:2"], allowed_operations: ["profile.read", "instance.observe"], allowed_origins: ["https://example.com"],
      expires_at: new Date(Date.now() + 60_000).toISOString(), max_created_profiles: 0, creation_template: null });
  };
  const changedGrantDescription = await service.describe(credentialHash, { connection_id: connection.connection_id, operation: "instance.observe", context: allowedContext, arguments: allowedArguments });
  assert.equal((changedGrantDescription.availability as { state: string }).state, "unknown");
  assert.deepEqual((changedGrantDescription.availability as { reason_codes: string[] }).reason_codes, ["facts_changed"]);
  await accessStore.revokeGrant({ idempotency_key: "revoke-discovery-allowed", grant_id: allowedGrant.grant_id });
  await assert.rejects(() => service.submit(credentialHash, { idempotency_key: "after-discovery-revoke", connection_id: connection.connection_id,
    grant_id: allowedGrant.grant_id, operation: "instance.observe", profile_ref: "profile:2", origin: "https://example.com", runtime_session_ref: "session:one",
    page_id: "page-id:one", page_ref: "page:one", document_generation: 1,
    task_scope: { operations: ["instance.observe"], profile_refs: ["profile:2"], origins: ["https://example.com"] } }), /grant_unavailable/);
  console.log("managed browser Core HTTP boundary self-check passed");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
}
