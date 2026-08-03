import { createHash } from "node:crypto";
import { opaqueRef } from "./refs.js";
import type { DetailReadFailureClass } from "./detail-read-target.js";
import type { AllowlistedReadOperationId, AllowlistedReadOperationSite, LocalProviderReadProbePublicSummary } from "./runtime-session-types.js";

/** @deprecated Compatibility-only adapter schema; Core owns new admission. */
export const HARBOR_ALLOWLISTED_READ_OPERATION_SCHEMA = "harbor-allowlisted-read-operation/v0";

/** @deprecated Lode pin retained only inside the bounded compatibility adapter. */
export const LODE_262_ALLOWLIST_PIN = {
  repository: "WebEnvoy/Lode",
  commit: "e36a4a7",
  asset_path: "registry/runtime-consumption-allowlist.json",
  asset_sha256: "5aa6be8bd416bbd19f73dcfab995f62f769849923f2aa2e995da974b0f329184",
  mirror_payload_sha256: "3b32e37e04cb008c7e1c072ead35919cde6e498ebfcea34a57de889559a0f141",
  allowlist_id: "lode.xhs-boss.read.runtime-consumption",
  allowlist_version: "0.1.0",
  asset_owner: "Lode",
  consumer: {
    repository: "WebEnvoy/Harbor",
    issue: "#245",
    purpose: "allowlisted one-shot read-only operation admission"
  }
} as const;

/** @deprecated Lode pin retained only inside the bounded compatibility adapter. */
export const LODE_268_DETAIL_PIN = {
  repository: "WebEnvoy/Lode",
  issue: "#268",
  merge_commit: "66d79b4e600565a00515b1c801e84291edc7b0c1",
  asset_path: "registry/detail-runtime-consumption.json",
  asset_sha256: "dca2761b7feb09a0ab86f7202e153da3c97b21a75299af6adaf64eade319deef",
  truth_id: "lode.xhs-boss.detail-read.runtime-consumption",
  schema_version: "lode.detail-runtime-consumption.v0",
  asset_owner: "Lode",
  runtime_execution: "out_of_scope"
} as const;

export type ReadOperationFailureClass =
  | "invalid_request"
  | "operation_not_allowlisted"
  | "allowlist_pin_invalid"
  | "target_url_invalid"
  | "target_origin_not_allowed"
  | "target_path_not_allowlisted"
  | "session_missing"
  | "session_unmanaged"
  | "session_not_ready"
  | "session_user_controlled"
  | "not_logged_in"
  | "safety_challenge"
  | "fixture_runtime"
  | "provider_probe_unavailable"
  | "origin_drift"
  | "page_not_ready"
  | "network_resource_unavailable"
  | "permission_denied"
  | "city_unresolved"
  | "empty_result"
  | "field_missing"
  | "site_changed"
  | "public_summary_missing"
  | "source_refs_missing"
  | "evidence_refs_missing"
  | "post_check_missing"
  | DetailReadFailureClass;

export interface AllowlistedReadOperationRequest {
  site_id: AllowlistedReadOperationSite;
  operation_id: AllowlistedReadOperationId;
  query?: string;
  city_code?: string;
  limit?: number;
  detail_ref?: string;
  url?: string;
  holder_ref?: string;
}

export interface PinnedReadOperation {
  site_id: AllowlistedReadOperationSite;
  operation_id: AllowlistedReadOperationId;
  package_ref: string;
  lock_ref: string;
  version: "0.1.0" | "0.1.1";
  operation_mode: "read";
  lifecycle: "proposed";
  allowed_origin: string;
  target_schema: {
    pathname: string;
    public_query_parameter: "keyword" | "query";
    public_city_parameter?: "city";
  };
  resource_requirement_id: string;
  required_harbor_fact_keys: readonly string[];
  failure_mapping_id: string;
  required_failure_classes: readonly string[];
  required_source_ref_kinds: readonly string[];
  required_evidence_ref_kinds: readonly string[];
  post_check_id: string;
  required_post_check_fields: readonly ["status", "reason", "source_refs", "evidence_refs"];
}

export interface AdmittedReadOperation {
  status: "admitted";
  request: AllowlistedReadOperationRequest;
  entry: PinnedReadOperation;
  target_url: string;
}

export interface ReadOperationUnavailable {
  schema_version: typeof HARBOR_ALLOWLISTED_READ_OPERATION_SCHEMA;
  status: "unavailable";
  failure_class: ReadOperationFailureClass;
  runtime_session_ref: string;
  site_id?: string;
  operation_id?: string;
  retryable: boolean;
  public_boundary: ReadOperationPublicBoundary;
}

export interface CompletedReadOperation {
  schema_version: typeof HARBOR_ALLOWLISTED_READ_OPERATION_SCHEMA;
  status: "completed";
  operation_ref: string;
  runtime_session_ref: string;
  site_id: AllowlistedReadOperationSite;
  operation_id: AllowlistedReadOperationId;
  operation_mode: "read";
  observed_at: string;
  public_summary_ref: string;
  public_summary: LocalProviderReadProbePublicSummary;
  source_refs: ReadOperationRef[];
  evidence_refs: string[];
  evidence_ref_kinds: ReadOperationRef[];
  post_check: {
    post_check_ref: string;
    status: "passed";
    reason: "managed_provider_read_probe_completed";
  };
  lode_pin: typeof LODE_262_ALLOWLIST_PIN | typeof LODE_268_DETAIL_PIN;
  public_boundary: ReadOperationPublicBoundary;
}

