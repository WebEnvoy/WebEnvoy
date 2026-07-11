import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";

import type {
  HarborAdmissionInput,
  HarborBrowserProviderCatalog,
  HarborCoreRuntimeFacts,
  HarborCoreSceneReference,
  HarborIdentityEnvironmentFacts,
  HarborResourceFacts,
  HarborUnavailable
} from "./harbor-admission.js";
import type { LodePackageAdmissionContract, LodeRuntimeConsumptionEntry } from "./lode-admission.js";
import { completeRunWithReadOnlyFailure, completeRunWithReadOnlyProjection, type LodeReadOnlyFailureClass, type LodeReadOnlyProjection } from "./read-only-result-projection.js";
import { completeRunWithFailure } from "./result-envelope.js";
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
  public_query?: { query: string };
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
  executeReadOperation(input: { runtime_session_ref: string; site_id: string; operation_id: string; query: string; url?: string }): Promise<unknown | FailureRecord>;
};

export type RuntimeTaskSubmissionDependencies = {
  lodePackageResolver?: LodePackageResolver;
  harborRuntimeClient?: HarborRuntimeClient;
};

export type LocalLodePackageResolverOptions = {
  registryPath: string;
  rootDir?: string;
  allowlistAssetSha256?: string;
};

export type HttpHarborRuntimeClientOptions = {
  baseUrl: string;
  fetch?: FetchLike;
};

const resourceFactsBoundary =
  "Core consumes Harbor public resource readiness keys only; no raw page, storage, credential, network, screenshot, or browser endpoint material." as const;
