import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readFile, realpath } from "node:fs/promises";

import type {
  HarborAdmissionInput,
  HarborBrowserProviderCatalog,
  HarborCoreRuntimeFacts,
  HarborCoreSceneReference,
  HarborIdentityEnvironmentFacts,
  HarborResourceFacts,
  HarborUnavailable
} from "./harbor-admission.js";
import type { LodePackageAdmissionContract } from "./lode-admission.js";
import { completeRunWithReadOnlyFailure, completeRunWithReadOnlyProjection, type LodeReadOnlyFailureClass, type LodeReadOnlyProjection } from "./read-only-result-projection.js";
import type { FailureRecord, FileRunRecordStore } from "./run-record-store.js";
import { acceptReadOnlyTaskSubmission, type TaskIntentEnvelope, type TaskSubmissionResult } from "./task-submission.js";

type JsonObject = Record<string, unknown>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type HarborResourceFactState = HarborResourceFacts["resource_facts"][number]["state"];
type SiteRuntimeId = "xiaohongshu" | "boss";

export type RuntimeTaskSubmissionRequest = {
  run_id: string;
  task_intent: unknown;
  package_ref?: string;
  harbor?: {
    identity_environment_ref?: string;
    url?: string;
    reuse_existing?: boolean;
    timeout_ms?: number;
    evidence_policy?: JsonObject;
    session?: JsonObject;
    snapshot?: JsonObject;
  };
};

export type LodePackageResolverInput = {
  package_ref: string;
  task_intent: unknown;
};

export type LodePackageResolver = (input: LodePackageResolverInput) => Promise<LodePackageAdmissionContract | FailureRecord>;

export type HarborRuntimeAdmissionRequest = {
  run_id: string;
  task_intent: unknown;
  package_ref: string;
  harbor?: RuntimeTaskSubmissionRequest["harbor"];
};

export type HarborRuntimeClient = {
  collectAdmissionFacts(input: HarborRuntimeAdmissionRequest): Promise<HarborAdmissionInput | FailureRecord>;
};

export type RuntimeTaskSubmissionDependencies = {
  lodePackageResolver?: LodePackageResolver;
  harborRuntimeClient?: HarborRuntimeClient;
};

export type LocalLodePackageResolverOptions = {
  registryPath: string;
  rootDir?: string;
};

export type HttpHarborRuntimeClientOptions = {
  baseUrl: string;
  fetch?: FetchLike;
};

const resourceFactsBoundary =
  "Core consumes Harbor public resource readiness keys only; no raw page, storage, credential, network, screenshot, or browser endpoint material." as const;

function failure(category: FailureRecord["category"], code: string, phase: FailureRecord["phase"], recovery_hint: string): FailureRecord {
  return { category, code, phase, recovery_hint };
}

function unavailable(failure_class: string, retryable = true): HarborUnavailable {
  return { status: "unavailable", failure_class, retryable };
}

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function isFailure(value: unknown): value is FailureRecord {
  return Boolean(value && typeof value === "object" && "category" in value);
}

function taskPackageRef(taskIntent: unknown): string | undefined {
  const intent = object(taskIntent);
  return string(intent?.package_ref) ?? string(object(intent?.capability)?.source_ref);
}

function taskUrl(taskIntent: unknown): string | undefined {
  const intent = object(taskIntent);
  const refs = object(intent?.input)?.refs;
  if (Array.isArray(refs)) {
    const ref = refs.map(safeHttpUrl).find((entry): entry is string => entry !== undefined);
    if (ref) return ref;
  }
  return safeHttpUrl(object(intent?.scope)?.target_ref);
}

function isHarborSceneReference(value: unknown): value is HarborCoreSceneReference {
  const scene = object(value);
  const pageSummary = object(scene?.page_summary);
  return (
    scene?.schema_version === "harbor-page-scene-refs/v0" &&
    typeof scene.runtime_session_ref === "string" &&
    typeof scene.snapshot_ref === "string" &&
    typeof scene.source_trace_ref === "string" &&
    Array.isArray(scene.evidence_refs) &&
    scene.evidence_refs.every((ref) => typeof ref === "string" && ref.length > 0) &&
    pageSummary !== undefined &&
    safeHttpUrl(pageSummary.url) !== undefined &&
    scene.unavailable === null
  );
}

