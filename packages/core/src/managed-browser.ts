import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";
import { ManagedAccessError, managedFileOperations, managedInteractionOperations, managedPageOperations, type FileManagedAccessStore, type ManagedAccessRequest, type ManagedCreationTemplate } from "./managed-access.js";
import { managedBusinessTargetOperations, type ManagedBusinessTargetAccountScope } from "./managed-access.js";
import { createFileBusinessTargetStore, type BusinessTargetAccountScope } from "./business-target-store.js";
import { publicRunResult, type FileRunRecordStore, type RunRecord } from "./run-record-store.js";
import type { FileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import type { FileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import { matchHarborBusinessOperationOwner } from "./execution-policy-owner-proof.js";
import { runtimeSessionUseForControlOwner, type RuntimeSessionBindingFacts } from "./harbor-admission.js";
import { normalizeExecutionPolicyMutation } from "./execution-policy-config.js";
import { evaluateExecutionPolicy } from "./execution-policy.js";
import { completeRunWithFailure, completeRunWithResult } from "./result-envelope.js";
import { ProfileRecoveryCoreError, type ManagedRecoveryService } from "./profile-recovery.js";
import { projectManagedProviderCatalogFacts, projectManagedProviderPreference, providerFactsMatchPreference } from "./managed-provider-facts.js";
import {
  managedCapabilityDefinition,
  managedCapabilityDefinitions,
  managedCapabilityDefinitionRevision,
  managedCapabilityDefinitionState,
  managedCapabilityExample,
  managedCapabilityExecutionInputSchema,
  managedCapabilityFieldGuidance,
  managedCapabilityInputFields,
  managedCapabilityInputShapeIssues,
  validateManagedCapabilityInputShape
} from "./managed-capabilities.js";

type ObjectValue = Record<string, unknown>;
type EnvironmentConfiguration = { timezone?: string; language?: string; viewport?: string };
type Request = ManagedAccessRequest & { idempotency_key: string; url?: string; name?: string; tags?: string[]; label?: string; confirmation?: "delete_local_data"; runtime_session_ref?: string; observation_ref?: string; account_system_ref?: string; account_ref?: string; business_target_ref?: string; declared_external_id?: string;
  page_id?: string; page_ref?: string; document_generation?: number; cursor?: string; limit?: number; target_ref?: string; file_ref?: string; text?: string; key?: string; delta_y?: number; wait_for?: "page_changed" | "text" | "enabled"; timeout_ms?: number; configuration?: EnvironmentConfiguration; backup_ref?: string; operation_ref?: string; provider_id?: "cloakbrowser" | "chrome_official" | "camoufox" };
type DescribeContext = { grant_id: string; profile_ref: string; task_scope: ManagedAccessRequest["task_scope"] };
type DescribeInput = { operation: string; connection_id: string; context?: DescribeContext; arguments?: ObjectValue };
type DiscoveryDimensionState = "supported" | "limited" | "unsupported" | "unknown" | "not_applicable" | "not_evaluated";
type DiscoveryAvailabilityState = "no_known_blocker" | "blocked" | "unknown" | "not_evaluated";
type DiscoveryAuthorizationState = "allowed" | "denied" | "unknown" | "not_evaluated";
const discoveryOperationPattern = new RegExp(managedCapabilityDefinitions.operation_pattern);
const discoveryNextStep = (code: string, operation: string | null, fields: string[] = []) => ({ code, actor: code.startsWith("owner_") || code === "wait_for_owner_return" ? "owner" : "agent", operation, fields });
const isInteraction = (operation: string) => (managedInteractionOperations as readonly string[]).includes(operation);
const isPageMutation = (operation: string) => (managedPageOperations as readonly string[]).includes(operation) && operation !== "page.list";
const isObservation = (operation: string) => ["instance.observe", "instance.read", "instance.snapshot", "instance.wait"].includes(operation);
const isInput = (operation: string) => ["instance.click", "instance.input", "instance.press", "instance.scroll"].includes(operation);
const isEnvironment = (operation: string) => ["environment.read", "environment.update"].includes(operation);
const isRecovery = (operation: string) => ["recovery.inspect", "recovery.request", "recovery.status"].includes(operation);
const isProviderPreference = (operation: string) => ["provider.preference.read", "provider.preference.set", "provider.preference.clear"].includes(operation);
const isBusinessTargetOperation = (operation: string) => (managedBusinessTargetOperations as readonly string[]).includes(operation);
function discoveryExecutionChecks(operation: string): string[] {
  const checks = ["reauthorize"];
  // Core owns the exact current Account binding check, represented by the
  // existing reauthorize check in descriptions and repeated at execution.
  if (isBusinessTargetOperation(operation)) return checks;
  if (["instance.observe", "instance.read", "instance.snapshot", "instance.click", "instance.input", "instance.press", "instance.scroll", "instance.wait", "instance.diagnostics", "page.list", "page.open", "page.activate", "page.close", "page.navigate", "page.reload", "page.back", "page.forward", "file.upload", "file.download"].includes(operation)) checks.push("verify_page_and_target");
  if (["file.upload", "file.download"].includes(operation)) checks.push("verify_file_material");
  if (["instance.click", "instance.input", "instance.press", "instance.scroll", "instance.wait", "page.open", "page.activate", "page.close", "page.navigate", "page.reload", "page.back", "page.forward", "file.upload", "file.download", "instance.stop", "instance.handoff", "environment.update", "provider.preference.set", "provider.preference.clear"].includes(operation)) checks.push("acquire_control_if_required");
  if (!["profile.list", "profile.read", "profile.metadata.update", "provider.preference.read", "provider.preference.set", "provider.preference.clear"].includes(operation)) checks.push("check_provider_runtime");
  return [...new Set(checks)];
}
class InteractionFailure extends ManagedAccessError {
  constructor(readonly receipt: ObjectValue) { super(typeof receipt.failure_class === "string" ? receipt.failure_class : "managed_interaction_outcome_unknown"); }
}
class PageFailure extends ManagedAccessError {
  constructor(readonly receipt: ObjectValue) { super(typeof receipt.failure_class === "string" ? receipt.failure_class : "managed_page_outcome_unknown"); }
}
class FileFailure extends ManagedAccessError {
  constructor(readonly receipt: ObjectValue) { super(typeof receipt.failure_class === "string" ? receipt.failure_class : "managed_file_outcome_unknown"); }
}
class ScopeBoundaryFailure extends ManagedAccessError {
  constructor(readonly receipt: ObjectValue) { super("managed_browser_scope_boundary"); }
}
class CreationReceiptFailure extends ManagedAccessError {}
const harborIdentityEnvironmentMutationSchema = "harbor-identity-environment-mutation/v1";
const profileMutationOperations = new Set(["create", "copy_environment", "archive", "delete", "profile.metadata.update"]);
function profileMutationReceipt(value: unknown, operation: string): ObjectValue {
  const invalid = () => { throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const receipt = value as ObjectValue;
  if (Object.keys(receipt).some(key => !["schema_version", "operation", "status", "identity_environment_ref", "source_identity_environment_ref", "record", "provider_selection", "effects", "failure", "public_boundary"].includes(key)) ||
      receipt.schema_version !== harborIdentityEnvironmentMutationSchema || receipt.operation !== operation ||
      !["completed", "rejected", "repair_required"].includes(String(receipt.status)) ||
      !(receipt.identity_environment_ref === null || typeof receipt.identity_environment_ref === "string" && receipt.identity_environment_ref.length > 0) ||
      !(receipt.source_identity_environment_ref === null || typeof receipt.source_identity_environment_ref === "string" && receipt.source_identity_environment_ref.length > 0) ||
      !(receipt.record === null || !!receipt.record && typeof receipt.record === "object" && !Array.isArray(receipt.record)) ||
      !(receipt.provider_selection === null || !!receipt.provider_selection && typeof receipt.provider_selection === "object" && !Array.isArray(receipt.provider_selection)) ||
      !receipt.effects || typeof receipt.effects !== "object" || Array.isArray(receipt.effects) ||
      !receipt.public_boundary || typeof receipt.public_boundary !== "object" || Array.isArray(receipt.public_boundary)) return invalid();
  const effects = receipt.effects as ObjectValue;
  const boundary = receipt.public_boundary as ObjectValue;
  if (!(["registered", "updated", "removed", "unchanged"].includes(String(effects.index)) &&
      ["created", "copied", "excluded", "preserved", "deleted", "unchanged", "residual"].includes(String(effects.local_data)) &&
      ["preserved_unverified", "excluded", "unchanged"].includes(String(effects.login_state))) ||
      boundary.output !== "status_and_redacted_refs_only" || boundary.raw_material !== "not_exposed" ||
      JSON.stringify(boundary.not_exposed) !== JSON.stringify(["cookie", "token", "password", "profile_storage", "local_path"])) return invalid();
  let failure: ObjectValue | null = null;
  if (receipt.failure !== null) {
    if (!receipt.failure || typeof receipt.failure !== "object" || Array.isArray(receipt.failure)) return invalid();
    failure = receipt.failure as ObjectValue;
    if (typeof failure.code !== "string" || !failure.code.length || typeof failure.retryable !== "boolean" ||
        !Array.isArray(failure.recovery_actions) || failure.recovery_actions.some(action => typeof action !== "string")) return invalid();
  }
  if (receipt.status === "completed" && failure !== null || receipt.status !== "completed" && failure === null) return invalid();
  if (receipt.status === "rejected" && (receipt.record !== null || receipt.provider_selection !== null || receipt.source_identity_environment_ref !== null ||
      effects.index !== "unchanged" || effects.local_data !== "unchanged" || effects.login_state !== "unchanged")) return invalid();
  return receipt;
}
function isDeterministicWaitTimeout(receipt: ObjectValue | undefined): boolean {
  return receipt?.status === "unavailable" && receipt.dispatch_state === "dispatched" && receipt.failure_class === "wait_condition_timeout";
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (code: string): never => { throw new ManagedAccessError(code); };
const harborCapabilityDescriptionSchemaVersion = "harbor-capability-description/v1";
const harborProviderStates = new Set(["supported", "limited", "unsupported", "unknown", "not_applicable", "not_evaluated"]);
const harborAvailabilityStates = new Set(["no_known_blocker", "blocked", "unknown", "not_evaluated"]);
const harborExecutionChecks = new Set(["reauthorize", "verify_page_and_target", "verify_file_material", "acquire_control_if_required", "check_provider_runtime"]);
function harborContractObject(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("discovery_version_mismatch");
  return value as ObjectValue;
}
function harborContractString(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || !value.length || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) return fail("discovery_version_mismatch");
  return value;
}
function harborContractTime(value: unknown): string | null {
  if (value === null) return null;
  const result = harborContractString(value, 64);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) return fail("discovery_version_mismatch");
  return result;
}
function harborContractStrings(value: unknown, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > 16) return fail("discovery_version_mismatch");
  return value.map(item => harborContractString(item, maxLength));
}
function normalizeHarborCapabilityDescription(value: unknown, operation: string, profileRef: string): ObjectValue {
  const input = harborContractObject(value);
  if (input.schema_version !== harborCapabilityDescriptionSchemaVersion || input.operation !== operation || input.profile_ref !== profileRef ||
      Object.keys(input).some(key => !["schema_version", "operation", "profile_ref", "provider", "availability", "execution_checks"].includes(key))) return fail("discovery_version_mismatch");
  const provider = harborContractObject(input.provider);
  if (Object.keys(provider).some(key => !["state", "provider_id", "reason_codes", "limitations", "facts_at"].includes(key)) ||
      !Object.hasOwn(provider, "state") || !Object.hasOwn(provider, "provider_id") || !Object.hasOwn(provider, "reason_codes") || !Object.hasOwn(provider, "limitations") || !Object.hasOwn(provider, "facts_at")) return fail("discovery_version_mismatch");
  const providerStateKnown = harborProviderStates.has(String(provider.state));
  const providerId = provider.provider_id === null ? null : harborContractString(provider.provider_id, 512);
  const providerReasons = harborContractStrings(provider.reason_codes, 128);
  if (!Array.isArray(provider.limitations) || provider.limitations.length > 16) return fail("discovery_version_mismatch");
  const normalizedLimitations = provider.limitations.map(item => {
    const limitation = harborContractObject(item);
    if (Object.keys(limitation).some(key => !["code", "summary"].includes(key)) || !Object.hasOwn(limitation, "code") || !Object.hasOwn(limitation, "summary")) return fail("discovery_version_mismatch");
    return { code: harborContractString(limitation.code, 128), summary: harborContractString(limitation.summary, 256) };
  });
  const providerFactsAt = harborContractTime(provider.facts_at);
  const normalizedProvider = {
    state: providerStateKnown ? provider.state : "unknown",
    provider_id: providerStateKnown ? providerId : null,
    reason_codes: [...new Set(providerStateKnown ? providerReasons : [...providerReasons, "runtime_facts_unavailable"])],
    limitations: normalizedLimitations,
    facts_at: providerFactsAt
  };
  const availability = harborContractObject(input.availability);
  if (Object.keys(availability).some(key => !["state", "reason_codes", "facts_at"].includes(key)) ||
      !Object.hasOwn(availability, "state") || !Object.hasOwn(availability, "reason_codes") || !Object.hasOwn(availability, "facts_at")) return fail("discovery_version_mismatch");
  const availabilityStateKnown = harborAvailabilityStates.has(String(availability.state));
  const availabilityReasons = harborContractStrings(availability.reason_codes, 128);
  const normalizedAvailability = {
    state: availabilityStateKnown ? availability.state : "unknown",
    reason_codes: [...new Set(availabilityStateKnown ? availabilityReasons : [...availabilityReasons, "runtime_facts_unavailable"])],
    facts_at: harborContractTime(availability.facts_at)
  };
  if (normalizedProvider.reason_codes.includes("profile_missing") || normalizedAvailability.reason_codes.includes("profile_missing")) return fail("discovery_context_unavailable");
  if (!Array.isArray(input.execution_checks) || input.execution_checks.length > 16 || input.execution_checks.some(check => !harborExecutionChecks.has(String(check)))) return fail("discovery_version_mismatch");
  return { schema_version: harborCapabilityDescriptionSchemaVersion, operation, profile_ref: profileRef, provider: normalizedProvider, availability: normalizedAvailability, execution_checks: [...input.execution_checks] };
}
function accessFingerprint(access: { principal: { principal_id: string }; connection: { connection_id: string }; grant: unknown; profile_policy?: unknown; scope_semantics: string }): string {
  return digest(JSON.stringify({ principal_id: access.principal.principal_id, connection_id: access.connection.connection_id, grant: access.grant, profile_policy: access.profile_policy ?? null, scope_semantics: access.scope_semantics }));
}
function describeAuthorizationError(code: string): { state: "denied" | "unknown"; reason_codes: string[] } {
  return {
    state: code === "managed_access_origin_required" ? "unknown" : "denied",
    reason_codes: [code === "managed_access_scope_semantics_mismatch" ? "scope_semantics_mismatch" : code === "managed_access_origin_required" ? "origin_required" : code === "managed_access_controlled_origin_required" ? "controlled_origin_denied" : "scope_denied"]
  };
}
function pageRef(value: ObjectValue): string {
  return typeof value.page_ref === "string" && value.page_ref.length > 0 ? value.page_ref : "page:opaque";
}
function redactedBoundaryReceipt(value: ObjectValue, fallbackPageRef?: string): ObjectValue {
  const page = value.page && typeof value.page === "object" && !Array.isArray(value.page) ? object(value.page) : {};
  let origin = "unknown";
  if (typeof page.current_url === "string") {
    try { origin = new URL(page.current_url).origin; } catch { /* opaque fallback below */ }
  }
  return { status: "unavailable", dispatch_state: value.dispatch_state === "dispatched" ? "dispatched" : "not_dispatched", failure_class: "managed_browser_scope_boundary",
    ...(typeof value.operation_ref === "string" ? { operation_ref: value.operation_ref } : {}), ...(typeof value.runtime_session_ref === "string" ? { runtime_session_ref: value.runtime_session_ref } : {}),
    page: { origin, page_ref: fallbackPageRef ?? pageRef(page) } };
}
function unauthorizedPage(value: ObjectValue, authorizedOrigins: readonly string[]): boolean {
  const page = value.page && typeof value.page === "object" && !Array.isArray(value.page) ? object(value.page) : undefined;
  if (!page || typeof page.current_url !== "string") return false;
  try { return !authorizedOrigins.includes(new URL(page.current_url).origin); } catch { return true; }
}
function redactCompletedPage(value: ObjectValue, authorizedOrigins: readonly string[], fallbackPageRef?: string): ObjectValue {
  if (!unauthorizedPage(value, authorizedOrigins)) return value;
  throw new ScopeBoundaryFailure(redactedBoundaryReceipt(value, fallbackPageRef));
}
function redirectedSessionBoundary(value: ObjectValue, authorizedOrigins: readonly string[], fallbackPageRef?: string): ObjectValue | undefined {
  const session = value.session && typeof value.session === "object" && !Array.isArray(value.session) ? object(value.session) : undefined;
  const page = session?.current_page && typeof session.current_page === "object" && !Array.isArray(session.current_page) ? object(session.current_page) : undefined;
  if (!page || !unauthorizedPage({ page }, authorizedOrigins)) return undefined;
  return redactedBoundaryReceipt({ ...value, page, dispatch_state: "dispatched" }, fallbackPageRef);
}
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("managed_browser_invalid_input");
  return value as ObjectValue;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) return fail("managed_browser_invalid_input");
  return value;
}
function configuration(value: unknown): EnvironmentConfiguration {
  const input = object(value), fields = ["timezone", "language", "viewport"];
  if (!Object.keys(input).length || Object.keys(input).some(key => !fields.includes(key))) return fail("managed_browser_invalid_input");
  for (const key of fields) if (input[key] !== undefined) {
    const item = input[key];
    if (typeof item !== "string" || !item.length || item.length > 128 || /[\u0000-\u001f\u007f]/.test(item)) return fail("managed_browser_invalid_input");
  }
  return input as EnvironmentConfiguration;
}
function parse(value: unknown): Request {
  const input = object(value);
  text(input.idempotency_key);
  if (input.operation !== undefined && typeof input.operation === "string") {
    if (Object.keys(input).some(key => input[key] !== undefined && !managedCapabilityInputFields(input.operation).includes(key))) return fail("managed_browser_invalid_input");
    validateManagedCapabilityInputShape(input);
  } else if (Object.keys(input).some(key => input[key] !== undefined && !managedCapabilityInputFields(undefined).includes(key))) return fail("managed_browser_invalid_input");
  if (input.configuration !== undefined && !isEnvironment(String(input.operation))) return fail("managed_browser_invalid_input");
  if (input.provider_id !== undefined && !["cloakbrowser", "chrome_official", "camoufox"].includes(String(input.provider_id))) return fail("managed_browser_invalid_input");
  for (const key of ["url", "runtime_session_ref", "observation_ref", "account_system_ref", "account_ref", "business_target_ref", "declared_external_id", "page_id", "page_ref", "cursor", "target_ref", "file_ref"]) if (input[key] !== undefined) text(input[key]);
  if (input.document_generation !== undefined && (typeof input.document_generation !== "number" || !Number.isSafeInteger(input.document_generation) || input.document_generation < 1)) return fail("managed_browser_invalid_input");
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 128)) return fail("managed_browser_invalid_input");
  if (input.url !== undefined) {
    let url: URL;
    try { url = new URL(text(input.url)); } catch { return fail("managed_browser_invalid_input"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin !== input.origin || !["instance.start", "instance.navigate", "page.open", "page.navigate"].includes(String(input.operation))) return fail("managed_browser_invalid_input");
  }
  if (["instance.navigate", "instance.read", "instance.observe", "instance.diagnostics", ...managedPageOperations, ...managedInteractionOperations].includes(String(input.operation))) {
    text(input.runtime_session_ref);
    if (["instance.navigate", "page.navigate"].includes(String(input.operation))) text(input.url);
    if (input.operation === "instance.diagnostics" && input.url !== undefined) return fail("managed_browser_invalid_input");
  }
  if ((managedFileOperations as readonly string[]).includes(String(input.operation))) {
    const operation = String(input.operation);
    const fields = operation === "file.upload" ? ["page_ref", "observation_ref", "target_ref", "file_ref"] : ["page_ref", "observation_ref", "target_ref"];
    const all = ["page_ref", "observation_ref", "target_ref", "file_ref"];
    if (all.some(key => input[key] !== undefined && !fields.includes(key)) || !input.runtime_session_ref || !input.page_ref || !input.observation_ref || !input.target_ref || !input.origin ||
      (operation === "file.upload" ? typeof input.file_ref !== "string" : input.file_ref !== undefined) || input.url !== undefined || input.text !== undefined || input.key !== undefined || input.delta_y !== undefined || input.wait_for !== undefined || input.timeout_ms !== undefined || input.page_id === undefined) return fail("managed_browser_invalid_input");
    text(input.runtime_session_ref); text(input.page_ref); text(input.observation_ref); text(input.target_ref); text(input.origin); text(input.page_id);
    if (input.document_generation === undefined || !Number.isSafeInteger(input.document_generation) || Number(input.document_generation) < 1) return fail("managed_browser_invalid_input");
    if (operation === "file.upload") text(input.file_ref);
    if (input.cursor !== undefined || input.limit !== undefined || input.configuration !== undefined || input.backup_ref !== undefined || input.operation_ref !== undefined || input.provider_id !== undefined || input.template_ref !== undefined || input.account_ref !== undefined || input.account_system_ref !== undefined) return fail("managed_browser_invalid_input");
  } else if ((managedPageOperations as readonly string[]).includes(String(input.operation))) {
    const operation = String(input.operation);
    if (!["page.list", "page.open"].includes(operation) && input.page_id === undefined && input.page_ref === undefined) return fail("managed_browser_invalid_input");
    if (operation === "page.navigate") text(input.url);
    if (!["page.open", "page.navigate"].includes(operation) && input.url !== undefined) return fail("managed_browser_invalid_input");
    if (input.cursor !== undefined || input.limit !== undefined || input.document_generation !== undefined && operation === "page.list" ||
      input.observation_ref !== undefined || input.target_ref !== undefined || input.text !== undefined || input.key !== undefined || input.delta_y !== undefined || input.wait_for !== undefined || input.timeout_ms !== undefined || input.configuration !== undefined || input.account_ref !== undefined || input.account_system_ref !== undefined || input.template_ref !== undefined) return fail("managed_browser_invalid_input");
  } else if (isInteraction(String(input.operation))) {
    if (input.cursor !== undefined && input.operation !== "instance.snapshot" || input.limit !== undefined && !["instance.snapshot", "instance.diagnostics"].includes(String(input.operation))) return fail("managed_browser_invalid_input");
    const action = String(input.operation).slice("instance.".length);
    const fields: Record<string, string[]> = { snapshot: ["page_ref", "observation_ref", "cursor", "limit"], click: ["page_ref", "observation_ref", "target_ref"], input: ["page_ref", "observation_ref", "target_ref", "text"], press: ["page_ref", "observation_ref", "target_ref", "key"], scroll: ["page_ref", "observation_ref", "delta_y"], wait: ["page_ref", "observation_ref", "wait_for", "target_ref", "text", "timeout_ms"] };
    const all = ["page_ref", "observation_ref", "cursor", "limit", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms", "account_ref", "account_system_ref", "url", "template_ref"];
    if (all.some(key => input[key] !== undefined && !fields[action]!.includes(key))) return fail("managed_browser_invalid_input");
    if (action !== "snapshot") { text(input.page_ref); text(input.observation_ref); }
    if (["click", "input", "press"].includes(action)) text(input.target_ref);
    if (action === "input" && (typeof input.text !== "string" || input.text.length > 512 || /[\u0000-\u001f\u007f]/.test(input.text))) return fail("managed_browser_invalid_input");
    if (action === "press" && !["Enter", "Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Space", "Backspace", "Delete", "Escape"].includes(String(input.key))) return fail("managed_browser_invalid_input");
    if (action === "scroll" && (!Number.isSafeInteger(input.delta_y) || Math.abs(Number(input.delta_y)) > 2000 || input.delta_y === 0)) return fail("managed_browser_invalid_input");
    if (action === "wait") {
      if (!["page_changed", "text", "enabled"].includes(String(input.wait_for))) return fail("managed_browser_invalid_input");
      if (input.timeout_ms !== undefined && (!Number.isSafeInteger(input.timeout_ms) || Number(input.timeout_ms) < 1 || Number(input.timeout_ms) > 10_000)) return fail("managed_browser_invalid_input");
      if (input.wait_for === "enabled") text(input.target_ref); else if (input.target_ref !== undefined) return fail("managed_browser_invalid_input");
      if (input.wait_for === "text") { if (text(input.text).length > 256) return fail("managed_browser_invalid_input"); } else if (input.text !== undefined) return fail("managed_browser_invalid_input");
    }
  } else if (input.operation === "instance.diagnostics") {
    if (["target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms", "observation_ref", "account_system_ref", "account_ref", "template_ref"].some(key => input[key] !== undefined)) return fail("managed_browser_invalid_input");
  } else if (isEnvironment(String(input.operation))) {
    if (["template_ref", "url", "runtime_session_ref", "observation_ref", "account_system_ref", "account_ref", "page_ref", "cursor", "limit", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms"].some(key => input[key] !== undefined)) return fail("managed_browser_invalid_input");
    if (input.operation === "environment.update") configuration(input.configuration);
    else if (input.configuration !== undefined) return fail("managed_browser_invalid_input");
  } else if (isRecovery(String(input.operation))) {
    if (input.origin !== undefined || input.url !== undefined || input.runtime_session_ref !== undefined || input.page_ref !== undefined || input.cursor !== undefined || input.limit !== undefined || input.target_ref !== undefined || input.text !== undefined || input.key !== undefined || input.delta_y !== undefined || input.wait_for !== undefined || input.timeout_ms !== undefined || input.configuration !== undefined) return fail("managed_browser_invalid_input");
    text(input.profile_ref);
    if (input.operation === "recovery.status") text(input.operation_ref);
    if (input.backup_ref !== undefined && input.operation !== "recovery.request") return fail("managed_browser_invalid_input");
    if (input.backup_ref !== undefined) text(input.backup_ref);
  } else if (isProviderPreference(String(input.operation))) {
    if (["profile_ref", "origin", "template_ref", "url", "runtime_session_ref", "observation_ref", "account_system_ref", "account_ref", "page_id", "page_ref", "document_generation", "cursor", "limit", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms", "configuration", "backup_ref", "operation_ref"].some(key => input[key] !== undefined) ||
      (input.operation === "provider.preference.set" ? input.provider_id === undefined : input.provider_id !== undefined)) return fail("managed_browser_invalid_input");
  } else if (input.operation === "profile.create") {
    if (["profile_ref", "runtime_session_ref", "observation_ref", "account_system_ref", "account_ref", "page_id", "page_ref", "document_generation", "cursor", "limit", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms", "configuration", "backup_ref", "operation_ref"].some(key => input[key] !== undefined)) return fail("managed_browser_invalid_input");
  } else if (input.operation === "profile.copy_environment") {
    text(input.profile_ref); text(input.template_ref);
  } else if (input.operation === "profile.archive") {
    text(input.profile_ref);
  } else if (input.operation === "profile.delete") {
    text(input.profile_ref);
    if (input.confirmation !== "delete_local_data") return fail("managed_browser_invalid_input");
  } else if (input.operation === "profile.metadata.update") {
    text(input.profile_ref);
    if (input.name === undefined && input.tags === undefined) return fail("managed_browser_invalid_input");
    if (input.name !== undefined) {
      if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 512 || /[\u0000-\u001f\u007f]/.test(input.name)) return fail("managed_browser_invalid_input");
    }
    if (input.tags !== undefined) {
      if (!Array.isArray(input.tags) || input.tags.length > 16 || input.tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 512 || /[\u0000-\u001f\u007f]/.test(tag))) return fail("managed_browser_invalid_input");
    }
  } else if (input.provider_id !== undefined || !["instance.navigate", "instance.read", "instance.observe"].includes(String(input.operation)) && (["page_id", "page_ref", "document_generation", "cursor", "limit", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms"].some(key => input[key] !== undefined)) ||
    (!(["account.bind", "business_target.create", "business_target.list"] as string[]).includes(String(input.operation)) && ["observation_ref", "account_system_ref", "account_ref"].some(key => input[key] !== undefined))) return fail("managed_browser_invalid_input");
  if (isBusinessTargetOperation(String(input.operation))) {
    const createOrList = ["business_target.create", "business_target.list"].includes(String(input.operation));
    const required = createOrList ? ["profile_ref", "account_system_ref", "account_ref"] : ["profile_ref", "business_target_ref"];
    if (required.some(key => input[key] === undefined) ||
        createOrList && input.business_target_ref !== undefined || !createOrList && (input.account_system_ref !== undefined || input.account_ref !== undefined) ||
        input.origin !== undefined || input.url !== undefined || input.runtime_session_ref !== undefined || input.observation_ref !== undefined ||
        input.page_id !== undefined || input.page_ref !== undefined || input.target_ref !== undefined || input.file_ref !== undefined ||
        input.cursor !== undefined || input.limit !== undefined || input.configuration !== undefined || input.backup_ref !== undefined || input.operation_ref !== undefined ||
        input.provider_id !== undefined || input.name !== undefined || input.tags !== undefined || input.text !== undefined || input.key !== undefined ||
        input.delta_y !== undefined || input.wait_for !== undefined || input.timeout_ms !== undefined) return fail("managed_browser_invalid_input");
    if (input.operation === "business_target.create") {
      if (input.label === undefined || input.business_target_ref !== undefined || input.verification_state !== undefined) return fail("managed_browser_invalid_input");
      if (input.declared_external_id !== undefined && input.declared_external_id === "") return fail("managed_browser_invalid_input");
    } else if (input.operation === "business_target.metadata.update") {
      if (input.label === undefined || input.declared_external_id !== undefined || input.verification_state !== undefined) return fail("managed_browser_invalid_input");
    } else if (["business_target.read", "business_target.list", "business_target.disable"].includes(String(input.operation)) &&
      (input.label !== undefined || input.declared_external_id !== undefined || input.verification_state !== undefined)) return fail("managed_browser_invalid_input");
  }
  return input as Request;
}
export const parseManagedBrowserRequest = parse;
function accessRequest(input: Request): ManagedAccessRequest {
  const { idempotency_key: _key, url: _url, name: _name, tags: _tags, label: _label, declared_external_id: _externalId, runtime_session_ref: _session, observation_ref: _observation, account_system_ref: _system, account_ref: _account, page_id: _pageId, page_ref: _page, document_generation: _generation, cursor: _cursor, limit: _limit, target_ref: _target, file_ref: _file, text: _text, key: _press, delta_y: _scroll, wait_for: _wait, timeout_ms: _timeout, configuration: _configuration, backup_ref: _backup, operation_ref: _operation, provider_id: _provider, ...rest } = input;
  const access = rest as ManagedAccessRequest;
  if (managedFileOperations.includes(input.operation as typeof managedFileOperations[number])) access.file_refs = _file === undefined ? [] : [_file];
  if (isBusinessTargetOperation(input.operation)) {
    if (_system !== undefined) access.account_system_ref = _system;
    if (_account !== undefined) access.account_ref = _account;
  }
  return access;
}
function publicOrigin(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.origin === value && !parsed.username && !parsed.password;
  } catch { return false; }
}
function describeStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 1024 && value.every(item => typeof item === "string" && item.length > 0 && item.length <= 512 && item.trim() === item && !/[\u0000-\u001f\u007f]/.test(item)) && new Set(value).size === value.length;
}
function parseDescribe(value: unknown): DescribeInput {
  const input = object(value);
  if (Object.keys(input).some(key => !["operation", "connection_id", "context", "arguments"].includes(key)) || typeof input.operation !== "string" || !discoveryOperationPattern.test(input.operation) || typeof input.connection_id !== "string") return fail("managed_browser_invalid_input");
  const definition = managedCapabilityDefinition(input.operation);
  let context: DescribeContext | undefined;
  if (input.context !== undefined) {
    const raw = object(input.context);
    if (Object.keys(raw).some(key => !["grant_id", "profile_ref", "task_scope"].includes(key)) || typeof raw.grant_id !== "string" || typeof raw.profile_ref !== "string") return fail("managed_browser_invalid_input");
    const scope = object(raw.task_scope);
    const allowFileRefs = definition?.file_scope !== undefined;
    if (Object.keys(scope).some(key => !["operations", "profile_refs", "origins", ...(allowFileRefs ? ["file_refs"] : [])].includes(key)) ||
      !describeStrings(scope.operations) || !describeStrings(scope.profile_refs) || !describeStrings(scope.origins) || scope.origins.some(origin => !publicOrigin(origin)) ||
      allowFileRefs && scope.file_refs !== undefined && !describeStrings(scope.file_refs)) return fail("managed_browser_invalid_input");
    const fileRefs = scope.file_refs as string[] | undefined;
    context = { grant_id: text(raw.grant_id), profile_ref: text(raw.profile_ref), task_scope: {
      operations: scope.operations as ManagedAccessRequest["task_scope"]["operations"],
      profile_refs: scope.profile_refs as string[],
      origins: scope.origins as string[],
      ...(fileRefs === undefined ? {} : { file_refs: fileRefs })
    } };
  }
  let args: ObjectValue | undefined;
  if (input.arguments !== undefined) {
    args = object(input.arguments);
    const fields = new Set(Object.keys(managedCapabilityDefinitions.fields).filter(field => field !== "profile_ref"));
    if (Object.keys(args).some(key => !fields.has(key))) return fail("managed_browser_invalid_input");
    for (const [key, item] of Object.entries(args)) {
      if (key === "origin" && typeof item !== "string" || key === "origin" && !publicOrigin(item)) return fail("managed_browser_invalid_input");
    }
  }
  return { operation: input.operation, connection_id: text(input.connection_id), ...(context === undefined ? {} : { context }), ...(args === undefined ? {} : { arguments: args }) };
}
function describeInputAssessment(input: DescribeInput, context: DescribeContext | undefined, definition: ReturnType<typeof managedCapabilityDefinition>): { state: "not_provided" | "incomplete" | "invalid" | "complete"; missing: string[]; invalid: { path: string; code: string }[] } {
  if (input.arguments === undefined) return { state: "not_provided", missing: [], invalid: [] };
  const missing: string[] = [], invalid: { path: string; code: string }[] = [];
  if (!definition) return { state: "invalid", missing, invalid: [{ path: "/operation", code: "operation_not_defined" }] };
  if (context === undefined) missing.push("/context/grant_id", "/context/task_scope");
  if (definition.context === "profile" && context === undefined) missing.push("/context/profile_ref");
  const draft = { ...input.arguments, operation: input.operation, ...(context === undefined ? {} : { grant_id: context.grant_id, profile_ref: context.profile_ref, task_scope: context.task_scope }) } as ObjectValue;
  const pathFor = (field: string) => field.startsWith("task_scope.")
    ? `/context/${field.replace(".", "/")}`
    : context === undefined && field === "profile_ref" ? "/context/profile_ref" : `/arguments/${field}`;
  const shape = managedCapabilityInputShapeIssues(draft);
  for (const field of shape.missing) missing.push(pathFor(field));
  for (const issue of shape.invalid) invalid.push({ path: pathFor(issue.field), code: issue.code });
  return { state: invalid.length ? "invalid" : missing.length ? "incomplete" : "complete", missing, invalid };
}
function publicProfile(value: unknown): ObjectValue {
  const profile = object(value), refs = object(profile.refs);
  return { profile_ref: text(refs.profile_ref), identity_environment_ref: text(profile.identity_environment_ref), name: profile.name ?? text(refs.profile_ref), tags: profile.tags ?? [], site: profile.site,
    status: profile.status, account_bindings: profile.account_bindings ?? [], environment_summary: profile.environment_summary,
    ...(profile.lifecycle_state === undefined ? {} : { lifecycle_state: profile.lifecycle_state === "active" || profile.lifecycle_state === "archived" ? profile.lifecycle_state : fail("managed_browser_runtime_invalid") }),
    identity_ownership: publicProfileIdentityOwnership(profile.identity_ownership) };
}
function publicProfileIdentityOwnership(value: unknown): ObjectValue {
  const unknown = () => ({ schema_version: "webenvoy.profile-identity-ownership/v1",
    current: { status: "unknown", observed_at: null, account_system_ref: null, account_ref: null },
    history: { bindings: [], declared: null }, ownership: { status: "unknown" } });
  if (value === undefined) return unknown();
  const projection = object(value);
  if (projection.schema_version !== "webenvoy.profile-identity-ownership/v1") return fail("managed_browser_runtime_invalid");
  const current = object(projection.current), history = object(projection.history), ownership = object(projection.ownership);
  const ownerStatus = ownership.status;
  if (!["unique", "conflict", "unknown", "not_runnable"].includes(String(ownerStatus))) return fail("managed_browser_runtime_invalid");
  const currentStatus = current.status;
  if (!["verified", "discovered", "conflict", "unknown"].includes(String(currentStatus))) return fail("managed_browser_runtime_invalid");
  const observedAt = current.observed_at === null ? null : typeof current.observed_at === "string" ? current.observed_at : fail("managed_browser_runtime_invalid");
  if ((observedAt === null && currentStatus !== "unknown") ||
    (observedAt !== null && (!Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt))) return fail("managed_browser_runtime_invalid");
  const requiredRef = (item: unknown) => {
    if (typeof item !== "string" || !/^[A-Za-z0-9:_./-]{1,256}$/.test(item)) return fail("managed_browser_runtime_invalid");
    return item;
  };
  const optionalRef = (item: unknown) => item === null ? null : requiredRef(item);
  const accountSystemRef = optionalRef(current.account_system_ref), accountRef = optionalRef(current.account_ref);
  if ((currentStatus === "unknown") !== (accountSystemRef === null && accountRef === null) || (accountSystemRef === null) !== (accountRef === null)) return fail("managed_browser_runtime_invalid");
  if (!Array.isArray(history.bindings) || history.bindings.length > 1024) return fail("managed_browser_runtime_invalid");
  const bindings = history.bindings.map(value => {
    const binding = object(value);
    if (binding.status !== "bound" || binding.verification !== "verified_at_binding") return fail("managed_browser_runtime_invalid");
    const boundAt = text(binding.bound_at);
    if (!Number.isFinite(Date.parse(boundAt)) || new Date(boundAt).toISOString() !== boundAt) return fail("managed_browser_runtime_invalid");
    const bindingOwnerStatus = binding.ownership_status === undefined
      ? ownerStatus === "unique" ? "unique" : ownerStatus === "not_runnable" ? "not_runnable" : "unknown"
      : binding.ownership_status;
    if (!["unique", "conflict", "not_runnable", "unknown"].includes(String(bindingOwnerStatus))) return fail("managed_browser_runtime_invalid");
    return { status: "bound", verification: "verified_at_binding", ownership_status: ownerStatus === "not_runnable" ? "not_runnable" : ownerStatus === "unknown" ? "unknown" : bindingOwnerStatus,
      account_system_ref: requiredRef(binding.account_system_ref), account_ref: requiredRef(binding.account_ref), bound_at: boundAt };
  });
  let declared: ObjectValue | null = null;
  if (history.declared !== null) {
    const declaration = object(history.declared);
    if (declaration.status !== "declared") return fail("managed_browser_runtime_invalid");
    declared = { status: "declared", account_system_ref: requiredRef(declaration.account_system_ref), account_ref: requiredRef(declaration.account_ref) };
  }
  if (["unique", "conflict"].includes(String(ownerStatus)) && bindings.length === 0) return fail("managed_browser_runtime_invalid");
  return {
    schema_version: projection.schema_version,
    current: { status: currentStatus, observed_at: observedAt, account_system_ref: accountSystemRef, account_ref: accountRef },
    history: { bindings, declared },
    ownership: { status: ownerStatus }
  };
}
type BusinessTargetBindingStatus = "unique" | "conflict" | "not_runnable" | "unknown";
type BusinessTargetOwnedBinding = BusinessTargetAccountScope & { ownership_status: BusinessTargetBindingStatus };
function businessTargetAccountBindings(profile: ObjectValue): BusinessTargetOwnedBinding[] {
  const ownershipValue = profile.identity_ownership;
  if (!ownershipValue || typeof ownershipValue !== "object" || Array.isArray(ownershipValue)) return fail("business_target_identity_ownership_unavailable");
  const ownership = object(ownershipValue), owner = object(ownership.ownership), history = object(ownership.history);
  if (ownership.schema_version !== "webenvoy.profile-identity-ownership/v1" || !Array.isArray(history.bindings)) return fail("business_target_identity_ownership_unavailable");
  const bindings = history.bindings.map(value => {
    const binding = object(value);
    if (binding.status !== "bound" || binding.verification !== "verified_at_binding" || typeof binding.account_system_ref !== "string" ||
        !/^account-system:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(binding.account_system_ref) || typeof binding.account_ref !== "string" ||
        !/^account:sha256:[a-f0-9]{64}$/.test(binding.account_ref) || typeof binding.bound_at !== "string" || !Number.isFinite(Date.parse(binding.bound_at))) return fail("business_target_identity_ownership_unavailable");
    const ownership_status = owner.status === "not_runnable" ? "not_runnable" : binding.ownership_status;
    if (!["unique", "conflict", "not_runnable", "unknown"].includes(String(ownership_status))) return fail("business_target_identity_ownership_unavailable");
    return { profile_ref: text(profile.profile_ref), account_system_ref: binding.account_system_ref, account_ref: binding.account_ref,
      ownership_status: ownership_status as BusinessTargetBindingStatus };
  });
  const keys = bindings.map(binding => `${binding.account_system_ref}\u0000${binding.account_ref}`);
  if (new Set(keys).size !== keys.length) return fail("business_target_identity_ownership_unavailable");
  return bindings;
}
function requireRunnableBusinessTargetBinding(binding: BusinessTargetOwnedBinding | undefined): BusinessTargetAccountScope {
  if (!binding) return fail("business_target_account_scope_unavailable");
  if (binding.ownership_status === "conflict") return fail("business_target_account_binding_conflict");
  if (binding.ownership_status === "not_runnable") return fail("business_target_account_not_runnable");
  if (binding.ownership_status !== "unique") return fail("business_target_account_binding_unknown");
  return { profile_ref: binding.profile_ref, account_system_ref: binding.account_system_ref, account_ref: binding.account_ref };
}
function rawProfileRef(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const refs = (value as ObjectValue).refs;
  if (!refs || typeof refs !== "object" || Array.isArray(refs)) return undefined;
  const profileRef = (refs as ObjectValue).profile_ref;
  return typeof profileRef === "string" && profileRef.length > 0 ? profileRef : undefined;
}
function assertCopyTemplateMatch(profile: ObjectValue, template: Pick<ManagedCreationTemplate, "provider_id" | "site" | "language" | "timezone">): void {
  if (template.provider_id === null) return fail("managed_browser_template_provider_unspecified");
  const site = object(profile.site), environment = object(profile.environment_summary);
  if (site.site_id !== template.site.site_id || site.origin !== template.site.origin || site.display_name !== template.site.display_name ||
      environment.provider_id !== template.provider_id || environment.language !== template.language || environment.timezone !== template.timezone) {
    return fail("managed_browser_copy_template_mismatch");
  }
}
function copyTemplateFacts(value: unknown): Pick<ManagedCreationTemplate, "provider_id" | "site" | "language" | "timezone"> {
  const input = object(value), site = object(input.site);
  if (!(["cloakbrowser", "chrome_official", "camoufox"] as unknown[]).includes(input.provider_id)) return fail("managed_browser_runtime_invalid");
  return {
    provider_id: input.provider_id as ManagedCreationTemplate["provider_id"],
    site: { site_id: text(site.site_id), origin: text(site.origin), display_name: text(site.display_name) },
    language: text(input.language), timezone: text(input.timezone)
  };
}
function publicProviderSelection(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("managed_browser_provider_selection_invalid");
  const selection = value as ObjectValue;
  if (selection.schema_version !== "harbor-provider-selection/v1" ||
    !["explicit_request", "user_default"].includes(String(selection.source)) ||
    !["cloakbrowser", "chrome_official", "camoufox"].includes(String(selection.selected_provider_id))) return fail("managed_browser_provider_selection_invalid");
  return { schema_version: selection.schema_version, source: selection.source, selected_provider_id: selection.selected_provider_id };
}
function publicSession(value: unknown): ObjectValue {
  const session = object(value);
  return Object.fromEntries(["runtime_session_ref", "profile_ref", "identity_environment_ref", "provider_id", "lifecycle_state", "control_owner", "control_lock", "current_page", "current_error", "availability"].filter(key => session[key] !== undefined).map(key => [key, session[key]]));
}
function managedRuntimeSessionBinding(session: ObjectValue, identityEnvironmentRef: string, profileRef: string): {
  binding: RuntimeSessionBindingFacts;
  refs: string[];
} {
  const fields = ["runtime_session_ref", "identity_environment_ref", "execution_identity_ref", "profile_ref", "provider_ref", "provider_mode", "lifecycle_state", "control_owner"] as const;
  const facts = Object.fromEntries(fields.map(field => [field, session[field]])) as Record<(typeof fields)[number], unknown>;
  if (fields.some(field => typeof facts[field] !== "string" || !facts[field]) ||
      facts.identity_environment_ref !== identityEnvironmentRef || facts.profile_ref !== profileRef ||
      !["core_task", "user", "agent", "none"].includes(String(facts.control_owner))) {
    return fail("managed_browser_runtime_invalid");
  }
  const binding: RuntimeSessionBindingFacts = {
    schema_version: "webenvoy.runtime-session-binding.v0",
    identity_environment_ref: facts.identity_environment_ref as string,
    execution_identity_ref: facts.execution_identity_ref as string,
    runtime_session_ref: facts.runtime_session_ref as string,
    profile_ref: facts.profile_ref as string,
    provider_ref: facts.provider_ref as string,
    provider_mode: facts.provider_mode as string,
    lifecycle_state: facts.lifecycle_state as string,
    control_owner: facts.control_owner as string,
    session_use: runtimeSessionUseForControlOwner(facts.control_owner as string),
    core_task_run: true,
    consumer_boundary: "Core stores Harbor public refs and status facts only; no credentials, cookies, tokens, profile storage, raw browser endpoints, or raw evidence."
  };
  return {
    binding,
    refs: [...new Set([binding.runtime_session_ref, binding.profile_ref, binding.provider_ref,
      binding.identity_environment_ref, binding.execution_identity_ref])]
  };
}
function response(run: RunRecord) {
  const result = publicRunResult(run);
  return { ok: run.status === "succeeded", run_id: run.run_id, status: run.status,
    ...(result === undefined ? {} : { result }),
    ...(run.public_result_summary?.dispatch_state === undefined ? {} : { dispatch_state: run.public_result_summary.dispatch_state }),
    ...(run.public_result_summary?.reconciliation === undefined ? {} : { reconciliation: run.public_result_summary.reconciliation }),
    ...(run.failure === undefined ? {} : { failure: { code: run.failure.code } }) };
}

export function createManagedBrowserService(options: {
  accessStore: FileManagedAccessStore; runRecordStore: FileRunRecordStore;
  authorizationDecisionStore: FileAuthorizationDecisionStore; executionPolicyConfigStore: FileExecutionPolicyConfigStore;
  harborBaseUrl: string; supervisorToken: string; recoveryService?: ManagedRecoveryService;
}) {
  const store = options.runRecordStore;
  const directory = join(store.directory, "managed-operation-locks");
  const businessTargetStore = createFileBusinessTargetStore({ directory: join(store.directory, "business-targets") });
  async function harbor(path: string, body?: ObjectValue, receiptKind?: "interaction" | "page" | "file", deadlineAt?: number): Promise<ObjectValue> {
    const remainingMs = deadlineAt === undefined ? 70_000 : Math.min(70_000, deadlineAt - Date.now());
    if (remainingMs <= 0) return fail("managed_task_timeout");
    const mutationOperation = path === "/runtime/identity-environment-mutations" && typeof body?.operation === "string" && profileMutationOperations.has(body.operation)
      ? body.operation : undefined;
    const url = new URL(path, options.harborBaseUrl);
    const requestBody = body === undefined ? undefined : JSON.stringify(body);
    let result: Response;
    try {
      result = await fetch(url, { method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${options.supervisorToken}`, "content-type": "application/json" },
        ...(requestBody === undefined ? {} : { body: requestBody }), signal: AbortSignal.timeout(remainingMs) });
    } catch (error) {
      if (mutationOperation) throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
      throw error;
    }
    let payload: unknown;
    try { payload = await result.json(); }
    catch (error) {
      if (mutationOperation) throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
      throw error;
    }
    const value = mutationOperation ? profileMutationReceipt(payload, mutationOperation) : object(payload);
    if (receiptKind !== undefined) {
      if (["completed", "unavailable", "unknown_outcome"].includes(String(value.status)) && ["not_dispatched", "dispatched"].includes(String(value.dispatch_state))) return value;
      throw new Error(`managed_${receiptKind}_receipt_unavailable`);
    }
    if (mutationOperation) {
      if (value.status === "rejected" || value.status === "repair_required") return value;
      if (!result.ok) throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
      return value;
    }
    // Harbor uses 409 for a delete receipt that still needs local repair. Keep
    // the durable receipt available to the caller so it stays unknown until a
    // GET-only reconciliation reads that same key.
    if (value.status === "repair_required") return value;
    if (!result.ok || value.status === "unavailable" || value.status === "failed" || value.lifecycle_state === "failed") {
      const failure = value.failure && typeof value.failure === "object" ? object(value.failure) : {};
      const error = value.current_error && typeof value.current_error === "object" ? object(value.current_error) : {};
      return fail(typeof value.failure_class === "string" ? value.failure_class : typeof failure.code === "string" ? failure.code : typeof error.code === "string" ? error.code : "managed_browser_runtime_refused");
    }
    return value;
  }
  async function resolveBusinessTargetAccountScopes(profileRef: string, selections: { account_system_ref: string; account_ref: string }[]): Promise<ManagedBusinessTargetAccountScope[]> {
    const list = await harbor("/runtime/identity-environments");
    if (!Array.isArray(list.identity_environments)) return fail("managed_browser_runtime_invalid");
    const rawProfile = list.identity_environments.find(item => rawProfileRef(item) === profileRef);
    const profile = rawProfile === undefined ? undefined : publicProfile(rawProfile);
    if (!profile) return fail("business_target_profile_not_found");
    const liveBindings = businessTargetAccountBindings(profile);
    if (!Array.isArray(selections) || selections.length < 1 || selections.length > 128) return fail("managed_access_invalid_input");
    const unique = new Set<string>();
    return selections.map(selection => {
      if (!selection || typeof selection.account_system_ref !== "string" || typeof selection.account_ref !== "string") return fail("managed_access_invalid_input");
      const key = `${selection.account_system_ref}\u0000${selection.account_ref}`;
      if (unique.has(key)) return fail("managed_access_invalid_input");
      unique.add(key);
      const match = liveBindings.find(binding => binding.account_system_ref === selection.account_system_ref && binding.account_ref === selection.account_ref);
      return requireRunnableBusinessTargetBinding(match);
    });
  }
  async function resolveBusinessTargetOperationFacts(access: Awaited<ReturnType<FileManagedAccessStore["checkAccess"]>>, input: Request) {
    const profileRef = text(input.profile_ref);
    const list = await harbor("/runtime/identity-environments");
    if (!Array.isArray(list.identity_environments)) return fail("managed_browser_runtime_invalid");
    const rawProfile = list.identity_environments.find(item => rawProfileRef(item) === profileRef);
    const profile = rawProfile === undefined ? undefined : publicProfile(rawProfile);
    if (!profile) return fail("business_target_profile_not_found");
    const liveBindings = businessTargetAccountBindings(profile);
    const snapshots = access.grant.business_target_account_scopes ?? [];
    const allowedAccountScopes = snapshots.filter(snapshot => snapshot.profile_ref === profileRef && liveBindings.some(live =>
      live.ownership_status === "unique" && live.account_system_ref === snapshot.account_system_ref && live.account_ref === snapshot.account_ref));
    const blockedAccountScopes: (BusinessTargetAccountScope & { ownership_status: "conflict" | "not_runnable" | "unknown" | "changed" })[] = [];
    for (const snapshot of snapshots) {
      if (snapshot.profile_ref !== profileRef) continue;
      const live = liveBindings.find(binding => binding.account_system_ref === snapshot.account_system_ref && binding.account_ref === snapshot.account_ref);
      if (!live) blockedAccountScopes.push({ ...snapshot, ownership_status: "changed" });
      else if (live.ownership_status !== "unique") blockedAccountScopes.push({ ...snapshot, ownership_status: live.ownership_status });
    }
    if (["business_target.create", "business_target.list"].includes(input.operation)) {
      const selected = snapshots.find(scope => scope.profile_ref === profileRef && scope.account_system_ref === input.account_system_ref && scope.account_ref === input.account_ref);
      if (!selected) return fail("business_target_scope_unavailable");
      const live = liveBindings.find(binding => binding.account_system_ref === input.account_system_ref && binding.account_ref === input.account_ref);
      if (!live) return fail("business_target_account_binding_changed");
      requireRunnableBusinessTargetBinding(live);
    }
    return { allowed_account_scopes: allowedAccountScopes, blocked_account_scopes: blockedAccountScopes };
  }
  async function authorize(hash: string, input: Request, runId: string, deadlineAt?: number) {
    const access = await options.accessStore.checkAccess(hash, accessRequest(input));
    const catalog = await harbor("/runtime/managed-operation-catalog", undefined, undefined, deadlineAt);
    const version = digest(JSON.stringify(catalog));
    const controlled = isInteraction(input.operation);
    const preference = isProviderPreference(input.operation);
    const policyOperation = controlled ? isInput(input.operation) ? "controlled-page.interact" : "controlled-page.observe" : input.operation;
    const proof = matchHarborBusinessOperationOwner(catalog, policyOperation, {
      schema_version: "webenvoy.harbor-resource-match.v0", match_ref: `resource-match:${version.slice(0, 32)}`,
      match_version: `sha256:${digest(JSON.stringify({ catalog: version, profile_ref: input.profile_ref, origin: input.origin, policy: access.profile_policy }))}`,
      matched_requirement_refs: preference ? ["harbor://browser-provider-preference"] : ["harbor://managed-profile", ...(controlled || managedFileOperations.includes(input.operation as typeof managedFileOperations[number]) ? ["harbor://controlled-page"] : []), ...(managedFileOperations.includes(input.operation as typeof managedFileOperations[number]) ? ["harbor://managed-file"] : [])]
    });
    if (!proof) return fail("execution_policy_owner_declaration_invalid");
    const evaluation = evaluateExecutionPolicy({ caller: "agent", evaluated_at: new Date().toISOString(),
      action: { action_instance_ref: `managed-action:${runId}`, action_id: policyOperation,
        // The policy owner acts on a Profile. Its exact origin is checked by the
        // access intersection and bound above, including explicitly approved local origins.
        target: preference
          ? { target_ref: "browser-provider-preference:local", target_type: "provider_preference" }
          : { target_ref: input.profile_ref ?? input.template_ref ?? input.grant_id, target_type: "managed_profile" } },
      owner_proof: proof, context: { skill_ref: "harbor:managed-browser" },
      policies: await options.executionPolicyConfigStore.resolveSources({ skill_ref: "harbor:managed-browser" }) });
    const decision = await options.authorizationDecisionStore.recordAuthorizationDecision({ idempotency_key: `managed-policy:${runId}`,
      subject: { scope: "environment", operation_ref: runId }, evaluation });
    if (evaluation.status !== "evaluated" || evaluation.next_step !== "execute") return fail("managed_browser_policy_refused");
    return { ...access, decision_ref: decision.decision_ref };
  }
  async function executeBusinessTarget(hash: string, input: Request, runId: string): Promise<ObjectValue> {
    const access = await options.accessStore.checkAccess(hash, accessRequest(input));
    const profileRef = text(input.profile_ref);
    const targetFacts = await resolveBusinessTargetOperationFacts(access, input);
    const currentAccess = await options.accessStore.checkAccess(hash, accessRequest(input));
    if (currentAccess.grant.grant_id !== access.grant.grant_id) return fail("managed_access_denied");
    await store.updateRunRecord(runId, { evidence_refs: [`managed-business-target:${runId}`] });
    const result = await businessTargetStore.operate({
      operation: input.operation as typeof managedBusinessTargetOperations[number],
      operation_ref: runId,
      request_hash: digest(JSON.stringify(input)),
      profile_ref: profileRef,
      allowed_account_scopes: targetFacts.allowed_account_scopes,
      blocked_account_scopes: targetFacts.blocked_account_scopes,
      ...(input.account_system_ref === undefined ? {} : { account_system_ref: input.account_system_ref }),
      ...(input.account_ref === undefined ? {} : { account_ref: input.account_ref }),
      ...(input.business_target_ref === undefined ? {} : { business_target_ref: input.business_target_ref }),
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.declared_external_id === undefined ? {} : { declared_external_id: input.declared_external_id })
    });
    return result as ObjectValue;
  }
  async function execute(hash: string, input: Request, runId: string, deadlineAt?: number): Promise<ObjectValue> {
    const ensureTaskActive = async () => {
      if (deadlineAt !== undefined && Date.now() >= deadlineAt) return fail("managed_task_timeout");
      if (deadlineAt !== undefined) {
        const current = await store.getRunRecord(runId);
        if (!current || current.status !== "running") return fail("managed_task_cancelled");
      }
    };
    const runtimeHarbor = async (path: string, body?: ObjectValue, receiptKind?: "interaction" | "page" | "file") => {
      await ensureTaskActive();
      return harbor(path, body, receiptKind, deadlineAt);
    };
    if (isBusinessTargetOperation(input.operation)) {
      await ensureTaskActive();
      return executeBusinessTarget(hash, input, runId);
    }
    const access = await authorize(hash, input, runId, deadlineAt);
    const check = async () => { await ensureTaskActive(); return options.accessStore.checkAccess(hash, accessRequest(input)); };
    await ensureTaskActive();
    await store.updateRunRecord(runId, { evidence_refs: [access.decision_ref] });
    const holder = access.principal.principal_id;
    if (isProviderPreference(input.operation)) {
      await check();
      if (input.operation === "provider.preference.read") {
        const [preferenceValue, providerCatalogValue] = await Promise.all([
          runtimeHarbor("/runtime/browser-provider-preference"),
          runtimeHarbor("/runtime/browser-providers")
        ]);
        const preference = projectManagedProviderPreference(preferenceValue);
        const providerFacts = projectManagedProviderCatalogFacts(providerCatalogValue);
        if (!preference || !providerFacts || !providerFactsMatchPreference(preference, providerFacts)) return fail("managed_browser_provider_facts_malformed");
        return { preference, provider_facts: providerFacts, authorization_decision_ref: access.decision_ref };
      }
      const preference = await runtimeHarbor("/runtime/browser-provider-preference", input.operation === "provider.preference.set"
        ? { operation: "set", idempotency_key: runId, provider_id: input.provider_id! }
        : { operation: "clear", idempotency_key: runId });
      if (preference.status !== "completed") {
        const failure = preference.failure && typeof preference.failure === "object" ? object(preference.failure) : {};
        return fail(typeof failure.code === "string" ? failure.code : "managed_browser_runtime_refused");
      }
      return { preference, authorization_decision_ref: access.decision_ref };
    }
    if (isRecovery(input.operation)) {
      await check();
      if (!options.recoveryService) return fail("recovery_unavailable");
      try {
        const recovery = input.operation === "recovery.inspect"
          ? await options.recoveryService.inspect({ idempotency_key: input.idempotency_key, profile_ref: input.profile_ref })
          : input.operation === "recovery.request"
            ? await options.recoveryService.request({ idempotency_key: input.idempotency_key, profile_ref: input.profile_ref, ...(input.backup_ref === undefined ? {} : { backup_ref: input.backup_ref }) })
            : await options.recoveryService.status({ operation_ref: input.operation_ref! }, input.profile_ref);
        return { recovery, authorization_decision_ref: access.decision_ref };
      } catch (error) {
        if (error instanceof ProfileRecoveryCoreError) throw new ManagedAccessError(error.code);
        throw error;
      }
    }
    if (input.operation === "profile.create" || input.operation === "profile.copy_environment") {
      // Unknown creation blocks further quota consumption until the existing receipt is reconciled.
      const unresolved = (await store.listRunRecords()).some(run => run.run_id !== runId && run.public_result_summary?.grant_id === input.grant_id &&
        ["profile.create", "profile.copy_environment"].includes(String(run.public_result_summary?.operation)) && ["running", "admitted", "unknown_outcome"].includes(run.status) && run.public_result_summary?.reconciliation !== "completed");
      if (unresolved) return fail("managed_browser_creation_reconciliation_required");
      await check();
      const template = access.creation_template!;
      if (input.operation === "profile.create") {
        if (template.provider_id !== null && input.provider_id !== undefined) return fail("managed_browser_template_provider_conflict");
        const created = await runtimeHarbor("/runtime/identity-environment-mutations", { operation: "create", idempotency_key: runId,
          identity_environment: { site: template.site, ...((template.provider_id ?? input.provider_id) === undefined ? {} : { requested_provider_id: template.provider_id ?? input.provider_id }), language: template.language, timezone: template.timezone } });
        if (created.status === "rejected") return fail(text(object(created.failure).code));
        if (created.status !== "completed") throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
        try {
          const profile = publicProfile(created.record);
          const providerSelection = publicProviderSelection(created.provider_selection);
          if (created.identity_environment_ref !== profile.identity_environment_ref || created.source_identity_environment_ref !== null) throw new Error("profile_create_receipt_mismatch");
          await options.accessStore.recordCreatedProfile({ idempotency_key: runId, grant_id: input.grant_id, profile_ref: profile.profile_ref });
          return { profile, provider_selection: providerSelection, authorization_decision_ref: access.decision_ref };
        } catch (error) {
          throw new CreationReceiptFailure(error instanceof ManagedAccessError ? error.code : "managed_browser_creation_unknown");
        }
      }
      if (template.provider_id === null) return fail("managed_browser_template_provider_unspecified");
      const list = await runtimeHarbor("/runtime/identity-environments");
      if (!Array.isArray(list.identity_environments)) return fail("managed_browser_runtime_invalid");
      // Select by the already-authorized exact Profile ref before validating its record.
      // A malformed unrelated Profile must not block a copy from this source.
      const sourceRecord = list.identity_environments.find(profile => rawProfileRef(profile) === input.profile_ref);
      const source = sourceRecord === undefined ? undefined : publicProfile(sourceRecord);
      if (!source) return fail("managed_browser_profile_not_found");
      if (source.lifecycle_state === "archived") return fail("managed_browser_profile_archived");
      assertCopyTemplateMatch(source, template);
      const currentAccess = await check();
      if (accessFingerprint(currentAccess) !== accessFingerprint(access)) return fail("managed_browser_authorization_changed");
      const sourcePolicySnapshot = access.profile_policy;
      if (!sourcePolicySnapshot || sourcePolicySnapshot.profile_ref !== source.profile_ref) return fail("managed_browser_profile_policy_unavailable");
      const current = (await store.getRunRecord(runId))!;
      await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary,
        source_identity_environment_ref: source.identity_environment_ref,
        copy_template_snapshot: copyTemplateFacts(template), copy_source_policy_snapshot: sourcePolicySnapshot } });
      const expectedSource = { provider_id: template.provider_id, site: template.site, language: template.language, timezone: template.timezone };
      const copied = await runtimeHarbor("/runtime/identity-environment-mutations", {
        operation: "copy_environment", idempotency_key: runId, identity_environment_ref: text(source.identity_environment_ref),
        expected_environment_template: expectedSource
      });
      if (copied.status === "rejected") {
        const failure = copied.failure && typeof copied.failure === "object" ? object(copied.failure) : {};
        return fail(typeof failure.code === "string" ? failure.code : "managed_browser_runtime_refused");
      }
      if (copied.status !== "completed") throw new CreationReceiptFailure("managed_browser_copy_unknown");
      try {
        const profile = publicProfile(copied.record);
        assertCopyTemplateMatch(profile, template);
        if (copied.operation !== "copy_environment" || copied.identity_environment_ref !== profile.identity_environment_ref ||
            copied.source_identity_environment_ref !== source.identity_environment_ref || profile.profile_ref === source.profile_ref ||
            profile.identity_environment_ref === source.identity_environment_ref || profile.lifecycle_state !== "active") throw new Error("managed_browser_copy_result_invalid");
        await options.accessStore.recordCreatedProfile({ idempotency_key: runId, grant_id: input.grant_id,
          operation: "profile.copy_environment", source_profile_ref: source.profile_ref,
          source_policy_snapshot: sourcePolicySnapshot, profile_ref: profile.profile_ref });
        return { profile, authorization_decision_ref: access.decision_ref };
      } catch (error) {
        throw new CreationReceiptFailure(error instanceof ManagedAccessError ? error.code : "managed_browser_copy_unknown");
      }
    }
    const list = await runtimeHarbor("/runtime/identity-environments");
    if (!Array.isArray(list.identity_environments)) return fail("managed_browser_runtime_invalid");
    if (input.operation === "profile.list") {
      const visible = list.identity_environments.filter(raw => {
        const profileRef = rawProfileRef(raw);
        return profileRef !== undefined && access.grant.profile_refs.includes(profileRef);
      }).map(publicProfile);
      return { profiles: visible };
    }
    const rawProfile = list.identity_environments.find(raw => rawProfileRef(raw) === input.profile_ref);
    if (!rawProfile) return fail("managed_browser_profile_not_found");
    const profile = publicProfile(rawProfile);
    if (input.operation === "profile.read") return { profile };
    if (input.operation === "instance.start" && profile.lifecycle_state === "archived") return fail("managed_browser_profile_archived");
    const identityEnvironmentRef = text(profile.identity_environment_ref);
    const identity = encodeURIComponent(identityEnvironmentRef);
    if (input.operation === "profile.metadata.update") {
      await check();
      const current = (await store.getRunRecord(runId))!;
      await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary,
        identity_environment_ref: identityEnvironmentRef } });
      const mutation = await runtimeHarbor("/runtime/identity-environment-mutations", {
        operation: "profile.metadata.update",
        idempotency_key: runId,
        identity_environment_ref: identityEnvironmentRef,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.tags === undefined ? {} : { tags: input.tags })
      });
      if (mutation.operation !== "profile.metadata.update" || mutation.identity_environment_ref !== identityEnvironmentRef || mutation.source_identity_environment_ref !== null) {
        throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
      }
      if (mutation.status === "rejected") {
        const failure = mutation.failure && typeof mutation.failure === "object" ? object(mutation.failure) : {};
        return fail(typeof failure.code === "string" ? failure.code : "managed_browser_runtime_refused");
      }
      if (mutation.status !== "completed") throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
      try {
        const updated = publicProfile(mutation.record);
        if (updated.profile_ref !== input.profile_ref || updated.identity_environment_ref !== identityEnvironmentRef) throw new Error("profile_metadata_receipt_mismatch");
        return { profile: updated, authorization_decision_ref: access.decision_ref };
      } catch {
        throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
      }
    }
    if (input.operation === "profile.archive" || input.operation === "profile.delete") {
      const current = (await store.getRunRecord(runId))!;
      await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary,
        identity_environment_ref: identityEnvironmentRef } });
      await check();
      const mutation = await runtimeHarbor("/runtime/identity-environment-mutations", {
        operation: input.operation === "profile.archive" ? "archive" : "delete",
        idempotency_key: runId,
        identity_environment_ref: identityEnvironmentRef,
        ...(input.operation === "profile.delete" ? { confirmation: input.confirmation } : {})
      });
      if (mutation.status === "repair_required") throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
      if (mutation.status === "rejected") {
        const failure = mutation.failure && typeof mutation.failure === "object" ? object(mutation.failure) : {};
        return fail(typeof failure.code === "string" ? failure.code : "managed_browser_runtime_refused");
      }
      if (mutation.status !== "completed") throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
      const expectedOperation = input.operation === "profile.archive" ? "archive" : "delete";
      if (mutation.operation !== expectedOperation || mutation.identity_environment_ref !== identityEnvironmentRef ||
          mutation.source_identity_environment_ref !== identityEnvironmentRef) throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
      if (input.operation === "profile.delete") {
        const effects = mutation.effects && typeof mutation.effects === "object" && !Array.isArray(mutation.effects) ? mutation.effects as ObjectValue : undefined;
        if (mutation.record !== null || effects?.index !== "removed" || effects?.local_data !== "deleted") throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
      }
      let archivedProfile: ObjectValue | undefined;
      if (input.operation === "profile.archive") {
        try { archivedProfile = publicProfile(mutation.record); }
        catch { throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown"); }
      }
      if (archivedProfile && (archivedProfile.profile_ref !== input.profile_ref || archivedProfile.identity_environment_ref !== identityEnvironmentRef || archivedProfile.lifecycle_state !== "archived")) {
        throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
      }
      return {
        ...(archivedProfile ? { profile: archivedProfile } : { receipt: mutation }),
        authorization_decision_ref: access.decision_ref
      };
    }
    if (isEnvironment(input.operation)) await check();
    if (input.operation === "environment.read") return await runtimeHarbor(`/runtime/identity-environments/${identity}/environment`);
    if (input.operation === "environment.update") return await runtimeHarbor(`/runtime/identity-environments/${identity}/environment`, {
      idempotency_key: runId, configuration: input.configuration!
    });
    const active = await runtimeHarbor(`/runtime/identity-environments/${identity}/session`);
    const activeSession = active.runtime_session === null ? undefined : object(active.runtime_session);
    let session = activeSession;
    if (input.operation === "instance.start" && !session) {
      await check();
      session = await runtimeHarbor("/runtime/identity-environment-sessions", { identity_environment_ref: profile.identity_environment_ref,
        operation_scope: "profile_management", url: input.url ?? input.origin, reuse_existing: true,
        control_owner: "core_task", holder_ref: holder, headless: false, timeout_ms: 60_000, scope_semantics: access.scope_semantics });
    }
    if (!session || session.profile_ref !== input.profile_ref) return fail("managed_browser_session_missing");
    if (input.runtime_session_ref !== undefined && session.runtime_session_ref !== input.runtime_session_ref) return fail("managed_browser_session_mismatch");
    const runtimeBinding = managedRuntimeSessionBinding(session, identityEnvironmentRef, text(input.profile_ref));
    await store.bindManagedBrowserRuntimeSession(runId, runtimeBinding.binding, runtimeBinding.refs);
    let leaseSession: ObjectValue = session;
    const ref = encodeURIComponent(text(leaseSession.runtime_session_ref));
    const acquireControlLease = async () => {
      await check();
      const lease = object(leaseSession.control_lock);
      // A user-held Instance is never implicitly taken over by an Agent Page action.
      if (leaseSession.control_owner === "user" && lease.state === "held") return fail("control_lock_conflict");
      if (leaseSession.control_owner !== "core_task" || lease.state !== "held" || lease.holder_ref !== holder) {
        leaseSession = await runtimeHarbor(`/runtime/sessions/${ref}/lock`, { control_owner: "core_task", holder_ref: holder });
        session = leaseSession;
      }
      const acquired = object(leaseSession.control_lock);
      if (leaseSession.control_owner !== "core_task" || acquired.state !== "held" || acquired.holder_ref !== holder) return fail("control_lock_conflict");
      return await check();
    };
    if ((managedPageOperations as readonly string[]).includes(input.operation)) {
      if (input.operation === "page.list") {
        const pageAccess = await check();
        return await runtimeHarbor(`/runtime/sessions/${ref}/pages`, {
          operation: input.operation, holder_ref: holder,
          authorized_origins: pageAccess.authorized_origins, scope_semantics: pageAccess.scope_semantics
        });
      }
      const pageAccess = await acquireControlLease();
      const run = (await store.getRunRecord(runId))!;
      await store.updateRunRecord(runId, { public_result_summary: { ...run.public_result_summary, dispatch_state: "dispatched" } });
      const result = await runtimeHarbor(`/runtime/sessions/${ref}/pages`, {
        operation: input.operation, holder_ref: holder, operation_ref: runId, idempotency_key: runId,
        ...(input.page_id ? { page_id: input.page_id } : {}), ...(input.page_ref ? { page_ref: input.page_ref } : {}),
        ...(input.document_generation ? { document_generation: input.document_generation } : {}), ...(input.url ? { url: input.url } : {}),
        authorized_origins: pageAccess.authorized_origins, scope_semantics: pageAccess.scope_semantics
      }, "page");
      const safeResult = pageAccess.scope_semantics === "agent_operations_v2" ? redactCompletedPage(result, pageAccess.authorized_origins, input.page_ref) : result;
      if (safeResult.status !== "completed") throw new PageFailure(safeResult);
      return safeResult;
    }
    if ((managedFileOperations as readonly string[]).includes(input.operation)) {
      const fileAccess = await acquireControlLease();
      const run = (await store.getRunRecord(runId))!;
      await store.updateRunRecord(runId, { public_result_summary: { ...run.public_result_summary, dispatch_state: "dispatched" } });
      const result = await runtimeHarbor(`/runtime/sessions/${ref}/files`, {
        operation: input.operation,
        operation_ref: runId,
        idempotency_key: runId,
        holder_ref: holder,
        principal_id: fileAccess.principal.principal_id,
        profile_ref: input.profile_ref!,
        expected_origin: input.origin!,
        authorized_origins: fileAccess.authorized_origins, scope_semantics: fileAccess.scope_semantics,
        page_id: input.page_id!,
        page_ref: input.page_ref!,
        document_generation: input.document_generation!,
        observation_ref: input.observation_ref!,
        target_ref: input.target_ref!,
        ...(input.file_ref === undefined ? {} : { file_ref: input.file_ref }),
        ...(fileAccess.grant.file_scope === undefined ? {} : { max_file_bytes: fileAccess.grant.file_scope.max_file_bytes, allowed_mime_types: fileAccess.grant.file_scope.allowed_mime_types }),
        ...(input.timeout_ms === undefined ? {} : { timeout_ms: input.timeout_ms })
      }, "file");
      const safeResult = fileAccess.scope_semantics === "agent_operations_v2" ? redactCompletedPage(result, fileAccess.authorized_origins, input.page_ref) : result;
      if (safeResult.status !== "completed") throw new FileFailure(safeResult);
      return safeResult;
    }
    if (input.operation === "instance.diagnostics") {
      // Network/console diagnostics are pure observation and must not acquire or refresh the input lease.
      const diagnosticsAccess = await check();
      return await runtimeHarbor(`/runtime/sessions/${ref}/diagnostics`, {
        origin: input.origin!, authorized_origins: diagnosticsAccess.authorized_origins, scope_semantics: diagnosticsAccess.scope_semantics, ...(input.page_ref ? { page_ref: input.page_ref } : {}),
        ...(input.document_generation ? { document_generation: input.document_generation } : {}),
        ...(input.cursor ? { cursor: input.cursor } : {}), ...(input.limit ? { limit: input.limit } : {})
      });
    }
    if (!isObservation(input.operation)) await acquireControlLease();
    else await check();
    if (input.operation === "instance.stop") return { session: publicSession(await runtimeHarbor(`/runtime/sessions/${ref}/stop`, { control_owner: "core_task", holder_ref: holder })) };
    if (input.operation === "instance.handoff") return { session: publicSession(await runtimeHarbor(`/runtime/sessions/${ref}/handoff`, { control_owner: "user", expected_control_owner: "core_task", handoff_reason: "user_requested", holder_ref: holder })) };
    if (isInteraction(input.operation)) {
      const interactionAccess = await check();
      const run = (await store.getRunRecord(runId))!;
      if (input.operation === "instance.snapshot") {
        // Snapshot is an observation, not a dispatched write. The same-status
        // update is also the final atomic cancellation checkpoint before the
        // Harbor request; a concurrent task.stop makes this update fail.
        await store.updateRunRecord(runId, { status: "running" });
      } else {
        await store.updateRunRecord(runId, { public_result_summary: { ...run.public_result_summary, dispatch_state: "dispatched" } });
      }
      const result = await runtimeHarbor(`/runtime/sessions/${ref}/interactions`, {
        holder_ref: holder, operation_ref: runId, expected_origin: input.origin, controlled_origin: input.origin,
        // Harbor must enforce the Core-checked grant ∩ Profile ∩ task
        // intersection for every request/redirect, not re-derive trust from
        // Agent-supplied origin fields.
        authorized_origins: interactionAccess.authorized_origins, scope_semantics: interactionAccess.scope_semantics,
        action: input.operation.slice("instance.".length),
        ...Object.fromEntries(["page_id", "page_ref", "document_generation", "observation_ref", "cursor", "limit", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms"].filter(key => input[key as keyof Request] !== undefined).map(key => [key, input[key as keyof Request]]))
      }, "interaction");
      const safeResult = interactionAccess.scope_semantics === "agent_operations_v2" ? redactCompletedPage(result, interactionAccess.authorized_origins, input.page_ref) : result;
      if (safeResult.status !== "completed") throw new InteractionFailure(safeResult);
      return safeResult;
    }
    if (input.operation === "instance.navigate" || input.operation === "instance.read") {
      const pageBinding = { holder_ref: holder, expected_origin: input.origin,
        scope_semantics: access.scope_semantics,
        ...(input.page_id ? { page_id: input.page_id } : {}), ...(input.page_ref ? { page_ref: input.page_ref } : {}),
        ...(input.document_generation ? { document_generation: input.document_generation } : {}) };
      await runtimeHarbor(`/runtime/sessions/${ref}/observe`, pageBinding);
      await check();
      const result = await runtimeHarbor(`/runtime/sessions/${ref}/${input.operation === "instance.navigate" ? "navigate" : "read"}`, {
        holder_ref: holder, expected_origin: input.origin, scope_semantics: access.scope_semantics, ...(input.page_id ? { page_id: input.page_id } : {}),
        ...(input.page_ref ? { page_ref: input.page_ref } : {}), ...(input.document_generation ? { document_generation: input.document_generation } : {}),
        ...(input.url ? { url: input.url } : {}) });
      const boundary = access.scope_semantics === "agent_operations_v2" ? redirectedSessionBoundary(result, access.authorized_origins, input.page_ref) : undefined;
      if (boundary) throw new ScopeBoundaryFailure(boundary);
      return { session: publicSession(result.session), ...(result.text === undefined ? {} : { text: result.text, truncated: result.truncated }), observed_at: result.observed_at };
    }
    const observation = await runtimeHarbor(`/runtime/sessions/${ref}/observe`, { holder_ref: holder, expected_origin: input.origin, scope_semantics: access.scope_semantics,
      ...(input.page_id ? { page_id: input.page_id } : {}), ...(input.page_ref ? { page_ref: input.page_ref } : {}),
      ...(input.document_generation ? { document_generation: input.document_generation } : {}) });
    const page = object(observation.page);
    let observedOrigin: string;
    try { observedOrigin = new URL(text(page.current_url)).origin; } catch { return fail("managed_browser_observation_unknown"); }
    if (observedOrigin !== input.origin) {
      if (access.scope_semantics === "agent_operations_v2") throw new ScopeBoundaryFailure(redactedBoundaryReceipt(observation, input.page_ref));
      return fail("managed_browser_observed_origin_denied");
    }
    if (input.operation === "account.bind") {
      await check();
      const bound = await runtimeHarbor(`/runtime/identity-environments/${identity}/account-bindings`, {
        observation_ref: text(input.observation_ref), account_system_ref: text(input.account_system_ref), account_ref: text(input.account_ref),
        idempotency_key: runId, holder_ref: holder });
      return { profile: publicProfile(bound), observation };
    }
    return { session: publicSession(session), observation };
  }
  async function readProfileVisibility(credentialHash: string, connectionId: string, context: DescribeContext) {
    if (!context.task_scope.profile_refs.includes(context.profile_ref)) return fail("discovery_context_unavailable");
    const candidates = ["profile.read", "profile.list"].filter(operation => context.task_scope.operations.includes(operation as ManagedAccessRequest["operation"]));
    for (const operation of candidates) {
      try {
        const access = await options.accessStore.checkAccess(credentialHash, {
          connection_id: connectionId,
          grant_id: context.grant_id,
          operation,
          profile_ref: context.profile_ref,
          task_scope: { operations: [operation], profile_refs: [context.profile_ref], origins: context.task_scope.origins }
        });
        if (operation === "profile.list" && !access.grant.profile_refs.includes(context.profile_ref)) continue;
        return access;
      } catch (error) {
        const code = error instanceof ManagedAccessError ? error.code : "managed_access_unavailable";
        if (["managed_access_authentication_required", "managed_access_connection_unavailable", "managed_access_grant_unavailable"].includes(code)) throw error;
      }
    }
    return fail("discovery_context_unavailable");
  }
  async function evaluatePolicy(access: Awaited<ReturnType<FileManagedAccessStore["checkAccess"]>>, input: Request, actionRef: string) {
    const catalog = await harbor("/runtime/managed-operation-catalog");
    const version = digest(JSON.stringify(catalog));
    const controlled = isInteraction(input.operation);
    const preference = isProviderPreference(input.operation);
    const policyOperation = controlled ? isInput(input.operation) ? "controlled-page.interact" : "controlled-page.observe" : input.operation;
    const proof = matchHarborBusinessOperationOwner(catalog, policyOperation, {
      schema_version: "webenvoy.harbor-resource-match.v0", match_ref: `resource-match:${version.slice(0, 32)}`,
      match_version: `sha256:${digest(JSON.stringify({ catalog: version, profile_ref: input.profile_ref, origin: input.origin, policy: access.profile_policy }))}`,
      matched_requirement_refs: preference ? ["harbor://browser-provider-preference"] : ["harbor://managed-profile", ...(controlled || managedFileOperations.includes(input.operation as typeof managedFileOperations[number]) ? ["harbor://controlled-page"] : []), ...(managedFileOperations.includes(input.operation as typeof managedFileOperations[number]) ? ["harbor://managed-file"] : [])]
    });
    if (!proof) return undefined;
    return evaluateExecutionPolicy({ caller: "agent", evaluated_at: new Date().toISOString(),
      action: { action_instance_ref: actionRef, action_id: policyOperation,
        target: preference ? { target_ref: "browser-provider-preference:local", target_type: "provider_preference" } : { target_ref: input.profile_ref ?? input.template_ref ?? input.grant_id, target_type: "managed_profile" } },
      owner_proof: proof, context: { skill_ref: "harbor:managed-browser" },
      policies: await options.executionPolicyConfigStore.resolveSources({ skill_ref: "harbor:managed-browser" }) });
  }
  async function describeBusinessTargetContext(
    credentialHash: string,
    connection: Awaited<ReturnType<FileManagedAccessStore["checkConnection"]>>,
    context: DescribeContext,
    target: Request,
    assessment: ReturnType<typeof describeInputAssessment>,
    visibilitySnapshot: string,
    result: ObjectValue,
    finish: () => ObjectValue
  ): Promise<ObjectValue> {
    const factsAt = () => new Date().toISOString();
    const unknown = () => {
      result.authorization = { state: "unknown", reason_codes: ["facts_changed"] };
      result.availability = { state: "unknown", reason_codes: ["facts_changed"], facts_at: null };
      result.next_steps = [discoveryNextStep("retry_description", target.operation)];
      return finish();
    };
    result.provider = { state: "not_applicable", provider_id: null, reason_codes: [], limitations: [], facts_at: factsAt() };
    result.authorization = { state: "not_evaluated", reason_codes: [] };
    result.availability = { state: "not_evaluated", reason_codes: [], facts_at: null };
    if (assessment.state === "incomplete" || assessment.state === "invalid" || assessment.state === "not_provided") {
      try {
        const finalConnection = await options.accessStore.checkConnection(credentialHash, connection.connection.connection_id);
        const finalVisible = await readProfileVisibility(credentialHash, finalConnection.connection.connection_id, context);
        if (finalConnection.principal.principal_id !== connection.principal.principal_id ||
            finalConnection.connection.connection_id !== connection.connection.connection_id ||
            accessFingerprint(finalVisible) !== visibilitySnapshot) return unknown();
      } catch { return unknown(); }
      result.next_steps = [discoveryNextStep("fill_inputs", target.operation, [...assessment.missing, ...assessment.invalid.map(issue => issue.path)])];
    } else {
      let initialAccess: Awaited<ReturnType<FileManagedAccessStore["checkAccess"]>> | undefined;
      let initialAuthorization: { state: "allowed" | "denied" | "unknown"; reason_codes: string[] };
      try {
        initialAccess = await options.accessStore.checkAccess(credentialHash, accessRequest(target));
        initialAuthorization = { state: "allowed", reason_codes: [] };
      } catch (error) {
        const code = error instanceof ManagedAccessError ? error.code : "managed_access_unavailable";
        if (["managed_access_authentication_required", "managed_access_connection_unavailable", "managed_access_grant_unavailable"].includes(code)) throw error;
        initialAuthorization = describeAuthorizationError(code);
      }
      result.authorization = initialAuthorization;
      let initialAssessment: Awaited<ReturnType<typeof businessTargetStore.inspect>> | undefined;
      let initialLocalState: string | undefined;
      if (initialAccess) {
        try {
          const facts = await resolveBusinessTargetOperationFacts(initialAccess, target);
          initialAssessment = await businessTargetStore.inspect({ operation: target.operation as typeof managedBusinessTargetOperations[number],
            profile_ref: context.profile_ref, allowed_account_scopes: facts.allowed_account_scopes, blocked_account_scopes: facts.blocked_account_scopes,
            ...(target.account_system_ref === undefined ? {} : { account_system_ref: target.account_system_ref }),
            ...(target.account_ref === undefined ? {} : { account_ref: target.account_ref }),
            ...(target.business_target_ref === undefined ? {} : { business_target_ref: target.business_target_ref }) });
          initialLocalState = JSON.stringify(initialAssessment);
          result.availability = initialAssessment.state === "available"
            ? { state: "no_known_blocker", reason_codes: [], facts_at: factsAt() }
            : { state: "blocked", reason_codes: [initialAssessment.reason_code], facts_at: factsAt() };
        } catch (error) {
          const code = error instanceof ManagedAccessError ? error.code : "runtime_facts_unavailable";
          initialLocalState = `${code.startsWith("business_target_") ? "blocked" : "unknown"}:${code}`;
          result.availability = code.startsWith("business_target_")
            ? { state: "blocked", reason_codes: [code], facts_at: factsAt() }
            : { state: "unknown", reason_codes: [code], facts_at: null };
        }
      } else {
        result.availability = { state: initialAuthorization.state === "denied" ? "blocked" : "unknown",
          reason_codes: initialAuthorization.reason_codes, facts_at: null };
      }

      // A contextual description is advisory. Re-read the exact authorization,
      // selected Profile binding and local record before returning availability.
      let changed = false;
      try {
        const finalConnection = await options.accessStore.checkConnection(credentialHash, connection.connection.connection_id);
        if (finalConnection.principal.principal_id !== connection.principal.principal_id ||
            finalConnection.connection.connection_id !== connection.connection.connection_id) changed = true;
        if (!changed && initialAccess) {
          let finalLocalState: string;
          try {
            const facts = await resolveBusinessTargetOperationFacts(initialAccess, target);
            const finalAssessment = await businessTargetStore.inspect({ operation: target.operation as typeof managedBusinessTargetOperations[number],
              profile_ref: context.profile_ref, allowed_account_scopes: facts.allowed_account_scopes, blocked_account_scopes: facts.blocked_account_scopes,
              ...(target.account_system_ref === undefined ? {} : { account_system_ref: target.account_system_ref }),
              ...(target.account_ref === undefined ? {} : { account_ref: target.account_ref }),
              ...(target.business_target_ref === undefined ? {} : { business_target_ref: target.business_target_ref }) });
            finalLocalState = JSON.stringify(finalAssessment);
          } catch (error) {
            const code = error instanceof ManagedAccessError ? error.code : "runtime_facts_unavailable";
            finalLocalState = `${code.startsWith("business_target_") ? "blocked" : "unknown"}:${code}`;
          }
          if (finalLocalState !== initialLocalState) changed = true;
        }
        // Keep the last checks local to Core, after the Harbor binding read.
        const finalVisible = await readProfileVisibility(credentialHash, finalConnection.connection.connection_id, context);
        if (accessFingerprint(finalVisible) !== visibilitySnapshot) changed = true;
        let finalAccess: Awaited<ReturnType<FileManagedAccessStore["checkAccess"]>> | undefined;
        let finalAuthorization: { state: "allowed" | "denied" | "unknown"; reason_codes: string[] };
        try {
          finalAccess = await options.accessStore.checkAccess(credentialHash, accessRequest(target));
          finalAuthorization = { state: "allowed", reason_codes: [] };
        } catch (error) {
          const code = error instanceof ManagedAccessError ? error.code : "managed_access_unavailable";
          finalAuthorization = ["managed_access_authentication_required", "managed_access_connection_unavailable", "managed_access_grant_unavailable"].includes(code)
            ? { state: "unknown", reason_codes: ["facts_changed"] } : describeAuthorizationError(code);
        }
        if (JSON.stringify(finalAuthorization) !== JSON.stringify(initialAuthorization) ||
            initialAccess && (!finalAccess || accessFingerprint(finalAccess) !== accessFingerprint(initialAccess)) ||
            !initialAccess && finalAccess) changed = true;
      } catch {
        changed = true;
      }
      if (changed) return unknown();
      const availability = result.availability as ObjectValue;
      if ((result.authorization as ObjectValue).state === "denied") result.next_steps = [discoveryNextStep("owner_authorize", target.operation)];
      else if (availability.state === "unknown") result.next_steps = [discoveryNextStep("retry_description", target.operation)];
    }
    return finish();
  }
  async function describe(credentialHash: string, value: unknown): Promise<ObjectValue> {
    const input = parseDescribe(value);
    const connection = await options.accessStore.checkConnection(credentialHash, input.connection_id);
    const state = managedCapabilityDefinitionState(input.operation);
    const definition = managedCapabilityDefinition(input.operation);
    const exposure = definition?.exposure === "exposed" ? "exposed" : "not_exposed";
    const assessment = definition ? describeInputAssessment(input, input.context, definition) : input.arguments === undefined
      ? { state: "not_provided" as const, missing: [], invalid: [] }
      : { state: "invalid" as const, missing: [], invalid: [{ path: "/operation", code: "operation_not_defined" }] };
    const checks = discoveryExecutionChecks(input.operation);
    const result: ObjectValue = {
      ok: true,
      schema_version: "webenvoy.capability-description/v1",
      operation: input.operation,
      assessed_at: new Date().toISOString(),
      definition_revision: managedCapabilityDefinitionRevision,
      mode: input.context === undefined ? "definition_only" : "contextual",
      definition: { state, capability: definition?.capability ?? null },
      invocation: {
        exposure,
        tool: exposure === "exposed" ? managedCapabilityDefinitions.operation_tool : null,
        input_schema: exposure === "exposed" ? managedCapabilityExecutionInputSchema(input.operation) : null,
        field_guidance: exposure === "exposed" ? managedCapabilityFieldGuidance(input.operation) : [],
        example: exposure === "exposed" ? managedCapabilityExample(input.operation) : null,
        query_tool: exposure === "exposed" ? managedCapabilityDefinitions.query_tool : null
      },
      provider: { state: input.context === undefined ? "not_evaluated" : "unknown", provider_id: null, reason_codes: input.context === undefined ? [] : ["runtime_facts_unavailable"], limitations: [], facts_at: null },
      authorization: { state: input.context === undefined ? "not_evaluated" : "unknown", reason_codes: input.context === undefined ? [] : ["context_not_evaluated"] },
      availability: { state: input.context === undefined ? "not_evaluated" : "unknown", reason_codes: input.context === undefined ? [] : ["runtime_facts_unavailable"], facts_at: null },
      inputs: { state: assessment.state, missing: assessment.missing, invalid: assessment.invalid },
      execution_checks: checks,
      next_steps: []
    };
    const finish = () => {
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > 64 * 1024) return fail("discovery_response_too_large");
      return result;
    };
    if (input.context === undefined) {
      if (exposure === "exposed" && (assessment.state === "incomplete" || assessment.state === "invalid")) result.next_steps = [discoveryNextStep("fill_inputs", input.operation, [...assessment.missing, ...assessment.invalid.map(issue => issue.path)])];
      else if (state === "defined" && exposure === "not_exposed") result.next_steps = [discoveryNextStep("not_exposed", null)];
      else if (state === "out_of_scope") result.next_steps = [discoveryNextStep("use_existing_tool", null)];
      return finish();
    }
    if (definition?.context === "unsupported") return fail("discovery_context_not_supported");
    const context = input.context;
    const visible = await readProfileVisibility(credentialHash, connection.connection.connection_id, context);
    const visibilitySnapshot = accessFingerprint(visible);
    if (definition?.context !== "profile") {
      result.provider = { state: "not_evaluated", provider_id: null, reason_codes: [], limitations: [], facts_at: null };
      result.authorization = { state: "not_evaluated", reason_codes: [] };
      result.availability = { state: "not_evaluated", reason_codes: [], facts_at: null };
      if (state === "defined" && exposure === "not_exposed") result.next_steps = [discoveryNextStep("not_exposed", null)];
      else if (state === "out_of_scope") result.next_steps = [discoveryNextStep("use_existing_tool", null)];
      return finish();
    }
    const target = { idempotency_key: "describe", connection_id: connection.connection.connection_id, operation: input.operation,
      grant_id: context.grant_id, profile_ref: context.profile_ref, task_scope: context.task_scope, ...(input.arguments ?? {}) } as Request;
    if (isBusinessTargetOperation(input.operation)) {
      return describeBusinessTargetContext(credentialHash, connection, context, target, assessment, visibilitySnapshot, result, finish);
    }
    let targetAccess: Awaited<ReturnType<FileManagedAccessStore["checkAccess"]>> | undefined;
    let targetAuthorizationAssessed = false;
    let targetAuthorizationState: "allowed" | "denied" | "unknown" | undefined;
    if (!assessment.invalid.some(item => item.path.includes("file_ref")) && !assessment.missing.some(path => path.includes("file_refs"))) {
      targetAuthorizationAssessed = true;
      try {
        targetAccess = await options.accessStore.checkAccess(credentialHash, accessRequest(target));
        result.authorization = { state: "allowed", reason_codes: [] };
        targetAuthorizationState = "allowed";
      } catch (error) {
        const code = error instanceof ManagedAccessError ? error.code : "managed_access_unavailable";
        if (["managed_access_authentication_required", "managed_access_connection_unavailable", "managed_access_grant_unavailable"].includes(code)) throw error;
        const authorization = describeAuthorizationError(code);
        result.authorization = authorization;
        targetAuthorizationState = authorization.state;
      }
    }
    const authorizedOrigins = targetAccess?.authorized_origins ?? visible.authorized_origins;
    let harborFacts: ObjectValue | undefined;
    try {
      harborFacts = normalizeHarborCapabilityDescription(await harbor("/runtime/capabilities/describe", {
        operation: input.operation,
        profile_ref: context.profile_ref,
        authorized_origins: authorizedOrigins,
        ...(input.arguments?.runtime_session_ref === undefined ? {} : { runtime_session_ref: input.arguments.runtime_session_ref }),
        ...(input.arguments?.page_id === undefined ? {} : { page_id: input.arguments.page_id }),
        ...(input.arguments?.page_ref === undefined ? {} : { page_ref: input.arguments.page_ref }),
        ...(input.arguments?.document_generation === undefined ? {} : { document_generation: input.arguments.document_generation }),
        ...(input.arguments?.observation_ref === undefined ? {} : { observation_ref: input.arguments.observation_ref }),
        ...(input.arguments?.target_ref === undefined ? {} : { target_ref: input.arguments.target_ref })
      }), input.operation, context.profile_ref);
      if (harborFacts.provider && typeof harborFacts.provider === "object") result.provider = harborFacts.provider;
      if (harborFacts.availability && typeof harborFacts.availability === "object") result.availability = harborFacts.availability;
      if (Array.isArray(harborFacts.execution_checks)) result.execution_checks = [...new Set([...checks, ...harborFacts.execution_checks])];
    } catch (error) {
      if (error instanceof ManagedAccessError && ["discovery_context_unavailable", "discovery_version_mismatch"].includes(error.code)) throw error;
      const code = error instanceof ManagedAccessError ? error.code : "runtime_facts_unavailable";
      result.provider = { state: "unknown", provider_id: null, reason_codes: ["runtime_facts_unavailable"], limitations: [], facts_at: null };
      result.availability = { state: "unknown", reason_codes: [code === "managed_browser_runtime_refused" ? "runtime_facts_unavailable" : code], facts_at: null };
    }
    let initialPolicyState: string | undefined;
    if (result.authorization && (result.authorization as ObjectValue).state === "denied") {
      const authorizationReasons = (result.authorization as ObjectValue).reason_codes;
      result.availability = { state: "blocked", reason_codes: [Array.isArray(authorizationReasons) && typeof authorizationReasons[0] === "string" ? authorizationReasons[0] : "scope_denied"], facts_at: (result.availability as ObjectValue).facts_at ?? null };
    }
    if (targetAccess && (result.inputs as ObjectValue).state === "complete") {
      try {
        const evaluation = await evaluatePolicy(targetAccess, target, `managed-description:${digest(`${context.grant_id}:${context.profile_ref}:${input.operation}`)}`);
        initialPolicyState = evaluation === undefined ? "unavailable" : `${evaluation.status}:${evaluation.next_step}`;
        if (!evaluation) result.availability = { state: "unknown", reason_codes: ["execution_policy_unavailable"], facts_at: (result.availability as ObjectValue).facts_at ?? null };
        else if (evaluation.status !== "evaluated" || evaluation.next_step !== "execute") result.availability = { state: "blocked", reason_codes: ["execution_policy_denied"], facts_at: (result.availability as ObjectValue).facts_at ?? null };
      } catch { result.availability = { state: "unknown", reason_codes: ["execution_policy_unavailable"], facts_at: (result.availability as ObjectValue).facts_at ?? null }; }
    }
    // Facts may change while Harbor is being read. Recheck the Connection,
    // visibility Grant, target authorization, policy, and Harbor's narrow
    // control/runtime snapshot before returning contextual details.
    let factsChanged = false;
    let finalAuthorizedOrigins = authorizedOrigins;
    try {
      const finalConnection = await options.accessStore.checkConnection(credentialHash, connection.connection.connection_id);
      const finalVisible = await readProfileVisibility(credentialHash, finalConnection.connection.connection_id, context);
      if (finalConnection.principal.principal_id !== connection.principal.principal_id ||
          finalConnection.connection.connection_id !== connection.connection.connection_id ||
          accessFingerprint(finalVisible) !== visibilitySnapshot) factsChanged = true;
      finalAuthorizedOrigins = finalVisible.authorized_origins;
      if (!factsChanged && targetAuthorizationAssessed) {
        let finalTargetAccess: Awaited<ReturnType<FileManagedAccessStore["checkAccess"]>> | undefined;
        let finalAuthorizationState: "allowed" | "denied" | "unknown" = "unknown";
        try {
          finalTargetAccess = await options.accessStore.checkAccess(credentialHash, accessRequest(target));
          finalAuthorizationState = "allowed";
        } catch (error) {
          const code = error instanceof ManagedAccessError ? error.code : "managed_access_unavailable";
          finalAuthorizationState = ["managed_access_authentication_required", "managed_access_connection_unavailable", "managed_access_grant_unavailable"].includes(code)
            ? "unknown" : describeAuthorizationError(code).state;
        }
        finalAuthorizedOrigins = finalTargetAccess?.authorized_origins ?? finalVisible.authorized_origins;
        if (finalAuthorizationState !== targetAuthorizationState || targetAccess && (!finalTargetAccess || accessFingerprint(finalTargetAccess) !== accessFingerprint(targetAccess))) factsChanged = true;
        if (!factsChanged && finalTargetAccess && (result.inputs as ObjectValue).state === "complete") {
          try {
            const evaluation = await evaluatePolicy(finalTargetAccess, target, `managed-description-final:${digest(`${context.grant_id}:${context.profile_ref}:${input.operation}`)}`);
            const finalPolicyState = evaluation === undefined ? "unavailable" : `${evaluation.status}:${evaluation.next_step}`;
            if (finalPolicyState !== initialPolicyState) factsChanged = true;
          } catch { factsChanged = true; }
        }
      }
      if (!factsChanged && harborFacts) {
        const finalHarborFacts = normalizeHarborCapabilityDescription(await harbor("/runtime/capabilities/describe", {
          operation: input.operation,
          profile_ref: context.profile_ref,
          authorized_origins: finalAuthorizedOrigins,
          ...(input.arguments?.runtime_session_ref === undefined ? {} : { runtime_session_ref: input.arguments.runtime_session_ref }),
          ...(input.arguments?.page_id === undefined ? {} : { page_id: input.arguments.page_id }),
          ...(input.arguments?.page_ref === undefined ? {} : { page_ref: input.arguments.page_ref }),
          ...(input.arguments?.document_generation === undefined ? {} : { document_generation: input.arguments.document_generation }),
          ...(input.arguments?.observation_ref === undefined ? {} : { observation_ref: input.arguments.observation_ref }),
          ...(input.arguments?.target_ref === undefined ? {} : { target_ref: input.arguments.target_ref })
        }), input.operation, context.profile_ref);
        if (JSON.stringify(finalHarborFacts) !== JSON.stringify(harborFacts)) factsChanged = true;
      }
    } catch (error) {
      if (error instanceof ManagedAccessError && ["discovery_context_unavailable", "discovery_version_mismatch"].includes(error.code)) throw error;
      factsChanged = true;
    }
    if (factsChanged) {
      result.provider = { state: "unknown", provider_id: null, reason_codes: ["facts_changed"], limitations: [], facts_at: null };
      result.authorization = { state: "unknown", reason_codes: ["facts_changed"] };
      result.availability = { state: "unknown", reason_codes: ["facts_changed"], facts_at: null };
      result.next_steps = [discoveryNextStep("retry_description", input.operation)];
      return finish();
    }
    const availability = result.availability as ObjectValue;
    if ((result.inputs as ObjectValue).state === "incomplete" || (result.inputs as ObjectValue).state === "invalid") result.next_steps = [discoveryNextStep("fill_inputs", input.operation, [...assessment.missing, ...assessment.invalid.map(issue => issue.path)])];
    else if ((result.authorization as ObjectValue).state === "denied") result.next_steps = [discoveryNextStep("owner_authorize", input.operation)];
    else if (availability.state === "blocked" && (availability.reason_codes as string[]).includes("human_control")) result.next_steps = [discoveryNextStep("wait_for_owner_return", input.operation)];
    else if (availability.state === "blocked" && (availability.reason_codes as string[]).includes("instance_not_running")) result.next_steps = [discoveryNextStep("start_profile", "instance.start", ["/arguments/origin"])];
    else if ((result.provider as ObjectValue).reason_codes && ((result.provider as ObjectValue).reason_codes as string[]).some(code => ["provider_not_qualified", "provider_evidence_stale"].includes(code))) result.next_steps = [discoveryNextStep("owner_review_provider", null)];
    else if ((availability.reason_codes as string[]).includes("stale_reference")) result.next_steps = [discoveryNextStep("observe_page", "instance.observe")];
    else if ((availability.reason_codes as string[]).includes("page_selection_required")) result.next_steps = [discoveryNextStep("choose_page", "page.list")];
    else if (availability.state === "unknown") result.next_steps = [discoveryNextStep("retry_description", input.operation)];
    return finish();
  }
  return {
    describe,
    resolveBusinessTargetAccountScopes,
    async getManagementPolicy() {
      return await options.executionPolicyConfigStore.getInstalledSkillConfiguration("harbor:managed-browser") ?? null;
    },
    async putManagementPolicy(value: unknown) {
      // These are the categories declared by Harbor's managed operation catalog.
      const mutation = normalizeExecutionPolicyMutation(value, { allowed_categories: new Set(["read", "prepare", "commit", "destructive"]) });
      return options.executionPolicyConfigStore.putInstalledSkillConfiguration("harbor:managed-browser", mutation);
    },
    /**
     * Core-internal dispatch hook for a pinned no-script site task. The caller
     * owns the single Run and result/post-check commit; this method only reuses
     * managed-browser admission, current Profile/Grant/Origin checks, and the
     * existing Harbor snapshot dispatch against that Run id.
     */
    async executeTaskSnapshot(credentialHash: string, value: unknown, runId: string, timeoutMs = 60_000) {
      // Only this Core-owned task adapter may discover the currently selected
      // Runtime Session. Keep the ordinary managed-browser request parser's
      // requirement for an Agent-supplied runtime_session_ref unchanged.
      const internal = object(value);
      const input = parse({ ...internal, runtime_session_ref: "core-managed-task-current-session" });
      if (input.operation !== "instance.snapshot" || input.idempotency_key !== runId || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return fail("managed_task_invalid_input");
      delete input.runtime_session_ref;
      return execute(credentialHash, input, runId, Date.now() + timeoutMs);
    },
    async submit(credentialHash: string, value: unknown) {
      const input = parse(value);
      const principal = await options.accessStore.authenticateCredential(credentialHash);
      const runId = `managed-${digest(`${principal.principal_id}:${input.idempotency_key}`)}`;
      const requestHash = digest(JSON.stringify(input));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const grantScopedCreation = input.operation === "profile.create" || input.operation === "profile.copy_environment";
      return withFileOwnershipLock(join(directory, `${digest(grantScopedCreation || isProviderPreference(input.operation) ? input.grant_id : input.profile_ref ?? runId)}.lock`), 5000, async () => {
        const previous = await store.getRunRecord(runId);
        if (previous) {
          if (previous.public_result_summary?.request_hash !== requestHash) return fail("managed_browser_idempotency_conflict");
          return response(previous);
        }
        await options.accessStore.checkAccess(credentialHash, accessRequest(input));
        const summary = { principal_id: principal.principal_id, grant_id: input.grant_id, operation: input.operation, request_hash: requestHash,
          ...(input.operation === "profile.metadata.update" || input.operation === "profile.copy_environment" || input.operation === "profile.archive" || input.operation === "profile.delete" || isBusinessTargetOperation(input.operation) || isInteraction(input.operation) || isEnvironment(input.operation) || isPageMutation(input.operation) || managedFileOperations.includes(input.operation as typeof managedFileOperations[number]) ? {
            ...(isInteraction(input.operation) || isPageMutation(input.operation) || managedFileOperations.includes(input.operation as typeof managedFileOperations[number]) ? { runtime_session_ref: input.runtime_session_ref } : {}),
            profile_ref: input.profile_ref, origin: input.origin,
            ...(isInteraction(input.operation) || isPageMutation(input.operation) || managedFileOperations.includes(input.operation as typeof managedFileOperations[number]) ? { dispatch_state: "not_dispatched" } : {}),
            ...(input.file_ref === undefined ? {} : { file_ref: input.file_ref })
          } : {}) };
        await store.createRunRecord({ run_id: runId, task_intent_ref: `managed-intent:${runId}`, capability_ref: "harbor:managed-browser", status: "admitted",
          admission: { decision: "accepted", action_risk: input.operation === "profile.delete" ? "destructive" : (["profile.create", "profile.copy_environment", "profile.archive", "profile.metadata.update", "provider.preference.set", "provider.preference.clear", "account.bind", "environment.update", "business_target.create", "business_target.metadata.update", "business_target.disable"].includes(input.operation) || isInput(input.operation) || isPageMutation(input.operation) || managedFileOperations.includes(input.operation as typeof managedFileOperations[number])) ? "write" : "read" }, public_result_summary: summary });
        await store.updateRunRecord(runId, { status: "running" });
        try {
          const result = await execute(credentialHash, input, runId);
          await completeRunWithResult(store, runId, { result_ref: `managed-result:${runId}`, result_kind: "managed_browser_operation", data: result, persisted_public_summary: { ...summary, ...(isInteraction(input.operation) || isPageMutation(input.operation) || managedFileOperations.includes(input.operation as typeof managedFileOperations[number]) ? { dispatch_state: result.dispatch_state } : {}), result } });
        } catch (error) {
          const current = (await store.getRunRecord(runId))!;
          const receipt = error instanceof InteractionFailure || error instanceof PageFailure || error instanceof FileFailure || error instanceof ScopeBoundaryFailure ? error.receipt : undefined;
          const dispatchAware = isInteraction(input.operation) || isPageMutation(input.operation) || managedFileOperations.includes(input.operation as typeof managedFileOperations[number]);
          const notDispatched = dispatchAware && (receipt?.dispatch_state ?? current.public_result_summary?.dispatch_state) === "not_dispatched";
          const known = dispatchAware
            ? notDispatched ||
              (error instanceof InteractionFailure && isDeterministicWaitTimeout(receipt))
            : error instanceof ManagedAccessError && error.code !== "managed_browser_creation_unknown" && !(error instanceof CreationReceiptFailure);
          const knownFailure = known || error instanceof ScopeBoundaryFailure;
          if (dispatchAware) await store.updateRunRecord(runId, { public_result_summary: {
            ...current.public_result_summary, dispatch_state: notDispatched ? "not_dispatched" : "dispatched", ...(receipt ? { result: receipt } : {})
          } });
          if (!dispatchAware && receipt) await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, result: receipt } });
          await completeRunWithFailure(store, runId, { status: knownFailure ? "failed" : "unknown_outcome",
            failure: { category: "runtime_execution", code: error instanceof ManagedAccessError ? error.code : knownFailure ? "managed_browser_runtime_unavailable" : "managed_browser_outcome_unknown", phase: "execution", recovery_hint: "query_operation_without_replay" } });
        }
        return response((await store.getRunRecord(runId))!);
      });
    },
    async query(credentialHash: string, runId: string) {
      const principal = await options.accessStore.authenticateCredential(credentialHash);
      const run = await store.getRunRecord(runId);
      if (!run || run.public_result_summary?.principal_id !== principal.principal_id) return fail("managed_browser_operation_not_found");
      if (isBusinessTargetOperation(String(run.public_result_summary?.operation)) && ["running", "admitted", "unknown_outcome"].includes(run.status) && !run.public_result_summary?.reconciliation) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const profileRef = typeof run.public_result_summary?.profile_ref === "string" ? run.public_result_summary.profile_ref : runId;
        return withFileOwnershipLock(join(directory, `${digest(text(profileRef))}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.status === "failed" || current.public_result_summary?.reconciliation) return response(current);
          const requestHash = typeof current.public_result_summary?.request_hash === "string" ? current.public_result_summary.request_hash : "";
          const result = requestHash ? await businessTargetStore.operationResult(runId, requestHash) : undefined;
          if (result) {
            if (current.status === "unknown_outcome") {
              await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, reconciliation: "completed", result } });
            } else {
              await completeRunWithResult(store, runId, { result_ref: `managed-result:${runId}`, result_kind: "managed_browser_operation", data: result,
                persisted_public_summary: { ...current.public_result_summary, reconciliation: "completed", result } });
            }
          } else {
            const failure = { category: "write_outcome" as const, code: "business_target_operation_not_applied", phase: "query" as const, recovery_hint: "operation_was_not_applied" };
            if (current.status === "unknown_outcome") {
              await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, reconciliation: "completed", result: { failure } } });
            } else {
              await completeRunWithFailure(store, runId, { status: "failed", failure });
            }
          }
          return response((await store.getRunRecord(runId))!);
        });
      }
      if (["running", "admitted", "unknown_outcome"].includes(run.status) && run.public_result_summary?.operation === "profile.metadata.update" && !run.public_result_summary?.reconciliation) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const profileRef = typeof run.public_result_summary?.profile_ref === "string" ? run.public_result_summary.profile_ref : runId;
        return withFileOwnershipLock(join(directory, `${digest(text(profileRef))}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.public_result_summary?.reconciliation) return response(current);
          if (["running", "admitted"].includes(current.status)) await completeRunWithFailure(store, runId, {
            status: "unknown_outcome", failure: { category: "write_outcome", code: "managed_browser_outcome_unknown", phase: "query", recovery_hint: "query_operation_without_replay" }
          });
          try {
            const expectedIdentityRef = text(current.public_result_summary?.identity_environment_ref);
            const expectedProfileRef = text(current.public_result_summary?.profile_ref);
            const receipt = profileMutationReceipt(await harbor(`/runtime/identity-environment-mutations/${encodeURIComponent(runId)}`), "profile.metadata.update");
            if (receipt.identity_environment_ref !== expectedIdentityRef || receipt.source_identity_environment_ref !== null) {
              throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
            }
            if (receipt.status === "completed") {
              let profile: ObjectValue;
              try { profile = publicProfile(receipt.record); }
              catch { throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown"); }
              if (profile.profile_ref !== expectedProfileRef || profile.identity_environment_ref !== expectedIdentityRef) {
                throw new CreationReceiptFailure("managed_browser_profile_mutation_unknown");
              }
              const result: ObjectValue = { receipt };
              result.profile = profile;
              await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, reconciliation: "completed", result } });
            } else if (receipt.status === "rejected") {
              await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, reconciliation: "completed", result: { receipt } } });
            } else if (receipt.status === "repair_required") {
              await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, result: { receipt } } });
            }
          } catch { /* A missing receipt never proves the metadata write did not occur. */ }
          return response((await store.getRunRecord(runId))!);
        });
      }
      if (["provider.preference.set", "provider.preference.clear"].includes(String(run.public_result_summary?.operation)) &&
        ["running", "admitted", "unknown_outcome"].includes(run.status) && !run.public_result_summary?.reconciliation) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        return withFileOwnershipLock(join(directory, `${digest(text(run.public_result_summary!.grant_id))}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.public_result_summary?.reconciliation) return response(current);
          if (["running", "admitted"].includes(current.status)) await completeRunWithFailure(store, runId, {
            status: "unknown_outcome", failure: { category: "write_outcome", code: "managed_browser_outcome_unknown", phase: "query", recovery_hint: "query_operation_without_replay" }
          });
          try {
            const receipt = await harbor(`/runtime/browser-provider-preference-mutations/${encodeURIComponent(runId)}`);
            await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, reconciliation: "completed", result: { preference: receipt } } });
          } catch { /* Missing Runtime receipt never proves the original preference write did not occur. */ }
          return response((await store.getRunRecord(runId))!);
        });
      }
      if (["running", "admitted", "unknown_outcome"].includes(run.status) && run.public_result_summary?.operation === "environment.update" && !run.public_result_summary?.reconciliation) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const profileRef = typeof run.public_result_summary?.profile_ref === "string" ? run.public_result_summary.profile_ref : runId;
        return withFileOwnershipLock(join(directory, `${digest(text(profileRef))}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.public_result_summary?.reconciliation) return response(current);
          if (["running", "admitted"].includes(current.status)) await completeRunWithFailure(store, runId, {
            status: "unknown_outcome", failure: { category: "write_outcome", code: "managed_browser_outcome_unknown", phase: "query", recovery_hint: "query_operation_without_replay" }
          });
          try {
            // A receipt lookup is read-only; never reissue the environment update.
            const receipt = await harbor(`/runtime/identity-environment-mutations/${encodeURIComponent(runId)}`);
            if (receipt.status === "completed" || receipt.status === "rejected" || receipt.status === "repair_required") {
              let environment: ObjectValue | undefined;
              if (receipt.status === "completed" && typeof receipt.identity_environment_ref === "string") {
                try {
                  environment = await harbor(`/runtime/identity-environments/${encodeURIComponent(text(receipt.identity_environment_ref))}/environment`);
                } catch { /* The persisted receipt remains the authoritative recovery fact. */ }
              }
              await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, reconciliation: "completed", result: { receipt, ...(environment === undefined ? {} : { environment }) } } });
            }
          } catch { /* Missing Runtime receipt never proves the original update did not occur. */ }
          return response((await store.getRunRecord(runId))!);
        });
      }
      if (["running", "admitted", "unknown_outcome"].includes(run.status) && isInteraction(String(run.public_result_summary?.operation)) && !run.public_result_summary?.reconciliation) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        return withFileOwnershipLock(join(directory, `${digest(text(run.public_result_summary!.profile_ref))}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.public_result_summary?.reconciliation) return response(current);
          if (["running", "admitted"].includes(current.status)) await completeRunWithFailure(store, runId, {
            status: "unknown_outcome", failure: { category: "write_outcome", code: "managed_browser_outcome_unknown", phase: "query", recovery_hint: "query_operation_without_replay" }
          });
          try {
            const receipt = await harbor(`/runtime/managed-interactions/${encodeURIComponent(runId)}`, undefined, "interaction");
            if (receipt.operation_ref !== runId || receipt.runtime_session_ref !== current.public_result_summary?.runtime_session_ref) throw new Error("receipt_mismatch");
            await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, result: receipt,
              ...(receipt.status === "completed" ? { reconciliation: "completed" } : receipt.dispatch_state === "not_dispatched" ? { reconciliation: "not_dispatched" } : {}) } });
          } catch { /* Missing Runtime receipt never proves the original input did not occur. */ }
          return response((await store.getRunRecord(runId))!);
        });
      }
      if (["running", "admitted", "unknown_outcome"].includes(run.status) && isPageMutation(String(run.public_result_summary?.operation)) && !run.public_result_summary?.reconciliation) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        return withFileOwnershipLock(join(directory, `${digest(text(run.public_result_summary!.profile_ref))}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.public_result_summary?.reconciliation) return response(current);
          if (["running", "admitted"].includes(current.status)) await completeRunWithFailure(store, runId, {
            status: "unknown_outcome", failure: { category: "write_outcome", code: "managed_browser_outcome_unknown", phase: "query", recovery_hint: "query_operation_without_replay" }
          });
          try {
            // The Runtime receipt is a read-only lookup of the original operation.
            const receipt = await harbor(`/runtime/managed-pages/${encodeURIComponent(runId)}`, undefined, "page");
            if (receipt.operation_ref !== runId || receipt.runtime_session_ref !== current.public_result_summary?.runtime_session_ref) throw new Error("receipt_mismatch");
            await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, result: receipt,
              ...(receipt.status === "completed" ? { reconciliation: "completed" } : receipt.dispatch_state === "not_dispatched" ? { reconciliation: "not_dispatched" } : {}) } });
          } catch { /* Missing Runtime receipt never proves the original Page action did not occur. */ }
          return response((await store.getRunRecord(runId))!);
        });
      }
      if (["running", "admitted", "unknown_outcome"].includes(run.status) && managedFileOperations.includes(String(run.public_result_summary?.operation) as typeof managedFileOperations[number]) && !run.public_result_summary?.reconciliation) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        return withFileOwnershipLock(join(directory, `${digest(text(run.public_result_summary!.profile_ref))}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.public_result_summary?.reconciliation) return response(current);
          if (["running", "admitted"].includes(current.status)) await completeRunWithFailure(store, runId, {
            status: "unknown_outcome", failure: { category: "write_outcome", code: "managed_browser_outcome_unknown", phase: "query", recovery_hint: "query_operation_without_replay" }
          });
          try {
            // Read the durable Harbor receipt only; a missing/unknown receipt is
            // never evidence that an upload or download may safely be replayed.
            const receipt = await harbor(`/runtime/managed-files/${encodeURIComponent(runId)}`, undefined, "file");
            if (receipt.operation_ref !== runId || receipt.runtime_session_ref !== current.public_result_summary?.runtime_session_ref) throw new Error("receipt_mismatch");
            await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, result: receipt,
              ...(receipt.status === "completed" ? { reconciliation: "completed" } : receipt.dispatch_state === "not_dispatched" ? { reconciliation: "not_dispatched" } : {}) } });
          } catch { /* Missing Runtime receipt never proves the original file operation did not occur. */ }
          return response((await store.getRunRecord(runId))!);
        });
      }
      const profileOperation = String(run.public_result_summary?.operation);
      if (["running", "admitted", "unknown_outcome"].includes(run.status) &&
          ["profile.create", "profile.copy_environment", "profile.archive", "profile.delete"].includes(profileOperation) &&
          run.public_result_summary?.reconciliation !== "completed") {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const creation = profileOperation === "profile.create" || profileOperation === "profile.copy_environment";
        const lockRef = creation ? text(run.public_result_summary!.grant_id) : text(run.public_result_summary!.profile_ref);
        return withFileOwnershipLock(join(directory, `${digest(lockRef)}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.status === "failed" || current.public_result_summary?.reconciliation === "completed") return response(current);
          if (current.status === "running" || current.status === "admitted") await completeRunWithFailure(store, runId, {
            status: "unknown_outcome", failure: { category: "write_outcome", code: "managed_browser_outcome_unknown", phase: "query", recovery_hint: "query_operation_without_replay" }
          });
          // Only read Harbor's receipt for the original Run ID; never replay a lifecycle mutation.
          try {
            const expectedOperation = profileOperation === "profile.create" ? "create"
              : profileOperation === "profile.copy_environment" ? "copy_environment"
                : profileOperation === "profile.archive" ? "archive" : "delete";
            const receipt = profileMutationReceipt(await harbor(`/runtime/identity-environment-mutations/${encodeURIComponent(runId)}`), expectedOperation);
            if (receipt.status === "completed") {
              if (creation) {
                const profile = publicProfile(receipt.record);
                let result: ObjectValue = { profile };
                if (profileOperation === "profile.create") {
                  const providerSelection = publicProviderSelection(receipt.provider_selection);
                  if (profile.identity_environment_ref !== receipt.identity_environment_ref || receipt.source_identity_environment_ref !== null) throw new Error("profile_create_receipt_mismatch");
                  result.provider_selection = providerSelection;
                  await options.accessStore.recordCreatedProfile({ idempotency_key: runId, grant_id: current.public_result_summary!.grant_id, profile_ref: profile.profile_ref });
                } else {
                  const expectedTemplate = copyTemplateFacts(current.public_result_summary?.copy_template_snapshot);
                  if (receipt.source_identity_environment_ref !== current.public_result_summary?.source_identity_environment_ref ||
                      profile.identity_environment_ref !== receipt.identity_environment_ref ||
                      profile.identity_environment_ref === current.public_result_summary?.source_identity_environment_ref ||
                      profile.profile_ref === current.public_result_summary?.profile_ref || profile.lifecycle_state !== "active") throw new Error("profile_copy_receipt_mismatch");
                  assertCopyTemplateMatch(profile, expectedTemplate);
                  await options.accessStore.recordCreatedProfile({ idempotency_key: runId, grant_id: current.public_result_summary!.grant_id,
                    operation: "profile.copy_environment", source_profile_ref: current.public_result_summary!.profile_ref,
                    source_policy_snapshot: current.public_result_summary?.copy_source_policy_snapshot, profile_ref: profile.profile_ref });
                }
                await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, reconciliation: "completed", result } });
              } else {
                const targetRef = current.public_result_summary?.identity_environment_ref;
                if (receipt.identity_environment_ref !== targetRef) throw new Error("profile_mutation_receipt_mismatch");
                const result: ObjectValue = profileOperation === "profile.archive"
                  ? { profile: publicProfile(receipt.record) }
                  : { receipt };
                if (receipt.status === "completed" && receipt.source_identity_environment_ref !== targetRef) throw new Error("profile_mutation_receipt_mismatch");
                if (profileOperation === "profile.archive" && (object(result.profile).profile_ref !== current.public_result_summary?.profile_ref ||
                    object(result.profile).identity_environment_ref !== targetRef || object(result.profile).lifecycle_state !== "archived")) throw new Error("profile_archive_receipt_mismatch");
                if (profileOperation === "profile.delete" && receipt.status === "completed") {
                  const effects = object(receipt.effects);
                  if (receipt.record !== null || effects.index !== "removed" || effects.local_data !== "deleted") throw new Error("profile_delete_receipt_mismatch");
                }
                await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, reconciliation: "completed", result } });
              }
            } else if (receipt.status === "rejected") {
              const failure = object(receipt.failure);
              if (!creation && receipt.identity_environment_ref !== current.public_result_summary?.identity_environment_ref) throw new Error("profile_mutation_receipt_mismatch");
              text(failure.code);
              await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, reconciliation: "completed", result: { receipt } } });
            } else if (receipt.status === "repair_required") {
              await store.updateRunRecord(runId, { public_result_summary: { ...current.public_result_summary, result: { receipt } } });
            }
          } catch (error) {
            if (error instanceof ManagedAccessError) await store.updateRunRecord(runId, { failure: { category: "write_outcome", code: error.code, phase: "query", recovery_hint: "query_operation_without_replay" } });
            // Missing or mismatched receipts remain unknown; do not retry the write.
          }
          return response((await store.getRunRecord(runId))!);
        });
      }
      return response(run);
    }
  };
}