export interface ReadOperationRef {
  kind: string;
  ref: string;
}

export interface ReadOperationObservationRecord {
  schema_version: "harbor-read-operation-observation/v0";
  record_type: "source_observation" | "operation_evidence" | "operation_result_summary" | "post_check";
  ref: string;
  operation_ref: string;
  runtime_session_ref: string;
  site_id: AllowlistedReadOperationSite;
  operation_id: AllowlistedReadOperationId;
  origin: string;
  observed_at: string;
  source_kind?: string;
  evidence_kind?: string;
  summary_source_ref?: string;
  public_summary?: LocalProviderReadProbePublicSummary;
  post_check?: {
    status: "passed";
    reason: "managed_provider_read_probe_completed";
    required_fields: readonly ["status", "reason", "source_refs", "evidence_refs"];
    source_refs: ReadOperationRef[];
    evidence_refs: string[];
  };
  public_boundary: ReadOperationPublicBoundary;
}

export interface OperationProbeEvidence {
  operation_ref: string;
  runtime_session_ref: string;
  site_id: AllowlistedReadOperationSite;
  operation_id: AllowlistedReadOperationId;
  origin: string;
  observed_at: string;
  public_summary_ref: string;
  public_summary_source_ref: string;
  public_summary: LocalProviderReadProbePublicSummary;
  source_refs: ReadOperationRef[];
  evidence_refs: string[];
  evidence_ref_kinds: ReadOperationRef[];
  post_check_ref: string;
}

export interface ReadOperationPublicBoundary {
  output: "public_summary_and_refs_only";
  raw_credentials: "not_exposed";
  raw_profile_storage: "not_exposed";
  raw_cdp_endpoint: "not_exposed";
  raw_dom: "not_exposed";
  raw_har: "not_exposed";
  raw_network_bodies: "not_exposed";
  screenshot_body: "not_exposed";
  external_write_actions: "not_performed";
}

const PUBLIC_BOUNDARY: ReadOperationPublicBoundary = {
  output: "public_summary_and_refs_only",
  raw_credentials: "not_exposed",
  raw_profile_storage: "not_exposed",
  raw_cdp_endpoint: "not_exposed",
  raw_dom: "not_exposed",
  raw_har: "not_exposed",
  raw_network_bodies: "not_exposed",
  screenshot_body: "not_exposed",
  external_write_actions: "not_performed"
};

// This is a packaged, subset mirror of Lode #262. Its pin records the immutable
// Lode asset identity; it intentionally has no registry fetch or runtime execution.
const PINNED_READ_OPERATIONS: readonly PinnedReadOperation[] = [
  {
    site_id: "xiaohongshu",
    operation_id: "xhs_search_notes",
    package_ref: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
    lock_ref: "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0",
    version: "0.1.0",
    operation_mode: "read",
    lifecycle: "proposed",
    allowed_origin: "https://www.xiaohongshu.com",
    target_schema: {
      pathname: "/search_result",
      public_query_parameter: "keyword"
    },
    resource_requirement_id: "xiaohongshu.search-notes.resources",
    required_harbor_fact_keys: [
      "runtime.execution_surface.available",
      "runtime.origin.www_xiaohongshu_com.available",
      "identity.user_logged_in.confirmed",
      "page.vue_app.ready",
      "page.pinia_store.ready",
      "source.refs.available",
      "evidence.snapshot_ref.available",
      "safety.challenge.absent"
    ],
    failure_mapping_id: "xiaohongshu.search-notes.failure-mapping",
    required_failure_classes: [
      "invalid_contract",
      "resource_unavailable",
      "site_changed",
      "empty_result",
      "not_logged_in",
      "login_expired",
      "page_not_ready",
      "signed_ref_missing",
      "safety_challenge",
      "field_missing",
      "network_resource_unavailable"
    ],
    required_source_ref_kinds: ["pinia_store_summary", "network_summary", "dom_snapshot_summary"],
    required_evidence_ref_kinds: ["snapshot_ref", "post_check_ref"],
    post_check_id: "xiaohongshu.search-notes.post-check",
    required_post_check_fields: ["status", "reason", "source_refs", "evidence_refs"]
  },
  {
    site_id: "boss",
    operation_id: "boss_job_search",
    package_ref: "lode://site-capability/boss/job-search@0.1.0",
    lock_ref: "lode://lock/site-capability/boss/job-search@0.1.0",
    version: "0.1.0",
    operation_mode: "read",
    lifecycle: "proposed",
    allowed_origin: "https://www.zhipin.com",
    target_schema: {
      pathname: "/web/geek/job",
      public_query_parameter: "query",
      public_city_parameter: "city"
    },
    resource_requirement_id: "boss.job-search.resources",
    required_harbor_fact_keys: [
      "runtime.execution_surface.available",
      "runtime.origin.www_zhipin_com.available",
      "identity.boss_geek_logged_in.confirmed",
      "page.boss_spa.ready",
      "network.wapi_zpgeek.available",
      "source.refs.available",
      "evidence.snapshot_ref.available",
      "safety.challenge.absent"
    ],
    failure_mapping_id: "boss.job-search.failure-mapping",
    required_failure_classes: [
      "invalid_contract",
      "resource_unavailable",
      "site_changed",
      "empty_result",
      "not_logged_in",
      "identity_insufficient",
      "captcha_required",
      "page_not_ready",
      "input_missing_security_id",
      "query_missing",
      "city_unresolved",
      "pagination_limited",
      "job_expired",
      "permission_denied",
      "field_missing",
      "network_resource_unavailable"
    ],
    required_source_ref_kinds: ["network_summary"],
    required_evidence_ref_kinds: ["snapshot_ref", "network_summary_ref", "post_check_ref"],
    post_check_id: "boss.job-search.post-check",
    required_post_check_fields: ["status", "reason", "source_refs", "evidence_refs"]
  }
];