function packageOutputSchemaId(packageRef: string, fallbackVersion: string): string {
  const match = /^lode:\/\/site-capability\/(.+)@([^/@]+)$/.exec(packageRef);
  if (!match) return `lode://schema/core/read-only-result/output@${fallbackVersion}`;
  return `lode://schema/site-capability/${match[1]}/output@${match[2]}`;
}

function readOnlyResultKind(taskIntent: TaskIntentEnvelope): string {
  return `${taskIntent.capability.ref.replace(/^lode:capability\//, "")}.read_result`;
}

function sameOrigin(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function projectionFromScene(taskIntent: TaskIntentEnvelope, packageRef: string, scene: HarborCoreSceneReference): LodeReadOnlyProjection {
  const pageSummary = object(scene.page_summary) ?? {};
  const evidenceRefs = [...scene.evidence_refs];
  const sourceRefs = [scene.source_trace_ref, scene.refmap_ref, scene.snapshot_ref].filter((ref): ref is string => typeof ref === "string" && ref.length > 0);
  return {
    result_kind: readOnlyResultKind(taskIntent),
    status: "available",
    classification: "success_result",
    normalized: {
      schema_version: "webenvoy.core-readonly-harbor-scene-projection.v0",
      title: string(pageSummary.title) ?? "",
      url: string(pageSummary.url) ?? taskIntent.scope.target_ref,
      summary: string(pageSummary.summary) ?? "Harbor provided refs-only page scene evidence.",
      capability: {
        ref: taskIntent.capability.ref,
        version: taskIntent.capability.version,
        ...(taskIntent.capability.source_ref === undefined ? {} : { source_ref: taskIntent.capability.source_ref }),
        ...(taskIntent.capability.lock_ref === undefined ? {} : { lock_ref: taskIntent.capability.lock_ref }),
        package_ref: packageRef
      },
      harbor_scene: {
        snapshot_ref: scene.snapshot_ref,
        ...(scene.refmap_ref === undefined ? {} : { refmap_ref: scene.refmap_ref }),
        source_trace_ref: scene.source_trace_ref
      },
      consumer_boundary: "Core stores refs-only read result projection from Harbor scene evidence; no raw DOM, HAR, screenshot body, cookies, tokens, profile storage, or browser endpoints are stored."
    },
    source_refs: sourceRefs,
    evidence_refs: evidenceRefs,
    warnings: ["Site-specific Lode runtime normalizer execution remains outside this Core refs-only completion path."]
  };
}

function sceneEvidenceRefs(value: unknown): string[] {
  const refs = object(value)?.evidence_refs;
  return Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === "string" && ref.length > 0) : [];
}

function readFailureRecoveryHint(failureClass: LodeReadOnlyFailureClass): string {
  return failureClass === "page_changed" || failureClass === "page_not_ready" ? "retry_after_refresh" : "manual_handoff";
}

async function completeAcceptedReadTaskWithFailure(
  store: FileRunRecordStore,
  result: Extract<TaskSubmissionResult, { ok: true }>,
  failureClass: LodeReadOnlyFailureClass,
  summary: string,
  evidenceRefs: readonly string[] = []
): Promise<TaskSubmissionResult> {
  await store.updateRunRecord(result.run_record.run_id, {
    status: "running",
    ...(evidenceRefs.length === 0 ? {} : { evidence_refs: evidenceRefs })
  });
  const recoveryHint = readFailureRecoveryHint(failureClass);
  const completed = await completeRunWithReadOnlyFailure(store, result.run_record.run_id, {
    lode_failure_class: failureClass,
    ...(evidenceRefs.length === 0 ? {} : { evidence_refs: evidenceRefs }),
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "blocked",
      summary,
      checked_at: new Date().toISOString(),
      code: failureClass,
      attribution: "runtime",
      recovery_hint: recoveryHint,
      ...(evidenceRefs.length === 0 ? {} : { evidence_refs: [...evidenceRefs] }),
      consumer_boundary: "Core records terminal refs-only failure state for App recovery; it does not execute writes or inline raw browser/page material."
    },
    retention_state: "active"
  });
  return {
    ok: false,
    failure: completed.run_record.failure ?? failure("runtime_execution", failureClass, "execution", recoveryHint),
    run_record: completed.run_record
  };
}