const lodeAllowlistCommit = "e36a4a7";
const lodeAllowlistAssetPath = "registry/runtime-consumption-allowlist.json";
const lodeAllowlistSemanticSha256 = "599de2eaa0768810a08e49ef840603dded7240a08d9858049e8ee5a081794db7";
const canonicalDeferredProbeOperations = [
  {
    package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
    lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
    site_slug: "xiaohongshu",
    operation_id: "xhs_search_notes",
    version: "0.1.0",
    deferred_facts: new Set(["identity.user_logged_in.confirmed", "page.vue_app.ready", "page.pinia_store.ready", "source.refs.available"])
  },
  {
    package_ref: "lode://site-capability/boss/job-search@0.1.0",
    lock_ref: "lode://lock/site-capability/boss/job-search@0.1.0",
    site_slug: "boss",
    operation_id: "boss_job_search",
    version: "0.1.0",
    deferred_facts: new Set(["page.boss_spa.ready", "network.wapi_zpgeek.available", "source.refs.available"])
  }
] as const;

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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as JsonObject).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as JsonObject)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function allowlistSemanticSha256(allowlist: JsonObject): string {
  const semantic = {
    schema_version: allowlist.schema_version,
    allowlist_id: allowlist.allowlist_id,
    allowlist_version: allowlist.allowlist_version,
    asset_owner: allowlist.asset_owner,
    consumer_boundary: allowlist.consumer_boundary,
    entries: allowlist.entries,
    fail_closed: allowlist.fail_closed
  };
  return createHash("sha256").update(canonicalJson(semantic)).digest("hex");
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

function operationAdmissionContract(contract: LodePackageAdmissionContract): LodePackageAdmissionContract {
  const runtime = contract.runtime_consumption;
  const deferredFacts = runtime && canonicalDeferredProbeOperations.find((operation) =>
    contract.package_ref === operation.package_ref &&
    contract.lock_ref === operation.lock_ref &&
    contract.operation_id === operation.operation_id &&
    contract.version === operation.version &&
    runtime.package_ref === operation.package_ref &&
    runtime.lock_ref === operation.lock_ref &&
    runtime.site_slug === operation.site_slug &&
    runtime.operation_id === operation.operation_id &&
    runtime.version === operation.version &&
    runtime.allowlist_id === "lode.xhs-boss.read.runtime-consumption" &&
    runtime.allowlist_version === "0.1.0" &&
    runtime.asset_owner === "Lode" &&
    runtime.consumer.repository === "WebEnvoy/WebEnvoy" &&
    runtime.consumer.issue === "#267" &&
    runtime.consumer.purpose === "lock-bound read-only task admission and run recording"
  )?.deferred_facts;
  if (!deferredFacts) return contract;
  return {
    ...contract,
    resource_requirements: {
      ...contract.resource_requirements,
      resource_requirement_profiles: contract.resource_requirements.resource_requirement_profiles.map((profile) => ({
        ...profile,
        ...(profile.required_harbor_facts === undefined
          ? {}
          : { required_harbor_facts: profile.required_harbor_facts.filter((fact) => !deferredFacts.has(fact.fact_key)) })
      }))
    }
  };
}

function operationPreflightFailure(
  harbor: HarborAdmissionInput,
  entry: LodeRuntimeConsumptionEntry,
  requestedIdentityRef: string | undefined,
  targetUrl: string | undefined
): FailureRecord | undefined {
  const identity = object(harbor.harbor_identity_environment_facts);
  const runtime = object(harbor.harbor_runtime_facts);
  const control = object(runtime?.control);
  if (identity?.schema_version !== "harbor-local-identity-environment/v0") {
    return failure("resource_admission", "identity_environment_unavailable", "runtime_binding", "connect_identity_environment");
  }
  const login = object(identity?.login_state);
  const site = object(identity?.site_binding);
  const origin = safeHttpUrl(site?.origin);
  const allowedOrigin = origin !== undefined && entry.allowed_origins.some((allowed) => sameOrigin(origin, allowed));
  if (!requestedIdentityRef || identity.identity_environment_ref !== requestedIdentityRef || site?.site_id !== entry.site_slug) {
    return failure("resource_admission", "identity_runtime_mismatch", "runtime_binding", "select_matching_runtime");
  }
  if (
    (login?.reason ?? login?.authentication_provenance) !== "user_confirmed_managed_session" ||
    login?.manual_authentication_state !== "completed" ||
    login?.state !== "logged_in" ||
    login?.recovery_required !== false
  ) {
    return failure("resource_admission", "identity_auth_required", "runtime_binding", "open_manual_auth");
  }
  if (control?.owner !== "core_task" || (control?.lock_owner !== undefined && control.lock_owner !== "core_task")) {
    return failure("resource_admission", "runtime_session_busy", "runtime_binding", "wait_or_request_handoff");
  }
  if (!origin?.startsWith("https://") || !allowedOrigin || !sameOrigin(origin, targetUrl)) {
    return failure("resource_admission", "runtime_origin_not_allowed", "resource_matching", "fix_input");
  }
  return undefined;
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

function projectionFromReadOperation(taskIntent: TaskIntentEnvelope, packageRef: string, operation: JsonObject): LodeReadOnlyProjection {
  const sourceRefs = (operation.source_refs as JsonObject[]).map((entry) => string(object(entry)?.ref) as string);
  const evidenceRefs = (operation.evidence_ref_kinds as JsonObject[]).map((entry) => string(object(entry)?.ref) as string);
  return {
    result_kind: readOnlyResultKind(taskIntent),
    status: "available",
    classification: "success_result",
    normalized: {
      schema_version: "webenvoy.core-harbor-read-operation-projection.v0",
      public_summary: operation.public_summary,
      operation_ref: operation.operation_ref,
      public_summary_ref: operation.public_summary_ref,
      lode_pin: operation.lode_pin,
      capability: { ref: taskIntent.capability.ref, version: taskIntent.capability.version, package_ref: packageRef },
      consumer_boundary: "Core stores Harbor public summary and opaque refs only; raw DOM, HAR, screenshot bytes, cookies, tokens, profile storage, and CDP data are never stored."
    },
    source_refs: sourceRefs,
    evidence_refs: evidenceRefs
  };
}

function validateCompletedReadOperation(
  value: unknown,
  entry: LodeRuntimeConsumptionEntry,
  requested: { runtime_session_ref: string; site_id: string; operation_id: string }
): JsonObject | undefined {
  const operation = object(value);
  const pin = object(operation?.lode_pin);
  const consumer = object(pin?.consumer);
  const postCheck = object(operation?.post_check);
  const boundary = object(operation?.public_boundary);
  const sourceRefs = Array.isArray(operation?.source_refs) ? operation.source_refs.map(object) : [];
  const evidenceRefs = Array.isArray(operation?.evidence_ref_kinds) ? operation.evidence_ref_kinds.map(object) : [];
  const flatEvidenceRefs = Array.isArray(operation?.evidence_refs) ? operation.evidence_refs : [];
  const bodyEvidenceRefs = evidenceRefs.filter((ref) => ref?.kind !== "post_check_ref");
  const publicSummary = object(operation?.public_summary);
  const summaryKeys = new Set(["schema_version", "operation_id", "result_kind", "surface", "result_state", "response_status", "source_signals"]);
  const opaqueRef = (value: unknown) => typeof value === "string" && /^[a-z][a-z0-9_]*_[0-9a-f-]{36}$/i.test(value);
  const validRefs = (refs: (JsonObject | undefined)[]) => refs.length > 0 && refs.every((ref) => Boolean(string(ref?.kind) && opaqueRef(ref?.ref)));
  const exactKinds = (refs: (JsonObject | undefined)[], required: readonly string[]) => {
    const kinds = refs.map((ref) => string(ref?.kind));
    return kinds.length === required.length && new Set(kinds).size === kinds.length && required.every((kind) => kinds.includes(kind));
  };
  const allRefs = [...sourceRefs, ...evidenceRefs].map((ref) => string(ref?.ref));
  if (
    operation?.schema_version !== "harbor-allowlisted-read-operation/v0" || operation.status !== "completed" ||
    !opaqueRef(operation.operation_ref) || !opaqueRef(operation.public_summary_ref) || !publicSummary || Object.keys(publicSummary).some((key) => !summaryKeys.has(key)) ||
    publicSummary.schema_version !== "harbor-read-operation-public-summary/v0" || publicSummary.operation_id !== entry.operation_id ||
    publicSummary.result_state !== "operation_read_response_observed" || typeof publicSummary.response_status !== "number" || publicSummary.response_status < 200 || publicSummary.response_status >= 300 ||
    !Array.isArray(publicSummary.source_signals) || !publicSummary.source_signals.every((signal) => string(signal)) ||
    operation.runtime_session_ref !== requested.runtime_session_ref || operation.site_id !== requested.site_id || operation.operation_id !== requested.operation_id ||
    operation.site_id !== entry.site_slug || operation.operation_id !== entry.operation_id || operation.operation_mode !== "read" ||
    typeof operation.observed_at !== "string" || !Number.isFinite(Date.parse(operation.observed_at)) ||
    !validRefs(sourceRefs) || !validRefs(evidenceRefs) ||
    !exactKinds(sourceRefs, entry.required_source_ref_kinds) || !exactKinds(evidenceRefs, entry.required_evidence_ref_kinds) ||
    new Set(allRefs).size !== allRefs.length ||
    flatEvidenceRefs.length !== bodyEvidenceRefs.length || !flatEvidenceRefs.every((ref, index) => ref === bodyEvidenceRefs[index]?.ref) ||
    postCheck?.status !== "passed" || postCheck.reason !== "managed_provider_read_probe_completed" || !opaqueRef(postCheck.post_check_ref) ||
    postCheck.post_check_ref !== evidenceRefs.find((ref) => ref?.kind === "post_check_ref")?.ref ||
    pin?.repository !== "WebEnvoy/Lode" || pin.commit !== lodeAllowlistCommit || pin.asset_path !== lodeAllowlistAssetPath ||
    pin.asset_sha256 !== "5aa6be8bd416bbd19f73dcfab995f62f769849923f2aa2e995da974b0f329184" ||
    pin.mirror_payload_sha256 !== "bbc17210563ed91fc320f006bbd81a9a965ed43f18ffd3018ee9b25f6c5bdf2e" ||
    pin.allowlist_id !== entry.allowlist_id || pin.allowlist_version !== entry.allowlist_version || pin.asset_owner !== entry.asset_owner ||
    consumer?.repository !== "WebEnvoy/Harbor" || consumer.issue !== "#245" || consumer.purpose !== "allowlisted one-shot read-only operation admission" ||
    boundary?.output !== "public_summary_and_refs_only" || boundary.raw_credentials !== "not_exposed" || boundary.raw_profile_storage !== "not_exposed" ||
    boundary.raw_cdp_endpoint !== "not_exposed" || boundary.raw_dom !== "not_exposed" || boundary.raw_har !== "not_exposed" ||
    boundary.raw_network_bodies !== "not_exposed" || boundary.screenshot_body !== "not_exposed" || boundary.external_write_actions !== "not_performed"
  ) return undefined;
  return operation;
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

async function completeAcceptedReadOperation(
  store: FileRunRecordStore,
  result: Extract<TaskSubmissionResult, { ok: true }>,
  packageRef: string,
  entry: LodeRuntimeConsumptionEntry,
  operation: unknown,
  requested: { runtime_session_ref: string; site_id: string; operation_id: string }
): Promise<TaskSubmissionResult> {
  const completedOperation = validateCompletedReadOperation(operation, entry, requested);
  if (!completedOperation) {
    return completeAcceptedReadTaskWithFailure(store, result, "site_changed", "Core rejected an unavailable or contract-drifted Harbor read operation.");
  }
  const projection = projectionFromReadOperation(result.task_intent, packageRef, completedOperation);
  const evidenceRefs = projection.evidence_refs as string[];
  await store.updateRunRecord(result.run_record.run_id, { status: "running", evidence_refs: evidenceRefs });
  const completed = await completeRunWithReadOnlyProjection(store, result.run_record.run_id, {
    result_ref: `result:core/${result.task_intent.intent_id}`,
    output_schema_id: packageOutputSchemaId(packageRef, result.task_intent.capability.version),
    projection,
    projection_ref: string(completedOperation.public_summary_ref)!,
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "passed",
      summary: "Harbor completed the allowlisted read operation and its Lode-bound post-check passed.",
      checked_at: new Date().toISOString(),
      evidence_refs: evidenceRefs,
      source_refs: projection.source_refs as string[],
      consumer_boundary: "Core records only the validated public summary and opaque operation/source/evidence/post-check refs."
    },
    retention_state: "active"
  });
  return { ok: true, task_intent: result.task_intent, run_record: completed.run_record };
}

async function completeAcceptedUnknownOutcome(
  store: FileRunRecordStore,
  result: Extract<TaskSubmissionResult, { ok: true }>,
  code: string
): Promise<TaskSubmissionResult> {
  await store.updateRunRecord(result.run_record.run_id, { status: "running" });
  const completed = await completeRunWithFailure(store, result.run_record.run_id, {
    status: "unknown_outcome",
    failure: failure("runtime_execution", code, "verification", "reconcile_status"),
    retention_state: "active",
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "not_run",
      summary: "Harbor operation dispatch completed without a trustworthy terminal response.",
      checked_at: new Date().toISOString(),
      code,
      attribution: "runtime",
      recovery_hint: "reconcile_status",
      consumer_boundary: "Core records an indeterminate terminal outcome without inventing result or evidence refs."
    }
  });
  return { ok: false, failure: completed.run_record.failure!, run_record: completed.run_record };
}

function unavailableFailureClass(value: unknown, entry: LodeRuntimeConsumptionEntry, requested: { runtime_session_ref: string; site_id: string; operation_id: string }): string | undefined {
  const unavailable = object(value);
  const failureClass = string(unavailable?.failure_class);
  if (
    unavailable?.schema_version !== "harbor-allowlisted-read-operation/v0" || unavailable.status !== "unavailable" ||
    unavailable.runtime_session_ref !== requested.runtime_session_ref || unavailable.site_id !== requested.site_id || unavailable.operation_id !== requested.operation_id ||
    typeof unavailable.retryable !== "boolean" || !failureClass
  ) return undefined;
  if (entry.required_failure_classes.includes(failureClass)) return failureClass;
  const harborToLode: Record<string, string> = {
    invalid_request: "site_changed",
    operation_not_allowlisted: "site_changed",
    allowlist_pin_invalid: "site_changed",
    target_url_invalid: "site_changed",
    target_origin_not_allowed: "site_changed",
    target_path_not_allowlisted: "site_changed",
    session_missing: "page_not_ready",
    session_unmanaged: "page_not_ready",
    session_not_ready: "page_not_ready",
    session_user_controlled: "page_not_ready",
    fixture_runtime: "page_not_ready",
    provider_probe_unavailable: "network_resource_unavailable",
    origin_drift: "site_changed",
    public_summary_missing: "field_missing",
    source_refs_missing: "field_missing",
    evidence_refs_missing: "network_resource_unavailable",
    post_check_missing: "field_missing"
  };
  const mapped = harborToLode[failureClass];
  return mapped && entry.required_failure_classes.includes(mapped) ? mapped : undefined;
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
  const runtimeConsumption = lode_package_contract.runtime_consumption;
  const preflightFailure = !isFailure(harbor) && runtimeConsumption
    ? operationPreflightFailure(harbor, runtimeConsumption, request.harbor?.identity_environment_ref, request.harbor?.url ?? taskUrl(request.task_intent))
    : undefined;
  const submitted = await acceptReadOnlyTaskSubmission(
    store,
    isFailure(harbor)
      ? { ...base, lode_package_contract, harbor_admission_failure: harbor }
      : {
          ...base,
          lode_package_contract: operationAdmissionContract(lode_package_contract),
          ...harbor,
          ...(preflightFailure === undefined ? {} : { harbor_admission_failure: preflightFailure })
        }
  );
  if (!submitted.ok || isFailure(harbor)) return submitted;
  if (runtimeConsumption) {
    const query = request.public_query?.query;
    if (!query || query.trim() !== query) {
      return completeAcceptedReadTaskWithFailure(store, submitted, "query_missing", "An explicit non-empty public query is required for an allowlisted read operation.");
    }
    const runtimeSessionRef = string(object(harbor.harbor_runtime_facts)?.runtime_session_ref);
    if (!runtimeSessionRef) return completeAcceptedReadTaskWithFailure(store, submitted, "page_not_ready", "Harbor did not provide a runtime session ref for the read operation.");
    let operation: unknown;
    try {
      operation = await deps.harborRuntimeClient.executeReadOperation({
        runtime_session_ref: runtimeSessionRef,
        site_id: runtimeConsumption.site_slug,
        operation_id: runtimeConsumption.operation_id,
        query,
        ...(request.harbor?.url === undefined ? {} : { url: request.harbor.url })
      });
    } catch {
      operation = failure("runtime_execution", "harbor_read_operation_unavailable", "execution", "retry_after_refresh");
    }
    if (isFailure(operation)) return completeAcceptedUnknownOutcome(store, submitted, operation.code);
    if (object(operation)?.status === "unavailable") {
      const requested = { runtime_session_ref: runtimeSessionRef, site_id: runtimeConsumption.site_slug, operation_id: runtimeConsumption.operation_id };
      const failureClass = unavailableFailureClass(operation, runtimeConsumption, requested);
      if (!failureClass) return completeAcceptedReadTaskWithFailure(store, submitted, "site_changed", "Core rejected a Harbor unavailable response outside the pinned Lode failure taxonomy.");
      return completeAcceptedReadTaskWithFailure(store, submitted, failureClass as LodeReadOnlyFailureClass, `Harbor read operation ended with ${failureClass}.`);
    }
    const requested = { runtime_session_ref: runtimeSessionRef, site_id: runtimeConsumption.site_slug, operation_id: runtimeConsumption.operation_id };
    return completeAcceptedReadOperation(store, submitted, package_ref, runtimeConsumption, operation, requested);
  }
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
      const runtime_consumption = await resolveRuntimeConsumption(package_ref, lock_ref, version, operation_id, entry.task_kind === "real_site_read");
      if (runtime_consumption instanceof Error) return failure("capability_contract", runtime_consumption.message, "admission", "repair_package_contract");

      return {
        package_ref,
        source_ref: package_ref,
        lock_ref,
        capability_id,
        ...(operation_id === undefined ? {} : { operation_id }),
        operation_mode,
        version,
        ...(lifecycle === undefined ? {} : { lifecycle }),
        resource_requirements: resource_requirements as LodePackageAdmissionContract["resource_requirements"],
        ...(runtime_consumption === undefined ? {} : { runtime_consumption })
      };
    } catch {
      return failure("capability_contract", "lode_registry_unavailable", "admission", "connect_lode_registry");
    }
  };

  async function resolveRuntimeConsumption(packageRef: string, lockRef: string, version: string, operationId: string | undefined, required: boolean): Promise<LodeRuntimeConsumptionEntry | undefined | Error> {
    const path = await pathUnderRoot(lodeAllowlistAssetPath).catch(() => undefined);
    if (!path) return required ? new Error("runtime_consumption_allowlist_missing") : undefined;
    const allowlist = object(JSON.parse(await readFile(path, "utf8")));
    if (!allowlist || allowlistSemanticSha256(allowlist) !== (options.allowlistAssetSha256 ?? lodeAllowlistSemanticSha256)) {
      return new Error("runtime_consumption_allowlist_pin_mismatch");
    }
    const entries = Array.isArray(allowlist?.entries) ? allowlist.entries.map(object) : [];
    const entry = entries.find((candidate) => candidate?.package_ref === packageRef);
    if (!entry) return required ? new Error("runtime_consumption_operation_missing") : undefined;
    const boundary = object(allowlist?.consumer_boundary);
    const consumers = Array.isArray(boundary?.allowed_consumers) ? boundary.allowed_consumers.map(object) : [];
    const consumer = consumers.find((candidate) => candidate?.repository === "WebEnvoy/WebEnvoy" && candidate.issue === "#267");
    const resource = object(entry.resource_requirements);
    const failureTaxonomy = object(entry.failure_taxonomy);
    const evidence = object(entry.evidence_and_post_check);
    const strings = (value: unknown) => Array.isArray(value) && value.every((item) => string(item)) ? value as string[] : undefined;
    const requiredRefKinds = strings(evidence?.required_ref_kinds);
    const requiredSourceRefKinds = requiredRefKinds?.filter((kind) => !kind.endsWith("_ref")) ?? [];
    if (requiredSourceRefKinds.length === 0 && requiredRefKinds?.includes("network_summary_ref")) requiredSourceRefKinds.push("network_summary");
    const requiredEvidenceRefKinds = requiredRefKinds?.filter((kind) => kind.endsWith("_ref"));
    const requiredFailureClasses = strings(failureTaxonomy?.required_classes);
    const requiredPostCheckFields = strings(evidence?.required_post_check_fields);
    if (
      allowlist?.schema_version !== "lode.runtime-consumption-allowlist.v0" || !string(allowlist.allowlist_id) || !string(allowlist.allowlist_version) || allowlist.asset_owner !== "Lode" ||
      consumer?.purpose !== "lock-bound read-only task admission and run recording" ||
      entry.lock_ref !== lockRef || entry.version !== version || entry.operation_id !== operationId || entry.operation_mode !== "read" || entry.lifecycle !== "proposed" ||
      !string(entry.site_slug) || !strings(entry.allowed_origins)?.every((origin) => origin.startsWith("https://")) ||
      !string(resource?.resource_requirements_id) || !string(failureTaxonomy?.failure_mapping_id) || !requiredFailureClasses?.length ||
      !requiredRefKinds?.length || !string(evidence?.post_check_id) || requiredPostCheckFields?.join(",") !== "status,reason,source_refs,evidence_refs"
    ) return new Error("runtime_consumption_allowlist_drift");
    return {
      allowlist_id: string(allowlist.allowlist_id)!, allowlist_version: string(allowlist.allowlist_version)!, asset_owner: "Lode",
      consumer: { repository: string(consumer.repository)!, issue: string(consumer.issue)!, purpose: string(consumer.purpose)! },
      package_ref: packageRef, lock_ref: lockRef, version, site_slug: string(entry.site_slug)!, operation_id: operationId!, operation_mode: "read", lifecycle: "proposed",
      allowed_origins: entry.allowed_origins as string[], resource_requirements_id: string(resource!.resource_requirements_id)!,
      failure_mapping_id: string(failureTaxonomy!.failure_mapping_id)!, required_failure_classes: requiredFailureClasses,
      required_source_ref_kinds: requiredSourceRefKinds, required_evidence_ref_kinds: requiredEvidenceRefKinds!,
      post_check_id: string(evidence!.post_check_id)!, required_post_check_fields: requiredPostCheckFields!
    };
  }
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
  const supervisorToken = process.env.HARBOR_RUNTIME_SUPERVISOR_TOKEN;
  const harborHost = (() => {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      return "";
    }
  })();
  const localHarbor = harborHost === "localhost" || harborHost === "127.0.0.1" || harborHost === "::1" || harborHost === "[::1]";

  function protectedHeaders(method: "GET" | "POST", path: string): Record<string, string> | FailureRecord | undefined {
    const protectedRequest = method === "POST" && (
      path === "/runtime/identity-environment-sessions" ||
      /^\/runtime\/(?:identity-environment-)?sessions\/[^/]+\/(?:lock|release|stop|snapshot|read-operations)$/.test(path)
    );
    if (!protectedRequest || !localHarbor) return undefined;
    if (!supervisorToken || supervisorToken.trim() !== supervisorToken || /[\r\n]/.test(supervisorToken)) {
      return failure("resource_admission", "harbor_runtime_supervisor_token_missing", "runtime_binding", "connect_runtime");
    }
    return { authorization: `Bearer ${supervisorToken}` };
  }

  async function requestJson(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown | FailureRecord> {
    try {
      const authorization = protectedHeaders(method, path);
      if (isFailure(authorization)) return authorization;
      const init: RequestInit = { method, ...(authorization === undefined ? {} : { headers: authorization }) };
      if (method === "POST") {
        init.headers = { ...authorization, "content-type": "application/json" };
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
    },
    async executeReadOperation(input) {
      try {
        const path = `/runtime/sessions/${encodeURIComponent(input.runtime_session_ref)}/read-operations`;
        const authorization = protectedHeaders("POST", path);
        if (isFailure(authorization)) return authorization;
        const response = await fetchJson(`${baseUrl}${path}`, {
          method: "POST",
          headers: { ...authorization, "content-type": "application/json" },
          body: JSON.stringify({ site_id: input.site_id, operation_id: input.operation_id, query: input.query, ...(input.url === undefined ? {} : { url: input.url }) })
        });
        const payload = await response.json() as unknown;
        const body = object(payload);
        if (body?.schema_version === "harbor-allowlisted-read-operation/v0" && (body.status === "completed" || body.status === "unavailable")) return payload;
        return failure("runtime_execution", "harbor_read_operation_outcome_unknown", "verification", "reconcile_status");
      } catch {
        return failure("runtime_execution", "harbor_read_operation_outcome_unknown", "verification", "reconcile_status");
      }
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
      authentication_provenance: string(status?.authentication_provenance) ?? "unknown",
      manual_authentication_state: string(status?.manual_authentication_state) ?? "unknown",
      recovery_required: status?.recovery_required === false ? false : true
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
  const lockOwner = string(controlLock?.owner);
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
      owner: string(direct.control_owner) ?? lockOwner ?? "unknown",
      ...(lockOwner === undefined ? {} : { lock_owner: lockOwner }),
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