// HARBOR-252 keeps the merged Lode #268 detail contract separate from the
// immutable Lode #262 search pin.
const DETAIL_READ_OPERATIONS: readonly PinnedReadOperation[] = [
  {
    site_id: "xiaohongshu",
    operation_id: "xhs_read_note_detail",
    package_ref: "lode://site-capability/xiaohongshu/read-note-detail@0.1.0",
    lock_ref: "lode://lock/site-capability/xiaohongshu/read-note-detail@0.1.0",
    version: "0.1.0",
    operation_mode: "read",
    lifecycle: "proposed",
    allowed_origin: "https://www.xiaohongshu.com",
    target_schema: { pathname: "/explore/{opaque}", public_query_parameter: "keyword" },
    resource_requirement_id: "xiaohongshu.read-note-detail.resources",
    required_harbor_fact_keys: ["identity.user_logged_in.confirmed", "page.note_detail.ready", "safety.challenge.absent"],
    failure_mapping_id: "xiaohongshu.read-note-detail.failure-mapping",
    required_failure_classes: ["not_logged_in", "safety_challenge", "page_not_ready", "site_changed", "empty_result"],
    required_source_ref_kinds: ["pinia_store_summary", "network_summary", "dom_snapshot_summary"],
    required_evidence_ref_kinds: ["snapshot_ref", "post_check_ref"],
    post_check_id: "xiaohongshu.read-note-detail.post-check",
    required_post_check_fields: ["status", "reason", "source_refs", "evidence_refs"]
  },
  {
    site_id: "boss",
    operation_id: "boss_read_job_detail",
    package_ref: "lode://site-capability/boss/read-job-detail@0.1.1",
    lock_ref: "lode://lock/site-capability/boss/read-job-detail@0.1.1",
    version: "0.1.1",
    operation_mode: "read",
    lifecycle: "proposed",
    allowed_origin: "https://www.zhipin.com",
    target_schema: { pathname: "/job_detail/{opaque}.html", public_query_parameter: "query" },
    resource_requirement_id: "boss.read-job-detail.resources",
    required_harbor_fact_keys: ["identity.boss_geek_logged_in.confirmed", "page.job_detail.ready", "safety.challenge.absent"],
    failure_mapping_id: "boss.read-job-detail.failure-mapping",
    required_failure_classes: ["not_logged_in", "safety_challenge", "page_not_ready", "site_changed", "empty_result"],
    required_source_ref_kinds: ["wapi_job_detail_summary", "dom_snapshot_summary"],
    required_evidence_ref_kinds: ["snapshot_ref"],
    post_check_id: "boss.read-job-detail.post-check",
    required_post_check_fields: ["status", "reason", "source_refs", "evidence_refs"]
  }
];

export function admitAllowlistedReadOperation(input: unknown): AdmittedReadOperation | ReadOperationFailureClass {
  const request = parseRequest(input);
  if (typeof request === "string") return request;
  const detailEntry = DETAIL_READ_OPERATIONS.find((candidate) => candidate.site_id === request.site_id && candidate.operation_id === request.operation_id);
  if (detailEntry && validateDetailTruthPin()) return "allowlist_pin_invalid";
  const pinFailure = detailEntry ? null : validatePinnedAllowlist();
  if (pinFailure) return pinFailure;
  const entry = detailEntry ?? PINNED_READ_OPERATIONS.find((candidate) => candidate.site_id === request.site_id && candidate.operation_id === request.operation_id);
  if (!entry) return "operation_not_allowlisted";
  if (entry.operation_mode !== "read" || entry.lifecycle !== "proposed") return "allowlist_pin_invalid";
  if (detailEntry) return { status: "admitted", request, entry, target_url: "" };
  const target = resolveTargetUrl(request, entry);
  if (typeof target === "string") return target;
  return { status: "admitted", request, entry, target_url: target.target_url };
}

const PINNED_READ_OPERATION_MIRROR = {
  schema_version: HARBOR_ALLOWLISTED_READ_OPERATION_SCHEMA,
  lode_pin: {
    repository: LODE_262_ALLOWLIST_PIN.repository,
    commit: LODE_262_ALLOWLIST_PIN.commit,
    asset_path: LODE_262_ALLOWLIST_PIN.asset_path,
    asset_sha256: LODE_262_ALLOWLIST_PIN.asset_sha256,
    allowlist_id: LODE_262_ALLOWLIST_PIN.allowlist_id,
    allowlist_version: LODE_262_ALLOWLIST_PIN.allowlist_version,
    asset_owner: LODE_262_ALLOWLIST_PIN.asset_owner,
    consumer: LODE_262_ALLOWLIST_PIN.consumer
  },
  entries: PINNED_READ_OPERATIONS
} as const;