async function completeAcceptedReadTask(
  store: FileRunRecordStore,
  result: Extract<TaskSubmissionResult, { ok: true }>,
  packageRef: string,
  harbor: HarborAdmissionInput
): Promise<TaskSubmissionResult> {
  const taskIntent = result.task_intent;
  if (taskIntent.policy.risk !== "read" || taskIntent.policy.execution_intent !== "read") {
    return result;
  }
  const scene = harbor.harbor_scene_ref;
  if (!isHarborSceneReference(scene)) {
    return completeAcceptedReadTaskWithFailure(
      store,
      result,
      "page_not_ready",
      "Core could not complete the read-only task because Harbor did not provide a valid refs-only page scene.",
      sceneEvidenceRefs(scene)
    );
  }
  if (!sameOrigin(safeHttpUrl(object(scene.page_summary)?.url), taskUrl(taskIntent))) {
    return completeAcceptedReadTaskWithFailure(
      store,
      result,
      "page_changed",
      "Core rejected the Harbor page scene because its page URL was not same-origin with the submitted task target.",
      scene.evidence_refs
    );
  }
  const evidenceRefs = [...scene.evidence_refs];
  await store.updateRunRecord(result.run_record.run_id, {
    status: "running",
    evidence_refs: evidenceRefs
  });
  const completed = await completeRunWithReadOnlyProjection(store, result.run_record.run_id, {
    result_ref: `result:core/${taskIntent.intent_id}`,
    output_schema_id: packageOutputSchemaId(packageRef, taskIntent.capability.version),
    projection: projectionFromScene(taskIntent, packageRef, scene),
    projection_ref: `projection:core/${taskIntent.intent_id}`,
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "passed",
      summary: "Core completed the read-only task from Harbor refs-only scene evidence.",
      checked_at: new Date().toISOString(),
      evidence_refs: evidenceRefs,
      source_refs: [scene.source_trace_ref],
      consumer_boundary: "Core post-check confirms a terminal refs-only read result envelope; it does not execute writes or inline raw browser/page material."
    },
    retention_state: "active"
  });

  return {
    ok: true,
    task_intent: taskIntent,
    run_record: completed.run_record
  };
}

export async function submitRuntimeTask(
  store: FileRunRecordStore,
  request: RuntimeTaskSubmissionRequest,
  deps: RuntimeTaskSubmissionDependencies
): Promise<TaskSubmissionResult> {
  const package_ref = request.package_ref ?? taskPackageRef(request.task_intent);
  const base = {
    run_id: request.run_id,
    task_intent: request.task_intent,
    ...(package_ref === undefined ? {} : { package_ref })
  };

  if (!package_ref) {
    return acceptReadOnlyTaskSubmission(store, base);
  }

  let lode_package_contract: LodePackageAdmissionContract | undefined;
  let lode_resolution_failure: FailureRecord | undefined;
  if (!deps.lodePackageResolver) {
    lode_resolution_failure = failure("capability_contract", "lode_resolver_unconfigured", "admission", "connect_lode_registry");
  } else {
    try {
      const resolved = await deps.lodePackageResolver({ package_ref, task_intent: request.task_intent });
      if (isFailure(resolved)) lode_resolution_failure = resolved;
      else lode_package_contract = resolved;
    } catch {
      lode_resolution_failure = failure("capability_contract", "lode_registry_unavailable", "admission", "connect_lode_registry");
    }
  }

  if (lode_resolution_failure) {
    return acceptReadOnlyTaskSubmission(store, { ...base, lode_resolution_failure });
  }
  if (!lode_package_contract) {
    return acceptReadOnlyTaskSubmission(store, {
      ...base,
      lode_resolution_failure: failure("capability_contract", "lode_registry_unavailable", "admission", "connect_lode_registry")
    });
  }

  if (!deps.harborRuntimeClient) {
    return acceptReadOnlyTaskSubmission(store, {
      ...base,
      lode_package_contract,
      harbor_admission_failure: failure("resource_admission", "harbor_runtime_api_unconfigured", "runtime_binding", "connect_runtime")
    });
  }

  let harbor: HarborAdmissionInput | FailureRecord;
  try {
    harbor = await deps.harborRuntimeClient.collectAdmissionFacts({
      run_id: request.run_id,
      task_intent: request.task_intent,
      package_ref,
      harbor: request.harbor
    });
  } catch {
    harbor = failure("resource_admission", "harbor_runtime_api_unavailable", "runtime_binding", "connect_runtime");
  }
  const submitted = await acceptReadOnlyTaskSubmission(
    store,
    isFailure(harbor)
      ? { ...base, lode_package_contract, harbor_admission_failure: harbor }
      : { ...base, lode_package_contract, ...harbor }
  );
  if (!submitted.ok || isFailure(harbor)) return submitted;
  return completeAcceptedReadTask(store, submitted, package_ref, harbor);
}

