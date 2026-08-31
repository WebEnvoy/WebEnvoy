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
import {
  projectHarborPublicIdentityEnvironmentRecord,
  validateHarborIdentityEnvironmentFacts,
  validateHarborIdentityProviderStatus
} from "./harbor-admission.js";
import {
  lodeRuntimeAdmissionFailure,
  parseLodeRuntimeAdmissionPolicy,
  type LodePackageAdmissionContract,
  type LodeRuntimeAdmissionPolicy,
  type LodeRuntimeConsumptionEntry
} from "./lode-admission.js";
import {
  matchLockedLodeOperation,
  matchLockedOperationIdentity,
  isOpaqueDetailOperationContract,
  opaqueDetailOperationContract,
  type LockedOperationMatch,
  type LockedOperationSelection
} from "./operation-identity-matcher.js";
import { readBoundedJsonResponse } from "./bounded-json-response.js";
import { normalizePublicHttpTarget } from "./public-target-reference.js";
import { completeRunWithReadOnlyEmptyResult, completeRunWithReadOnlyFailure, completeRunWithReadOnlyProjection, type LodeReadOnlyFailureClass, type LodeReadOnlyProjection } from "./read-only-result-projection.js";
import { completeRunWithFailure } from "./result-envelope.js";
import { terminalRunRecordStatuses, type FailureRecord, type FileRunRecordStore, type PreviewResult, type RunRecord } from "./run-record-store.js";
import { acceptApprovedWritePrecheckTask, acceptReadOnlyTaskSubmission, validateTaskIntent, type TaskIntentEnvelope, type TaskSubmissionResult } from "./task-submission.js";
import {
  commitDetailTargetReservation,
  compensatePublishedSearchDetailTargets,
  inspectDetailTarget,
  inspectDetailTargetForIdentity,
  isOpaqueDetailRef,
  publishSearchDetailTargets,
  releaseDetailTargetReservation,
  reserveDetailTarget,
  rollbackSearchDetailTargets,
  stageSearchDetailTargets,
  type DetailTargetBatch,
  type DetailTargetReservation
} from "./detail-target-store.js";
import { sameOrigin } from "./execution-policy.js";
import type { FileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import type { FileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import {
  evaluateWritePrecheckTaskPolicy,
  isExactWritePrecheckRun,
  isUnifiedWritePrecheckTask,
  persistWritePrecheckPolicyDecision,
  writePrecheckPolicyFailure,
  type EvaluatedWritePrecheckPolicy,
  type WritePrecheckAuthorizationContext
} from "./write-precheck-policy.js";

type JsonObject = Record<string, unknown>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type HarborResourceFactState = HarborResourceFacts["resource_facts"][number]["state"];
type SiteRuntimeId = "xiaohongshu" | "boss";

export type RuntimeTaskSubmissionRequest = {
  run_id: string;
  run_claim_token?: string;
  task_intent: unknown;
  package_ref?: string;
  public_query?: { query: string; city_code?: string; page?: number; limit?: number };
  harbor?: {
    identity_environment_ref?: string;
    url?: string;
    reuse_existing?: boolean;
    timeout_ms?: number;
    evidence_policy?: JsonObject;
    session?: JsonObject;
    snapshot?: JsonObject;
  };
  /** Internal task-thread binding; callers cannot supply this through /tasks. */
  authorization_context?: WritePrecheckAuthorizationContext;
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
  admission_mode?: "read" | "write_precheck";
  harbor?: RuntimeTaskSubmissionRequest["harbor"];
  runtime_session_ref?: string;
};

type HarborAdmissionCollectionFailure = {
  kind: "harbor_admission_collection_failure";
  failure: FailureRecord;
  cleanup_failure: FailureRecord;
  runtime_session_ref: string;
};

type HarborRuntimeAdmissionResult = HarborAdmissionInput | FailureRecord | HarborAdmissionCollectionFailure;

export type HarborRuntimeClient = {
  collectAdmissionFacts(input: HarborRuntimeAdmissionRequest): Promise<HarborRuntimeAdmissionResult>;
  /** Execute the Lode-pinned, validate-only XHS publish precheck once a Core policy allows it. */
  validateOnlyWritePrecheck(input: {
    runtime_session_ref: string;
    holder_ref?: string;
    url: string;
    target_ref: string;
    requested_fields?: readonly ("title" | "summary" | "canonical_url" | "source_status")[];
    include_source_refs?: boolean;
    proposed_input_summary?: string;
    signal?: AbortSignal;
  }): Promise<unknown | FailureRecord>;
  executeReadOperation(input: { runtime_session_ref: string; holder_ref?: string; site_id: string; operation_id: string; query?: string; city_code?: string; limit?: number; detail_ref?: string; url?: string; signal?: AbortSignal }): Promise<unknown | FailureRecord>;
  releaseCoreTaskSession(input: { runtime_session_ref: string; run_id: string }): Promise<FailureRecord | undefined>;
};

export type RuntimeTaskSubmissionDependencies = {
  lodePackageResolver?: LodePackageResolver;
  harborRuntimeClient?: HarborRuntimeClient;
  executionPolicyConfigStore?: FileExecutionPolicyConfigStore;
  authorizationDecisionStore?: FileAuthorizationDecisionStore;
  clock?: () => Date;
};

export type LocalLodePackageResolverOptions = {
  registryPath: string;
  rootDir?: string;
  allowlistAssetSha256?: string;
  runtimeAdmissionAssetSha256?: Readonly<Record<string, string>>;
  /** Test-only override for the Lode-owned declaration content pin. */
  searchRuntimeConsumptionDeclarationSha256?: string;
};

export type HttpHarborRuntimeClientOptions = {
  baseUrl: string;
  fetch?: FetchLike;
  cleanupTimeoutMs?: number;
};

const resourceFactsBoundary =
  "Core consumes Harbor public resource readiness keys only; no raw page, storage, credential, network, screenshot, or browser endpoint material." as const;
const lodeAllowlistCommit = "e36a4a7";
const lodeAllowlistAssetPath = "registry/runtime-consumption-allowlist.json";
const lodeAllowlistSemanticSha256 = "0e36e0844fa917d84c47db619929e345e8b95463f3d2e74186488d7e3a34a987";
const lodeRuntimeAdmissionAssetPaths = [
  lodeAllowlistAssetPath,
  "registry/detail-runtime-consumption.json",
  "registry/validate-only-runtime-consumption.json"
] as const;
// WebEnvoy/Lode@6bff1afd059a30571f8ed219d1dcd25e6fb20c6b.
const lodeRuntimeAdmissionAssetSemanticSha256: Readonly<Record<string, string>> = {
  "registry/detail-runtime-consumption.json": "ad17f4400ef745b1ebdb4cb46b2f4b50f274ee5ef3cfd5074e5980915a27a1a0",
  "registry/validate-only-runtime-consumption.json": "21f57cfd9f395bb13b322aec9e5dd0c9c5f01ea959052e3ceb0aeaf14e636ce0"
};
const lodeSearchRuntimeConsumptionDeclarationPath = "registry/search-runtime-consumption.json";
const lodeSearchRuntimeConsumptionDeclarationSha256 = "76d017a5e5dc79e774d586c10fb2494d6704013118ab14b739ceb5547ce3f0b0";
const lodeSearchRuntimeConsumptionAssetRoles = [
  "manifest",
  "package_lock",
  "input_schema",
  "output_schema",
  "resource_requirements",
  "failure_mapping",
  "post_check",
  "runtime_consumption_allowlist"
] as const;
const xhsDetailPackageRef = opaqueDetailOperationContract.package_ref;
const xhsDetailLockRef = opaqueDetailOperationContract.lock_ref;
const lodeDetailTruthAssetSha256 = "dca2761b7feb09a0ab86f7202e153da3c97b21a75299af6adaf64eade319deef";
const canonicalDeferredProbeOperations = [
  {
    package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
    lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
    site_slug: "xiaohongshu",
    operation_id: "xhs_search_notes",
    version: "0.1.0",
    allowlist_id: "lode.xhs-boss.read.runtime-consumption",
    consumer_issue: "#267",
    consumer_purpose: "lock-bound read-only task admission and run recording",
    deferred_facts: new Set(["identity.user_logged_in.confirmed", "page.vue_app.ready", "page.pinia_store.ready", "source.refs.available"])
  },
  {
    package_ref: opaqueDetailOperationContract.package_ref,
    lock_ref: opaqueDetailOperationContract.lock_ref,
    site_slug: opaqueDetailOperationContract.site_slug,
    operation_id: opaqueDetailOperationContract.operation_id,
    version: opaqueDetailOperationContract.version,
    allowlist_id: "lode.xhs-boss.detail-read.runtime-consumption",
    consumer_issue: "#270",
    consumer_purpose: "persisted opaque detail ref consumption",
    deferred_facts: new Set(["identity.user_logged_in.confirmed", "page.vue_app.ready", "page.pinia_store.ready", "source.refs.available"])
  },
  {
    package_ref: "lode://site-capability/boss/job-search@0.1.0",
    lock_ref: "lode://lock/site-capability/boss/job-search@0.1.0",
    site_slug: "boss",
    operation_id: "boss_job_search",
    version: "0.1.0",
    allowlist_id: "lode.xhs-boss.read.runtime-consumption",
    consumer_issue: "#267",
    consumer_purpose: "lock-bound read-only task admission and run recording",
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

function isAdmissionCollectionFailure(value: unknown): value is HarborAdmissionCollectionFailure {
  return object(value)?.kind === "harbor_admission_collection_failure";
}

function taskPackageRef(taskIntent: unknown): string | undefined {
  const intent = object(taskIntent);
  return string(intent?.package_ref) ?? string(object(intent?.capability)?.source_ref);
}

function taskUrl(taskIntent: unknown): string | undefined {
  const intent = object(taskIntent);
  const targetRef = string(object(intent?.scope)?.target_ref);
  if (!targetRef) return undefined;
  const normalized = normalizePublicHttpTarget(targetRef);
  return normalized.ok ? normalized.target_ref : undefined;
}

function xhsDetailRefFromIntent(taskIntent: unknown): string | FailureRecord | undefined {
  const intent = object(taskIntent);
  const sourceRef = string(object(intent?.capability)?.source_ref);
  if (sourceRef !== xhsDetailPackageRef) return undefined;
  const input = object(intent?.input);
  const scope = object(intent?.scope);
  const refs = input?.refs;
  const ref = Array.isArray(refs) && refs.length === 1 ? refs[0] : undefined;
  if (
    Object.keys(input ?? {}).some((key) => key !== "summary" && key !== "refs") ||
    scope?.target_type !== "xiaohongshu_note_detail" ||
    !isOpaqueDetailRef(ref) ||
    scope.target_ref !== ref ||
    string(object(intent?.capability)?.lock_ref) !== xhsDetailLockRef
  ) {
    return failure("capability_contract", "detail_ref_invalid", "admission", "use_persisted_search_detail_ref");
  }
  return ref;
}

function isXhsDetailOperation(entry: LodeRuntimeConsumptionEntry | undefined): boolean {
  return isOpaqueDetailOperationContract(entry);
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

function operationAdmissionContract(
  contract: LodePackageAdmissionContract,
  verifiedXhsDetailInput: boolean
): LodePackageAdmissionContract {
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
    runtime.allowlist_id === operation.allowlist_id &&
    runtime.allowlist_version === "0.1.0" &&
    runtime.asset_owner === "Lode" &&
    runtime.consumer.repository === "WebEnvoy/WebEnvoy" &&
    runtime.consumer.issue === operation.consumer_issue &&
    runtime.consumer.purpose === operation.consumer_purpose
  )?.deferred_facts;
  const verifiedInputFacts = verifiedXhsDetailInput
    ? new Set(["input.signed_note_ref.available"])
    : undefined;
  if (!deferredFacts && !verifiedInputFacts) return contract;
  const excludedFacts = new Set([...(deferredFacts ?? []), ...(verifiedInputFacts ?? [])]);
  return {
    ...contract,
    resource_requirements: {
      ...contract.resource_requirements,
      resource_requirement_profiles: contract.resource_requirements.resource_requirement_profiles.map((profile) => ({
        ...profile,
        ...(profile.required_harbor_facts === undefined
          ? {}
          : { required_harbor_facts: profile.required_harbor_facts.filter((fact) => !excludedFacts.has(fact.fact_key)) })
      }))
    }
  };
}

function operationSelectionFromTask(
  contract: LodePackageAdmissionContract,
  taskIntent: TaskIntentEnvelope,
  detailOperation: boolean,
  requestedTargetRef: string | undefined
): LockedOperationSelection | FailureRecord {
  const resourceRef = taskIntent.resource_requirement_refs.length === 1 ? taskIntent.resource_requirement_refs[0] : undefined;
  const profileId = taskIntent.resource_requirement_profile_id;
  const scopeTarget = detailOperation ? undefined : normalizePublicHttpTarget(taskIntent.scope.target_ref);
  const requestedTarget = requestedTargetRef === undefined ? scopeTarget : normalizePublicHttpTarget(requestedTargetRef);
  const detailOrigin = detailOperation ? contract.runtime_consumption?.allowed_origins[0] : undefined;
  const targetRef = detailOperation
    ? taskIntent.scope.target_ref
    : scopeTarget?.ok && requestedTarget?.ok && scopeTarget.target_ref === requestedTarget.target_ref
      ? scopeTarget.target_ref
      : undefined;
  const targetOrigin = detailOperation
    ? detailOrigin
    : scopeTarget?.ok && requestedTarget?.ok && scopeTarget.target_ref === requestedTarget.target_ref
      ? scopeTarget.target_origin
      : undefined;
  if (!contract.lock_ref || !contract.operation_id || !resourceRef || !profileId || !targetRef || !targetOrigin) {
    return failure("capability_contract", "operation_selection_invalid", "resource_matching", "fix_input");
  }
  return {
    package_ref: contract.package_ref,
    lock_ref: taskIntent.capability.lock_ref ?? "",
    version: taskIntent.capability.version,
    operation_id: contract.operation_id,
    operation_mode: taskIntent.policy.execution_intent,
    target_ref: targetRef,
    target_origin: targetOrigin,
    resource_requirement_ref: resourceRef,
    resource_requirement_profile_id: profileId
  };
}

function operationPreflightFailure(
  harbor: HarborAdmissionInput,
  operation: LockedOperationMatch,
  requestedIdentityRef: string | undefined
): FailureRecord | undefined {
  const identity = object(harbor.harbor_identity_environment_facts);
  const runtime = object(harbor.harbor_runtime_facts);
  const control = object(runtime?.control);
  if (identity?.schema_version !== "harbor-local-identity-environment/v0" || !requestedIdentityRef) {
    return failure("resource_admission", "identity_environment_unavailable", "runtime_binding", "connect_identity_environment");
  }
  const identityFailure = matchLockedOperationIdentity(operation, identity as HarborIdentityEnvironmentFacts, requestedIdentityRef);
  if (identityFailure) return identityFailure;
  if (control?.owner !== "core_task" || (control?.lock_owner !== undefined && control.lock_owner !== "core_task")) {
    return failure("resource_admission", "runtime_session_busy", "runtime_binding", "wait_or_request_handoff");
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

function projectionFromReadOperation(
  taskIntent: TaskIntentEnvelope,
  packageRef: string,
  operation: JsonObject,
  searchDeclaration?: LodePackageAdmissionContract["runtime_consumption_declaration"],
  requestedQuery?: string
): LodeReadOnlyProjection {
  const sourceRefs = (operation.source_refs as JsonObject[]).map((entry) => string(object(entry)?.ref) as string);
  const evidenceRefs = (operation.evidence_ref_kinds as JsonObject[]).map((entry) => string(object(entry)?.ref) as string);
  const publicSummary = object(operation.public_summary);
  if (searchDeclaration !== undefined) {
    const items = (Array.isArray(publicSummary?.items) ? publicSummary.items : []).map((value) => {
      const item = object(value) ?? {};
      return {
        detail_ref: item.detail_ref,
        title: item.title,
        ...(item.author_display_name === undefined ? {} : { author_display_name: item.author_display_name }),
        ...(item.interaction_metrics === undefined ? {} : { interaction_metrics: item.interaction_metrics })
      };
    });
    const keyword = requestedQuery ?? "";
    const resultCount = publicSummary?.result_count as number;
    const boundedKeyword = keyword.length > 80 ? keyword.slice(0, 80) : keyword;
    const normalized = {
      canonical_url: taskIntent.scope.target_ref,
      title: `Xiaohongshu search results (${resultCount})`,
      summary: boundedKeyword.length === 0 ? "Public Xiaohongshu search results." : `Public search results for ${boundedKeyword}.`,
      source_status: "located",
      keyword,
      result_count: resultCount,
      has_more: "unknown",
      notes: items
    };
    const pinnedSourceRefs = sourceRefs.map((ref, index) => ({
      ref_id: ref,
      source_kind: string(object((operation.source_refs as JsonObject[])[index])?.kind) ?? "summary_ref",
      producer: "Harbor",
      redaction: "summary_only",
      schema_hint: "harbor.runtime-summary-ref.v0"
    }));
    const pinnedEvidenceRefs = evidenceRefs.map((ref, index) => ({
      ref_id: ref,
      evidence_kind: string(object((operation.evidence_ref_kinds as JsonObject[])[index])?.kind) ?? "evidence_ref",
      producer: "Harbor",
      redaction: "refs_only"
    }));
    return {
      result_kind: "xhs_note_search",
      status: "available",
      classification: "success_result",
      normalized,
      source_refs: pinnedSourceRefs,
      evidence_refs: pinnedEvidenceRefs,
      warnings: ["Core normalized the Harbor public summary against the pinned Lode output contract."]
    };
  }
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

function validXhsSearchSummary(
  summary: JsonObject | undefined,
  detailRefs: unknown[],
  requestedLimit: number | undefined
): boolean {
  if (
    summary == null ||
    !Number.isInteger(summary.result_count) ||
    summary.result_count !== detailRefs.length ||
    detailRefs.length === 0 ||
    detailRefs.length > Math.min(requestedLimit ?? 15, 15) ||
    new Set(detailRefs).size !== detailRefs.length ||
    !detailRefs.every(isOpaqueDetailRef)
  ) return false;

  if (summary.schema_version === "harbor-read-operation-public-summary/v0") {
    return summary.items === undefined;
  }
  if (summary.schema_version !== "harbor-read-operation-public-summary/v1") return false;

  const items = Array.isArray(summary.items) ? summary.items.map(object) : [];
  const itemKeys = new Set(["detail_ref", "title", "author_display_name", "interaction_metrics"]);
  const metricKeys = new Set(["likes", "comments", "collects"]);
  const bounded = (value: unknown, max: number) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
  const safePublicText = (value: unknown, max: number) =>
    bounded(value, max) &&
    !/(?:^|[^a-z0-9_-])(?:[a-z0-9_-]*token|cookie|authorization|password|passwd|secret|credential|profile[_-]?storage|raw[_-]?(?:dom|har)|network[_-]?response[_-]?body)\s*[=:]\s*\S+/i.test(value as string) &&
    !/\bbearer\s+\S+/i.test(value as string);
  const optionalPublicText = (value: unknown, max: number) => value === undefined || safePublicText(value, max);

  return items.length === detailRefs.length && items.every((item, index) => {
    if (!item || Object.keys(item).some((key) => !itemKeys.has(key)) || item.detail_ref !== detailRefs[index] || !safePublicText(item.title, 200)) {
      return false;
    }
    if (!optionalPublicText(item.author_display_name, 100)) return false;
    const metrics = object(item.interaction_metrics);
    if (item.interaction_metrics !== undefined && metrics === undefined) return false;
    return metrics === undefined || (
      Object.keys(metrics).length > 0 &&
      Object.keys(metrics).every((key) => metricKeys.has(key)) &&
      [...metricKeys].every((key) =>
        metrics[key] === undefined ||
        (bounded(metrics[key], 40) && /^[0-9０-９.,+\-\s万千百wWkKmM]+$/u.test(metrics[key] as string))
      )
    );
  });
}

type ReadOperationValidation =
  | { ok: true; operation: JsonObject }
  | {
      ok: false;
      failureClass: LodeReadOnlyFailureClass;
      failureCategory?: FailureRecord["category"];
      failureAttribution?: NonNullable<FailureRecord["attribution"]>;
    };

function validateCompletedReadOperation(
  value: unknown,
  entry: LodeRuntimeConsumptionEntry,
  requested: { runtime_session_ref: string; site_id: string; operation_id: string; query?: string; city_code?: string; limit?: number; detail_ref?: string },
  searchDeclaration?: LodePackageAdmissionContract["runtime_consumption_declaration"]
): ReadOperationValidation {
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
  const detailOperation = entry.operation_id === "xhs_read_note_detail";
  const expectedSummary = entry.operation_id === "boss_job_search"
    ? {
        keys: ["schema_version", "operation_id", "result_kind", "surface", "result_state", "response_status", "query", "city_code", "business_code", "job_count", "source_signals"],
        resultKind: "boss_job_search_surface",
        surface: "web_geek_jobs",
        sourceSignals: ["boss_wapi_zpgeek_read_network"]
      }
    : detailOperation
      ? {
        keys: ["schema_version", "operation_id", "result_kind", "surface", "result_state", "response_status", "normalized", "source_signals"],
        resultKind: "xiaohongshu_note_detail_surface",
        surface: "note_detail",
        sourceSignals: ["pinia_note_store_ready", "xhs_note_detail_document", "xhs_note_detail_rendered"]
      }
      : {
        keys: ["schema_version", "operation_id", "result_kind", "surface", "result_state", "response_status", "result_count", "detail_refs", "items", "source_signals"],
        resultKind: "xiaohongshu_search_notes_surface",
        surface: "search_result",
        sourceSignals: ["pinia_store", "xhs_search_read_network"]
      };
  const summaryKeys = new Set(expectedSummary.keys);
  const sourceSignals = Array.isArray(publicSummary?.source_signals) ? publicSummary.source_signals : [];
  const opaqueRef = (value: unknown) => typeof value === "string" && /^[a-z][a-z0-9_]*_[0-9a-f-]{36}$/i.test(value);
  const validRefs = (refs: (JsonObject | undefined)[]) => refs.length > 0 && refs.every((ref) => Boolean(string(ref?.kind) && opaqueRef(ref?.ref)));
  const exactKinds = (refs: (JsonObject | undefined)[], required: readonly string[]) => {
    const kinds = refs.map((ref) => string(ref?.kind));
    return kinds.length === required.length && new Set(kinds).size === kinds.length && required.every((kind) => kinds.includes(kind));
  };
  const allRefs = [...sourceRefs, ...evidenceRefs].map((ref) => string(ref?.ref));
  const detailRefs = Array.isArray(publicSummary?.detail_refs) ? publicSummary.detail_refs : [];
  const normalized = object(publicSummary?.normalized);
  const author = object(normalized?.author);
  const metrics = object(normalized?.interaction_metrics);
  const citation = object(normalized?.source_citation);
  const bounded = (candidate: unknown, max: number) => typeof candidate === "string" && candidate.length > 0 && candidate.length <= max && candidate.trim() === candidate;
  const validDetailSummary = !detailOperation || (
    normalized?.kind === "xiaohongshu_note_detail" &&
    typeof normalized.canonical_url === "string" &&
    normalized.canonical_url === `https://www.xiaohongshu.com/explore/${normalized.note_id}` &&
    typeof normalized.note_id === "string" && /^[a-f0-9]{24}$/i.test(normalized.note_id) &&
    bounded(normalized.title, 200) && bounded(normalized.summary, 2000) && bounded(normalized.body_summary, 4000) &&
    bounded(author?.display_name, 100) && bounded(author?.author_id, 100) &&
    author?.profile_url === `https://www.xiaohongshu.com/user/profile/${string(author?.author_id) ?? ""}` &&
    ["likes", "comments", "collects", "shares"].every((key) => bounded(metrics?.[key], 40)) &&
    citation?.kind === "xhs_note_detail_ref" &&
    citation.note_id === normalized.note_id &&
    citation.url === normalized.canonical_url &&
    Array.isArray(citation.field_sources) &&
    citation.field_sources.join(",") === "pinia_store_summary,network_summary,dom_snapshot_summary" &&
    (normalized.source_status === "located" || normalized.source_status === "partially_located") &&
    !/(xsec|cookie|token|profile_storage|raw_dom|raw_har|network_response_body|screenshot_body)/i.test(JSON.stringify(normalized))
  );
  const validSearchSummary = entry.operation_id !== "xhs_search_notes" ||
    (validXhsSearchSummary(publicSummary, detailRefs, requested.limit) &&
      (searchDeclaration === undefined || publicSummary?.schema_version === "harbor-read-operation-public-summary/v1"));
  const validSearchPin = entry.operation_id === "xhs_search_notes" && searchDeclaration !== undefined
    ? searchDeclaration.output_required_public_fields.join(",") === "canonical_url,title,summary,source_status,keyword,result_count,notes"
    : true;
  const validOperationEnvelope = operation?.schema_version === "harbor-allowlisted-read-operation/v0" &&
    operation.status === "completed" && opaqueRef(operation.operation_ref) && opaqueRef(operation.public_summary_ref);
  const validPublicProjection = publicSummary !== undefined &&
    !Object.keys(publicSummary).some((key) => !summaryKeys.has(key)) &&
    (entry.operation_id === "xhs_search_notes" || publicSummary.schema_version === "harbor-read-operation-public-summary/v0") &&
    publicSummary.operation_id === entry.operation_id &&
    publicSummary.result_kind === expectedSummary.resultKind && publicSummary.surface === expectedSummary.surface &&
    publicSummary.result_state === "operation_read_response_observed" && typeof publicSummary.response_status === "number" &&
    publicSummary.response_status >= 200 && publicSummary.response_status < 300 &&
    sourceSignals.length === expectedSummary.sourceSignals.length && expectedSummary.sourceSignals.every((signal, index) => sourceSignals[index] === signal) &&
    (entry.operation_id !== "boss_job_search" || (
      publicSummary.query === requested.query && publicSummary.city_code === requested.city_code && publicSummary.business_code === 0 &&
      Number.isInteger(publicSummary.job_count) && (publicSummary.job_count as number) > 0
    )) && validSearchSummary && validDetailSummary;
  const validRuntimeBinding = operation?.runtime_session_ref === requested.runtime_session_ref &&
    operation.site_id === requested.site_id && operation.operation_id === requested.operation_id &&
    operation.site_id === entry.site_slug && operation.operation_id === entry.operation_id && operation.operation_mode === "read" &&
    typeof operation.observed_at === "string" && Number.isFinite(Date.parse(operation.observed_at));
  const validSourceRefs = validRefs(sourceRefs) && exactKinds(sourceRefs, entry.required_source_ref_kinds);
  const validEvidenceRefs = validRefs(evidenceRefs) && exactKinds(evidenceRefs, entry.required_evidence_ref_kinds);
  const validDistinctRefs = new Set(allRefs).size === allRefs.length;
  const validFlatEvidenceRefs = flatEvidenceRefs.length === bodyEvidenceRefs.length && flatEvidenceRefs.every((ref, index) => ref === bodyEvidenceRefs[index]?.ref);
  const validPostCheck = postCheck?.status === "passed" && postCheck.reason === "managed_provider_read_probe_completed" &&
    opaqueRef(postCheck.post_check_ref) && postCheck.post_check_ref === evidenceRefs.find((ref) => ref?.kind === "post_check_ref")?.ref;
  const validPin = entry.operation_id === "xhs_search_notes" && searchDeclaration !== undefined
    ? validSearchPin
    : pin?.repository === "WebEnvoy/Lode" && (detailOperation
      ? pin.issue === "#268" && pin.merge_commit === "66d79b4e600565a00515b1c801e84291edc7b0c1" && pin.asset_path === "registry/detail-runtime-consumption.json" && pin.asset_sha256 === lodeDetailTruthAssetSha256 && pin.truth_id === entry.allowlist_id && pin.asset_owner === "Lode"
      : pin.commit === lodeAllowlistCommit && pin.asset_path === lodeAllowlistAssetPath &&
        pin.asset_sha256 === "5aa6be8bd416bbd19f73dcfab995f62f769849923f2aa2e995da974b0f329184" &&
        pin.mirror_payload_sha256 === "3b32e37e04cb008c7e1c072ead35919cde6e498ebfcea34a57de889559a0f141" &&
        pin.allowlist_id === entry.allowlist_id && pin.allowlist_version === entry.allowlist_version && pin.asset_owner === entry.asset_owner &&
        consumer?.repository === "WebEnvoy/Harbor" && consumer.issue === "#245" && consumer.purpose === "allowlisted one-shot read-only operation admission");
  const validBoundary = boundary?.output === "public_summary_and_refs_only" && boundary.raw_credentials === "not_exposed" && boundary.raw_profile_storage === "not_exposed" &&
    boundary.raw_cdp_endpoint === "not_exposed" && boundary.raw_dom === "not_exposed" && boundary.raw_har === "not_exposed" &&
    boundary.raw_network_bodies === "not_exposed" && boundary.screenshot_body === "not_exposed" && boundary.external_write_actions === "not_performed";

  if (searchDeclaration !== undefined) {
    if (!validPublicProjection) return { ok: false, failureClass: "output_invalid", failureCategory: "result_projection", failureAttribution: "capability" };
    if (!validOperationEnvelope || !validRuntimeBinding || !validBoundary) {
      return { ok: false, failureClass: "site_changed", failureCategory: "runtime_execution", failureAttribution: "runtime" };
    }
    if (!validSourceRefs || !validEvidenceRefs || !validDistinctRefs || !validFlatEvidenceRefs || !validPostCheck) {
      return { ok: false, failureClass: "network_resource_unavailable", failureCategory: "evidence_reference", failureAttribution: "evidence" };
    }
    if (!validPin) return { ok: false, failureClass: "invalid_contract", failureCategory: "capability_contract", failureAttribution: "capability" };
  } else if (!validOperationEnvelope || !validPublicProjection || !validRuntimeBinding || !validSourceRefs || !validEvidenceRefs || !validDistinctRefs || !validFlatEvidenceRefs || !validPostCheck || !validPin || !validBoundary) {
    return { ok: false, failureClass: "site_changed" };
  }
  return { ok: true, operation: operation! };
}

function sceneEvidenceRefs(value: unknown): string[] {
  const refs = object(value)?.evidence_refs;
  return Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === "string" && ref.length > 0) : [];
}

function readFailureRecoveryHint(failureClass: LodeReadOnlyFailureClass): string {
  if (failureClass === "empty_result") return "fix_input";
  if (failureClass === "output_invalid") return "repair_package";
  if (failureClass === "invalid_contract") return "repair_package";
  if (failureClass === "network_resource_unavailable") return "rerun_with_evidence";
  if (failureClass === "not_logged_in" || failureClass === "login_expired") return "open_manual_auth";
  if (failureClass === "identity_insufficient") return "switch_identity";
  return failureClass === "page_changed" || failureClass === "page_not_ready" ? "retry_after_refresh" : "manual_handoff";
}

async function completeAcceptedReadTaskWithFailure(
  store: FileRunRecordStore,
  result: Extract<TaskSubmissionResult, { ok: true }>,
  failureClass: LodeReadOnlyFailureClass,
  summary: string,
  evidenceRefs: readonly string[] = [],
  failureOverride?: Pick<ReadOperationValidation & { ok: false }, "failureCategory" | "failureAttribution">
): Promise<TaskSubmissionResult> {
  await store.updateRunRecord(result.run_record.run_id, {
    status: "running",
    ...(evidenceRefs.length === 0 ? {} : { evidence_refs: evidenceRefs })
  });
  const recoveryHint = readFailureRecoveryHint(failureClass);
  const attribution = failureOverride?.failureAttribution ?? (failureClass === "output_invalid" || failureClass === "invalid_contract" ? "capability" as const : "runtime" as const);
  const postCheck = {
    schema_version: "webenvoy.post-check-result.v0" as const,
    status: failureClass === "empty_result" ? "passed" as const : "blocked" as const,
    summary: failureClass === "empty_result" ? "Harbor read operation completed with no matching results." : summary,
    checked_at: new Date().toISOString(),
    code: failureClass,
    attribution,
    recovery_hint: recoveryHint,
    ...(evidenceRefs.length === 0 ? {} : { evidence_refs: [...evidenceRefs] }),
    consumer_boundary: failureClass === "empty_result"
      ? "Core records a successful bounded empty result for App display; it does not execute writes or inline raw browser/page material."
      : "Core records terminal refs-only failure state for App recovery; it does not execute writes or inline raw browser/page material."
  };
  if (failureClass === "empty_result") {
    const completed = await completeRunWithReadOnlyEmptyResult(store, result.run_record.run_id, {
      ...(evidenceRefs.length === 0 ? {} : { evidence_refs: evidenceRefs }),
      post_check: postCheck,
      retention_state: "active"
    });
    return {
      ok: true,
      task_intent: result.task_intent,
      run_record: completed.run_record
    };
  }
  const completed = await completeRunWithReadOnlyFailure(store, result.run_record.run_id, {
    lode_failure_class: failureClass,
    ...(failureOverride?.failureCategory === undefined ? {} : { failure_category: failureOverride.failureCategory }),
    failure_attribution: attribution,
    ...(evidenceRefs.length === 0 ? {} : { evidence_refs: evidenceRefs }),
    post_check: postCheck,
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
  const sceneTarget = string(object(scene.page_summary)?.url);
  const normalizedSceneTarget = sceneTarget === undefined ? undefined : normalizePublicHttpTarget(sceneTarget);
  if (!normalizedSceneTarget?.ok || normalizedSceneTarget.target_ref !== taskUrl(taskIntent)) {
    return completeAcceptedReadTaskWithFailure(
      store,
      result,
      "page_changed",
      "Core rejected the Harbor page scene because its page URL did not exactly match the submitted task target.",
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
  requested: { runtime_session_ref: string; site_id: string; operation_id: string; query?: string; city_code?: string; limit?: number; detail_ref?: string; identity_environment_ref?: string },
  searchDeclaration?: LodePackageAdmissionContract["runtime_consumption_declaration"]
): Promise<TaskSubmissionResult> {
  const validation = validateCompletedReadOperation(operation, entry, requested, searchDeclaration);
  if (!validation.ok) {
    return completeAcceptedReadTaskWithFailure(
      store,
      result,
      validation.failureClass,
      searchDeclaration !== undefined
        ? "Core rejected Harbor output against the pinned Lode search schema."
        : "Core rejected an unavailable or contract-drifted Harbor read operation.",
      [],
      validation
    );
  }
  const completedOperation = validation.operation;
  const projection = projectionFromReadOperation(result.task_intent, packageRef, completedOperation, searchDeclaration, requested.query);
  const evidenceRefs = projection.evidence_refs.map((ref) => typeof ref === "string" ? ref : ref.ref_id);
  await store.updateRunRecord(result.run_record.run_id, { status: "running", evidence_refs: evidenceRefs });
  const publicSummary = object(completedOperation.public_summary);
  let detailTargetBatch: DetailTargetBatch | undefined;
  if (entry.operation_id === "xhs_search_notes") {
    const detailRefs = Array.isArray(publicSummary?.detail_refs) ? publicSummary.detail_refs.filter(isOpaqueDetailRef) : [];
    if (!requested.identity_environment_ref || detailRefs.length === 0) {
      return completeAcceptedReadTaskWithFailure(store, result, "field_missing", "Core could not persist bound opaque detail refs from the Harbor search result.");
    }
    detailTargetBatch = await stageSearchDetailTargets(store.directory, {
      detail_refs: detailRefs,
      site_slug: "xiaohongshu",
      identity_environment_ref: requested.identity_environment_ref,
      runtime_session_ref: requested.runtime_session_ref,
      search_run_ref: result.run_record.run_id,
      search_result_ref: string(completedOperation.public_summary_ref)!,
      observed_at: string(completedOperation.observed_at)!
    });
  }
  let published = false;
  try {
    if (detailTargetBatch) {
      await publishSearchDetailTargets(detailTargetBatch);
      published = true;
    }
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
        source_refs: projection.source_refs.map((ref) => typeof ref === "string" ? ref : ref.ref_id),
        consumer_boundary: "Core records only the validated public summary and opaque operation/source/evidence/post-check refs."
      },
      retention_state: "active"
    });
    return { ok: true, task_intent: result.task_intent, run_record: completed.run_record };
  } catch (error) {
    if (detailTargetBatch) {
      if (published) await compensatePublishedSearchDetailTargets(detailTargetBatch);
      else await rollbackSearchDetailTargets(detailTargetBatch);
    }
    throw error;
  }
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

const xhsWritePrecheckPackageRef = "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0";
const xhsWritePrecheckLockRef = "lode://lock/site-capability/xiaohongshu/publish-note-precheck@0.1.1";
const xhsWritePrecheckInputSchemaRef = "lode://schema/site-capability/xiaohongshu/publish-note-precheck/input@0.1.0";
const xhsWritePrecheckOutputSchemaRef = "lode://schema/site-capability/xiaohongshu/publish-note-precheck/output@0.1.0";
const xhsWritePrecheckLodeCommit = "6bff1afd059a30571f8ed219d1dcd25e6fb20c6b";
const xhsWritePrecheckLodeAssetSha256 = "c62ba191357e0056b03523a46c0bb26424c916333f388898a4cc457f9c1cc6fc";
const xhsWritePrecheckLodeSemanticSha256 = "21f57cfd9f395bb13b322aec9e5dd0c9c5f01ea959052e3ceb0aeaf14e636ce0";

type WritePrecheckValidation =
  | { ok: true; operation: JsonObject; source_refs: string[]; evidence_refs: string[] }
  | { ok: false; failure: FailureRecord };

function opaquePublicRef(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9._:/-]*$/.test(value) &&
    !/(?:cookie|token|password|secret|credential|profile|storage|raw[_-]?(?:dom|har)|network[_-]?(?:body|response)|cdp|screenshot)/i.test(value);
}

function writePrecheckFailure(code: string, category: FailureRecord["category"] = "runtime_execution"): FailureRecord {
  return failure(category, code, category === "result_projection" ? "projection" : "execution", code === "harbor_write_precheck_outcome_unknown" ? "reconcile_status" : "retry_after_refresh");
}

function validateCompletedWritePrecheck(
  value: unknown,
  expected: { runtime_session_ref: string; target_ref: string }
): WritePrecheckValidation {
  const operation = object(value);
  if (!operation || operation.schema_version !== "harbor-validate-only-write-precheck/v0" || operation.status !== "completed" || operation.submitted !== false ||
    operation.runtime_session_ref !== expected.runtime_session_ref || operation.target_ref !== expected.target_ref) {
    return { ok: false, failure: writePrecheckFailure("harbor_write_precheck_output_invalid", "result_projection") };
  }
  const pin = object(operation.lode_pin);
  if (!pin || pin.package_ref !== xhsWritePrecheckPackageRef || pin.lock_ref !== xhsWritePrecheckLockRef ||
    pin.input_schema_ref !== xhsWritePrecheckInputSchemaRef || pin.output_schema_ref !== xhsWritePrecheckOutputSchemaRef ||
    pin.version !== "0.1.0" || pin.operation_id !== "xhs_publish_note_precheck" || pin.operation_mode !== "validate_only" ||
    pin.origin !== "https://creator.xiaohongshu.com" || pin.repository !== "WebEnvoy/Lode" || pin.commit !== xhsWritePrecheckLodeCommit ||
    pin.asset_path !== "registry/validate-only-runtime-consumption.json" || pin.asset_sha256 !== xhsWritePrecheckLodeAssetSha256 ||
    pin.asset_semantic_sha256 !== xhsWritePrecheckLodeSemanticSha256) {
    return { ok: false, failure: writePrecheckFailure("write_precheck_contract_drift", "capability_contract") };
  }
  const boundary = object(operation.public_boundary);
  if (!boundary || boundary.raw_dom !== "not_exposed" || boundary.raw_har !== "not_exposed" ||
    boundary.screenshot_body !== "not_exposed" || boundary.credentials !== "not_exposed" || boundary.external_write_actions !== "not_performed") {
    return { ok: false, failure: writePrecheckFailure("write_precheck_privacy_boundary_invalid", "result_projection") };
  }
  const sourceRefs = Array.isArray(operation.source_refs) ? operation.source_refs.map(object) : [];
  const evidenceRefs = Array.isArray(operation.evidence_ref_kinds) ? operation.evidence_ref_kinds.map(object) : [];
  const sourceValues = sourceRefs.map((entry) => string(entry?.ref));
  const evidenceValues = evidenceRefs.map((entry) => string(entry?.ref));
  const sourceKinds = sourceRefs.map((entry) => string(entry?.kind));
  const evidenceKinds = evidenceRefs.map((entry) => string(entry?.kind));
  if (sourceRefs.length !== 2 || sourceRefs.some((entry) => !entry || !string(entry.kind) || !opaquePublicRef(entry.ref)) ||
    new Set(sourceKinds).size !== sourceKinds.length ||
    !["creator_publish_page_summary", "dom_snapshot_summary"].every((kind) => sourceKinds.includes(kind)) ||
    evidenceRefs.length !== 2 || evidenceRefs.some((entry) => !entry || !string(entry.kind) || !opaquePublicRef(entry.ref)) ||
    new Set(evidenceKinds).size !== evidenceKinds.length ||
    !["snapshot_ref", "post_check_ref"].every((kind) => evidenceKinds.includes(kind)) ||
    new Set(sourceValues).size !== sourceValues.length || new Set(evidenceValues).size !== evidenceValues.length ||
    !opaquePublicRef(operation.page_ref) || !opaquePublicRef(operation.operation_ref) || !opaquePublicRef(operation.result_ref) ||
    !opaquePublicRef(operation.submitted_result_ref) || !string(operation.observed_at) || !Number.isFinite(Date.parse(string(operation.observed_at)!))) {
    return { ok: false, failure: writePrecheckFailure("write_precheck_refs_invalid", "evidence_reference") };
  }
  const postCheck = object(operation.post_check);
  const postSourceRefs = Array.isArray(postCheck?.source_refs) ? postCheck.source_refs.map(object).filter((entry): entry is JsonObject => entry !== undefined) : [];
  const postEvidenceRefs = Array.isArray(postCheck?.evidence_refs) ? postCheck.evidence_refs.map(object).filter((entry): entry is JsonObject => entry !== undefined) : [];
  const postCheckRef = evidenceRefs.find((entry) => entry?.kind === "post_check_ref")?.ref;
  const snapshotRef = evidenceRefs.find((entry) => entry?.kind === "snapshot_ref")?.ref;
  if (!postCheck || postCheck.status !== "passed" || postCheck.reason !== "validated_creator_entrypoint_without_submission" ||
    postCheck.submitted !== false || postCheck.no_submit_guard !== "active" || !opaquePublicRef(postCheckRef) ||
    !opaquePublicRef(snapshotRef) || postCheck.post_check_ref !== postCheckRef ||
    !Array.isArray(postCheck.source_refs) || !Array.isArray(postCheck.evidence_refs) ||
    postCheck.source_refs.some((entry) => !object(entry) || !opaquePublicRef(object(entry)?.ref)) ||
    postCheck.evidence_refs.some((entry) => !object(entry) || !opaquePublicRef(object(entry)?.ref)) ||
    postSourceRefs.length !== sourceValues.length ||
    postSourceRefs.some((entry) => !sourceValues.includes(string(entry.ref)) || postSourceRefs.filter((candidate) => candidate.ref === entry.ref).length !== 1) ||
    postEvidenceRefs.length !== 1 || postEvidenceRefs[0]?.ref !== snapshotRef) {
    return { ok: false, failure: writePrecheckFailure("write_precheck_post_check_invalid", "evidence_reference") };
  }
  const observations = object(operation.entrypoint_observations);
  const fields = object(operation.field_states);
  const prohibited = object(operation.prohibited_actions_observed);
  if (operation.classification !== "partial_result" || operation.precheck_scope !== "entrypoint_only" || operation.composition_state !== "composition_not_initialized" ||
    operation.no_submit_guard !== "active" || !observations || !fields || !prohibited || Object.keys(observations).length === 0 || Object.keys(fields).length === 0 || Object.keys(prohibited).length === 0 ||
    Object.values(observations).some((entry) => entry !== true) || Object.values(prohibited).some((entry) => entry !== false)) {
    return { ok: false, failure: writePrecheckFailure("write_precheck_observation_invalid", "result_projection") };
  }
  return {
    ok: true,
    operation,
    source_refs: sourceValues as string[],
    evidence_refs: evidenceValues as string[]
  };
}

function writePrecheckPreviewResult(taskIntent: TaskIntentEnvelope, operation: JsonObject, evidenceRefs: readonly string[]): PreviewResult {
  return {
    schema_version: "webenvoy.preview-result.v0",
    state: "available",
    submitted: false,
    action_refs: { action_request_id: `action-request:${taskIntent.intent_id}` },
    capability: {
      capability_ref: taskIntent.capability.ref,
      capability_version: taskIntent.capability.version,
      ...(taskIntent.capability.source_ref === undefined ? {} : { capability_source_ref: taskIntent.capability.source_ref }),
      ...(taskIntent.capability.lock_ref === undefined ? {} : { capability_lock_ref: taskIntent.capability.lock_ref }),
      package_ref: xhsWritePrecheckPackageRef
    },
    evidence_refs: [...evidenceRefs],
    consumer_boundary: "Core preview result is validate-only/draft/preview projection; it is not submitted result, approval execution, reconciliation, or post-submit truth."
  };
}

async function completeAcceptedWritePrecheck(
  store: FileRunRecordStore,
  result: Extract<TaskSubmissionResult, { ok: true }>,
  operation: unknown,
  runtimeSessionRef: string,
  targetRef: string
): Promise<TaskSubmissionResult> {
  const validation = validateCompletedWritePrecheck(operation, { runtime_session_ref: runtimeSessionRef, target_ref: targetRef });
  if (!validation.ok) {
    // The operation response is untrusted at this boundary. A malformed or
    // contract-drift payload is indeterminate, never a retryable failure.
    return completeAcceptedWritePrecheckUnknown(store, result, "harbor_write_precheck_outcome_unknown");
  }
  const { operation: completedOperation, source_refs: sourceRefs, evidence_refs: evidenceRefs } = validation;
  const postCheck = object(completedOperation.post_check)!;
  const postCheckRef = string(postCheck.post_check_ref)!;
  const publicSummary: Record<string, unknown> = {
    schema_version: "webenvoy.core-xhs-write-precheck-projection.v0",
    operation_ref: completedOperation.operation_ref,
    page_ref: completedOperation.page_ref,
    result_ref: completedOperation.result_ref,
    submitted_result_ref: completedOperation.submitted_result_ref,
    target_ref: completedOperation.target_ref,
    classification: completedOperation.classification,
    precheck_scope: completedOperation.precheck_scope,
    composition_state: completedOperation.composition_state,
    entrypoint_observations: completedOperation.entrypoint_observations,
    field_states: completedOperation.field_states,
    prohibited_actions_observed: completedOperation.prohibited_actions_observed,
    no_submit_guard: completedOperation.no_submit_guard,
    submitted: false,
    post_check_ref: postCheckRef,
    lode_pin: completedOperation.lode_pin,
    consumer_boundary: "Core stores only the Harbor public summary and opaque refs; raw DOM, HAR, screenshot bytes, credentials, and external write actions are excluded."
  };
  await store.updateRunRecord(result.run_record.run_id, { status: "running" });
  const completed = await store.updateRunRecord(result.run_record.run_id, {
    status: "succeeded",
    result_ref: string(completedOperation.result_ref)!,
    result_kind: "validate_only_write_precheck",
    result_outcome: "partial",
    output_schema_id: xhsWritePrecheckOutputSchemaRef,
    projection_ref: string(completedOperation.operation_ref)!,
    public_result_summary: publicSummary,
    source_refs: sourceRefs,
    evidence_refs: evidenceRefs,
    preview_result: writePrecheckPreviewResult(result.task_intent, completedOperation, evidenceRefs),
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "passed",
      summary: "Harbor validated the creator publish entrypoint without submission.",
      checked_at: string(completedOperation.observed_at) ?? new Date().toISOString(),
      evidence_refs: evidenceRefs,
      source_refs: sourceRefs,
      consumer_boundary: "Core records only the validated public summary and opaque refs; submitted=false is explicit and no external write action was performed."
    },
    retention_state: "active"
  });
  return { ok: true, task_intent: result.task_intent, run_record: completed };
}

async function completeAcceptedWritePrecheckUnknown(
  store: FileRunRecordStore,
  result: Extract<TaskSubmissionResult, { ok: true }>,
  code: string
): Promise<TaskSubmissionResult> {
  await store.updateRunRecord(result.run_record.run_id, {
    status: "running",
    preview_result: writePrecheckPreviewResult(result.task_intent, {}, []),
    public_result_summary: {
      schema_version: "webenvoy.core-xhs-write-precheck-projection.v0",
      submitted: false,
      outcome: "unknown",
      consumer_boundary: "Core stores only bounded outcome state and no write or browser material."
    }
  });
  const failureRecord = failure("runtime_execution", code, code === "harbor_write_precheck_outcome_unknown" ? "verification" : "execution", code === "harbor_write_precheck_outcome_unknown" ? "reconcile_status" : "retry_after_refresh");
  const completed = await completeRunWithFailure(store, result.run_record.run_id, {
    status: code === "harbor_write_precheck_outcome_unknown" ? "unknown_outcome" : "failed",
    failure: failureRecord,
    retention_state: "active",
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "not_run",
      summary: "The validate-only write-precheck did not produce a trustworthy terminal response; Core will not retry it automatically.",
      checked_at: new Date().toISOString(),
      code,
      attribution: "runtime",
      recovery_hint: failureRecord.recovery_hint,
      consumer_boundary: "Core records submitted=false and an indeterminate outcome without storing raw browser or external write material."
    }
  });
  return { ok: false, failure: completed.run_record.failure!, run_record: completed.run_record };
}

async function completeAcceptedWritePrecheckAdmissionFailure(
  store: FileRunRecordStore,
  result: Extract<TaskSubmissionResult, { ok: true }>,
  admissionFailure: FailureRecord,
  runtimeSessionRef?: string,
  cleanupFailure?: FailureRecord,
  client?: HarborRuntimeClient
): Promise<TaskSubmissionResult> {
  let cleanup = cleanupFailure;
  if (runtimeSessionRef && !cleanup && client) {
    try {
      cleanup = await client.releaseCoreTaskSession({
        runtime_session_ref: runtimeSessionRef,
        run_id: result.run_record.run_id
      });
    } catch {
      cleanup = failure("runtime_execution", "core_task_session_cleanup_unverified", "runtime_binding", "inspect_runtime_session");
    }
  }
  await store.updateRunRecord(result.run_record.run_id, {
    status: "running",
    ...(runtimeSessionRef === undefined ? {} : { runtime_binding_refs: [runtimeSessionRef] }),
    preview_result: writePrecheckPreviewResult(result.task_intent, {}, []),
    public_result_summary: {
      schema_version: "webenvoy.core-xhs-write-precheck-projection.v0",
      submitted: false,
      outcome: "unavailable",
      ...(runtimeSessionRef === undefined ? {} : { runtime_session_ref: runtimeSessionRef }),
      consumer_boundary: "Core stores only structured admission failure state and an opaque runtime session ref; no browser or write material is stored."
    }
  });
  const completed = await completeRunWithFailure(store, result.run_record.run_id, {
    status: "failed",
    failure: admissionFailure,
    retention_state: "active",
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "blocked",
      summary: cleanup
        ? `Admission failed with ${admissionFailure.code}; Core also recorded Harbor session cleanup failure ${cleanup.code}.`
        : `Harbor admission failed with ${admissionFailure.code}; no validate-only operation was called.`,
      checked_at: new Date().toISOString(),
      code: cleanup?.code ?? admissionFailure.code,
      attribution: "runtime",
      recovery_hint: cleanup?.recovery_hint ?? admissionFailure.recovery_hint,
      ...(runtimeSessionRef === undefined ? {} : { source_refs: [runtimeSessionRef] }),
      consumer_boundary: "Core exposes only structured admission and cleanup classifications plus opaque refs; no Harbor private material is persisted."
    }
  });
  return { ok: false, failure: completed.run_record.failure!, run_record: completed.run_record };
}

function writePrecheckUnavailableFailure(value: JsonObject): FailureRecord {
  const failureClass = string(value.failure_class);
  const retryable = value.retryable === true;
  return failure(
    "runtime_execution",
    failureClass ? `write_precheck_${failureClass}` : "write_precheck_unavailable",
    "execution",
    retryable ? "retry_after_refresh" : "repair_browser_environment"
  );
}

async function dispatchApprovedWritePrecheck(
  store: FileRunRecordStore,
  result: Extract<TaskSubmissionResult, { ok: true }>,
  request: RuntimeTaskSubmissionRequest,
  deps: RuntimeTaskSubmissionDependencies,
  policy: EvaluatedWritePrecheckPolicy
): Promise<TaskSubmissionResult> {
  const client = deps.harborRuntimeClient;
  if (!client || !client.validateOnlyWritePrecheck) {
    return completeAcceptedWritePrecheckAdmissionFailure(
      store,
      result,
      failure("resource_admission", "harbor_runtime_api_unconfigured", "runtime_binding", "connect_runtime")
    );
  }
  const target = policy.evaluation.status === "evaluated" ? policy.evaluation.action.target : undefined;
  if (!target || !request.authorization_context) {
    return completeAcceptedWritePrecheckAdmissionFailure(
      store,
      result,
      failure("capability_contract", "write_precheck_dispatch_binding_invalid", "admission", "request_new_confirmation")
    );
  }
  let admission: HarborRuntimeAdmissionResult;
  try {
    admission = await client.collectAdmissionFacts({
      run_id: request.run_id,
      task_intent: result.task_intent,
      package_ref: xhsWritePrecheckPackageRef,
      admission_mode: "write_precheck",
      harbor: request.harbor
    });
  } catch {
    return completeAcceptedWritePrecheckAdmissionFailure(
      store,
      result,
      failure("resource_admission", "harbor_runtime_api_unavailable", "runtime_binding", "connect_runtime"),
      undefined,
      undefined,
      client
    );
  }
  const collectionFailure = isAdmissionCollectionFailure(admission) ? admission : undefined;
  const admissionValue: HarborAdmissionInput | FailureRecord = collectionFailure
    ? collectionFailure.failure
    : admission as HarborAdmissionInput | FailureRecord;
  if (isFailure(admissionValue)) {
    return completeAcceptedWritePrecheckAdmissionFailure(
      store,
      result,
      admissionValue.category === "resource_admission"
        ? admissionValue
        : failure("resource_admission", admissionValue.code || "harbor_runtime_admission_failed", "runtime_binding", "connect_runtime"),
      collectionFailure?.runtime_session_ref,
      collectionFailure?.cleanup_failure,
      client
    );
  }
  const runtimeSessionRef = string(object(admissionValue.harbor_runtime_facts)?.runtime_session_ref);
  if (!runtimeSessionRef) {
    return completeAcceptedWritePrecheckAdmissionFailure(
      store,
      result,
      failure("resource_admission", "harbor_runtime_session_missing", "runtime_binding", "connect_runtime"),
      collectionFailure?.runtime_session_ref,
      collectionFailure?.cleanup_failure,
      client
    );
  }

  let operation: unknown;
  try {
    operation = await client.validateOnlyWritePrecheck({
      runtime_session_ref: runtimeSessionRef,
      holder_ref: request.run_id,
      url: result.task_intent.scope.target_ref,
      target_ref: target.target_ref,
      requested_fields: ["title", "summary", "canonical_url", "source_status"],
      include_source_refs: true,
      proposed_input_summary: result.task_intent.input.summary
    });
  } catch {
    operation = failure("runtime_execution", "harbor_write_precheck_outcome_unknown", "verification", "reconcile_status");
  }
  if (isFailure(operation)) {
    const cleanup = await releaseAcceptedCoreTaskSession(store, result, client, runtimeSessionRef,
      failure("runtime_execution", "harbor_write_precheck_outcome_unknown", "verification", "reconcile_status"),
      "unknown_outcome");
    if (cleanup) return cleanup;
    return completeAcceptedWritePrecheckUnknown(store, result, "harbor_write_precheck_outcome_unknown");
  }
  const operationObject = object(operation);
  if (operationObject?.status === "unavailable") {
    const cleanup = await releaseAcceptedCoreTaskSession(store, result, client, runtimeSessionRef, writePrecheckUnavailableFailure(operationObject));
    if (cleanup) return cleanup;
    await store.updateRunRecord(result.run_record.run_id, {
      status: "running",
      preview_result: writePrecheckPreviewResult(result.task_intent, operationObject, []),
      public_result_summary: {
        schema_version: "webenvoy.core-xhs-write-precheck-projection.v0",
        submitted: false,
        outcome: "unavailable",
        consumer_boundary: "Core stores only structured unavailable state and no write or browser material."
      }
    });
    const completed = await completeRunWithFailure(store, result.run_record.run_id, {
      failure: writePrecheckUnavailableFailure(operationObject),
      retention_state: "active",
      post_check: {
        schema_version: "webenvoy.post-check-result.v0",
        status: "blocked",
        summary: "Harbor could not validate the creator publish entrypoint; no external write action was performed.",
        checked_at: new Date().toISOString(),
        code: writePrecheckUnavailableFailure(operationObject).code,
        attribution: "runtime",
        recovery_hint: writePrecheckUnavailableFailure(operationObject).recovery_hint,
        consumer_boundary: "Core records only structured unavailable state and opaque refs; no browser or write material is stored."
      }
    });
    return { ok: false, failure: completed.run_record.failure!, run_record: completed.run_record };
  }
  const cleanup = await releaseAcceptedCoreTaskSession(store, result, client, runtimeSessionRef);
  if (cleanup) return cleanup;
  return completeAcceptedWritePrecheck(store, result, operation, runtimeSessionRef, target.target_ref);
}

export type ContinueWritePrecheckTaskRequest = {
  run_id: string;
  task_intent: unknown;
  package_ref: string;
  harbor?: RuntimeTaskSubmissionRequest["harbor"];
  authorization_context: WritePrecheckAuthorizationContext;
  single_action_decision: import("./execution-policy.js").SingleActionDecision;
};

/** Continue only a previously-confirmed unified write-precheck run. */
export async function continueWritePrecheckTask(
  store: FileRunRecordStore,
  request: ContinueWritePrecheckTaskRequest,
  deps: RuntimeTaskSubmissionDependencies
): Promise<TaskSubmissionResult> {
  const existing = await store.getRunRecord(request.run_id);
  if (!existing || existing.status !== "requires_user_action") {
    return { ok: false, failure: failure("action_risk", "authorization_confirmation_inactive", "admission", "request_new_confirmation"), ...(existing ? { run_record: existing } : {}) };
  }
  if (!isExactWritePrecheckRun(existing, request.single_action_decision.confirmation_decision_ref)) {
    return { ok: false, failure: failure("action_risk", "single_action_confirmation_binding_mismatch", "admission", "request_new_confirmation"), run_record: existing };
  }
  const taskIntent = validateTaskIntent(request.task_intent);
  if (isFailure(taskIntent) || !request.package_ref) {
    return { ok: false, failure: isFailure(taskIntent) ? taskIntent : failure("request_invalid", "package_ref_required", "pre_admission", "fix_input"), run_record: existing };
  }
  if (existing.task_intent_ref !== taskIntent.intent_id || existing.package_ref !== request.package_ref ||
    existing.capability_ref !== taskIntent.capability.ref || existing.scope_target_ref !== taskIntent.scope.target_ref ||
    request.package_ref !== "lode://site-capability/xiaohongshu/publish-note-precheck@0.1.0" ||
    taskIntent.policy.risk !== "write" || taskIntent.policy.execution_intent !== "validate_only") {
    return { ok: false, failure: failure("action_risk", "single_action_confirmation_binding_mismatch", "admission", "request_new_confirmation"), run_record: existing };
  }
  if (!deps.lodePackageResolver || !deps.executionPolicyConfigStore || !deps.authorizationDecisionStore) {
    return { ok: false, failure: failure("action_risk", "authorization_decision_owner_unavailable", "admission", "retry_when_policy_owner_ready"), run_record: existing };
  }
  let contract: LodePackageAdmissionContract | FailureRecord;
  try {
    contract = await deps.lodePackageResolver({ package_ref: request.package_ref, task_intent: request.task_intent });
  } catch {
    contract = failure("capability_contract", "lode_registry_unavailable", "admission", "connect_lode_registry");
  }
  if (isFailure(contract)) return { ok: false, failure: contract, run_record: existing };
  if (!isUnifiedWritePrecheckTask(taskIntent, contract)) {
    return { ok: false, failure: failure("action_risk", "single_action_confirmation_binding_mismatch", "admission", "request_new_confirmation"), run_record: existing };
  }
  const policy = await evaluateWritePrecheckTaskPolicy({
    run_id: request.run_id,
    task_intent: taskIntent,
    lode_contract: contract,
    authorization_context: request.authorization_context,
    config_store: deps.executionPolicyConfigStore,
    single_action_decision: request.single_action_decision,
    evaluated_at: (deps.clock ?? (() => new Date()))().toISOString()
  });
  if (isFailure(policy)) return { ok: false, failure: policy, run_record: existing };
  if (!policy.evaluation || policy.evaluation.status !== "evaluated" || policy.evaluation.next_step !== "execute" ||
    policy.evaluation.effective_policy.source !== "single_action_decision" || request.single_action_decision.mode !== "auto" ||
    !(existing.authorization_decision_refs ?? []).includes(request.single_action_decision.confirmation_decision_ref)) {
    return { ok: false, failure: failure("action_risk", "single_action_confirmation_binding_mismatch", "admission", "request_new_confirmation"), run_record: existing };
  }
  const confirmation = await deps.authorizationDecisionStore.getAuthorizationDecision(request.single_action_decision.confirmation_decision_ref);
  if (!confirmation || confirmation.state !== "active" || confirmation.outcome !== "confirm") {
    return { ok: false, failure: failure("action_risk", "authorization_confirmation_inactive", "admission", "request_new_confirmation"), run_record: existing };
  }
  try {
    await persistWritePrecheckPolicyDecision({
      run_id: request.run_id,
      policy,
      authorization_store: deps.authorizationDecisionStore,
      run_record_store: store
    });
  } catch {
    return { ok: false, failure: failure("persistence_observability", "authorization_decision_persistence_failed", "persistence", "contact_operator"), run_record: existing };
  }
  let continued: RunRecord;
  try {
    continued = await store.continueRequiresUserActionRun(request.run_id);
  } catch {
    const current = await store.getRunRecord(request.run_id);
    return { ok: false, failure: failure("action_risk", "authorization_confirmation_inactive", "admission", "request_new_confirmation"), ...(current ? { run_record: current } : {}) };
  }
  return dispatchApprovedWritePrecheck(store, { ok: true, task_intent: taskIntent, run_record: continued }, {
    run_id: request.run_id,
    task_intent: taskIntent,
    package_ref: request.package_ref,
    ...(request.harbor === undefined ? {} : { harbor: request.harbor }),
    authorization_context: request.authorization_context
  }, deps, policy);
}

async function releaseAcceptedCoreTaskSession(
  store: FileRunRecordStore,
  result: Extract<TaskSubmissionResult, { ok: true }>,
  client: HarborRuntimeClient,
  runtimeSessionRef: string,
  primaryFailure?: FailureRecord,
  terminalStatus: "failed" | "unknown_outcome" = "failed"
): Promise<TaskSubmissionResult | undefined> {
  let cleanupFailure: FailureRecord | undefined;
  try {
    cleanupFailure = await client.releaseCoreTaskSession({
      runtime_session_ref: runtimeSessionRef,
      run_id: result.run_record.run_id
    });
  } catch {
    cleanupFailure = failure("runtime_execution", "core_task_session_cleanup_unverified", "runtime_binding", "inspect_runtime_session");
  }
  if (!cleanupFailure) return undefined;
  const terminalFailure = primaryFailure ?? cleanupFailure;
  await store.updateRunRecord(result.run_record.run_id, {
    status: "running",
    runtime_binding_refs: [runtimeSessionRef],
    preview_result: writePrecheckPreviewResult(result.task_intent, {}, []),
    public_result_summary: {
      schema_version: "webenvoy.core-xhs-write-precheck-projection.v0",
      submitted: false,
      outcome: terminalStatus === "unknown_outcome" ? "unknown" : "cleanup_failed",
      runtime_session_ref: runtimeSessionRef,
      consumer_boundary: "Core records submitted=false plus the opaque session ref when cleanup cannot be verified; no browser or write material is stored."
    }
  });
  const completed = await completeRunWithFailure(store, result.run_record.run_id, {
    status: terminalStatus,
    failure: terminalFailure,
    retention_state: "active",
    post_check: {
      schema_version: "webenvoy.post-check-result.v0",
      status: "blocked",
      summary: primaryFailure
        ? `The task failed with ${primaryFailure.code}; Core also could not release or stop its Harbor session lock.`
        : "Core could not release or stop its Harbor session lock, so the task cannot be projected as successful.",
      checked_at: new Date().toISOString(),
      code: cleanupFailure.code,
      attribution: "runtime",
      recovery_hint: cleanupFailure.recovery_hint,
      source_refs: [runtimeSessionRef],
      consumer_boundary: "Core exposes only the original failure, cleanup classification, and opaque runtime session ref; no Harbor private material is persisted."
    }
  });
  return { ok: false, failure: terminalFailure, run_record: completed.run_record };
}

async function finalizeAcceptedTask(
  store: FileRunRecordStore,
  result: Extract<TaskSubmissionResult, { ok: true }>,
  finalize: () => Promise<TaskSubmissionResult>
): Promise<TaskSubmissionResult> {
  try {
    return await finalize();
  } catch (error) {
    const current = await store.getRunRecord(result.run_record.run_id);
    if (!current || terminalRunRecordStatuses.has(current.status)) throw new Error("run finalization failed after terminal persistence");
    if (current.status === "admitted") await store.updateRunRecord(current.run_id, { status: "running" });
    const persistenceFailure = classifyFinalizationFailure(error);
    const completed = await completeRunWithFailure(store, current.run_id, {
      failure: persistenceFailure,
      retention_state: "active",
      post_check: {
        schema_version: "webenvoy.post-check-result.v0",
        status: "failed",
        summary: finalizationFailureSummary(persistenceFailure.code),
        checked_at: new Date().toISOString(),
        code: persistenceFailure.code,
        attribution: "unknown",
        recovery_hint: persistenceFailure.recovery_hint,
        consumer_boundary: "Core records only structured persistence failure truth and retains no raw Harbor material."
      }
    });
    return { ok: false, failure: persistenceFailure, run_record: completed.run_record };
  }
}

function classifyFinalizationFailure(error: unknown): FailureRecord {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("detail target")) {
    return failure("result_projection", "detail_target_binding_failed", "projection", "retry_task");
  }
  if (message === "public_result_summary exceeds 64 KiB") {
    return failure("result_projection", "public_result_summary_too_large", "projection", "repair_package");
  }
  if (message.startsWith("result data contains forbidden field:") || message.startsWith("run record must not contain private browser material:")) {
    return failure("result_projection", "public_result_private_field_rejected", "projection", "repair_package");
  }
  return failure("persistence_observability", "run_finalization_persistence_failed", "persistence", "retry_run_finalization");
}

function finalizationFailureSummary(code: string): string {
  if (code === "detail_target_binding_failed") {
    return "Core could not bind the fresh search result's opaque detail targets; retry the read task without changing identity authorization.";
  }
  if (code === "public_result_summary_too_large" || code === "public_result_private_field_rejected") {
    return "Core rejected the public result projection because it did not satisfy the bounded refs-only result contract.";
  }
  return "Core released the task session but could not persist the intended terminal result; a refs-only persistence failure was recorded instead.";
}

const lodeReadOnlyFailureClasses = new Set<LodeReadOnlyFailureClass>([
  "invalid_contract",
  "empty_result",
  "not_logged_in",
  "login_expired",
  "identity_insufficient",
  "captcha_required",
  "safety_challenge",
  "page_changed",
  "page_not_ready",
  "site_changed",
  "field_missing",
  "network_resource_unavailable",
  "resource_unavailable",
  "signed_ref_missing",
  "input_missing_security_id",
  "query_missing",
  "city_unresolved",
  "pagination_limited",
  "job_expired",
  "permission_denied"
]);

function isLodeReadOnlyFailureClass(value: string): value is LodeReadOnlyFailureClass {
  return lodeReadOnlyFailureClasses.has(value as LodeReadOnlyFailureClass);
}

function unavailableFailureClass(value: unknown, entry: LodeRuntimeConsumptionEntry, requested: { runtime_session_ref: string; site_id: string; operation_id: string }): LodeReadOnlyFailureClass | undefined {
  const unavailable = object(value);
  const failureClass = string(unavailable?.failure_class);
  if (
    unavailable?.schema_version !== "harbor-allowlisted-read-operation/v0" || unavailable.status !== "unavailable" ||
    unavailable.runtime_session_ref !== requested.runtime_session_ref || unavailable.site_id !== requested.site_id || unavailable.operation_id !== requested.operation_id ||
    typeof unavailable.retryable !== "boolean" || !failureClass
  ) return undefined;
  if (entry.required_failure_classes.includes(failureClass) && isLodeReadOnlyFailureClass(failureClass)) return failureClass;
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
    safety_challenge: "captcha_required",
    origin_drift: "site_changed",
    public_summary_missing: "field_missing",
    source_refs_missing: "field_missing",
    evidence_refs_missing: "network_resource_unavailable",
    post_check_missing: "field_missing"
  };
  const mapped = harborToLode[failureClass];
  if (mapped && isLodeReadOnlyFailureClass(mapped) && entry.required_failure_classes.includes(mapped)) return mapped;

  // A newer Harbor runtime may add a bounded unavailable class before the
  // pinned Lode taxonomy is updated. Keep the run in runtime failure space;
  // never reinterpret an admitted browser/runtime failure as site drift.
  return entry.required_failure_classes.includes("resource_unavailable") ? "resource_unavailable" : undefined;
}

export async function submitRuntimeTask(
  store: FileRunRecordStore,
  request: RuntimeTaskSubmissionRequest,
  deps: RuntimeTaskSubmissionDependencies
): Promise<TaskSubmissionResult> {
  const package_ref = request.package_ref ?? taskPackageRef(request.task_intent);
  const base = {
    run_id: request.run_id,
    ...(request.run_claim_token === undefined ? {} : { run_claim_token: request.run_claim_token }),
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

  const runtimeAdmissionFailure = lodeRuntimeAdmissionFailure(
    lode_package_contract.package_ref,
    lode_package_contract.runtime_admission
  );
  if (runtimeAdmissionFailure && isFailure(runtimeAdmissionFailure)) {
    return acceptReadOnlyTaskSubmission(store, { ...base, lode_resolution_failure: runtimeAdmissionFailure });
  }
  const detailRef = xhsDetailRefFromIntent(request.task_intent);
  if (isFailure(detailRef) || (typeof detailRef === "string" && (request.public_query !== undefined || request.harbor?.url !== undefined))) {
    return acceptReadOnlyTaskSubmission(store, {
      ...base,
      lode_package_contract,
      lode_resolution_failure: isFailure(detailRef)
        ? detailRef
        : failure("capability_contract", "detail_ref_invalid", "admission", "use_persisted_search_detail_ref")
    });
  }

  const validatedTaskIntent = validateTaskIntent(request.task_intent);
  if (isFailure(validatedTaskIntent)) return acceptReadOnlyTaskSubmission(store, base);
  const runtimeConsumption = lode_package_contract.runtime_consumption;
  let operationMatch: LockedOperationMatch | undefined;
  if (runtimeConsumption) {
    const detailOperation = isXhsDetailOperation(runtimeConsumption);
    const requestedTargetRef = detailOperation ? undefined : request.harbor?.url ?? taskUrl(validatedTaskIntent);
    const selection = operationSelectionFromTask(lode_package_contract, validatedTaskIntent, detailOperation, requestedTargetRef);
    if (isFailure(selection)) {
      return acceptReadOnlyTaskSubmission(store, { ...base, lode_package_contract, lode_resolution_failure: selection });
    }
    const matched = matchLockedLodeOperation(lode_package_contract, selection);
    if (isFailure(matched)) {
      return acceptReadOnlyTaskSubmission(store, { ...base, lode_package_contract, lode_resolution_failure: matched });
    }
    operationMatch = matched;
  }

  let verifiedXhsDetailInput = false;
  let xhsDetailRuntimeSessionRef: string | undefined;
  if (operationMatch && isXhsDetailOperation(operationMatch.runtime_consumption)) {
    const identityRef = request.harbor?.identity_environment_ref;
    if (!identityRef) {
      return acceptReadOnlyTaskSubmission(store, {
        ...base,
        lode_package_contract,
        harbor_admission_failure: failure("resource_admission", "identity_environment_unavailable", "runtime_binding", "connect_identity_environment")
      });
    }
    if (typeof detailRef !== "string") {
      return acceptReadOnlyTaskSubmission(store, {
        ...base,
        lode_package_contract,
        lode_resolution_failure: failure("capability_contract", "detail_ref_invalid", "admission", "use_persisted_search_detail_ref")
      });
    }
    let inspected;
    try {
      inspected = await inspectDetailTargetForIdentity(store.directory, detailRef, {
        site_slug: "xiaohongshu",
        identity_environment_ref: identityRef
      });
    } catch {
      return acceptReadOnlyTaskSubmission(store, {
        ...base,
        lode_package_contract,
        lode_resolution_failure: failure("persistence_observability", "detail_ref_lookup_failed", "persistence", "retry_task")
      });
    }
    if (!inspected.ok) {
      const detailFailure = inspected.code === "detail_ref_binding_mismatch"
        ? failure("result_projection", "site_changed", "projection", "repair_package")
        : failure("request_invalid", "signed_ref_missing", "projection", "fix_input");
      return acceptReadOnlyTaskSubmission(store, {
        ...base,
        lode_package_contract,
        lode_resolution_failure: detailFailure
      });
    }
    verifiedXhsDetailInput = true;
    xhsDetailRuntimeSessionRef = inspected.binding.runtime_session_ref;
  }

  const unifiedWritePrecheck = isUnifiedWritePrecheckTask(validatedTaskIntent, lode_package_contract);
  if (lode_package_contract.package_ref === xhsWritePrecheckPackageRef && !unifiedWritePrecheck) {
    return acceptReadOnlyTaskSubmission(store, {
      ...base,
      lode_package_contract,
      lode_resolution_failure: failure("capability_contract", "write_precheck_binding_invalid", "admission", "repair_package_contract")
    });
  }
  if (unifiedWritePrecheck) {
    const policy = deps.authorizationDecisionStore === undefined
      ? failure("action_risk", "authorization_decision_owner_unavailable", "admission", "retry_when_policy_owner_ready")
      : await evaluateWritePrecheckTaskPolicy({
          run_id: request.run_id,
          task_intent: validatedTaskIntent,
          lode_contract: lode_package_contract,
          ...(request.authorization_context === undefined ? {} : { authorization_context: request.authorization_context }),
          ...(deps.executionPolicyConfigStore === undefined ? {} : { config_store: deps.executionPolicyConfigStore }),
          evaluated_at: (deps.clock ?? (() => new Date()))().toISOString()
        });
    if (isFailure(policy)) {
      return acceptReadOnlyTaskSubmission(store, { ...base, lode_package_contract, execution_policy_failure: policy });
    }
    const policyFailure = writePrecheckPolicyFailure(policy.evaluation);
    if (policy.evaluation.status !== "evaluated" || policy.evaluation.next_step !== "execute") {
      const result = await acceptReadOnlyTaskSubmission(store, {
        ...base,
        lode_package_contract,
        execution_policy_failure: policyFailure
      });
      try {
        await persistWritePrecheckPolicyDecision({
          run_id: request.run_id,
          policy,
          authorization_store: deps.authorizationDecisionStore!,
          run_record_store: store
        });
        const runRecord = await store.getRunRecord(request.run_id);
        return runRecord && !result.ok ? { ...result, run_record: runRecord } : result;
      } catch {
        const persistenceFailure = failure("persistence_observability", "authorization_decision_persistence_failed", "persistence", "contact_operator");
        const runRecord = result.run_record
          ? await store.updateRunRecord(request.run_id, {
              status: result.run_record.status,
              failure: persistenceFailure,
              post_check: {
                schema_version: "webenvoy.post-check-result.v0",
                status: "blocked",
                summary: "The unified policy decision could not be linked durably; Harbor was not called.",
                checked_at: (deps.clock ?? (() => new Date()))().toISOString(),
                code: persistenceFailure.code,
                attribution: "unknown",
                recovery_hint: persistenceFailure.recovery_hint,
                consumer_boundary: "Core exposes only the fail-closed policy persistence classification; no browser or private evidence material is stored."
              }
            })
          : undefined;
        return { ok: false, failure: persistenceFailure, ...(runRecord ? { run_record: runRecord } : {}) };
      }
    }
    const admitted = await acceptApprovedWritePrecheckTask(store, {
      ...base,
      lode_package_contract
    });
    if (!admitted.ok) return admitted;
    try {
      await persistWritePrecheckPolicyDecision({
        run_id: request.run_id,
        policy,
        authorization_store: deps.authorizationDecisionStore!,
        run_record_store: store
      });
    } catch {
      const persistenceFailure = failure("persistence_observability", "authorization_decision_persistence_failed", "persistence", "contact_operator");
      const runRecord = await store.updateRunRecord(request.run_id, {
        status: "failed",
        failure: persistenceFailure,
        post_check: {
          schema_version: "webenvoy.post-check-result.v0",
          status: "blocked",
          summary: "The unified policy decision could not be linked durably; Harbor was not called.",
          checked_at: (deps.clock ?? (() => new Date()))().toISOString(),
          code: persistenceFailure.code,
          attribution: "unknown",
          recovery_hint: persistenceFailure.recovery_hint,
          consumer_boundary: "Core exposes only the fail-closed policy persistence classification; no browser or private evidence material is stored."
        }
      });
      return { ok: false, failure: persistenceFailure, run_record: runRecord };
    }
    const runRecord = await store.getRunRecord(request.run_id);
    if (!runRecord) return { ok: false, failure: failure("persistence_observability", "run_record_missing", "persistence", "contact_operator") };
    return dispatchApprovedWritePrecheck(store, { ok: true, task_intent: validatedTaskIntent, run_record: runRecord }, request, deps, policy);
  }

  if (!deps.harborRuntimeClient) {
    return acceptReadOnlyTaskSubmission(store, {
      ...base,
      lode_package_contract,
      harbor_admission_failure: failure("resource_admission", "harbor_runtime_api_unconfigured", "runtime_binding", "connect_runtime")
    });
  }

  const operationHarbor = operationMatch
    ? (() => {
        const { url: _discardedUrl, ...rest } = request.harbor ?? {};
        return {
          ...rest,
          ...(isXhsDetailOperation(operationMatch.runtime_consumption)
            ? {}
            : { url: operationMatch.selection.target_ref })
        };
      })()
    : request.harbor;
  let harborResult: HarborRuntimeAdmissionResult;
  try {
    harborResult = await deps.harborRuntimeClient.collectAdmissionFacts({
      run_id: request.run_id,
      task_intent: validatedTaskIntent,
      package_ref,
      admission_mode: validatedTaskIntent.policy.risk === "write" ? "write_precheck" : "read",
      harbor: operationHarbor,
      ...(xhsDetailRuntimeSessionRef === undefined ? {} : { runtime_session_ref: xhsDetailRuntimeSessionRef })
    });
  } catch {
    harborResult = failure("resource_admission", "harbor_runtime_api_unavailable", "runtime_binding", "connect_runtime");
  }
  const collectionFailure = isAdmissionCollectionFailure(harborResult) ? harborResult : undefined;
  const harbor: HarborAdmissionInput | FailureRecord = collectionFailure
    ? collectionFailure.failure
    : harborResult as HarborAdmissionInput | FailureRecord;
  const preflightFailure = !isFailure(harbor) && operationMatch
    ? operationPreflightFailure(
        harbor,
        operationMatch,
        request.harbor?.identity_environment_ref
      )
    : undefined;
  const submitted = await acceptReadOnlyTaskSubmission(
    store,
    isFailure(harbor)
      ? { ...base, lode_package_contract, harbor_admission_failure: harbor }
      : {
          ...base,
          lode_package_contract: operationAdmissionContract(lode_package_contract, verifiedXhsDetailInput),
          ...harbor,
          ...(preflightFailure === undefined ? {} : { harbor_admission_failure: preflightFailure })
        }
  );
  const runtimeSessionRef = collectionFailure?.runtime_session_ref ?? (isFailure(harbor) ? undefined : string(object(harbor.harbor_runtime_facts)?.runtime_session_ref));
  if (!submitted.ok || isFailure(harbor)) {
    const admissionFailure = !submitted.ok
      ? submitted.failure
      : isFailure(harbor)
        ? harbor
        : failure("resource_admission", "admission_failed", "admission", "retry_task");
    let returned = submitted;
    if (runtimeSessionRef && submitted.run_record) {
      const cleanupFailure = collectionFailure?.cleanup_failure ?? await deps.harborRuntimeClient.releaseCoreTaskSession({ runtime_session_ref: runtimeSessionRef, run_id: request.run_id });
      if (cleanupFailure) {
        const updated = await store.updateRunRecord(request.run_id, {
          status: submitted.run_record.status,
          post_check: {
            schema_version: "webenvoy.post-check-result.v0",
            status: "blocked",
            summary: `Admission failed with ${admissionFailure.code}; Core also could not release or stop its Harbor session lock.`,
            checked_at: new Date().toISOString(),
            code: cleanupFailure.code,
            attribution: "runtime",
            recovery_hint: cleanupFailure.recovery_hint,
            source_refs: [runtimeSessionRef],
            consumer_boundary: "Core preserves the admission failure and exposes only cleanup classification plus an opaque session ref."
          }
        });
        if (!submitted.ok) returned = { ...submitted, run_record: updated };
      }
    }
    return returned;
  }
  if (runtimeConsumption) {
    const detailOperation = isXhsDetailOperation(runtimeConsumption);
    let detailReservation: DetailTargetReservation | undefined;
    const query = request.public_query?.query;
    if (!detailOperation && (!query || query.trim() !== query)) {
      if (runtimeSessionRef) {
        const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
        if (cleanup) return cleanup;
      }
      return finalizeAcceptedTask(store, submitted, () => completeAcceptedReadTaskWithFailure(store, submitted, "query_missing", "An explicit non-empty public query is required for an allowlisted read operation."));
    }
    if (!runtimeSessionRef) return finalizeAcceptedTask(store, submitted, () => completeAcceptedReadTaskWithFailure(store, submitted, "page_not_ready", "Harbor did not provide a runtime session ref for the read operation."));
    if (detailOperation) {
      const identityRef = request.harbor?.identity_environment_ref;
      if (!identityRef || typeof detailRef !== "string") {
        const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
        if (cleanup) return cleanup;
        return finalizeAcceptedTask(store, submitted, () => completeAcceptedReadTaskWithFailure(store, submitted, "signed_ref_missing", "The detail task requires one persisted opaque search detail ref."));
      }
      const expectedBinding = {
        site_slug: "xiaohongshu",
        identity_environment_ref: identityRef,
        runtime_session_ref: runtimeSessionRef
      } as const;
      let inspected;
      try {
        inspected = await inspectDetailTarget(store.directory, detailRef, expectedBinding);
      } catch {
        const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
        if (cleanup) return cleanup;
        return finalizeAcceptedTask(store, submitted, () => completeAcceptedUnknownOutcome(store, submitted, "detail_ref_lookup_failed"));
      }
      if (!inspected.ok) {
        const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
        if (cleanup) return cleanup;
        const failureClass = inspected.code === "detail_ref_binding_mismatch" ? "site_changed" : "signed_ref_missing";
        return finalizeAcceptedTask(store, submitted, () => completeAcceptedReadTaskWithFailure(store, submitted, failureClass, `Core rejected the opaque detail ref: ${inspected.code}.`));
      }
      let searchRun;
      try {
        searchRun = await store.getRunRecord(inspected.binding.search_run_ref);
      } catch {
        const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
        if (cleanup) return cleanup;
        return finalizeAcceptedTask(store, submitted, () => completeAcceptedUnknownOutcome(store, submitted, "detail_ref_search_run_lookup_failed"));
      }
      if (
        searchRun?.status !== "succeeded" ||
        searchRun.projection_ref !== inspected.binding.search_result_ref ||
        !searchRun.runtime_binding_refs?.includes(inspected.binding.runtime_session_ref)
      ) {
        const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
        if (cleanup) return cleanup;
        return finalizeAcceptedTask(store, submitted, () => completeAcceptedReadTaskWithFailure(store, submitted, "site_changed", "The opaque detail ref no longer matches its persisted search run."));
      }
      let reserved;
      try {
        reserved = await reserveDetailTarget(store.directory, detailRef, {
          ...expectedBinding,
          detail_run_ref: submitted.run_record.run_id
        });
      } catch {
        const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
        if (cleanup) return cleanup;
        return finalizeAcceptedTask(store, submitted, () => completeAcceptedUnknownOutcome(store, submitted, "detail_ref_reservation_failed"));
      }
      if (!reserved.ok) {
        const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
        if (cleanup) return cleanup;
        return finalizeAcceptedTask(store, submitted, () => completeAcceptedReadTaskWithFailure(store, submitted, "signed_ref_missing", `Core rejected the opaque detail ref: ${reserved.code}.`));
      }
      detailReservation = reserved.reservation;
    }
    const cityCode = runtimeConsumption.operation_id === "boss_job_search" ? request.public_query?.city_code : undefined;
    const limit = request.public_query?.limit;
    let operation: unknown;
    const operationController = new AbortController();
    const operationTimeout = request.harbor?.timeout_ms;
    const operationTimer = operationTimeout === undefined
      ? undefined
      : setTimeout(() => operationController.abort(new Error("core_task_timeout")), operationTimeout);
    try {
      operation = await deps.harborRuntimeClient.executeReadOperation({
        runtime_session_ref: runtimeSessionRef,
        holder_ref: request.run_id,
        site_id: runtimeConsumption.site_slug,
        operation_id: runtimeConsumption.operation_id,
        ...(detailOperation ? { detail_ref: detailRef as string } : { query: query as string }),
        ...(cityCode === undefined ? {} : { city_code: cityCode }),
        ...(limit === undefined ? {} : { limit }),
        ...(!detailOperation && operationMatch ? { url: operationMatch.selection.target_ref } : {}),
        signal: operationController.signal
      });
    } catch {
      operation = failure("runtime_execution", operationController.signal.aborted ? "timeout" : "harbor_read_operation_unavailable", "execution", "retry_after_refresh");
    } finally {
      if (operationTimer !== undefined) clearTimeout(operationTimer);
    }
    if (isFailure(operation)) {
      const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef, operation);
      if (cleanup) return cleanup;
      return finalizeAcceptedTask(store, submitted, () => completeAcceptedUnknownOutcome(store, submitted, operation.code));
    }
    if (object(operation)?.status === "unavailable") {
      if (detailReservation) {
        try {
          await releaseDetailTargetReservation(detailReservation);
        } catch {
          const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
          if (cleanup) return cleanup;
          return finalizeAcceptedTask(store, submitted, () => completeAcceptedUnknownOutcome(store, submitted, "detail_ref_reservation_release_failed"));
        }
      }
      const requested = { runtime_session_ref: runtimeSessionRef, site_id: runtimeConsumption.site_slug, operation_id: runtimeConsumption.operation_id };
      const failureClass = unavailableFailureClass(operation, runtimeConsumption, requested);
      const operationFailure = failure("runtime_execution", failureClass ?? "site_changed", "execution", "retry_after_refresh");
      const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef, operationFailure);
      if (cleanup) return cleanup;
      if (!failureClass) return finalizeAcceptedTask(store, submitted, () => completeAcceptedReadTaskWithFailure(store, submitted, "site_changed", "Core rejected a Harbor unavailable response outside the pinned Lode failure taxonomy."));
      return finalizeAcceptedTask(store, submitted, () => completeAcceptedReadTaskWithFailure(store, submitted, failureClass, `Harbor read operation ended with ${failureClass}.`));
    }
    const requested = {
      runtime_session_ref: runtimeSessionRef,
      site_id: runtimeConsumption.site_slug,
      operation_id: runtimeConsumption.operation_id,
      ...(detailOperation ? { detail_ref: detailRef as string } : { query: query as string }),
      ...(cityCode === undefined ? {} : { city_code: cityCode }),
      ...(limit === undefined ? {} : { limit }),
      ...(request.harbor?.identity_environment_ref === undefined ? {} : { identity_environment_ref: request.harbor.identity_environment_ref })
    };
    if (detailReservation) {
      if (!validateCompletedReadOperation(operation, runtimeConsumption, requested).ok) {
        try {
          await releaseDetailTargetReservation(detailReservation);
        } catch {
          const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
          if (cleanup) return cleanup;
          return finalizeAcceptedTask(store, submitted, () => completeAcceptedUnknownOutcome(store, submitted, "detail_ref_reservation_release_failed"));
        }
        const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
        if (cleanup) return cleanup;
        return finalizeAcceptedTask(store, submitted, () => completeAcceptedReadTaskWithFailure(store, submitted, "site_changed", "Core rejected an unavailable or contract-drifted Harbor read operation."));
      }
      try {
        const committed = await commitDetailTargetReservation(detailReservation);
        if (!committed.ok) {
          const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
          if (cleanup) return cleanup;
          return finalizeAcceptedTask(store, submitted, () => completeAcceptedUnknownOutcome(store, submitted, committed.code));
        }
      } catch {
        const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
        if (cleanup) return cleanup;
        return finalizeAcceptedTask(store, submitted, () => completeAcceptedUnknownOutcome(store, submitted, "detail_ref_commit_failed"));
      }
    }
    const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
    if (cleanup) return cleanup;
    return finalizeAcceptedTask(store, submitted, () => completeAcceptedReadOperation(
      store,
      submitted,
      package_ref,
      runtimeConsumption,
      operation,
      requested,
      lode_package_contract.runtime_consumption_declaration
    ));
  }
  if (runtimeSessionRef) {
    const cleanup = await releaseAcceptedCoreTaskSession(store, submitted, deps.harborRuntimeClient, runtimeSessionRef);
    if (cleanup) return cleanup;
  }
  return finalizeAcceptedTask(store, submitted, () => completeAcceptedReadTask(store, submitted, package_ref, harbor));
}

export async function recoverInterruptedCoreTaskSessions(
  store: FileRunRecordStore,
  client: HarborRuntimeClient
): Promise<{ recovered: string[]; cleanup_failed: string[] }> {
  const recovered: string[] = [];
  const cleanup_failed: string[] = [];
  for (const record of await store.listRunRecords()) {
    const binding = record.admission.runtime_session_binding;
    if (
      terminalRunRecordStatuses.has(record.status) ||
      binding?.session_use !== "core_task_run" ||
      binding.core_task_run !== true ||
      binding.control_owner !== "core_task"
    ) continue;
    const cleanup = await client.releaseCoreTaskSession({ runtime_session_ref: binding.runtime_session_ref, run_id: record.run_id });
    const terminalFailure = cleanup ?? failure("runtime_execution", "core_task_interrupted", "execution", "retry_task");
    await completeRunWithFailure(store, record.run_id, {
      failure: terminalFailure,
      retention_state: "active",
      post_check: {
        schema_version: "webenvoy.post-check-result.v0",
        status: cleanup ? "blocked" : "failed",
        summary: cleanup
          ? "Core restart found an interrupted core_task run but could not release or stop its Harbor session lock."
          : "Core restart terminalized an interrupted run and released its Harbor core_task session lock.",
        checked_at: new Date().toISOString(),
        code: terminalFailure.code,
        attribution: "runtime",
        recovery_hint: terminalFailure.recovery_hint,
        source_refs: [binding.runtime_session_ref],
        consumer_boundary: "Recovery consumes only Core run state and Harbor public session refs; manual or non-core_task sessions are never reclaimed."
      }
    });
    (cleanup ? cleanup_failed : recovered).push(record.run_id);
  }
  return { recovered, cleanup_failed };
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

  type SearchDeclarationResolution = {
    declaration: NonNullable<LodePackageAdmissionContract["runtime_consumption_declaration"]>;
    assetBytes: Readonly<Record<string, Buffer>>;
  };

  return async ({ package_ref }) => {
    try {
      const registry = object(JSON.parse(await readFile(options.registryPath, "utf8")));
      const entries = Array.isArray(registry?.entries) ? registry.entries.map(object) : [];
      const matchingEntries = entries.filter((candidate) => candidate?.package_ref === package_ref);
      if (matchingEntries.length === 0) return failure("capability_contract", "package_not_found", "admission", "select_capability_version");
      if (matchingEntries.length !== 1) return failure("capability_contract", "package_duplicate", "admission", "repair_package_contract");
      const entry = matchingEntries[0];
      if (!entry) return failure("capability_contract", "package_not_found", "admission", "select_capability_version");

      const manifestPath = string(entry.manifest_path);
      const packagePath = string(entry.package_path);
      if (!manifestPath || !packagePath) {
        const runtimeAdmission = await resolveRuntimeAdmissionPolicy(entry, package_ref);
        if (runtimeAdmission && isFailure(runtimeAdmission)) return runtimeAdmission;
        return failure("capability_contract", "asset_missing", "admission", "repair_package_contract");
      }
      const resolvedPackagePath = await pathUnderRoot(packagePath);
      const resolvedManifestPath = await pathUnderRoot(manifestPath);
      if (!resolvedPackagePath || !resolvedManifestPath || relative(resolvedPackagePath, resolvedManifestPath).startsWith("..")) {
        return failure("capability_contract", "asset_missing", "admission", "repair_package_contract");
      }

      const manifestBytes = await readFile(resolvedManifestPath);
      const manifest = object(JSON.parse(manifestBytes.toString("utf8")));
      if (!manifest) {
        return failure("capability_contract", "manifest_package_ref_mismatch", "admission", "repair_package_contract");
      }
      const capability = object(manifest?.capability);
      const actionDeclaration = object(manifest?.action_declaration) as
        Exclude<LodePackageAdmissionContract["action_declaration"], undefined> | undefined;
      const resourcePath = resourceRequirementsPath(entry, manifest, packagePath);
      if (!resourcePath) return failure("capability_contract", "resource_requirements_missing", "admission", "repair_package_contract");
      const resolvedResourcePath = await pathUnderRoot(resourcePath);
      if (!resolvedResourcePath) return failure("capability_contract", "resource_requirements_missing", "admission", "repair_package_contract");

      const searchResolution = await resolveSearchRuntimeConsumptionDeclaration(entries, entry, package_ref, {
        manifestPath,
        packagePath,
        resourcePath,
        resolvedManifestPath,
        resolvedResourcePath,
        manifestBytes,
        manifest
      });
      if (isFailure(searchResolution)) return searchResolution;
      const searchDeclaration = searchResolution?.declaration;
      if (!searchResolution && manifest.package_ref !== undefined && manifest.package_ref !== package_ref) {
        return failure("capability_contract", "manifest_package_ref_mismatch", "admission", "repair_package_contract");
      }
      const resourceBytes = searchResolution?.assetBytes.resource_requirements ?? await readFile(resolvedResourcePath);
      const resource_requirements = object(JSON.parse(resourceBytes.toString("utf8")));
      if (searchResolution) {
        const packageLock = object(JSON.parse(searchResolution.assetBytes.package_lock!.toString("utf8")));
        const resolution = object(packageLock?.resolution);
        if (
          !packageLock || packageLock.package_ref !== package_ref || packageLock.lock_ref !== entry.lock_ref ||
          resolution?.package_path !== packagePath || resolution.manifest_path !== manifestPath
        ) return failure("capability_contract", "runtime_consumption_asset_binding_mismatch:package_lock", "admission", "repair_package_contract");
      }
      if (!resource_requirements || resource_requirements.package_ref !== package_ref) {
        return failure("capability_contract", "resource_requirements_package_ref_mismatch", "admission", "repair_package_contract");
      }
      const runtimeAdmission = await resolveRuntimeAdmissionPolicy(entry, package_ref, searchResolution?.assetBytes.runtime_consumption_allowlist);
      if (runtimeAdmission && isFailure(runtimeAdmission)) return runtimeAdmission;
      const capability_id = string(entry.capability_id) ?? string(capability?.capability_id);
      const operation_mode = string(entry.operation_mode) ?? string(capability?.operation_mode);
      const version = string(entry.version) ?? string(capability?.version);
      const lock_ref = string(entry.lock_ref) ?? manifestLockRef(manifest);
      const operation_id = string(entry.operation_id) ?? string(capability?.operation_id);
      const lifecycle = string(entry.lifecycle) ?? string(capability?.lifecycle);
      if (!capability_id || !operation_mode || !version || !lock_ref || !resource_requirements) {
        return failure("capability_contract", "invalid_contract", "admission", "repair_package_contract");
      }
      const runtime_consumption = await resolveRuntimeConsumption(
        package_ref,
        lock_ref,
        version,
        operation_id,
        entry.task_kind === "real_site_read",
        searchResolution?.assetBytes.runtime_consumption_allowlist
      );
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
        ...(actionDeclaration === undefined ? {} : {
          action_declaration: actionDeclaration
        }),
        ...(runtimeAdmission === undefined ? {} : { runtime_admission: runtimeAdmission }),
        resource_requirements: resource_requirements as LodePackageAdmissionContract["resource_requirements"],
        ...(runtime_consumption === undefined ? {} : { runtime_consumption }),
        ...(searchDeclaration === undefined ? {} : { runtime_consumption_declaration: searchDeclaration })
      };
    } catch {
      return failure("capability_contract", "lode_registry_unavailable", "admission", "connect_lode_registry");
    }
  };

  async function resolveSearchRuntimeConsumptionDeclaration(
    registryEntries: readonly (JsonObject | undefined)[],
    registryEntry: JsonObject,
    packageRef: string,
    paths: {
      manifestPath: string;
      packagePath: string;
      resourcePath: string;
      resolvedManifestPath: string;
      resolvedResourcePath: string;
      manifestBytes: Buffer;
      manifest: JsonObject;
    }
  ): Promise<SearchDeclarationResolution | FailureRecord | undefined> {
    const declarationRef = string(registryEntry.runtime_consumption_ref);
    if (declarationRef === undefined) return undefined;
    if (packageRef !== "lode://site-capability/xiaohongshu/search-notes@0.1.0" || declarationRef !== lodeSearchRuntimeConsumptionDeclarationPath) {
      return failure("capability_contract", "runtime_consumption_declaration_drift", "admission", "repair_package_contract");
    }
    if (registryEntries.filter((candidate) => candidate?.runtime_consumption_ref === declarationRef).length !== 1) {
      return failure("capability_contract", "runtime_consumption_declaration_duplicate", "admission", "repair_package_contract");
    }
    const path = await pathUnderRoot(declarationRef).catch(() => undefined);
    if (!path) return failure("capability_contract", "runtime_consumption_declaration_missing", "admission", "connect_lode_registry");
    let declaration: JsonObject | undefined;
    try {
      const declarationBytes = await readFile(path);
      const expectedDeclarationSha = options.searchRuntimeConsumptionDeclarationSha256 ?? lodeSearchRuntimeConsumptionDeclarationSha256;
      if (createHash("sha256").update(declarationBytes).digest("hex") !== expectedDeclarationSha) {
        return failure("capability_contract", "runtime_consumption_declaration_pin_mismatch", "admission", "repair_package_contract");
      }
      declaration = object(JSON.parse(declarationBytes.toString("utf8")));
    } catch {
      return failure("capability_contract", "runtime_consumption_declaration_unavailable", "admission", "connect_lode_registry");
    }
    const declaredEntries = Array.isArray(declaration?.entries) ? declaration.entries.map(object).filter((candidate): candidate is JsonObject => candidate !== undefined) : [];
    if (
      declaration?.schema_version !== "lode.search-runtime-consumption.v0" ||
      declaration.truth_id !== "lode.xiaohongshu.search.runtime-consumption" ||
      declaration.asset_owner !== "Lode" ||
      declaration.runtime_execution !== "out_of_scope" ||
      declaredEntries.length !== 1
    ) return failure("capability_contract", "runtime_consumption_declaration_invalid", "admission", "repair_package_contract");
    const declared = declaredEntries[0];
    if (!declared) return failure("capability_contract", "runtime_consumption_declaration_invalid", "admission", "repair_package_contract");
    const identityKeys = ["package_ref", "lock_ref", "version", "site_slug", "capability_id", "operation_id", "operation_mode", "lifecycle"] as const;
    if (
      declared.package_ref !== packageRef ||
      identityKeys.some((key) => declared[key] !== registryEntry[key]) ||
      declared.runtime_admission === undefined ||
      !object(declared.input_contract) ||
      !object(declared.output_contract) ||
      !Array.isArray(declared.required_ref_kinds)
    ) return failure("capability_contract", "runtime_consumption_declaration_drift", "admission", "repair_package_contract");
    const registryAdmission = parseLodeRuntimeAdmissionPolicy(packageRef, registryEntry.runtime_admission);
    const declaredAdmission = parseLodeRuntimeAdmissionPolicy(packageRef, declared.runtime_admission);
    if (
      registryAdmission === undefined || declaredAdmission === undefined ||
      isFailure(registryAdmission) || isFailure(declaredAdmission) ||
      canonicalJson(registryAdmission) !== canonicalJson(declaredAdmission)
    ) return failure("capability_contract", "runtime_consumption_declaration_drift", "admission", "repair_package_contract");
    const assets = object(declared.assets);
    if (!assets || Object.keys(assets).sort().join(",") !== [...lodeSearchRuntimeConsumptionAssetRoles].sort().join(",")) {
      return failure("capability_contract", "runtime_consumption_assets_invalid", "admission", "repair_package_contract");
    }
    if (paths.manifest.package_ref !== packageRef) {
      return failure("capability_contract", "runtime_consumption_asset_binding_mismatch:manifest", "admission", "repair_package_contract");
    }
    const expectedAssetPaths: Record<string, string> = {
      manifest: paths.manifestPath,
      package_lock: string(registryEntry.lock_path) ?? (() => {
        const lockAsset = assetByRole(paths.manifest, "package_lock");
        const lockPath = string(lockAsset?.path);
        return lockPath ? join(paths.packagePath, lockPath) : "";
      })(),
      input_schema: join(paths.packagePath, string(assetByRole(paths.manifest, "input_schema")?.path) ?? ""),
      output_schema: join(paths.packagePath, string(assetByRole(paths.manifest, "normalized_output_schema")?.path) ?? ""),
      resource_requirements: paths.resourcePath,
      failure_mapping: join(paths.packagePath, string(assetByRole(paths.manifest, "failure_mapping")?.path) ?? ""),
      post_check: join(paths.packagePath, string(assetByRole(paths.manifest, "post_check")?.path) ?? ""),
      runtime_consumption_allowlist: lodeAllowlistAssetPath
    };
    const assetHashes: Record<string, string> = {};
    const assetBytes: Record<string, Buffer> = {};
    for (const role of lodeSearchRuntimeConsumptionAssetRoles) {
      const tuple = assets[role];
      if (!Array.isArray(tuple) || tuple.length !== 2 || typeof tuple[0] !== "string" || typeof tuple[1] !== "string" || !/^[a-f0-9]{64}$/.test(tuple[1])) {
        return failure("capability_contract", `runtime_consumption_asset_invalid:${role}`, "admission", "repair_package_contract");
      }
      if (!expectedAssetPaths[role] || tuple[0] !== expectedAssetPaths[role]) {
        return failure("capability_contract", `runtime_consumption_asset_path_mismatch:${role}`, "admission", "repair_package_contract");
      }
      const assetPath = await pathUnderRoot(tuple[0]).catch(() => undefined);
      if (!assetPath) return failure("capability_contract", `runtime_consumption_asset_missing:${role}`, "admission", "connect_lode_registry");
      if ((role === "manifest" && assetPath !== paths.resolvedManifestPath) || (role === "resource_requirements" && assetPath !== paths.resolvedResourcePath)) {
        return failure("capability_contract", `runtime_consumption_asset_path_mismatch:${role}`, "admission", "repair_package_contract");
      }
      let bytes: Buffer;
      try {
        bytes = role === "manifest" ? paths.manifestBytes : await readFile(assetPath);
      } catch {
        return failure("capability_contract", `runtime_consumption_asset_unavailable:${role}`, "admission", "connect_lode_registry");
      }
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== tuple[1]) return failure("capability_contract", `runtime_consumption_asset_pin_mismatch:${role}`, "admission", "repair_package_contract");
      assetHashes[role] = tuple[1];
      assetBytes[role] = bytes;
    }
    const inputRequiredFields = (object(declared.input_contract)?.required as unknown);
    const outputRequiredFields = (object(declared.output_contract)?.required_public_fields as unknown);
    const requiredRefs = declared.required_ref_kinds;
    if (
      !Array.isArray(inputRequiredFields) || !inputRequiredFields.every((value) => typeof value === "string") ||
      !Array.isArray(outputRequiredFields) || !outputRequiredFields.every((value) => typeof value === "string") ||
      !requiredRefs.every((value) => typeof value === "string")
    ) return failure("capability_contract", "runtime_consumption_declaration_invalid", "admission", "repair_package_contract");
    return {
      declaration: {
        declaration_path: declarationRef,
        asset_hashes: assetHashes,
        input_required_fields: inputRequiredFields,
        output_required_public_fields: outputRequiredFields,
        required_ref_kinds: requiredRefs as string[]
      },
      assetBytes
    };
  }

  async function resolveRuntimeAdmissionPolicy(
    registryEntry: JsonObject,
    packageRef: string,
    pinnedAllowlistBytes?: Buffer
  ): Promise<LodeRuntimeAdmissionPolicy | FailureRecord | undefined> {
    const registryPolicy = parseLodeRuntimeAdmissionPolicy(packageRef, registryEntry.runtime_admission);
    if (registryPolicy === undefined || isFailure(registryPolicy)) return registryPolicy;
    let operationPolicy: unknown;
    for (const assetPath of lodeRuntimeAdmissionAssetPaths) {
      const path = await pathUnderRoot(assetPath).catch(() => undefined);
      if (!path) continue;
      const bytes = assetPath === lodeAllowlistAssetPath && pinnedAllowlistBytes !== undefined
        ? pinnedAllowlistBytes
        : await readFile(path);
      const asset = object(JSON.parse(bytes.toString("utf8")));
      const entries = Array.isArray(asset?.entries) ? asset.entries.map(object) : [];
      const operationEntry = entries.find((candidate) => candidate?.package_ref === packageRef);
      if (operationEntry) {
        const expectedSha256 = options.runtimeAdmissionAssetSha256?.[assetPath] ?? lodeRuntimeAdmissionAssetSemanticSha256[assetPath];
        if (expectedSha256 && createHash("sha256").update(canonicalJson(asset)).digest("hex") !== expectedSha256) {
          return failure("capability_contract", "runtime_admission_policy_pin_mismatch", "admission", "repair_package_contract");
        }
        operationPolicy = operationEntry.runtime_admission;
        break;
      }
    }
    const operationAdmission = parseLodeRuntimeAdmissionPolicy(packageRef, operationPolicy);
    if (operationAdmission === undefined || isFailure(operationAdmission)) return operationAdmission;
    if (canonicalJson(registryPolicy) !== canonicalJson(operationAdmission)) {
      return failure("capability_contract", "runtime_admission_policy_drift", "admission", "repair_package_contract");
    }
    return registryPolicy.enabled
      ? registryPolicy
      : failure("capability_contract", "runtime_admission_disabled", "admission", "wait_for_scope_activation");
  }

  async function resolveRuntimeConsumption(
    packageRef: string,
    lockRef: string,
    version: string,
    operationId: string | undefined,
    required: boolean,
    pinnedAllowlistBytes?: Buffer
  ): Promise<LodeRuntimeConsumptionEntry | undefined | Error> {
    if (packageRef === xhsDetailPackageRef) {
      const path = await pathUnderRoot("registry/detail-runtime-consumption.json").catch(() => undefined);
      if (!path) return new Error("runtime_consumption_detail_truth_missing");
      const detailTruth = object(JSON.parse(await readFile(path, "utf8")));
      const expectedSha = options.runtimeAdmissionAssetSha256?.["registry/detail-runtime-consumption.json"] ?? lodeRuntimeAdmissionAssetSemanticSha256["registry/detail-runtime-consumption.json"];
      if (!detailTruth || createHash("sha256").update(canonicalJson(detailTruth)).digest("hex") !== expectedSha) {
        return new Error("runtime_consumption_detail_truth_pin_mismatch");
      }
      const entries = Array.isArray(detailTruth.entries) ? detailTruth.entries.map(object) : [];
      const entry = entries.find((candidate) => candidate?.package_ref === packageRef);
      const requiredKinds = Array.isArray(entry?.required_ref_kinds) ? entry.required_ref_kinds.filter((kind): kind is string => typeof kind === "string") : [];
      const exactRequiredKinds = ["pinia_store_summary", "network_summary", "dom_snapshot_summary", "snapshot_ref", "post_check_ref"];
      if (
        detailTruth.schema_version !== "lode.detail-runtime-consumption.v0" ||
        detailTruth.truth_id !== "lode.xhs-boss.detail-read.runtime-consumption" ||
        detailTruth.asset_owner !== "Lode" ||
        entry?.lock_ref !== lockRef ||
        entry.version !== version ||
        entry.operation_id !== operationId ||
        entry.operation_mode !== "read" ||
        entry.site_slug !== "xiaohongshu" ||
        entry.lifecycle !== "proposed" ||
        requiredKinds.length !== exactRequiredKinds.length ||
        !requiredKinds.every((kind, index) => kind === exactRequiredKinds[index])
      ) return new Error("runtime_consumption_detail_truth_drift");
      return {
        allowlist_id: string(detailTruth.truth_id)!,
        allowlist_version: "0.1.0",
        asset_owner: "Lode",
        consumer: { repository: "WebEnvoy/WebEnvoy", issue: "#270", purpose: "persisted opaque detail ref consumption" },
        package_ref: packageRef,
        lock_ref: lockRef,
        version,
        site_slug: "xiaohongshu",
        operation_id: "xhs_read_note_detail",
        operation_mode: "read",
        lifecycle: "proposed",
        allowed_origins: ["https://www.xiaohongshu.com"],
        resource_requirements_id: "xiaohongshu.read-note-detail.resources",
        failure_mapping_id: "xiaohongshu.read-note-detail.failure-mapping",
        required_failure_classes: ["invalid_contract", "resource_unavailable", "site_changed", "empty_result", "not_logged_in", "login_expired", "page_not_ready", "signed_ref_missing", "safety_challenge", "field_missing", "network_resource_unavailable"],
        required_source_ref_kinds: ["pinia_store_summary", "network_summary", "dom_snapshot_summary"],
        required_evidence_ref_kinds: ["snapshot_ref", "post_check_ref"],
        post_check_id: "xiaohongshu.read-note-detail.post-check",
        required_post_check_fields: ["status", "reason", "source_refs", "evidence_refs"]
      };
    }
    const path = await pathUnderRoot(lodeAllowlistAssetPath).catch(() => undefined);
    if (!path) return required ? new Error("runtime_consumption_allowlist_missing") : undefined;
    const allowlistBytes = pinnedAllowlistBytes ?? await readFile(path);
    const allowlist = object(JSON.parse(allowlistBytes.toString("utf8")));
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
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 5_000;
  if (!Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs <= 0) throw new Error("cleanupTimeoutMs must be a positive integer");
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
      /^\/runtime\/(?:identity-environment-)?sessions\/[^/]+\/(?:lock|release|stop|snapshot|read-operations|validate-only-write-precheck)$/.test(path)
    );
    if (!protectedRequest || !localHarbor) return undefined;
    if (!supervisorToken || supervisorToken.trim() !== supervisorToken || /[\r\n]/.test(supervisorToken)) {
      return failure("resource_admission", "harbor_runtime_supervisor_token_missing", "runtime_binding", "connect_runtime");
    }
    return { authorization: `Bearer ${supervisorToken}` };
  }

  async function requestJson(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<unknown | FailureRecord> {
    try {
      const authorization = protectedHeaders(method, path);
      if (isFailure(authorization)) return authorization;
      const init: RequestInit = { method, ...(authorization === undefined ? {} : { headers: authorization }), ...(signal === undefined ? {} : { signal }) };
      if (method === "POST") {
        init.headers = { ...authorization, "content-type": "application/json" };
        init.body = JSON.stringify(body ?? {});
      }
      const response = await fetchJson(`${baseUrl}${path}`, init);
      const payload = await readBoundedJsonResponse(response, 1024 * 1024);
      if (!response.ok) {
        return failureFromHarborPayload(payload) ?? failure("resource_admission", "harbor_runtime_api_unavailable", "runtime_binding", "connect_runtime");
      }
      return payload;
    } catch {
      return failure("resource_admission", "harbor_runtime_api_unavailable", "runtime_binding", "connect_runtime");
    }
  }

  async function requestCanonicalRuntimeFacts(path: string): Promise<
    | { kind: "fallback" }
    | { kind: "payload"; value: unknown }
    | { kind: "failure"; failure: FailureRecord }
  > {
    try {
      const response = await fetchJson(`${baseUrl}${path}`, { method: "GET" });
      const payload = await readBoundedJsonResponse(response, 1024 * 1024);
      const body = object(payload);
      const endpointUnsupported = response.status === 404 && (
        body?.error === "not_found" ||
        body?.status === "unsupported" ||
        (body?.status === "unavailable" && body?.failure_class === "runtime_facts_unsupported" && body?.retryable === false)
      );
      if (endpointUnsupported || (response.ok && body?.status === "unsupported")) return { kind: "fallback" };
      if (!response.ok) {
        return { kind: "failure", failure: failureFromHarborPayload(payload) ?? failure("resource_admission", "harbor_runtime_api_unavailable", "runtime_binding", "connect_runtime") };
      }
      return { kind: "payload", value: payload };
    } catch {
      return { kind: "failure", failure: failure("resource_admission", "harbor_runtime_api_unavailable", "runtime_binding", "connect_runtime") };
    }
  }

  async function requestLegacyRuntimeFacts(path: string): Promise<unknown | FailureRecord> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("legacy_runtime_facts_timeout")), cleanupTimeoutMs);
    try {
      return await requestJson("GET", path, undefined, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async collectAdmissionFacts(input) {
      const taskTargetUrl = taskUrl(input.task_intent);
      const requestedTarget = input.harbor?.url === undefined
        ? undefined
        : normalizePublicHttpTarget(input.harbor.url);
      if (requestedTarget && (!requestedTarget.ok || requestedTarget.target_ref !== taskTargetUrl)) {
        return failure("capability_contract", "operation_selection_invalid", "resource_matching", "fix_input");
      }
      const readiness = await requestJson("GET", "/readiness");
      if (isFailure(readiness)) return readiness;
      if (!readinessOk(readiness)) return failure("resource_admission", "harbor_runtime_not_ready", "runtime_binding", "connect_runtime");

      const provider = await requestJson("GET", "/runtime/browser-providers");
      if (isFailure(provider)) return provider;
      const publicProviderStatus = providerStatus(provider);

      const identityRef = input.harbor?.identity_environment_ref;
      const identityRecord = identityRef === undefined
        ? undefined
        : await requestJson("GET", `/runtime/identity-environments/${encodeURIComponent(identityRef)}`);
      if (isFailure(identityRecord)) return identityRecord;

      let publicIdentity: HarborIdentityEnvironmentFacts | undefined;
      if (identityRef !== undefined) {
        const snapshot = projectHarborPublicIdentityEnvironmentRecord(identityRecord, { requireComplete: true });
        if (!snapshot || snapshot.facts.identity_environment_ref !== identityRef) {
          return failure("resource_admission", "identity_environment_unavailable", "runtime_binding", "repair_browser_environment");
        }
        const validatedIdentity = validateHarborIdentityEnvironmentFacts(snapshot.facts, input.admission_mode ?? "read");
        if (isFailure(validatedIdentity)) return validatedIdentity;
        const providerFailure = validateHarborIdentityProviderStatus(validatedIdentity, publicProviderStatus);
        if (providerFailure) return providerFailure;
        publicIdentity = validatedIdentity;
      }

      const session = input.runtime_session_ref === undefined
        ? await requestJson("POST", "/runtime/identity-environment-sessions", {
            identity_environment_ref: identityRef,
            url: taskTargetUrl,
            run_id: input.run_id,
            package_ref: input.package_ref,
            control_owner: "core_task",
            headless: object(input.task_intent)?.entrypoint !== "app",
            holder_ref: input.run_id,
            reuse_existing: input.harbor?.reuse_existing ?? true,
            timeout_ms: input.harbor?.timeout_ms
          })
        : await requestJson(
            "POST",
            `/runtime/sessions/${encodeURIComponent(input.runtime_session_ref)}/lock`,
            { control_owner: "core_task", holder_ref: input.run_id }
          );
      if (isFailure(session)) return session;

      const sessionIdentity = identityFactsFromSession(session);
      const validatedSessionIdentity = sessionIdentity === undefined
        ? undefined
        : validateHarborIdentityEnvironmentFacts(sessionIdentity, input.admission_mode ?? "read");
      const identity = validatedSessionIdentity && !isFailure(validatedSessionIdentity)
        ? validatedSessionIdentity
        : publicIdentity;
      const sessionRuntime = coreRuntimeFactsFromSession(session, identity);
      const openedSessionRef = input.runtime_session_ref ?? (isFailure(sessionRuntime)
        ? string(pickObject(session, "runtime_facts", "runtime_session")?.runtime_session_ref)
        : sessionRuntime.runtime_session_ref);
      const failAfterSession = async (primary: FailureRecord): Promise<FailureRecord | HarborAdmissionCollectionFailure> => {
        if (!openedSessionRef) return primary;
        const cleanup = await releaseCoreTaskSession({ runtime_session_ref: openedSessionRef, run_id: input.run_id });
        return cleanup ? {
          kind: "harbor_admission_collection_failure",
          failure: primary,
          cleanup_failure: cleanup,
          runtime_session_ref: openedSessionRef
        } : primary;
      };
      const sessionFailure = failureFromHarborPayload(session);
      if (sessionFailure) return failAfterSession(sessionFailure);
      if (isFailure(validatedSessionIdentity)) return failAfterSession(validatedSessionIdentity);
      if (isFailure(sessionRuntime)) return failAfterSession(sessionRuntime);
      let runtime = sessionRuntime;
      let runtimeFactsSource: "canonical" | "legacy" = "legacy";
      if (openedSessionRef) {
        const canonicalRuntimeResponse = await requestCanonicalRuntimeFacts(
          `/runtime/sessions/${encodeURIComponent(openedSessionRef)}/runtime-facts`
        );
        if (canonicalRuntimeResponse.kind === "failure") return failAfterSession(canonicalRuntimeResponse.failure);
        if (canonicalRuntimeResponse.kind === "payload") {
          const canonicalRuntime = coreRuntimeFactsFromSession(canonicalRuntimeResponse.value, identity, "canonical");
          if (isFailure(canonicalRuntime)) return failAfterSession(canonicalRuntime);
          runtime = canonicalRuntime;
          runtimeFactsSource = "canonical";
        } else {
          const legacyRuntimeResponse = await requestLegacyRuntimeFacts(
            `/runtime/sessions/${encodeURIComponent(openedSessionRef)}`
          );
          if (isFailure(legacyRuntimeResponse)) return failAfterSession(legacyRuntimeResponse);
          const legacyRuntime = legacyRuntimeFactsFromReadback(legacyRuntimeResponse, sessionRuntime);
          if (isFailure(legacyRuntime)) return failAfterSession(legacyRuntime);
          runtime = legacyRuntime;
        }
      }
      if (
        (openedSessionRef !== undefined && runtime.runtime_session_ref !== openedSessionRef) ||
        (input.runtime_session_ref !== undefined && runtime.runtime_session_ref !== input.runtime_session_ref)
      ) {
        return failAfterSession(failure("resource_admission", "runtime_ref_mismatch", "runtime_binding", "connect_runtime"));
      }
      const runtimeSessionRef = runtime.runtime_session_ref;
      const siteTask = siteTaskFromPackageRef(input.package_ref);
      const siteResourceFacts = siteTask === undefined
        ? undefined
        : await requestJson(
            "GET",
            `/runtime/sessions/${encodeURIComponent(runtimeSessionRef)}/site-resource-facts?site_id=${encodeURIComponent(siteTask.site_id)}&task_kind=${encodeURIComponent(siteTask.task_kind)}`
          );
      if (isFailure(siteResourceFacts)) {
        return {
          harbor_identity_environment_facts: identity ?? unavailable("identity_environment_unavailable"),
          harbor_provider_status: publicProviderStatus,
          harbor_runtime_facts: runtime,
          runtime_facts_source: runtimeFactsSource,
          harbor_scene_ref: unavailable(siteResourceFacts.code),
          harbor_resource_facts: unavailable(siteResourceFacts.code)
        };
      }

      const snapshot = await requestJson("POST", `/runtime/sessions/${encodeURIComponent(runtimeSessionRef)}/snapshot`, {
        run_id: input.run_id,
        package_ref: input.package_ref,
        evidence_policy: input.harbor?.evidence_policy
      });
      if (isFailure(snapshot)) {
        return {
          harbor_identity_environment_facts: identity ?? unavailable("identity_environment_unavailable"),
          harbor_provider_status: publicProviderStatus,
          harbor_runtime_facts: runtime,
          runtime_facts_source: runtimeFactsSource,
          harbor_scene_ref: unavailable(snapshot.code),
          harbor_resource_facts: resourceFactsFromSiteFacts(siteResourceFacts) ?? resourceFactsFromSession(session, runtime)
        };
      }

      const scene = sceneFromSnapshot(snapshot);
      const runtimeAfterSnapshot = runtimeFactsAfterSnapshot(runtime, scene);
      const evidenceFailure = "status" in scene ? undefined : await verifyEvidenceRefs(scene.evidence_refs);
      const facts: HarborAdmissionInput = {
        harbor_identity_environment_facts: identity ?? unavailable("identity_environment_unavailable"),
        harbor_provider_status: publicProviderStatus,
        harbor_runtime_facts: runtimeAfterSnapshot,
        runtime_facts_source: runtimeFactsSource,
        harbor_scene_ref: evidenceFailure ? unavailable(evidenceFailure.code) : scene,
        harbor_resource_facts: resourceFactsFromSiteFacts(siteResourceFacts) ?? resourceFactsFromSession(session, runtime)
      };
      return facts;
    },
    async validateOnlyWritePrecheck(input) {
      const path = `/runtime/sessions/${encodeURIComponent(input.runtime_session_ref)}/validate-only-write-precheck`;
      try {
        const authorization = protectedHeaders("POST", path);
        if (isFailure(authorization)) return authorization;
        const response = await fetchJson(`${baseUrl}${path}`, {
          method: "POST",
          headers: { ...authorization, "content-type": "application/json" },
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          body: JSON.stringify({
            url: input.url,
            target_ref: input.target_ref,
            no_submit_guard: "active",
            ...(input.holder_ref === undefined ? {} : { holder_ref: input.holder_ref }),
            ...(input.requested_fields === undefined ? {} : { requested_fields: input.requested_fields }),
            ...(input.include_source_refs === undefined ? {} : { include_source_refs: input.include_source_refs }),
            ...(input.proposed_input_summary === undefined ? {} : { proposed_input_summary: input.proposed_input_summary })
          })
        });
        const payload = await readBoundedJsonResponse(response, 1024 * 1024);
        const body = object(payload);
        if (body?.schema_version === "harbor-validate-only-write-precheck/v0" && body.submitted === false &&
          ((body.status === "completed" && body.runtime_session_ref === input.runtime_session_ref) ||
            (body.status === "unavailable" && body.runtime_session_ref === input.runtime_session_ref && typeof body.failure_class === "string" && typeof body.retryable === "boolean"))) return payload;
        return failure("runtime_execution", "harbor_write_precheck_outcome_unknown", "verification", "reconcile_status");
      } catch {
        return input.signal?.aborted
          ? failure("runtime_execution", "timeout", "execution", "retry_task")
          : failure("runtime_execution", "harbor_write_precheck_outcome_unknown", "verification", "reconcile_status");
      }
    },
    async executeReadOperation(input) {
      try {
        const path = `/runtime/sessions/${encodeURIComponent(input.runtime_session_ref)}/read-operations`;
        const authorization = protectedHeaders("POST", path);
        if (isFailure(authorization)) return authorization;
        const response = await fetchJson(`${baseUrl}${path}`, {
          method: "POST",
          headers: { ...authorization, "content-type": "application/json" },
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          body: JSON.stringify({
            ...(input.holder_ref === undefined ? {} : { holder_ref: input.holder_ref }),
            site_id: input.site_id,
            operation_id: input.operation_id,
            ...(input.query === undefined ? {} : { query: input.query }),
            ...(input.city_code === undefined ? {} : { city_code: input.city_code }),
            ...(input.limit === undefined ? {} : { limit: input.limit }),
            ...(input.detail_ref === undefined ? {} : { detail_ref: input.detail_ref }),
            ...(input.detail_ref !== undefined || input.url === undefined ? {} : { url: input.url })
          })
        });
        const payload = await readBoundedJsonResponse(response, 1024 * 1024);
        const body = object(payload);
        if (body?.schema_version === "harbor-allowlisted-read-operation/v0" && (body.status === "completed" || body.status === "unavailable")) return payload;
        return failure("runtime_execution", "harbor_read_operation_outcome_unknown", "verification", "reconcile_status");
      } catch {
        return input.signal?.aborted
          ? failure("runtime_execution", "timeout", "execution", "retry_task")
          : failure("runtime_execution", "harbor_read_operation_outcome_unknown", "verification", "reconcile_status");
      }
    },
    async releaseCoreTaskSession(input) {
      return releaseCoreTaskSession(input);
    }
  };

  async function releaseCoreTaskSession(input: { runtime_session_ref: string; run_id: string }): Promise<FailureRecord | undefined> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<FailureRecord>((resolve) => {
      timer = setTimeout(() => {
        controller.abort(new Error("core_task_session_cleanup_timeout"));
        resolve(failure("runtime_execution", "core_task_session_cleanup_timeout", "runtime_binding", "retry_session_cleanup"));
      }, cleanupTimeoutMs);
    });
    const sequence = async (): Promise<FailureRecord | undefined> => {
      const path = `/runtime/sessions/${encodeURIComponent(input.runtime_session_ref)}`;
      const current = await requestJson("GET", path, undefined, controller.signal);
      if (controller.signal.aborted) return failure("runtime_execution", "core_task_session_cleanup_timeout", "runtime_binding", "retry_session_cleanup");
      if (isFailure(current)) return failure("runtime_execution", "core_task_session_cleanup_unverified", "runtime_binding", "retry_session_cleanup");
      if (isReleasedSessionProof(current, input.runtime_session_ref)) return undefined;
      if (!isHeldCoreTaskSessionProof(current, input)) {
        return failure("runtime_execution", "core_task_session_lock_mismatch", "runtime_binding", "inspect_session_owner");
      }

      const body = { control_owner: "core_task", holder_ref: input.run_id };
      await requestJson("POST", `${path}/release`, body, controller.signal);
      if (controller.signal.aborted) return failure("runtime_execution", "core_task_session_cleanup_timeout", "runtime_binding", "retry_session_cleanup");
      const afterRelease = await requestJson("GET", path, undefined, controller.signal);
      if (controller.signal.aborted) return failure("runtime_execution", "core_task_session_cleanup_timeout", "runtime_binding", "retry_session_cleanup");
      if (isReleasedSessionProof(afterRelease, input.runtime_session_ref)) return undefined;

      await requestJson("POST", `${path}/stop`, body, controller.signal);
      if (controller.signal.aborted) return failure("runtime_execution", "core_task_session_cleanup_timeout", "runtime_binding", "retry_session_cleanup");
      const afterStop = await requestJson("GET", path, undefined, controller.signal);
      if (controller.signal.aborted) return failure("runtime_execution", "core_task_session_cleanup_timeout", "runtime_binding", "retry_session_cleanup");
      return isReleasedSessionProof(afterStop, input.runtime_session_ref)
        ? undefined
        : failure("runtime_execution", "core_task_session_cleanup_failed", "runtime_binding", "retry_session_cleanup");
    };
    try {
      return await Promise.race([sequence(), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

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

function isHeldCoreTaskSessionProof(value: unknown, input: { runtime_session_ref: string; run_id: string }): boolean {
  const session = object(value);
  const controlLock = object(session?.control_lock);
  return session?.runtime_session_ref === input.runtime_session_ref &&
    (session.lifecycle_state === "active" || session.lifecycle_state === "locked") &&
    session.control_owner === "core_task" &&
    controlLock?.owner === "core_task" &&
    controlLock.state === "held" &&
    controlLock.holder_ref === input.run_id;
}

export function isReleasedSessionProof(value: unknown, runtimeSessionRef: string): boolean {
  const session = object(value);
  const controlLock = object(session?.control_lock);
  return session?.runtime_session_ref === runtimeSessionRef &&
    (session.lifecycle_state === "idle" || session.lifecycle_state === "closed" || session.lifecycle_state === "failed") &&
    session.control_owner === "none" &&
    controlLock?.owner === "none" &&
    controlLock.state === "released" &&
    controlLock.holder_ref === null;
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

export function recoveryHintForHarborFailure(code: string): FailureRecord["recovery_hint"] {
  if (code === "identity_auth_required" || code === "login_expired") return "open_manual_auth";
  if ([
    "browser_environment_repair_required",
    "identity_storage_unavailable",
    "provider_conflict",
    "provider_binding_conflict",
    "fingerprint_conflict",
    "profile_locked",
    "launch_failed"
  ].includes(code)) return "repair_browser_environment";
  if (code === "browser_provider_unavailable") return "install_or_select_provider";
  if (code.startsWith("identity_environment_")) return "connect_identity_environment";
  if (code === "session_locked") return "wait_or_request_handoff";
  if (code === "url_unreachable") return "fix_input";
  return "connect_runtime";
}

function identityFactsFromSession(value: unknown): HarborIdentityEnvironmentFacts | undefined {
  const direct = pickObject(value, "harbor_identity_environment_facts", "identity_environment_facts", "identity_environment");
  return direct?.schema_version === "harbor-local-identity-environment/v0" ? (direct as HarborIdentityEnvironmentFacts) : undefined;
}

function coreRuntimeFactsFromSession(
  value: unknown,
  identity: HarborIdentityEnvironmentFacts | undefined,
  source: "session" | "canonical" = "session"
): HarborCoreRuntimeFacts | FailureRecord {
  if (source === "canonical" && object(value)?.schema_version !== "harbor-core-runtime-facts/v0") {
    return failure("resource_admission", "runtime_contract_invalid", "runtime_binding", "connect_runtime");
  }
  const direct = source === "canonical"
    ? object(value)
    : pickObject(value, "harbor_runtime_facts", "core_runtime_facts", "runtime_facts", "session");
  if (!direct) return failure("resource_admission", "runtime_ref_missing", "runtime_binding", "connect_runtime");
  if (source === "session" && direct.status === "unavailable") {
    return failure("resource_admission", string(direct.failure_class) ?? "runtime_session_unavailable", "runtime_binding", "connect_runtime");
  }

  const runtime_session_ref = string(direct.runtime_session_ref);
  const profile_ref = string(direct.profile_ref);
  const provider_ref = string(direct.provider_ref);
  const provider_mode = string(direct.provider_mode);
  const lifecycle_state = string(direct.lifecycle_state);
  const viewer_ref = string(direct.viewer_ref) ?? string(object(direct.viewer)?.viewer_ref);
  if (!runtime_session_ref || !profile_ref || !provider_ref || !provider_mode || !lifecycle_state || !viewer_ref) {
    return failure("resource_admission", source === "canonical" ? "runtime_contract_invalid" : "runtime_ref_missing", "runtime_binding", "connect_runtime");
  }
  if (direct.schema_version === "harbor-core-runtime-facts/v0") {
    const availability = object(direct.availability);
    const viewer = object(direct.viewer);
    const control = object(direct.control);
    const takeover = object(control?.takeover);
    const factRefs = object(direct.fact_refs);
    if (
      !availability || !string(availability.cdp) || !string(availability.viewer) || !string(availability.snapshot) || !string(availability.evidence) ||
      !viewer || !string(viewer.viewer_ref) || !string(viewer.availability) || !string(viewer.access_mode) || !string(viewer.expires_at) ||
      !control || !string(control.owner) || !takeover || typeof takeover.available !== "boolean" || !string(control.updated_at) ||
      factRefs?.session !== runtime_session_ref || factRefs.viewer !== viewer_ref || direct.unavailable !== null || !("current_error" in direct)
    ) return failure("resource_admission", "runtime_contract_invalid", "runtime_binding", "connect_runtime");
    return direct as HarborCoreRuntimeFacts;
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

function legacyRuntimeFactsFromReadback(
  value: unknown,
  openedRuntime: HarborCoreRuntimeFacts
): HarborCoreRuntimeFacts | FailureRecord {
  const readback = pickObject(value, "harbor_runtime_facts", "core_runtime_facts", "runtime_facts", "session");
  const readbackSessionRef = string(readback?.runtime_session_ref);
  if (!readbackSessionRef || readbackSessionRef !== openedRuntime.runtime_session_ref) {
    return failure("resource_admission", "runtime_ref_mismatch", "runtime_binding", "connect_runtime");
  }
  return openedRuntime;
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