export function canonicalPinnedMirrorSha256(mirror: unknown = PINNED_READ_OPERATION_MIRROR): string {
  return createHash("sha256").update(canonicalJson(mirror)).digest("hex");
}

export function readOperationUnavailable(
  runtime_session_ref: string,
  failure_class: ReadOperationFailureClass,
  options: { site_id?: string; operation_id?: string; retryable?: boolean } = {}
): ReadOperationUnavailable {
  return {
    schema_version: HARBOR_ALLOWLISTED_READ_OPERATION_SCHEMA,
    status: "unavailable",
    failure_class,
    runtime_session_ref,
    site_id: options.site_id,
    operation_id: options.operation_id,
    retryable: options.retryable ?? retryableFailure(failure_class),
    public_boundary: PUBLIC_BOUNDARY
  };
}

function completeReadOperation(
  entry: PinnedReadOperation,
  proof: OperationProbeEvidence
): CompletedReadOperation | ReadOperationFailureClass {
  if (!proof.post_check_ref) return "post_check_missing";
  if (!proof.public_summary_ref || !isExpectedPublicSummary(entry, proof.public_summary)) return "public_summary_missing";
  if (proof.evidence_refs.length === 0 || proof.evidence_refs.some((ref) => !ref)) return "evidence_refs_missing";
  const exactXhsDetailRefs = entry.operation_id === "xhs_read_note_detail";
  if (exactXhsDetailRefs
    ? !hasRequiredObservedRefs(proof.source_refs, entry.required_source_ref_kinds)
    : !entry.required_source_ref_kinds.every((kind) => proof.source_refs.some((ref) => ref.kind === kind && ref.ref))) return "source_refs_missing";
  if (exactXhsDetailRefs
    ? !hasRequiredObservedRefs(proof.evidence_ref_kinds, entry.required_evidence_ref_kinds)
    : !entry.required_evidence_ref_kinds.every((kind) => proof.evidence_ref_kinds.some((ref) => ref.kind === kind && ref.ref))) return "evidence_refs_missing";
  return {
    schema_version: HARBOR_ALLOWLISTED_READ_OPERATION_SCHEMA,
    status: "completed",
    operation_ref: proof.operation_ref,
    runtime_session_ref: proof.runtime_session_ref,
    site_id: proof.site_id,
    operation_id: proof.operation_id,
    operation_mode: "read",
    observed_at: proof.observed_at,
    public_summary_ref: proof.public_summary_ref,
    public_summary: proof.public_summary,
    source_refs: proof.source_refs,
    evidence_refs: proof.evidence_refs,
    evidence_ref_kinds: proof.evidence_ref_kinds,
    post_check: {
      post_check_ref: proof.post_check_ref,
      status: "passed",
      reason: "managed_provider_read_probe_completed"
    },
    lode_pin: isDetailOperation(entry.operation_id) ? LODE_268_DETAIL_PIN : LODE_262_ALLOWLIST_PIN,
    public_boundary: PUBLIC_BOUNDARY
  };
}

export class ReadOperationObservationStore {
  private readonly records = new Map<string, ReadOperationObservationRecord>();

  capture(input: {
    operation_ref: string;
    runtime_session_ref: string;
    entry: PinnedReadOperation;
    observed_origin: string;
    observed_at: string;
    source_refs: readonly ReadOperationRef[];
    evidence_ref_kinds: readonly ReadOperationRef[];
    public_summary_source_ref: string;
    public_summary: LocalProviderReadProbePublicSummary;
  }): OperationProbeEvidence | ReadOperationFailureClass {
    if (input.observed_origin !== input.entry.allowed_origin) return "origin_drift";
    if (!isExpectedPublicSummary(input.entry, input.public_summary)) return "public_summary_missing";
    if (!hasRequiredObservedRefs(input.source_refs, input.entry.required_source_ref_kinds)) return "source_refs_missing";
    const observedEvidenceKinds = input.entry.required_evidence_ref_kinds.filter((kind) => kind !== "post_check_ref");
    if (!hasRequiredObservedRefs(input.evidence_ref_kinds, observedEvidenceKinds)) return "evidence_refs_missing";
    if (!input.source_refs.some((source) => source.ref === input.public_summary_source_ref)) return "public_summary_missing";

    const source_refs = [...input.source_refs];
    const evidence_ref_kinds = [...input.evidence_ref_kinds];
    const evidence_refs = evidence_ref_kinds.map((evidence) => evidence.ref);
    for (const source of source_refs) {
      this.records.set(source.ref, observationRecord(input, "source_observation", source.ref, { source_kind: source.kind }));
    }
    for (const evidence of evidence_ref_kinds) {
      this.records.set(evidence.ref, observationRecord(input, "operation_evidence", evidence.ref, {
        evidence_kind: evidence.kind,
        summary_source_ref: evidence.kind === "network_summary_ref" ? input.public_summary_source_ref : undefined
      }));
    }
    const public_summary_ref = opaqueRef("read_result");
    this.records.set(public_summary_ref, observationRecord(input, "operation_result_summary", public_summary_ref, {
      summary_source_ref: input.public_summary_source_ref,
      public_summary: input.public_summary
    }));
    const post_check_ref = opaqueRef("post_check");
    const postCheck = observationRecord(input, "post_check", post_check_ref, {
      post_check: {
        status: "passed",
        reason: "managed_provider_read_probe_completed",
        required_fields: input.entry.required_post_check_fields,
        source_refs,
        evidence_refs
      }
    });
    this.records.set(post_check_ref, postCheck);
    if (input.entry.required_evidence_ref_kinds.includes("post_check_ref")) {
      evidence_ref_kinds.push({ kind: "post_check_ref", ref: post_check_ref });
    }
    return {
      operation_ref: input.operation_ref,
      runtime_session_ref: input.runtime_session_ref,
      site_id: input.entry.site_id,
      operation_id: input.entry.operation_id,
      origin: input.observed_origin,
      observed_at: input.observed_at,
      public_summary_ref,
      public_summary_source_ref: input.public_summary_source_ref,
      public_summary: input.public_summary,
      source_refs,
      evidence_refs,
      evidence_ref_kinds,
      post_check_ref
    };
  }