export function createLocalLodePackageResolver(options: LocalLodePackageResolverOptions): LodePackageResolver {
  const rootDir = options.rootDir ?? dirname(dirname(options.registryPath));
  const root = resolve(rootDir);
  const realRoot = realpath(root);

  async function pathUnderRoot(path: string): Promise<string | undefined> {
    const resolved = resolve(root, path);
    const child = relative(root, resolved);
    if (child !== "" && (child.startsWith("..") || isAbsolute(child))) return undefined;
    const [base, target] = await Promise.all([realRoot, realpath(resolved)]);
    const realChild = relative(base, target);
    return realChild === "" || (!realChild.startsWith("..") && !isAbsolute(realChild)) ? target : undefined;
  }

  return async ({ package_ref }) => {
    try {
      const registry = object(JSON.parse(await readFile(options.registryPath, "utf8")));
      const entries = Array.isArray(registry?.entries) ? registry.entries.map(object) : [];
      const entry = entries.find((candidate) => candidate?.package_ref === package_ref);
      if (!entry) return failure("capability_contract", "package_not_found", "admission", "select_capability_version");

      const manifestPath = string(entry.manifest_path);
      const packagePath = string(entry.package_path);
      if (!manifestPath || !packagePath) return failure("capability_contract", "asset_missing", "admission", "repair_package_contract");
      const resolvedManifestPath = await pathUnderRoot(manifestPath);
      if (!resolvedManifestPath) return failure("capability_contract", "asset_missing", "admission", "repair_package_contract");

      const manifest = object(JSON.parse(await readFile(resolvedManifestPath, "utf8")));
      const capability = object(manifest?.capability);
      const resourcePath = resourceRequirementsPath(entry, manifest, packagePath);
      if (!resourcePath) return failure("capability_contract", "resource_requirements_missing", "admission", "repair_package_contract");
      const resolvedResourcePath = await pathUnderRoot(resourcePath);
      if (!resolvedResourcePath) return failure("capability_contract", "resource_requirements_missing", "admission", "repair_package_contract");

      const resource_requirements = object(JSON.parse(await readFile(resolvedResourcePath, "utf8")));
      const capability_id = string(entry.capability_id) ?? string(capability?.capability_id);
      const operation_mode = string(entry.operation_mode) ?? string(capability?.operation_mode);
      const version = string(entry.version) ?? string(capability?.version);
      const lock_ref = string(entry.lock_ref) ?? manifestLockRef(manifest);
      const operation_id = string(entry.operation_id) ?? string(capability?.operation_id);
      const lifecycle = string(entry.lifecycle) ?? string(capability?.lifecycle);
      if (!capability_id || !operation_mode || !version || !lock_ref || !resource_requirements) {
        return failure("capability_contract", "invalid_contract", "admission", "repair_package_contract");
      }

      return {
        package_ref,
        source_ref: package_ref,
        lock_ref,
        capability_id,
        ...(operation_id === undefined ? {} : { operation_id }),
        operation_mode,
        version,
        ...(lifecycle === undefined ? {} : { lifecycle }),
        resource_requirements: resource_requirements as LodePackageAdmissionContract["resource_requirements"]
      };
    } catch {
      return failure("capability_contract", "lode_registry_unavailable", "admission", "connect_lode_registry");
    }
  };
}

