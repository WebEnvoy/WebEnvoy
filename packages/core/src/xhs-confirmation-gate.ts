import { createHash } from "node:crypto";

import type { HarborAdmissionInput, RuntimeSessionBindingFacts } from "./harbor-admission.js";
import { validateHarborAdmission, validateHarborRuntimeBinding } from "./harbor-admission.js";
import { validateLodePackageAdmission, type LodePackageAdmissionContract, type LodeRequiredHarborFact, type XhsMediaActionId } from "./lode-admission.js";
import { isExactXhsMediaActionRun, isExactXhsMediaActionTask } from "./media-action-policy.js";
import type { FailureRecord, FileRunRecordStore, RunRecord } from "./run-record-store.js";
import { validateTaskIntent, type TaskIntentEnvelope } from "./task-submission.js";
import type { HarborRuntimeClient, RuntimeTaskSubmissionDependencies, RuntimeTaskSubmissionRequest } from "./runtime-task-chain.js";

type JsonObject = Record<string, unknown>;

const confirmationContextSchemaVersion = "webenvoy.xhs-confirmation-context/v0" as const;
const observationSchemaVersion = "harbor-xhs-public-observation/v0" as const;
const observationOperationSchemaVersion = "harbor-validate-only-write-precheck/v0" as const;
const observationTtlMs = 10 * 60 * 1_000;
const summaryMaxLength = 280;

const publicObservationIssueCodes = new Set([
  "account_unknown",
  "account_mismatch",
  "business_target_unknown",
  "business_target_mismatch",
  "image_count_unknown",
  "image_order_unknown",
  "image_order_mismatch",
  "title_unknown",
  "title_mismatch",
  "body_unknown",
  "body_mismatch",
  "page_fingerprint_unknown",
  "page_changed",
  "page_diff_unknown"
]);

const confirmationIssueCodes = new Set([
  "account_unknown",
  "account_mismatch",
  "business_target_unknown",
  "business_target_mismatch",
  "page_unknown",
  "page_stale",
  "media_unknown",
  "media_mismatch",
  "fields_unknown",
  "fields_mismatch",
  "observation_stale",
  "observation_generation_changed",
  "runtime_binding_mismatch",
  "runtime_binding_missing",
  "runtime_session_busy",
  "runtime_session_unavailable",
  "runtime_ref_expired",
  "runtime_ref_mismatch",
  "snapshot_missing",
  "evidence_missing",
  "confirmation_context_missing",
  "confirmation_observation_invalid",
  "confirmation_observation_unavailable"
]);

const collectorFactKeys = new Set([
  "runtime.execution_surface.available",
  "safety.challenge.absent"
]);

export type XhsPublicObservationExpected = {
  account_ref?: string;
  business_target_ref?: string;
  title?: string;
  body?: string;
  media_refs?: readonly string[];
};

export type XhsConfirmationContext = {
  schema_version: typeof confirmationContextSchemaVersion;
  status: "ready" | "blocked";
  runtime_binding: {
    runtime_session_ref: string;
    identity_environment_ref: string;
    profile_ref: string;
    provider_ref: string;
    control_owner: "core_task";
    observation_generation: string;
    observation_ref: string;
  };
  account: {
    status: "verified" | "unknown" | "mismatch";
    account_ref: string | null;
    label: string | null;
  };
  business_target: {
    status: "verified" | "unknown" | "mismatch";
    target_ref: string | null;
    label: string | null;
  };
  page: {
    status: "verified" | "unknown" | "stale";
    url: string;
    fingerprint: string | null;
    diff: "unchanged" | "changed" | "unknown";
  };
  media: {
    status: "verified" | "unknown" | "mismatch";
    image_count: number | null;
    ordered_item_refs: string[];
    summary: string | null;
  };
  fields: {
    status: "verified" | "unknown" | "mismatch";
    title: { state: "empty" | "present" | "unknown"; length: number | null; summary: string | null };
    body: { state: "empty" | "present" | "unknown"; length: number | null; summary: string | null };
  };
  pending_issues: string[];
  observed_at: string;
  fingerprint: string;
  fail_closed: true;
};

export type XhsConfirmationObservationSuccess = {
  ok: true;
  admission: HarborAdmissionInput;
  runtime_session_ref: string;
  runtime_binding_refs: readonly string[];
  evidence_refs: readonly string[];
  runtime_session_binding: RuntimeSessionBindingFacts;
  confirmation_context: XhsConfirmationContext;
  operation: JsonObject;
};