  get(ref: string): ReadOperationObservationRecord | null {
    const record = this.records.get(ref);
    return record ? structuredClone(record) : null;
  }

  complete(entry: PinnedReadOperation, proof: OperationProbeEvidence): CompletedReadOperation | ReadOperationFailureClass {
    if (
      proof.site_id !== entry.site_id ||
      proof.operation_id !== entry.operation_id ||
      proof.origin !== entry.allowed_origin
    ) return "source_refs_missing";
    const postCheck = this.records.get(proof.post_check_ref);
    if (
      !postCheck ||
      postCheck.record_type !== "post_check" ||
      !postCheck.post_check ||
      !sameBinding(postCheck, proof) ||
      !sameRefs(postCheck.post_check.source_refs, proof.source_refs) ||
      !sameStrings(postCheck.post_check.evidence_refs, proof.evidence_refs)
    ) return "post_check_missing";
    const publicSummary = this.records.get(proof.public_summary_ref);
    if (
      !publicSummary ||
      publicSummary.record_type !== "operation_result_summary" ||
      publicSummary.summary_source_ref !== proof.public_summary_source_ref ||
      !proof.source_refs.some((source) => source.ref === proof.public_summary_source_ref) ||
      !publicSummary.public_summary ||
      !sameBinding(publicSummary, proof) ||
      !samePublicSummary(publicSummary.public_summary, proof.public_summary)
    ) return "public_summary_missing";
    for (const source of proof.source_refs) {
      const record = this.records.get(source.ref);
      if (!record || record.record_type !== "source_observation" || record.source_kind !== source.kind || !sameBinding(record, proof)) {
        return "source_refs_missing";
      }
    }
    for (const evidence of proof.evidence_ref_kinds) {
      const record = this.records.get(evidence.ref);
      if (evidence.kind === "post_check_ref") {
        if (evidence.ref !== proof.post_check_ref) return "post_check_missing";
      } else if (!record || record.record_type !== "operation_evidence" || record.evidence_kind !== evidence.kind || !sameBinding(record, proof)) {
        return "evidence_refs_missing";
      }
    }
    return completeReadOperation(entry, proof);
  }
}

function sameBinding(record: ReadOperationObservationRecord, proof: OperationProbeEvidence): boolean {
  return record.operation_ref === proof.operation_ref &&
    record.runtime_session_ref === proof.runtime_session_ref &&
    record.site_id === proof.site_id &&
    record.operation_id === proof.operation_id &&
    record.origin === proof.origin &&
    record.observed_at === proof.observed_at;
}