function resourceRequirementsPath(entry: JsonObject, manifest: JsonObject | undefined, packagePath: string): string | undefined {
  const direct = string(entry.resource_requirements_path);
  if (direct) return direct;
  const asset = assetByRole(manifest, "resource_requirements");
  const path = string(asset?.path);
  return path ? join(packagePath, path) : undefined;
}

function manifestLockRef(manifest: JsonObject | undefined): string | undefined {
  return string(assetByRole(manifest, "package_lock")?.lock_ref);
}

function assetByRole(manifest: JsonObject | undefined, role: string): JsonObject | undefined {
  const assets = Array.isArray(manifest?.asset_refs) ? manifest.asset_refs.map(object) : [];
  return assets.find((asset) => asset?.role === role);
}

function siteTaskFromPackageRef(packageRef: string): { site_id: SiteRuntimeId; task_kind: string } | undefined {
  const match = /^lode:\/\/site-capability\/(xiaohongshu|boss)\/([^@]+)@/.exec(packageRef);
  if (!match) return undefined;
  const taskSegment = match[2];
  if (!taskSegment) return undefined;
  return {
    site_id: match[1] as SiteRuntimeId,
    task_kind: taskSegment.replace(/-/g, "_")
  };
}

export function createHttpHarborRuntimeClient(options: HttpHarborRuntimeClientOptions): HarborRuntimeClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchJson = options.fetch ?? fetch;

  async function requestJson(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown | FailureRecord> {
    try {
      const init: RequestInit = { method };
      if (method === "POST") {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body ?? {});
      }
      const response = await fetchJson(`${baseUrl}${path}`, init);
      const payload = await response.json() as unknown;
      if (!response.ok) {
        return failureFromHarborPayload(payload) ?? failure("resource_admission", "harbor_runtime_api_unavailable", "runtime_binding", "connect_runtime");
      }
      return payload;
    } catch {
      return failure("resource_admission", "harbor_runtime_api_unavailable", "runtime_binding", "connect_runtime");
    }
  }

  return {
    async collectAdmissionFacts(input) {
      const readiness = await requestJson("GET", "/readiness");
      if (isFailure(readiness)) return readiness;
      if (!readinessOk(readiness)) return failure("resource_admission", "harbor_runtime_not_ready", "runtime_binding", "connect_runtime");

      const provider = await requestJson("GET", "/runtime/browser-providers");
      if (isFailure(provider)) return provider;

      const identityRef = input.harbor?.identity_environment_ref;
      const identityRecord = identityRef === undefined
        ? undefined
        : await requestJson("GET", `/runtime/identity-environments/${encodeURIComponent(identityRef)}`);

      const session = await requestJson("POST", "/runtime/identity-environment-sessions", {
        identity_environment_ref: identityRef,
        url: input.harbor?.url ?? taskUrl(input.task_intent),
        run_id: input.run_id,
        package_ref: input.package_ref,
        control_owner: "core_task",
        holder_ref: input.run_id,
        reuse_existing: input.harbor?.reuse_existing ?? true,
        timeout_ms: input.harbor?.timeout_ms
      });
      if (isFailure(session)) return session;

      const identity = identityFactsFromSession(session) ?? (isFailure(identityRecord) ? undefined : identityFactsFromPublicRecord(identityRecord));
      const runtime = coreRuntimeFactsFromSession(session, identity);
      if (isFailure(runtime)) return runtime;
      const runtimeSessionRef = runtime.runtime_session_ref;
      const siteTask = siteTaskFromPackageRef(input.package_ref);
      const siteResourceFacts = siteTask === undefined
        ? undefined
        : await requestJson(
            "GET",
            `/runtime/sessions/${encodeURIComponent(runtimeSessionRef)}/site-resource-facts?site_id=${encodeURIComponent(siteTask.site_id)}&task_kind=${encodeURIComponent(siteTask.task_kind)}`
          );
      if (isFailure(siteResourceFacts)) return siteResourceFacts;

      const snapshot = await requestJson("POST", `/runtime/sessions/${encodeURIComponent(runtimeSessionRef)}/snapshot`, {
        run_id: input.run_id,
        package_ref: input.package_ref,
        evidence_policy: input.harbor?.evidence_policy
      });
      if (isFailure(snapshot)) return snapshot;

      const scene = sceneFromSnapshot(snapshot);
      const runtimeAfterSnapshot = runtimeFactsAfterSnapshot(runtime, scene);
      const evidenceFailure = "status" in scene ? undefined : await verifyEvidenceRefs(scene.evidence_refs);
      const facts: HarborAdmissionInput = {
        harbor_identity_environment_facts: identity ?? unavailable("identity_environment_unavailable"),
        harbor_provider_status: providerStatus(provider),
        harbor_runtime_facts: runtimeAfterSnapshot,
        harbor_scene_ref: evidenceFailure ? unavailable(evidenceFailure.code) : scene,
        harbor_resource_facts: resourceFactsFromSiteFacts(siteResourceFacts) ?? resourceFactsFromSession(session, runtime)
      };
      return facts;
    }
  };

  async function verifyEvidenceRefs(refs: readonly string[]): Promise<FailureRecord | undefined> {
    for (const ref of refs) {
      const evidence = await requestJson("GET", `/runtime/evidence/${encodeURIComponent(ref)}`);
      if (isFailure(evidence)) return failure("evidence_reference", "evidence_unavailable", "evidence", "rerun_with_evidence");
      const value = object(evidence);
      if (value?.evidence_ref !== ref || value.access_state !== "available") {
        return failure("evidence_reference", "evidence_unavailable", "evidence", "rerun_with_evidence");
      }
    }
    return undefined;
  }
}