export type XhsConfirmationObservationFailure = {
  ok: false;
  failure: FailureRecord;
  admission?: HarborAdmissionInput;
  runtime_session_ref?: string;
  runtime_binding_refs?: readonly string[];
  evidence_refs?: readonly string[];
  runtime_session_binding?: RuntimeSessionBindingFacts;
  cleanup_failure?: FailureRecord;
  confirmation_context?: XhsConfirmationContext;
};

export type CollectXhsConfirmationObservationRequest = {
  run_id: string;
  task_intent: TaskIntentEnvelope;
  package_ref: string;
  action_id: XhsMediaActionId;
  required_harbor_facts: readonly LodeRequiredHarborFact[];
  harbor?: RuntimeTaskSubmissionRequest["harbor"];
  runtime_session_ref?: string;
  expected_binding?: RuntimeSessionBindingFacts;
  expected_generation?: string;
  expected_business_target_ref: string;
  expected_observation?: XhsPublicObservationExpected;
  client: HarborRuntimeClient;
  clock?: () => Date;
};

export type XhsMediaActionConfirmationPreflightRequest = {
  run_id: string;
  task_intent: unknown;
  package_ref: string;
  harbor?: RuntimeTaskSubmissionRequest["harbor"];
  confirmation_decision_ref?: string;
  expected_business_target_ref?: string;
};

export type XhsMediaActionConfirmationPreflightResult =
  | { ok: true; confirmation_context: XhsConfirmationContext; run_record: RunRecord }
  | { ok: false; failure: FailureRecord; confirmation_context?: XhsConfirmationContext; run_record?: RunRecord };

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isFailure(value: unknown): value is FailureRecord {
  const candidate = object(value);
  return typeof candidate?.category === "string" && typeof candidate.code === "string";
}

function failure(code: string, recoveryHint: string): FailureRecord {
  return {
    category: "action_risk",
    code,
    phase: "admission",
    recovery_hint: recoveryHint
  };
}

function safeSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= summaryMaxLength ? normalized : `${normalized.slice(0, summaryMaxLength - 1)}…`;
}

function safePublicRef(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 200 &&
    /^[A-Za-z][A-Za-z0-9._:/-]*$/.test(value) ? value : null;
}

function safeLabel(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 96 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.trim().length > 0 ? value.trim() : null;
}

function expectedMatch(value: unknown): value is "matched" | "mismatched" | "unknown" {
  return value === "matched" || value === "mismatched" || value === "unknown";
}

function validLabelObservation(value: unknown): boolean {
  const candidate = object(value);
  if (!candidate || Object.keys(candidate).sort().join(",") !== "expected_match,label,ref,status") return false;
  const status = candidate.status === "observed" || candidate.status === "unknown";
  const label = candidate.label === null || safeLabel(candidate.label) !== null;
  const ref = candidate.ref === null || safePublicRef(candidate.ref) !== null;
  const hasValue = candidate.label !== null || candidate.ref !== null;
  return status && label && ref && expectedMatch(candidate.expected_match) &&
    (candidate.status === "observed" ? hasValue : candidate.label === null && candidate.ref === null);
}

function validFieldObservation(value: unknown): boolean {
  const candidate = object(value);
  const summary = object(candidate?.summary);
  if (!candidate || !summary || Object.keys(candidate).sort().join(",") !== "expected_match,status,summary" ||
    Object.keys(summary).sort().join(",") !== "fingerprint,length,state") return false;
  const status = candidate.status === "observed" || candidate.status === "unknown" || candidate.status === "mismatch";
  const state = summary.state === "empty" || summary.state === "present" || summary.state === "unknown";
  const length = summary.length === null || (typeof summary.length === "number" && Number.isInteger(summary.length) && summary.length >= 0 && summary.length <= 2_000);
  const fingerprint = summary.fingerprint === null || (typeof summary.fingerprint === "string" && /^fnv1a:[0-9a-f]{8}$/.test(summary.fingerprint));
  return status && state && length && fingerprint && expectedMatch(candidate.expected_match);
}