function sameRefs(left: readonly ReadOperationRef[], right: readonly ReadOperationRef[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry.kind === right[index]?.kind && entry.ref === right[index]?.ref);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function samePublicSummary(left: LocalProviderReadProbePublicSummary, right: LocalProviderReadProbePublicSummary): boolean {
  return left.schema_version === right.schema_version &&
    left.operation_id === right.operation_id &&
    left.result_kind === right.result_kind &&
    left.surface === right.surface &&
    left.result_state === right.result_state &&
    left.response_status === right.response_status &&
    left.result_count === right.result_count &&
    sameNormalizedSummary(left.normalized, right.normalized) &&
    sameStrings(left.detail_refs ?? [], right.detail_refs ?? []) &&
    JSON.stringify(left.items ?? []) === JSON.stringify(right.items ?? []) &&
    sameStrings(left.source_signals, right.source_signals);
}

function observationRecord(
  input: {
    operation_ref: string;
    runtime_session_ref: string;
    entry: PinnedReadOperation;
    observed_origin: string;
    observed_at: string;
  },
  record_type: ReadOperationObservationRecord["record_type"],
  ref: string,
  detail: Pick<ReadOperationObservationRecord, "source_kind" | "evidence_kind" | "summary_source_ref" | "public_summary" | "post_check">
): ReadOperationObservationRecord {
  return {
    schema_version: "harbor-read-operation-observation/v0",
    record_type,
    ref,
    operation_ref: input.operation_ref,
    runtime_session_ref: input.runtime_session_ref,
    site_id: input.entry.site_id,
    operation_id: input.entry.operation_id,
    origin: input.observed_origin,
    observed_at: input.observed_at,
    ...detail,
    public_boundary: PUBLIC_BOUNDARY
  };
}

function hasRequiredObservedRefs(refs: readonly ReadOperationRef[], requiredKinds: readonly string[]): boolean {
  const kinds = new Set(refs.map((ref) => ref.kind));
  return refs.length === kinds.size &&
    refs.every((ref) => isOpaqueRef(ref.ref)) &&
    requiredKinds.every((kind) => kinds.has(kind)) &&
    [...kinds].every((kind) => requiredKinds.includes(kind));
}

function isOpaqueRef(value: string): boolean {
  return /^[a-z][a-z0-9_]*_[0-9a-f-]{36}$/i.test(value);
}

function parseRequest(input: unknown): AllowlistedReadOperationRequest | ReadOperationFailureClass {
  if (!isRecord(input)) return "invalid_request";
  const allowedKeys = new Set(["site_id", "operation_id", "query", "city_code", "limit", "detail_ref", "url", "holder_ref"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return "invalid_request";
  if (!isSiteId(input.site_id) || !isOperationId(input.operation_id)) return "invalid_request";
  const detail = input.operation_id === "xhs_read_note_detail" || input.operation_id === "boss_read_job_detail";
  if (detail ? !isPublicText(input.detail_ref) : (!isPublicText(input.query) || input.query.length > 256)) return "invalid_request";
  if (detail && (input.query !== undefined || input.city_code !== undefined || input.url !== undefined)) return "invalid_request";
  if (input.operation_id === "boss_job_search" && (typeof input.city_code !== "string" || !/^\d{6,32}$/.test(input.city_code))) return "city_unresolved";
  if (input.operation_id !== "boss_job_search" && input.city_code !== undefined) return "invalid_request";
  if (input.limit !== undefined && (typeof input.limit !== "number" || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 15)) return "invalid_request";
  if (input.operation_id !== "xhs_search_notes" && input.limit !== undefined) return "invalid_request";
  if (input.url !== undefined && (!isPublicText(input.url) || input.url.length > 2048)) return "invalid_request";
  if (input.holder_ref !== undefined && (!isPublicText(input.holder_ref) || input.holder_ref.length > 200)) return "invalid_request";
  return {
    site_id: input.site_id,
    operation_id: input.operation_id,
    query: typeof input.query === "string" ? input.query : undefined,
    city_code: typeof input.city_code === "string" ? input.city_code : undefined,
    limit: typeof input.limit === "number" ? input.limit : undefined,
    detail_ref: typeof input.detail_ref === "string" ? input.detail_ref : undefined,
    url: input.url,
    holder_ref: typeof input.holder_ref === "string" ? input.holder_ref : undefined
  };
}

function resolveTargetUrl(
  request: AllowlistedReadOperationRequest,
  entry: PinnedReadOperation
): { target_url: string } | ReadOperationFailureClass {
  const derived = deriveTargetUrl(request, entry);
  if (request.url) {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return "target_url_invalid";
    }
    if (url.protocol !== "https:" || url.username || url.password) return "target_url_invalid";
    if (url.origin !== entry.allowed_origin) return "target_origin_not_allowed";
    if (
      entry.operation_id === "xhs_search_notes" &&
      (url.pathname === "/search_result" || url.pathname === "/search_result/")
    ) {
      const sourced = new URL(derived);
      sourced.pathname = url.pathname;
      if (url.toString() === sourced.toString()) {
        return { target_url: sourced.toString() };
      }
    }
    if (!matchesTargetSchema(url, entry) || url.toString() !== derived) return "target_path_not_allowlisted";
  }
  return { target_url: derived };
}

function deriveTargetUrl(request: AllowlistedReadOperationRequest, entry: PinnedReadOperation): string {
  const url = new URL(entry.target_schema.pathname, entry.allowed_origin);
  url.searchParams.set(entry.target_schema.public_query_parameter, request.query!);
  if (entry.operation_id === "xhs_search_notes") url.searchParams.set("source", "web_search_result_notes");
  if (entry.target_schema.public_city_parameter) url.searchParams.set(entry.target_schema.public_city_parameter, request.city_code!);
  return url.toString();
}

function matchesTargetSchema(url: URL, entry: PinnedReadOperation): boolean {
  const schema = entry.target_schema;
  if (url.pathname !== schema.pathname || url.hash) return false;
  const keys = [...url.searchParams.keys()];
  const expectedKeys = schema.public_city_parameter
    ? [schema.public_query_parameter, schema.public_city_parameter]
    : [schema.public_query_parameter];
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]) &&
    expectedKeys.every((key) => Boolean(url.searchParams.get(key)));
}