function readinessOk(value: unknown): boolean {
  const ready = object(value);
  const status = string(ready?.status) ?? string(ready?.readiness);
  return ready?.ok === true || status === "ready" || status === "ok" || status === "healthy";
}

function pickObject(value: unknown, ...keys: string[]): JsonObject | undefined {
  const root = object(value);
  for (const key of keys) {
    const found = object(root?.[key]);
    if (found) return found;
  }
  return root;
}

function providerStatus(value: unknown): HarborBrowserProviderCatalog | HarborUnavailable {
  const direct = pickObject(value, "harbor_provider_status", "browser_provider_status", "provider_status");
  if (direct?.status === "unavailable") return unavailable(string(direct.failure_class) ?? "browser_provider_unavailable", direct.retryable !== false);
  return (direct ?? value) as HarborBrowserProviderCatalog;
}

function failureFromHarborPayload(value: unknown): FailureRecord | undefined {
  const direct = pickObject(value, "error", "failure", "current_error");
  if (!direct) return undefined;
  if (typeof direct.category === "string" && typeof direct.code === "string") {
    return {
      category: direct.category as FailureRecord["category"],
      code: direct.code,
      phase: typeof direct.phase === "string" ? direct.phase as FailureRecord["phase"] : "runtime_binding",
      recovery_hint: typeof direct.recovery_hint === "string" ? direct.recovery_hint : recoveryHintForHarborFailure(direct.code),
      ...(typeof direct.attribution === "string"
        ? { attribution: direct.attribution as NonNullable<FailureRecord["attribution"]> }
        : { attribution: "runtime" as const })
    };
  }
  const failureClass = string(direct.failure_class) ?? string(direct.code);
  if (!failureClass) return undefined;
  return failure("resource_admission", failureClass, "runtime_binding", recoveryHintForHarborFailure(failureClass));
}

function recoveryHintForHarborFailure(code: string): FailureRecord["recovery_hint"] {
  if (code === "identity_auth_required" || code === "login_expired") return "open_manual_auth";
  if (code.startsWith("identity_environment_")) return "connect_identity_environment";
  if (code === "session_locked") return "wait_or_request_handoff";
  if (code === "url_unreachable") return "fix_input";
  return "connect_runtime";
}