type HarborPublicObservation = {
  schema_version: typeof observationSchemaVersion;
  status: "observed" | "unknown";
  account: { status: "observed" | "unknown"; label: string | null; ref: string | null; expected_match: "matched" | "mismatched" | "unknown" };
  business_target: { status: "observed" | "unknown"; label: string | null; ref: string | null; expected_match: "matched" | "mismatched" | "unknown" };
  media: { image_count: number | null; order_status: "observed" | "unknown"; ordered_item_refs: string[]; expected_match: "matched" | "mismatched" | "unknown" };
  fields: {
    title: { status: "observed" | "unknown" | "mismatch"; summary: { state: "empty" | "present" | "unknown"; length: number | null; fingerprint: string | null }; expected_match: "matched" | "mismatched" | "unknown" };
    body: { status: "observed" | "unknown" | "mismatch"; summary: { state: "empty" | "present" | "unknown"; length: number | null; fingerprint: string | null }; expected_match: "matched" | "mismatched" | "unknown" };
  };
  page: { fingerprint: string | null; diff: "unchanged" | "changed" | "unknown" };
  pending_issue_codes: string[];
  submitted: false;
};

function validPublicObservation(value: unknown): value is HarborPublicObservation {
  const observation = object(value);
  const media = object(observation?.media);
  const fields = object(observation?.fields);
  const page = object(observation?.page);
  const refs = Array.isArray(media?.ordered_item_refs) ? media.ordered_item_refs : undefined;
  const imageCountValid = media?.image_count === null || (typeof media?.image_count === "number" && Number.isInteger(media.image_count) && media.image_count >= 0 && media.image_count <= 100);
  const orderValid = media?.order_status === "observed" || media?.order_status === "unknown";
  const refsValid = refs !== undefined && refs.length <= 100 && new Set(refs).size === refs.length && refs.every((ref) => safePublicRef(ref) !== null);
  const orderConsistent = orderValid && refsValid && (media?.order_status === "unknown"
    ? refs.length === 0
    : typeof media?.image_count === "number" && refs.length === media.image_count);
  const pending = Array.isArray(observation?.pending_issue_codes) ? observation.pending_issue_codes : undefined;
  return Boolean(observation && Object.keys(observation).sort().join(",") === "account,business_target,fields,media,page,pending_issue_codes,schema_version,status,submitted" &&
    observation.schema_version === observationSchemaVersion && (observation.status === "observed" || observation.status === "unknown") &&
    validLabelObservation(observation.account) && validLabelObservation(observation.business_target) &&
    media && Object.keys(media).sort().join(",") === "expected_match,image_count,order_status,ordered_item_refs" && imageCountValid && orderConsistent && expectedMatch(media.expected_match) &&
    fields && Object.keys(fields).sort().join(",") === "body,title" && validFieldObservation(fields.title) && validFieldObservation(fields.body) &&
    page && Object.keys(page).sort().join(",") === "diff,fingerprint" &&
    (page.fingerprint === null || (typeof page.fingerprint === "string" && /^fnv1a:[0-9a-f]{8}$/.test(page.fingerprint))) &&
    (page.diff === "unchanged" || page.diff === "changed" || page.diff === "unknown") &&
    pending !== undefined && pending.length <= 8 && new Set(pending).size === pending.length && pending.every((code) => publicObservationIssueCodes.has(code)) &&
    observation.status === (pending.length === 0 ? "observed" : "unknown") && observation.submitted === false);
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function runtimeBindingMatches(actual: RuntimeSessionBindingFacts, expected: RuntimeSessionBindingFacts): boolean {
  return actual.schema_version === expected.schema_version &&
    actual.identity_environment_ref === expected.identity_environment_ref &&
    actual.execution_identity_ref === expected.execution_identity_ref &&
    actual.runtime_session_ref === expected.runtime_session_ref &&
    actual.profile_ref === expected.profile_ref &&
    actual.provider_ref === expected.provider_ref &&
    actual.provider_mode === expected.provider_mode &&
    actual.lifecycle_state === expected.lifecycle_state &&
    actual.control_owner === expected.control_owner &&
    actual.session_use === expected.session_use &&
    actual.core_task_run === true && expected.core_task_run === true;
}

function contextFingerprint(context: Omit<XhsConfirmationContext, "fingerprint">): string {
  return hash({
    runtime_binding: context.runtime_binding,
    account: context.account,
    business_target: context.business_target,
    page: context.page,
    media: context.media,
    fields: context.fields,
    pending_issues: context.pending_issues,
    observed_at: context.observed_at
  });
}

function fieldDisplaySummary(summary: HarborPublicObservation["fields"]["title"]["summary"]): string | null {
  if (summary.state === "unknown" || summary.length === null) return null;
  return safeSummary(`${summary.state === "present" ? "已填写" : "为空"}（${summary.length} 字符）`);
}

function observationRef(operation: JsonObject): string {
  return safePublicRef(operation.operation_ref) ?? safePublicRef(operation.result_ref) ?? safePublicRef(operation.page_ref) ?? "unknown";
}

function blockedContext(
  binding: RuntimeSessionBindingFacts,
  taskUrl: string,
  observedAt: string,
  generation: string,
  ref: string,
  pendingIssues: readonly string[],
  observation: HarborPublicObservation | undefined,
  expected?: XhsPublicObservationExpected
): XhsConfirmationContext {
  const account = observation?.account;
  const target = observation?.business_target;
  const page = observation?.page;
  const media = observation?.media;
  const fields = observation?.fields;
  const context: Omit<XhsConfirmationContext, "fingerprint"> = {
    schema_version: confirmationContextSchemaVersion,
    status: "blocked",
    runtime_binding: {
      runtime_session_ref: binding.runtime_session_ref,
      identity_environment_ref: binding.identity_environment_ref,
      profile_ref: binding.profile_ref,
      provider_ref: binding.provider_ref,
      control_owner: "core_task",
      observation_generation: generation,
      observation_ref: ref
    },
    account: {
      status: account?.expected_match === "mismatched" ? "mismatch" : account?.status === "observed" && account.ref &&
        (expected?.account_ref === undefined || account.expected_match === "matched") ? "verified" : "unknown",
      account_ref: account?.ref ?? null,
      label: account?.label ?? null
    },
    business_target: {
      status: target?.expected_match === "mismatched" ? "mismatch" : target?.status === "observed" && target.ref && target.expected_match === "matched" ? "verified" : "unknown",
      target_ref: target?.ref ?? expected?.business_target_ref ?? null,
      label: target?.label ?? null
    },
    page: {
      status: page?.diff === "changed" ? "stale" : page?.fingerprint && page.diff === "unchanged" ? "verified" : "unknown",
      url: taskUrl,
      fingerprint: page?.fingerprint ?? null,
      diff: page?.diff ?? "unknown"
    },
    media: {
      status: media?.expected_match === "mismatched" ? "mismatch" : media?.order_status === "observed" && typeof media.image_count === "number" && media.ordered_item_refs.length === media.image_count &&
        (expected?.media_refs === undefined || media.expected_match === "matched") ? "verified" : "unknown",
      image_count: media?.image_count ?? null,
      ordered_item_refs: media?.ordered_item_refs ? [...media.ordered_item_refs] : [],
      summary: media && media.order_status === "observed" && typeof media.image_count === "number" ? safeSummary(`${media.image_count} 张图片，顺序已核对`) : null
    },
    fields: {
      status: fields?.title.status === "mismatch" || fields?.body.status === "mismatch" ||
        expected?.title !== undefined && fields?.title.expected_match === "mismatched" ||
        expected?.body !== undefined && fields?.body.expected_match === "mismatched" ? "mismatch" :
        fields?.title.status === "observed" && fields.body.status === "observed" &&
        (expected?.title === undefined || fields.title.expected_match === "matched") &&
        (expected?.body === undefined || fields.body.expected_match === "matched") ? "verified" : "unknown",
      title: {
        state: fields?.title.summary.state ?? "unknown",
        length: fields?.title.summary.length ?? null,
        summary: fields ? fieldDisplaySummary(fields.title.summary) : null
      },
      body: {
        state: fields?.body.summary.state ?? "unknown",
        length: fields?.body.summary.length ?? null,
        summary: fields ? fieldDisplaySummary(fields.body.summary) : null
      }
    },
    pending_issues: [...new Set(pendingIssues.filter((issue) => confirmationIssueCodes.has(issue)))],
    observed_at: observedAt,
    fail_closed: true
  };
  return { ...context, fingerprint: contextFingerprint(context) };
}

function requiredBlockers(actionId: XhsMediaActionId, context: XhsConfirmationContext): string[] {
  const blockers: string[] = [];
  if (context.account.status !== "verified") blockers.push(context.account.status === "mismatch" ? "account_mismatch" : "account_unknown");
  if (context.business_target.status !== "verified") blockers.push(context.business_target.status === "mismatch" ? "business_target_mismatch" : "business_target_unknown");
  if (context.page.status !== "verified") blockers.push(context.page.status === "stale" ? "page_stale" : "page_unknown");
  const needsMedia = actionId.endsWith(".save_draft") || actionId.endsWith(".publish");
  const needsFields = actionId === "xhs_publish_note_image_text_fields.compose" || actionId.endsWith(".save_draft") || actionId.endsWith(".publish");
  if (needsMedia && context.media.status !== "verified") blockers.push(context.media.status === "mismatch" ? "media_mismatch" : "media_unknown");
  if (needsFields && context.fields.status !== "verified") blockers.push(context.fields.status === "mismatch" ? "fields_mismatch" : "fields_unknown");
  return blockers;
}

export function expectedXhsObservationForTask(taskIntent: TaskIntentEnvelope, actionId: XhsMediaActionId, context?: XhsConfirmationContext): XhsPublicObservationExpected {
  const refs = actionId === "xhs_publish_note_image_text_media.image_upload" && Array.isArray(taskIntent.input.refs)
    ? taskIntent.input.refs
    : context?.media.status === "verified" ? context.media.ordered_item_refs : undefined;
  return {
    ...(context?.account.status !== "verified" || context.account.account_ref === null || context.account.account_ref === undefined ? {} : { account_ref: context.account.account_ref }),
    ...(context?.business_target.status !== "verified" || context.business_target.target_ref === null || context.business_target.target_ref === undefined ? {} : { business_target_ref: context.business_target.target_ref }),
    ...(refs === undefined || refs.length === 0 ? {} : { media_refs: [...refs] })
  };
}

function contextWithStatus(
  base: XhsConfirmationContext,
  status: "ready" | "blocked",
  pendingIssues: readonly string[]
): XhsConfirmationContext {
  const context: Omit<XhsConfirmationContext, "fingerprint"> = {
    ...base,
    status,
    pending_issues: [...new Set(pendingIssues.filter((issue) => confirmationIssueCodes.has(issue)))]
  };
  return { ...context, fingerprint: contextFingerprint(context) };
}

function confirmationIssueForFailure(code: string): string {
  return confirmationIssueCodes.has(code) ? code : "confirmation_observation_unavailable";
}

function isConfirmationContext(value: unknown): value is XhsConfirmationContext {
  const context = object(value);
  const binding = object(context?.runtime_binding);
  const account = object(context?.account);
  const target = object(context?.business_target);
  const page = object(context?.page);
  const media = object(context?.media);
  const fields = object(context?.fields);
  const title = object(fields?.title);
  const body = object(fields?.body);
  return Boolean(context && Object.keys(context).sort().join(",") === "account,business_target,fail_closed,fields,fingerprint,media,observed_at,page,pending_issues,runtime_binding,schema_version,status" &&
    context.schema_version === confirmationContextSchemaVersion && (context.status === "ready" || context.status === "blocked") && context.fail_closed === true &&
    binding && Object.keys(binding).sort().join(",") === "control_owner,identity_environment_ref,observation_generation,observation_ref,profile_ref,provider_ref,runtime_session_ref" &&
    typeof binding.runtime_session_ref === "string" && typeof binding.identity_environment_ref === "string" && typeof binding.profile_ref === "string" && typeof binding.provider_ref === "string" && binding.control_owner === "core_task" && typeof binding.observation_generation === "string" && typeof binding.observation_ref === "string" &&
    account && Object.keys(account).sort().join(",") === "account_ref,label,status" && ["verified", "unknown", "mismatch"].includes(String(account.status)) && (account.account_ref === null || safePublicRef(account.account_ref) !== null) && (account.label === null || safeLabel(account.label) !== null) &&
    target && Object.keys(target).sort().join(",") === "label,status,target_ref" && ["verified", "unknown", "mismatch"].includes(String(target.status)) && (target.target_ref === null || safePublicRef(target.target_ref) !== null) && (target.label === null || safeLabel(target.label) !== null) &&
    page && Object.keys(page).sort().join(",") === "diff,fingerprint,status,url" && ["verified", "unknown", "stale"].includes(String(page.status)) && typeof page.url === "string" && (page.fingerprint === null || /^fnv1a:[0-9a-f]{8}$/.test(String(page.fingerprint))) && ["unchanged", "changed", "unknown"].includes(String(page.diff)) &&
    media && Object.keys(media).sort().join(",") === "image_count,ordered_item_refs,status,summary" && ["verified", "unknown", "mismatch"].includes(String(media.status)) && (media.image_count === null || (typeof media.image_count === "number" && Number.isInteger(media.image_count) && media.image_count >= 0 && media.image_count <= 100)) && Array.isArray(media.ordered_item_refs) && media.ordered_item_refs.length <= 100 && media.ordered_item_refs.every((ref) => safePublicRef(ref) !== null) && (media.summary === null || (typeof media.summary === "string" && media.summary.length <= summaryMaxLength)) &&
    fields && Object.keys(fields).sort().join(",") === "body,status,title" && ["verified", "unknown", "mismatch"].includes(String(fields.status)) &&
    title && body && [title, body].every((field) => Object.keys(field).sort().join(",") === "length,state,summary" && ["empty", "present", "unknown"].includes(String(field.state)) && (field.length === null || (typeof field.length === "number" && Number.isInteger(field.length) && field.length >= 0 && field.length <= 2_000)) && (field.summary === null || (typeof field.summary === "string" && field.summary.length <= summaryMaxLength))) &&
    Array.isArray(context.pending_issues) && context.pending_issues.length <= 8 && new Set(context.pending_issues).size === context.pending_issues.length && context.pending_issues.every((issue) => confirmationIssueCodes.has(issue)) && typeof context.observed_at === "string" && Number.isFinite(Date.parse(context.observed_at)) && typeof context.fingerprint === "string" && /^sha256:[0-9a-f]{64}$/.test(context.fingerprint));
}

function collectionFailure(value: unknown): { failure: FailureRecord; cleanup_failure?: FailureRecord; runtime_session_ref?: string } | undefined {
  const candidate = object(value);
  if (candidate?.kind !== "harbor_admission_collection_failure" || !isFailure(candidate.failure)) return undefined;
  return {
    failure: candidate.failure,
    ...(isFailure(candidate.cleanup_failure) ? { cleanup_failure: candidate.cleanup_failure } : {}),
    ...(typeof candidate.runtime_session_ref === "string" ? { runtime_session_ref: candidate.runtime_session_ref } : {})
  };
}

function observedOperation(value: unknown, runtimeSessionRef: string): { operation: JsonObject; observation: HarborPublicObservation } | XhsConfirmationObservationFailure {
  const operation = object(value);
  if (!operation || operation.schema_version !== observationOperationSchemaVersion || operation.status !== "completed" || operation.runtime_session_ref !== runtimeSessionRef || operation.submitted !== false || typeof operation.observed_at !== "string" || !Number.isFinite(Date.parse(operation.observed_at)) || !validPublicObservation(operation.public_observation)) {
    return { ok: false, failure: failure("confirmation_observation_invalid", "refresh_confirmation_observation") };
  }
  return { operation, observation: operation.public_observation };
}

export async function collectXhsConfirmationObservation(input: CollectXhsConfirmationObservationRequest): Promise<XhsConfirmationObservationSuccess | XhsConfirmationObservationFailure> {
  const collectorFacts = input.required_harbor_facts.filter((fact) => collectorFactKeys.has(fact.fact_key));
  let admission: unknown;
  try {
    admission = await input.client.collectAdmissionFacts({
      run_id: input.run_id,
      task_intent: input.task_intent,
      package_ref: input.package_ref,
      admission_mode: "media_action",
      ...(input.harbor === undefined ? {} : { harbor: input.harbor }),
      ...(input.runtime_session_ref === undefined ? {} : { runtime_session_ref: input.runtime_session_ref })
    });
  } catch {
    return { ok: false, failure: failure("confirmation_observation_unavailable", "refresh_confirmation_observation") };
  }
  const collectedFailure = collectionFailure(admission);
  if (collectedFailure) {
    return {
      ok: false,
      failure: collectedFailure.failure,
      ...(collectedFailure.runtime_session_ref === undefined ? {} : { runtime_session_ref: collectedFailure.runtime_session_ref }),
      ...(collectedFailure.cleanup_failure === undefined ? {} : { cleanup_failure: collectedFailure.cleanup_failure })
    };
  }
  if (isFailure(admission)) return { ok: false, failure: admission };
  const admissionValue = admission as HarborAdmissionInput;
  const runtimeSessionRef = string(object(admissionValue.harbor_runtime_facts)?.runtime_session_ref);
  if (!runtimeSessionRef) return { ok: false, failure: failure("confirmation_observation_unavailable", "refresh_confirmation_observation") };
  if (input.runtime_session_ref !== undefined && runtimeSessionRef !== input.runtime_session_ref) {
    return { ok: false, runtime_session_ref: runtimeSessionRef, failure: failure("runtime_binding_mismatch", "refresh_confirmation_observation") };
  }
  const harborAdmission = validateHarborAdmission(admissionValue, "media_action", collectorFacts);
  if (!harborAdmission.ok) {
    const binding = harborAdmission.runtime_session_binding;
    return {
      ok: false,
      runtime_session_ref: runtimeSessionRef,
      ...(harborAdmission.runtime_binding_refs === undefined ? {} : { runtime_binding_refs: harborAdmission.runtime_binding_refs }),
      ...(harborAdmission.evidence_refs === undefined ? {} : { evidence_refs: harborAdmission.evidence_refs }),
      ...(binding === undefined ? {} : {
        runtime_session_binding: binding,
        confirmation_context: blockedContext(
          binding,
          input.task_intent.scope.target_ref,
          (input.clock ?? (() => new Date()))().toISOString(),
          "unknown",
          "unknown",
          [confirmationIssueForFailure(harborAdmission.failure.code)],
          undefined,
          {
            ...expectedXhsObservationForTask(input.task_intent, input.action_id),
            ...(input.expected_observation ?? {}),
            business_target_ref: input.expected_business_target_ref
          }
        )
      }),
      failure: harborAdmission.failure
    };
  }
  const runtimeBinding = validateHarborRuntimeBinding(admissionValue, "media_action");
  if (!runtimeBinding.ok) return { ok: false, runtime_session_ref: runtimeSessionRef, failure: runtimeBinding.failure };
  if (runtimeBinding.runtime_session_binding.runtime_session_ref !== runtimeSessionRef || runtimeBinding.runtime_session_binding.control_owner !== "core_task") {
    return { ok: false, runtime_session_ref: runtimeSessionRef, failure: failure("runtime_binding_mismatch", "refresh_confirmation_observation") };
  }
  if (input.expected_binding !== undefined && !runtimeBindingMatches(runtimeBinding.runtime_session_binding, input.expected_binding)) {
    return { ok: false, runtime_session_ref: runtimeSessionRef, failure: failure("runtime_binding_mismatch", "refresh_confirmation_observation") };
  }
  let operation: unknown;
  try {
    operation = await input.client.validateOnlyWritePrecheck({
      runtime_session_ref: runtimeSessionRef,
      holder_ref: input.run_id,
      url: input.task_intent.scope.target_ref,
      target_ref: input.expected_business_target_ref,
      requested_fields: ["title", "summary", "canonical_url", "source_status"],
      include_source_refs: true,
      proposed_input_summary: input.task_intent.input.summary,
      expected: {
        ...expectedXhsObservationForTask(input.task_intent, input.action_id),
        ...(input.expected_observation ?? {}),
        business_target_ref: input.expected_business_target_ref
      }
    });
  } catch {
    return { ok: false, runtime_session_ref: runtimeSessionRef, failure: failure("confirmation_observation_unavailable", "refresh_confirmation_observation") };
  }
  const observed = observedOperation(operation, runtimeSessionRef);
  if (!("observation" in observed)) return { ...observed, runtime_session_ref: runtimeSessionRef };
  const observation = observed.observation;
  const observedAt = (object(operation)?.observed_at as string);
  const ref = observationRef(object(operation)!);
  const generation = observation.page.fingerprint ?? "unknown";
  const expectedObservation: XhsPublicObservationExpected = {
    ...expectedXhsObservationForTask(input.task_intent, input.action_id),
    ...(input.expected_observation ?? {}),
    business_target_ref: input.expected_business_target_ref
  };
  const initialContext = blockedContext(
    runtimeBinding.runtime_session_binding,
    input.task_intent.scope.target_ref,
    observedAt,
    generation,
    ref,
    [],
    observation,
    expectedObservation
  );
  const pending: string[] = requiredBlockers(input.action_id, initialContext);
  const age = (input.clock ?? (() => new Date()))().getTime() - Date.parse(observedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > observationTtlMs) pending.push("observation_stale");
  if (input.expected_generation !== undefined && input.expected_generation !== generation) pending.push("observation_generation_changed");
  const context = contextWithStatus(initialContext, pending.length === 0 ? "ready" : "blocked", pending);
  if (context.status !== "ready") {
    const issue = pending[0] ?? "confirmation_observation_invalid";
    return {
      ok: false,
      admission: admissionValue,
      runtime_session_ref: runtimeSessionRef,
      runtime_binding_refs: harborAdmission.runtime_binding_refs,
      evidence_refs: harborAdmission.evidence_refs,
      runtime_session_binding: runtimeBinding.runtime_session_binding,
      confirmation_context: context,
      failure: failure(issue, "refresh_confirmation_observation")
    };
  }
  return {
    ok: true,
    admission: admissionValue,
    runtime_session_ref: runtimeSessionRef,
    runtime_binding_refs: harborAdmission.runtime_binding_refs,
    evidence_refs: harborAdmission.evidence_refs,
    runtime_session_binding: runtimeBinding.runtime_session_binding,
    confirmation_context: context,
    operation: object(operation)!
  };
}

export async function preflightXhsMediaActionConfirmation(
  store: FileRunRecordStore,
  request: XhsMediaActionConfirmationPreflightRequest,
  deps: RuntimeTaskSubmissionDependencies
): Promise<XhsMediaActionConfirmationPreflightResult> {
  const existing = await store.getRunRecord(request.run_id);
  if (!existing || existing.status !== "requires_user_action") {
    return { ok: false, failure: failure("authorization_confirmation_inactive", "request_new_confirmation"), ...(existing ? { run_record: existing } : {}) };
  }
  if (!isExactXhsMediaActionRun(existing, request.confirmation_decision_ref)) {
    return { ok: false, failure: failure("single_action_confirmation_binding_mismatch", "request_new_confirmation"), run_record: existing };
  }
  const taskIntent = validateTaskIntent(request.task_intent);
  if (isFailure(taskIntent) || ![existing.package_ref].includes(request.package_ref)) {
    return { ok: false, failure: isFailure(taskIntent) ? taskIntent : failure("media_action_binding_invalid", "request_new_confirmation"), run_record: existing };
  }
  if (!deps.lodePackageResolver || !deps.harborRuntimeClient) {
    return { ok: false, failure: failure("confirmation_observation_unavailable", "retry_when_policy_owner_ready"), run_record: existing };
  }
  let contract: LodePackageAdmissionContract | FailureRecord;
  try {
    contract = await deps.lodePackageResolver({ package_ref: request.package_ref, task_intent: request.task_intent });
  } catch {
    contract = failure("lode_registry_unavailable", "connect_lode_registry");
  }
  if (isFailure(contract)) return { ok: false, failure: contract, run_record: existing };
  if (!isExactXhsMediaActionTask(taskIntent, contract)) {
    return { ok: false, failure: failure("media_action_binding_invalid", "repair_package_contract"), run_record: existing };
  }
  const lodeAdmission = validateLodePackageAdmission(taskIntent, { package_ref: request.package_ref, lode_package_contract: contract });
  if (!lodeAdmission.ok) return { ok: false, failure: lodeAdmission.failure, run_record: existing };
  const binding = existing.admission.runtime_session_binding;
  const storedContextValue = existing.public_result_summary?.confirmation_context;
  if (!binding) return { ok: false, failure: failure("runtime_binding_missing", "refresh_confirmation_observation"), run_record: existing };
  if (!isConfirmationContext(storedContextValue)) return { ok: false, failure: failure("confirmation_context_missing", "refresh_confirmation_observation"), run_record: existing };
  const targetRef = request.expected_business_target_ref ?? (storedContextValue.business_target.status === "verified"
    ? storedContextValue.business_target.target_ref
    : undefined);
  if (!targetRef) return { ok: false, failure: failure("business_target_unknown", "refresh_confirmation_observation"), confirmation_context: contextWithStatus(storedContextValue, "blocked", ["business_target_unknown"]), run_record: existing };
  const collected = await collectXhsConfirmationObservation({
    run_id: request.run_id,
    task_intent: taskIntent,
    package_ref: request.package_ref,
    action_id: taskIntent.input.action_id as XhsMediaActionId,
    required_harbor_facts: lodeAdmission.required_harbor_facts,
    ...(request.harbor === undefined ? {} : { harbor: request.harbor }),
    runtime_session_ref: binding.runtime_session_ref,
    expected_binding: binding,
    expected_generation: storedContextValue.runtime_binding.observation_generation,
    expected_business_target_ref: targetRef,
    expected_observation: expectedXhsObservationForTask(taskIntent, taskIntent.input.action_id as XhsMediaActionId, storedContextValue),
    client: deps.harborRuntimeClient,
    ...(deps.clock === undefined ? {} : { clock: deps.clock })
  });
  if (!collected.ok) {
    const context = collected.confirmation_context ?? contextWithStatus(storedContextValue, "blocked", [confirmationIssueForFailure(collected.failure.code)]);
    const runRecord = await store.updateRunRecord(request.run_id, { public_result_summary: { ...(existing.public_result_summary ?? {}), confirmation_context: context } });
    return { ok: false, failure: collected.failure, confirmation_context: context, run_record: runRecord };
  }
  const runRecord = await store.updateRunRecord(request.run_id, {
    public_result_summary: { ...(existing.public_result_summary ?? {}), confirmation_context: collected.confirmation_context }
  });
  return { ok: true, confirmation_context: collected.confirmation_context, run_record: runRecord };
}

export function isXhsConfirmationContext(value: unknown): value is XhsConfirmationContext {
  return isConfirmationContext(value);
}