export function validatePinnedAllowlist(mirror: unknown = PINNED_READ_OPERATION_MIRROR): ReadOperationFailureClass | null {
  if (
    LODE_262_ALLOWLIST_PIN.repository !== "WebEnvoy/Lode" ||
    LODE_262_ALLOWLIST_PIN.commit !== "e36a4a7" ||
    LODE_262_ALLOWLIST_PIN.asset_path !== "registry/runtime-consumption-allowlist.json" ||
    !/^[a-f0-9]{64}$/.test(LODE_262_ALLOWLIST_PIN.asset_sha256) ||
    canonicalPinnedMirrorSha256(mirror) !== LODE_262_ALLOWLIST_PIN.mirror_payload_sha256 ||
    !isRecord(mirror) ||
    !Array.isArray(mirror.entries) ||
    mirror.entries.length !== 2
  ) return "allowlist_pin_invalid";
  for (const entry of PINNED_READ_OPERATIONS) {
    if (
      entry.operation_mode !== "read" ||
      entry.lifecycle !== "proposed" ||
      !entry.package_ref ||
      !entry.lock_ref ||
      !entry.resource_requirement_id ||
      !entry.failure_mapping_id ||
      !entry.post_check_id ||
      entry.required_harbor_fact_keys.length === 0 ||
      entry.required_failure_classes.length === 0 ||
      entry.required_source_ref_kinds.length === 0 ||
      entry.required_evidence_ref_kinds.length === 0 ||
      entry.required_post_check_fields.length !== 4 ||
      !entry.target_schema.pathname.startsWith("/") ||
      !isPinnedHttpsOrigin(entry.allowed_origin)
    ) return "allowlist_pin_invalid";
  }
  return null;
}

export function validateDetailTruthPin(): ReadOperationFailureClass | null {
  if (
    LODE_268_DETAIL_PIN.repository !== "WebEnvoy/Lode" ||
    LODE_268_DETAIL_PIN.issue !== "#268" ||
    LODE_268_DETAIL_PIN.merge_commit !== "66d79b4e600565a00515b1c801e84291edc7b0c1" ||
    LODE_268_DETAIL_PIN.asset_path !== "registry/detail-runtime-consumption.json" ||
    LODE_268_DETAIL_PIN.asset_sha256 !== "dca2761b7feb09a0ab86f7202e153da3c97b21a75299af6adaf64eade319deef" ||
    LODE_268_DETAIL_PIN.truth_id !== "lode.xhs-boss.detail-read.runtime-consumption" ||
    DETAIL_READ_OPERATIONS.length !== 2
  ) return "allowlist_pin_invalid";
  const xhs = DETAIL_READ_OPERATIONS.find((entry) => entry.operation_id === "xhs_read_note_detail");
  const boss = DETAIL_READ_OPERATIONS.find((entry) => entry.operation_id === "boss_read_job_detail");
  return xhs && boss &&
    sameStrings(xhs.required_source_ref_kinds, ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]) &&
    sameStrings(xhs.required_evidence_ref_kinds, ["snapshot_ref", "post_check_ref"]) &&
    boss.package_ref === "lode://site-capability/boss/read-job-detail@0.1.1" && boss.lock_ref === "lode://lock/site-capability/boss/read-job-detail@0.1.1" && boss.version === "0.1.1" &&
    sameStrings(boss.required_source_ref_kinds, ["wapi_job_detail_summary", "dom_snapshot_summary"]) &&
    sameStrings(boss.required_evidence_ref_kinds, ["snapshot_ref"])
    ? null : "allowlist_pin_invalid";
}

function isExpectedPublicSummary(entry: PinnedReadOperation, summary: LocalProviderReadProbePublicSummary): boolean {
  if (summary.operation_id !== entry.operation_id || summary.source_signals.length === 0) return false;
  if (summary.result_state !== "operation_read_response_observed" || !Number.isInteger(summary.response_status) || summary.response_status < 200 || summary.response_status >= 300) return false;
  if (entry.operation_id === "xhs_search_notes") {
    return summary.schema_version === "harbor-read-operation-public-summary/v1" &&
      summary.result_kind === "xiaohongshu_search_notes_surface" &&
      summary.surface === "search_result" &&
      Number.isInteger(summary.result_count) && summary.result_count! > 0 && summary.result_count! <= 15 &&
      validXhsSearchItems(summary) &&
      sameStrings(summary.source_signals, ["pinia_store", "xhs_search_read_network"]);
  }
  if (summary.schema_version !== "harbor-read-operation-public-summary/v0") return false;
  if (entry.operation_id === "xhs_read_note_detail") {
    return summary.result_kind === "xiaohongshu_note_detail_surface" && summary.surface === "note_detail" &&
      validXhsDetailSummary(summary.normalized) &&
      sameStrings(summary.source_signals, ["pinia_note_store_ready", "xhs_note_detail_document", "xhs_note_detail_rendered"]);
  }
  if (entry.operation_id === "boss_read_job_detail") {
    return summary.result_kind === "boss_job_detail_surface" && summary.surface === "job_detail" &&
      validBossDetailSummary(summary.normalized) &&
      sameStrings(summary.source_signals, ["boss_job_detail_document"]);
  }
  return summary.result_kind === "boss_job_search_surface" &&
    summary.surface === "web_geek_jobs" &&
    typeof summary.query === "string" && summary.query.length > 0 &&
    typeof summary.city_code === "string" && /^\d{6,}$/.test(summary.city_code) &&
    summary.business_code === 0 &&
    Number.isInteger(summary.job_count) && summary.job_count! > 0 &&
    sameStrings(summary.source_signals, ["boss_wapi_zpgeek_read_network"]);
}