function identityFactsFromSession(value: unknown): HarborIdentityEnvironmentFacts | undefined {
  const direct = pickObject(value, "harbor_identity_environment_facts", "identity_environment_facts", "identity_environment");
  return direct?.schema_version === "harbor-local-identity-environment/v0" ? (direct as HarborIdentityEnvironmentFacts) : undefined;
}

function identityFactsFromPublicRecord(value: unknown): HarborIdentityEnvironmentFacts | undefined {
  const direct = object(value);
  if (direct?.schema_version !== "harbor-local-identity-environment-store/v0") return undefined;
  const site = object(direct.site);
  const status = object(direct.status);
  const refs = object(direct.refs);
  const environment = object(direct.environment_summary);
  const identity_environment_ref = string(direct.identity_environment_ref);
  const execution_identity_ref = string(refs?.execution_identity_ref);
  const profile_ref = string(refs?.profile_ref);
  const origin = string(site?.origin);
  if (!identity_environment_ref || !execution_identity_ref || !profile_ref || !origin) return undefined;
  const selected_provider_id = string(environment?.provider_id) ?? null;
  return {
    schema_version: "harbor-local-identity-environment/v0",
    identity_environment_ref,
    execution_identity_ref,
    profile_ref,
    site_binding: {
      site_id: string(site?.site_id) ?? "unknown",
      origin
    },
    login_state: {
      state: string(status?.login_state) ?? "unknown",
      recovery_required: status?.recovery_required === true
    },
    browser_storage: {
      state: string(status?.browser_storage_state) ?? "unknown"
    },
    provider_binding: {
      selected_provider_id,
      binding_status: selected_provider_id ? "public_record_provider_available" : "no_launchable_provider"
    },
    consumer_boundary: {
      core: "admission_facts_refs_and_blocking_reasons_only",
      not_exposed: ["password", "verification_code", "cookie_value", "storage_value", "session_token"]
    }
  };
}

function coreRuntimeFactsFromSession(value: unknown, identity: HarborIdentityEnvironmentFacts | undefined): HarborCoreRuntimeFacts | FailureRecord {
  const direct = pickObject(value, "harbor_runtime_facts", "core_runtime_facts", "runtime_facts", "session");
  if (!direct) return failure("resource_admission", "runtime_ref_missing", "runtime_binding", "connect_runtime");
  if (direct.status === "unavailable") return failure("resource_admission", string(direct.failure_class) ?? "runtime_session_unavailable", "runtime_binding", "connect_runtime");
  if (direct.schema_version === "harbor-core-runtime-facts/v0") return direct as HarborCoreRuntimeFacts;

  const runtime_session_ref = string(direct.runtime_session_ref);
  const profile_ref = string(direct.profile_ref);
  const provider_ref = string(direct.provider_ref);
  const provider_mode = string(direct.provider_mode);
  const lifecycle_state = string(direct.lifecycle_state);
  const viewer_ref = string(direct.viewer_ref) ?? string(object(direct.viewer)?.viewer_ref);
  if (!runtime_session_ref || !profile_ref || !provider_ref || !provider_mode || !lifecycle_state || !viewer_ref) {
    return failure("resource_admission", "runtime_ref_missing", "runtime_binding", "connect_runtime");
  }
  const viewerEntry = object(direct.viewer_entry);
  const controlLock = object(direct.control_lock);
  const lastSeen = string(direct.last_seen_at) ?? new Date(0).toISOString();
  const identity_environment_ref = string(direct.identity_environment_ref) ?? string(identity?.identity_environment_ref);
  const execution_identity_ref = string(direct.execution_identity_ref) ?? string(identity?.execution_identity_ref);
  return {
    schema_version: "harbor-core-runtime-facts/v0",
    runtime_session_ref,
    ...(identity_environment_ref === undefined ? {} : { identity_environment_ref }),
    ...(execution_identity_ref === undefined ? {} : { execution_identity_ref }),
    profile_ref,
    provider_ref,
    provider_mode,
    lifecycle_state,
    availability: (object(direct.availability) ?? {}) as HarborCoreRuntimeFacts["availability"],
    viewer: {
      viewer_ref,
      availability: string(viewerEntry?.availability) ?? "unsupported",
      access_mode: string(viewerEntry?.access_mode) ?? "none",
      expires_at: string(viewerEntry?.expires_at) ?? lastSeen
    },
    control: {
      owner: string(direct.control_owner) ?? string(controlLock?.owner) ?? "unknown",
      handoff_reason: null,
      takeover: {
        available: false,
        unavailable_reason: "viewer_unavailable"
      },
      updated_at: string(controlLock?.updated_at) ?? lastSeen
    },
    current_error: direct.current_error ?? null,
    fact_refs: {
      session: runtime_session_ref,
      viewer: viewer_ref
    },
    unavailable: null
  };
}