function retryableFailure(failure: ReadOperationFailureClass): boolean {
  return ![
    "invalid_request",
    "operation_not_allowlisted",
    "allowlist_pin_invalid",
    "target_url_invalid",
    "target_origin_not_allowed",
    "target_path_not_allowlisted",
    "fixture_runtime",
    "origin_drift",
    "safety_challenge"
  ].includes(failure);
}

function isPinnedHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPublicText(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSiteId(value: unknown): value is AllowlistedReadOperationSite {
  return value === "xiaohongshu" || value === "boss";
}

function validXhsSearchItems(summary: LocalProviderReadProbePublicSummary): boolean {
  const refs = summary.detail_refs ?? [];
  const items = summary.items ?? [];
  const itemKeys = new Set(["detail_ref", "title", "author_display_name", "interaction_metrics"]);
  const metricKeys = new Set(["likes", "comments", "collects"]);
  return refs.length === summary.result_count && items.length === refs.length && items.every((item, index) => {
    if (
      Object.keys(item).some((key) => !itemKeys.has(key)) ||
      item.detail_ref !== refs[index] ||
      !safePublicText(item.title, 200) ||
      (item.author_display_name !== undefined && !safePublicText(item.author_display_name, 100))
    ) return false;
    const metrics = item.interaction_metrics;
    return metrics === undefined || (
      Object.keys(metrics).length > 0 &&
      Object.keys(metrics).every((key) => metricKeys.has(key)) &&
      Object.values(metrics).every((value) => boundedMetric(value))
    );
  });
}

function safePublicText(value: unknown, max: number): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/(?:^|[^a-z0-9_-])(?:[a-z0-9_-]*token|cookie|authorization|password|passwd|secret|credential|profile[_-]?storage|raw[_-]?(?:dom|har)|network[_-]?response[_-]?body)\s*[=:]\s*\S+/i.test(value) &&
    !/\bbearer\s+\S+/i.test(value);
}

function boundedMetric(value: unknown): boolean {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 40 &&
    value.trim() === value &&
    /^[0-9０-９.,+\-\s万千百wWkKmM]+$/u.test(value);
}

function isOperationId(value: unknown): value is AllowlistedReadOperationId {
  return value === "xhs_search_notes" || value === "boss_job_search" || value === "xhs_read_note_detail" || value === "boss_read_job_detail";
}

function isDetailOperation(value: AllowlistedReadOperationId): boolean {
  return value === "xhs_read_note_detail" || value === "boss_read_job_detail";
}

function sameNormalizedSummary(left: LocalProviderReadProbePublicSummary["normalized"], right: LocalProviderReadProbePublicSummary["normalized"]): boolean {
  return left === undefined && right === undefined || JSON.stringify(left) === JSON.stringify(right);
}

function validXhsDetailSummary(value: LocalProviderReadProbePublicSummary["normalized"]): boolean {
  return value?.kind === "xiaohongshu_note_detail" && validCanonicalPublicUrl(value.canonical_url, "https://www.xiaohongshu.com") &&
    /^[a-f0-9]{24}$/i.test(value.note_id) && value.canonical_url.endsWith(`/explore/${value.note_id}`) &&
    validBoundedText(value.title, 200) && validBoundedText(value.summary, 2000) && validBoundedText(value.body_summary, 4000) &&
    validBoundedText(value.author.display_name, 100) && validBoundedText(value.author.author_id, 100) &&
    value.author.profile_url === `https://www.xiaohongshu.com/user/profile/${value.author.author_id}` &&
    Object.values(value.interaction_metrics).every((entry) => validBoundedText(entry, 40)) &&
    value.source_citation.kind === "xhs_note_detail_ref" && value.source_citation.note_id === value.note_id && value.source_citation.url === value.canonical_url &&
    validFieldSources(value.source_citation.field_sources, ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]) &&
    (value.source_status === "located" || value.source_status === "partially_located");
}

function validBossDetailSummary(value: LocalProviderReadProbePublicSummary["normalized"]): boolean {
  return value?.kind === "boss_job_detail" && validCanonicalPublicUrl(value.canonical_url, "https://www.zhipin.com") &&
    /^detail_ref_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.detail_ref) &&
    validBoundedText(value.title, 200) && validBoundedText(value.summary, 2000) && validBoundedText(value.job.title, 200) &&
    validBoundedText(value.job.description, 4000) && validBoundedText(value.job.status, 100) && validOptionalText(value.job.salary, 100) && validOptionalText(value.job.location, 100) &&
    validBoundedText(value.company.name, 200) && validBoundedText(value.recruiter.name, 100) && validBoundedText(value.recruiter.title, 100) &&
    value.source_citation.kind === "boss_job_detail_ref" && value.source_citation.detail_ref === value.detail_ref && value.source_citation.url === value.canonical_url &&
    validFieldSources(value.source_citation.field_sources, ["wapi_job_detail_summary", "dom_snapshot_summary"]) &&
    (value.source_status === "located" || value.source_status === "partially_located");
}

function validCanonicalPublicUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === origin && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

function validBoundedText(value: string, max: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function validOptionalText(value: string | undefined, max: number): boolean {
  return value === undefined || validBoundedText(value, max);
}

function validFieldSources(value: readonly string[], expected: readonly string[]): boolean {
  return value.length === expected.length && value.every((entry, index) => entry === expected[index]);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