function sceneFromSnapshot(value: unknown): HarborCoreSceneReference | HarborUnavailable {
  const direct = pickObject(value, "harbor_scene_ref", "core_scene_ref", "scene_ref", "snapshot");
  if (direct?.status === "unavailable") return unavailable(string(direct.failure_class) ?? "snapshot_missing", direct.retryable !== false);
  if (direct?.schema_version === "harbor-page-scene-refs/v0") return direct as HarborCoreSceneReference;
  return unavailable("snapshot_missing");
}

function runtimeFactsAfterSnapshot(
  runtime: HarborCoreRuntimeFacts,
  scene: HarborCoreSceneReference | HarborUnavailable
): HarborCoreRuntimeFacts {
  return "status" in scene
    ? runtime
    : {
        ...runtime,
        availability: {
          ...runtime.availability,
          snapshot: "available",
          evidence: "available"
        }
      };
}

function resourceFactsFromSiteFacts(value: unknown): HarborResourceFacts | HarborUnavailable | undefined {
  if (value === undefined) return undefined;
  const direct = pickObject(value, "harbor_site_resource_facts", "site_resource_facts", "resource_facts");
  if (direct?.status === "unavailable") return unavailable(string(direct.failure_class) ?? "resource_requirement_unmatched", direct.retryable !== false);
  if (direct?.schema_version !== "harbor-site-resource-facts/v0") return unavailable("resource_requirement_unmatched");

  const entries = Array.isArray(direct.resource_facts) ? direct.resource_facts.map(object) : [];
  return {
    schema_version: "harbor-core-resource-facts/v0",
    resource_facts: entries.flatMap((entry) => {
      const fact_key = string(entry?.key) ?? string(entry?.fact_key);
      if (!fact_key) return [];
      const rawState = string(entry?.state);
      const state: HarborResourceFactState = rawState === "available" ? "available" : rawState === "unavailable" || rawState === "blocked" || rawState === "unsupported" ? "unavailable" : "unknown";
      const source_ref = string(entry?.evidence_ref);
      return [source_ref === undefined ? { fact_key, state } : { fact_key, state, source_ref }];
    }),
    consumer_boundary: resourceFactsBoundary
  };
}

function resourceFactsFromSession(value: unknown, runtime: HarborCoreRuntimeFacts): HarborResourceFacts {
  const direct = pickObject(value, "harbor_resource_facts", "resource_facts");
  if (direct?.schema_version === "harbor-core-resource-facts/v0") return direct as HarborResourceFacts;

  const source = pickObject(value, "runtime_facts", "session") ?? {};
  const facts = Array.isArray(source.facts) ? source.facts.map(object) : [];
  const resource_facts = facts.flatMap((fact) => {
    const fact_key = string(fact?.key) ?? string(fact?.fact_key);
    if (!fact_key) return [];
    const raw = String(fact?.value ?? fact?.state ?? "");
    const state: HarborResourceFactState = ["available", "ready", "true", "absent", "refs_available"].includes(raw) ? "available" : "unknown";
    const source_ref = string(fact?.evidence_ref);
    return [source_ref === undefined ? { fact_key, state } : { fact_key, state, source_ref }];
  });
  return {
    schema_version: "harbor-core-resource-facts/v0",
    resource_facts: [
      ...resource_facts,
      ...Object.entries(runtime.availability).flatMap(([key, value]) => value === "available" ? [{ fact_key: `runtime.${key}.available`, state: "available" as const }] : [])
    ],
    consumer_boundary: resourceFactsBoundary
  };
}
