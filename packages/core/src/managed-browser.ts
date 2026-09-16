import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { withFileOwnershipLock } from "./file-ownership.js";
import { ManagedAccessError, managedFileOperations, managedInteractionOperations, managedPageOperations, type FileManagedAccessStore, type ManagedAccessRequest } from "./managed-access.js";
import type { FileRunRecordStore, RunRecord } from "./run-record-store.js";
import type { FileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import type { FileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import { matchHarborBusinessOperationOwner } from "./execution-policy-owner-proof.js";
import { normalizeExecutionPolicyMutation } from "./execution-policy-config.js";
import { evaluateExecutionPolicy } from "./execution-policy.js";
import { completeRunWithFailure, completeRunWithResult } from "./result-envelope.js";
import { ProfileRecoveryCoreError, type ManagedRecoveryService } from "./profile-recovery.js";
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
type Request = ManagedAccessRequest & { idempotency_key: string; url?: string; runtime_session_ref?: string; observation_ref?: string; account_system_ref?: string; account_ref?: string;
  page_id?: string; page_ref?: string; document_generation?: number; cursor?: string; limit?: number; target_ref?: string; file_ref?: string; text?: string; key?: string; delta_y?: number; wait_for?: "page_changed" | "text" | "enabled"; timeout_ms?: number; configuration?: EnvironmentConfiguration; backup_ref?: string; operation_ref?: string; provider_id?: "cloakbrowser" | "chrome_official" | "camoufox" };
type DescribeContext = { grant_id: string; profile_ref: string; task_scope: ManagedAccessRequest["task_scope"] };
type DescribeInput = { operation: string; connection_id: string; context?: DescribeContext; arguments?: ObjectValue };
type DiscoveryDimensionState = "supported" | "limited" | "unsupported" | "unknown" | "not_applicable" | "not_evaluated";
type DiscoveryAvailabilityState = "no_known_blocker" | "blocked" | "unknown" | "not_evaluated";
type DiscoveryAuthorizationState = "allowed" | "denied" | "unknown" | "not_evaluated";
const discoveryOperationPattern = new RegExp(managedCapabilityDefinitions.operation_pattern);
const discoveryEnvelopeFields = new Set(["idempotency_key", "connection_id", "grant_id", "operation", "task_scope"]);
const discoveryNextStep = (code: string, operation: string | null, fields: string[] = []) => ({ code, actor: code.startsWith("owner_") || code === "wait_for_owner_return" ? "owner" : "agent", operation, fields });
const isInteraction = (operation: string) => (managedInteractionOperations as readonly string[]).includes(operation);
const isPageMutation = (operation: string) => (managedPageOperations as readonly string[]).includes(operation) && operation !== "page.list";
const isObservation = (operation: string) => ["instance.observe", "instance.read", "instance.snapshot", "instance.wait"].includes(operation);
const isInput = (operation: string) => ["instance.click", "instance.input", "instance.press", "instance.scroll"].includes(operation);
const isEnvironment = (operation: string) => ["environment.read", "environment.update"].includes(operation);
const isRecovery = (operation: string) => ["recovery.inspect", "recovery.request", "recovery.status"].includes(operation);
const isProviderPreference = (operation: string) => ["provider.preference.read", "provider.preference.set", "provider.preference.clear"].includes(operation);
function discoveryExecutionChecks(operation: string): string[] {
  const checks = ["reauthorize"];
  if (["instance.observe", "instance.read", "instance.snapshot", "instance.click", "instance.input", "instance.press", "instance.scroll", "instance.wait", "instance.diagnostics", "page.list", "page.open", "page.activate", "page.close", "page.navigate", "page.reload", "page.back", "page.forward", "file.upload", "file.download"].includes(operation)) checks.push("verify_page_and_target");
  if (["file.upload", "file.download"].includes(operation)) checks.push("verify_file_material");
  if (["instance.click", "instance.input", "instance.press", "instance.scroll", "instance.wait", "page.open", "page.activate", "page.close", "page.navigate", "page.reload", "page.back", "page.forward", "file.upload", "file.download", "instance.stop", "instance.handoff", "environment.update", "provider.preference.set", "provider.preference.clear"].includes(operation)) checks.push("acquire_control_if_required");
  if (!["profile.list", "profile.read", "provider.preference.read", "provider.preference.set", "provider.preference.clear"].includes(operation)) checks.push("check_provider_runtime");
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
  for (const key of ["url", "runtime_session_ref", "observation_ref", "account_system_ref", "account_ref", "page_id", "page_ref", "cursor", "target_ref", "file_ref"]) if (input[key] !== undefined) text(input[key]);
  if (input.document_generation !== undefined && (typeof input.document_generation !== "number" || !Number.isSafeInteger(input.document_generation) || input.document_generation < 1)) return fail("managed_browser_invalid_input");
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 64)) return fail("managed_browser_invalid_input");
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
    if (input.cursor !== undefined || input.limit !== undefined) return fail("managed_browser_invalid_input");
    const action = String(input.operation).slice("instance.".length);
    const fields: Record<string, string[]> = { snapshot: ["page_ref"], click: ["page_ref", "observation_ref", "target_ref"], input: ["page_ref", "observation_ref", "target_ref", "text"], press: ["page_ref", "observation_ref", "target_ref", "key"], scroll: ["page_ref", "observation_ref", "delta_y"], wait: ["page_ref", "observation_ref", "wait_for", "target_ref", "text", "timeout_ms"] };
    const all = ["page_ref", "observation_ref", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms", "account_ref", "account_system_ref", "url", "template_ref"];
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
  } else if (input.provider_id !== undefined || !["instance.navigate", "instance.read", "instance.observe"].includes(String(input.operation)) && (["page_id", "page_ref", "document_generation", "cursor", "limit", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms"].some(key => input[key] !== undefined)) ||
    (input.operation !== "account.bind" && ["observation_ref", "account_system_ref", "account_ref"].some(key => input[key] !== undefined))) return fail("managed_browser_invalid_input");
  return input as Request;
}
export const parseManagedBrowserRequest = parse;
function accessRequest(input: Request): ManagedAccessRequest {
  const { idempotency_key: _key, url: _url, runtime_session_ref: _session, observation_ref: _observation, account_system_ref: _system, account_ref: _account, page_id: _pageId, page_ref: _page, document_generation: _generation, cursor: _cursor, limit: _limit, target_ref: _target, file_ref: _file, text: _text, key: _press, delta_y: _scroll, wait_for: _wait, timeout_ms: _timeout, configuration: _configuration, backup_ref: _backup, operation_ref: _operation, provider_id: _provider, ...access } = input;
  if (managedFileOperations.includes(input.operation as typeof managedFileOperations[number])) access.file_refs = _file === undefined ? [] : [_file];
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
    const fields = new Set(managedCapabilityInputFields(input.operation).filter(field => !discoveryEnvelopeFields.has(field) && field !== "profile_ref"));
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
  return { profile_ref: text(refs.profile_ref), identity_environment_ref: text(profile.identity_environment_ref), site: profile.site,
    status: profile.status, account_bindings: profile.account_bindings ?? [], environment_summary: profile.environment_summary };
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
function response(run: RunRecord) {
  return { ok: run.status === "succeeded", run_id: run.run_id, status: run.status,
    ...(run.public_result_summary?.result === undefined ? {} : { result: run.public_result_summary.result }),
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
  async function harbor(path: string, body?: ObjectValue, receiptKind?: "interaction" | "page" | "file"): Promise<ObjectValue> {
    const result = await fetch(new URL(path, options.harborBaseUrl), { method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${options.supervisorToken}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(70_000) });
    const value = object(await result.json());
    if (receiptKind !== undefined) {
      if (["completed", "unavailable", "unknown_outcome"].includes(String(value.status)) && ["not_dispatched", "dispatched"].includes(String(value.dispatch_state))) return value;
      throw new Error(`managed_${receiptKind}_receipt_unavailable`);
    }
    if (!result.ok || value.status === "unavailable" || value.status === "failed" || value.lifecycle_state === "failed") {
      const failure = value.failure && typeof value.failure === "object" ? object(value.failure) : {};
      const error = value.current_error && typeof value.current_error === "object" ? object(value.current_error) : {};
      return fail(typeof value.failure_class === "string" ? value.failure_class : typeof failure.code === "string" ? failure.code : typeof error.code === "string" ? error.code : "managed_browser_runtime_refused");
    }
    return value;
  }
  async function authorize(hash: string, input: Request, runId: string) {
    const access = await options.accessStore.checkAccess(hash, accessRequest(input));
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
  async function execute(hash: string, input: Request, runId: string): Promise<ObjectValue> {
    const access = await authorize(hash, input, runId);
    const check = () => options.accessStore.checkAccess(hash, accessRequest(input));
    await store.updateRunRecord(runId, { evidence_refs: [access.decision_ref] });
    const holder = access.principal.principal_id;
    if (isProviderPreference(input.operation)) {
      await check();
      if (input.operation === "provider.preference.read") return { preference: await harbor("/runtime/browser-provider-preference"), authorization_decision_ref: access.decision_ref };
      const preference = await harbor("/runtime/browser-provider-preference", input.operation === "provider.preference.set"
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
    if (input.operation === "profile.create") {
      // Unknown creation blocks further quota consumption until the existing receipt is reconciled.
      const unresolved = (await store.listRunRecords()).some(run => run.run_id !== runId && run.public_result_summary?.grant_id === input.grant_id &&
        run.public_result_summary?.operation === "profile.create" && ["running", "admitted", "unknown_outcome"].includes(run.status) && run.public_result_summary?.reconciliation !== "completed");
      if (unresolved) return fail("managed_browser_creation_reconciliation_required");
      const template = access.creation_template!;
      if (template.provider_id !== null && input.provider_id !== undefined) return fail("managed_browser_template_provider_conflict");
      await check();
      const created = await harbor("/runtime/identity-environment-mutations", { operation: "create", idempotency_key: runId,
        identity_environment: { site: template.site, ...((template.provider_id ?? input.provider_id) === undefined ? {} : { requested_provider_id: template.provider_id ?? input.provider_id }), language: template.language, timezone: template.timezone } });
      if (created.status !== "completed") return fail("managed_browser_creation_unknown");
      try {
        const profile = publicProfile(created.record);
        const providerSelection = publicProviderSelection(created.provider_selection);
        await options.accessStore.recordCreatedProfile({ idempotency_key: runId, grant_id: input.grant_id, profile_ref: profile.profile_ref });
        return { profile, provider_selection: providerSelection, authorization_decision_ref: access.decision_ref };
      } catch (error) {
        throw new CreationReceiptFailure(error instanceof ManagedAccessError ? error.code : "managed_browser_creation_unknown");
      }
    }
    const list = await harbor("/runtime/identity-environments");
    if (!Array.isArray(list.identity_environments)) return fail("managed_browser_runtime_invalid");
    const profiles = list.identity_environments.map(publicProfile);
    if (input.operation === "profile.list") return { profiles: profiles.filter(profile => access.grant.profile_refs.includes(text(profile.profile_ref))) };
    const profile = profiles.find(profile => profile.profile_ref === input.profile_ref);
    if (!profile) return fail("managed_browser_profile_not_found");
    if (input.operation === "profile.read") return { profile };
    const identity = encodeURIComponent(text(profile.identity_environment_ref));
    if (isEnvironment(input.operation)) await check();
    if (input.operation === "environment.read") return await harbor(`/runtime/identity-environments/${identity}/environment`);
    if (input.operation === "environment.update") return await harbor(`/runtime/identity-environments/${identity}/environment`, {
      idempotency_key: runId, configuration: input.configuration!
    });
    const active = await harbor(`/runtime/identity-environments/${identity}/session`);
    const activeSession = active.runtime_session === null ? undefined : object(active.runtime_session);
    let session = activeSession;
    if (input.operation === "instance.start" && !session) {
      await check();
      session = await harbor("/runtime/identity-environment-sessions", { identity_environment_ref: profile.identity_environment_ref,
        operation_scope: "profile_management", url: input.url ?? input.origin, reuse_existing: true,
        control_owner: "core_task", holder_ref: holder, headless: false, timeout_ms: 60_000, scope_semantics: access.scope_semantics });
    }
    if (!session || session.profile_ref !== input.profile_ref) return fail("managed_browser_session_missing");
    if (input.runtime_session_ref !== undefined && session.runtime_session_ref !== input.runtime_session_ref) return fail("managed_browser_session_mismatch");
    let leaseSession: ObjectValue = session;
    const ref = encodeURIComponent(text(leaseSession.runtime_session_ref));
    const acquireControlLease = async () => {
      await check();
      const lease = object(leaseSession.control_lock);
      // A user-held Instance is never implicitly taken over by an Agent Page action.
      if (leaseSession.control_owner === "user" && lease.state === "held") return fail("control_lock_conflict");
      if (leaseSession.control_owner !== "core_task" || lease.state !== "held" || lease.holder_ref !== holder) {
        leaseSession = await harbor(`/runtime/sessions/${ref}/lock`, { control_owner: "core_task", holder_ref: holder });
        session = leaseSession;
      }
      const acquired = object(leaseSession.control_lock);
      if (leaseSession.control_owner !== "core_task" || acquired.state !== "held" || acquired.holder_ref !== holder) return fail("control_lock_conflict");
      return await check();
    };
    if ((managedPageOperations as readonly string[]).includes(input.operation)) {
      if (input.operation === "page.list") {
        const pageAccess = await check();
        return await harbor(`/runtime/sessions/${ref}/pages`, {
          operation: input.operation, holder_ref: holder,
          authorized_origins: pageAccess.authorized_origins, scope_semantics: pageAccess.scope_semantics
        });
      }
      const pageAccess = await acquireControlLease();
      const run = (await store.getRunRecord(runId))!;
      await store.updateRunRecord(runId, { public_result_summary: { ...run.public_result_summary, dispatch_state: "dispatched" } });
      const result = await harbor(`/runtime/sessions/${ref}/pages`, {
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
      const result = await harbor(`/runtime/sessions/${ref}/files`, {
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
      return await harbor(`/runtime/sessions/${ref}/diagnostics`, {
        origin: input.origin!, authorized_origins: diagnosticsAccess.authorized_origins, scope_semantics: diagnosticsAccess.scope_semantics, ...(input.page_ref ? { page_ref: input.page_ref } : {}),
        ...(input.document_generation ? { document_generation: input.document_generation } : {}),
        ...(input.cursor ? { cursor: input.cursor } : {}), ...(input.limit ? { limit: input.limit } : {})
      });
    }
    if (!isObservation(input.operation)) await acquireControlLease();
    else await check();
    if (input.operation === "instance.stop") return { session: publicSession(await harbor(`/runtime/sessions/${ref}/stop`, { control_owner: "core_task", holder_ref: holder })) };
    if (input.operation === "instance.handoff") return { session: publicSession(await harbor(`/runtime/sessions/${ref}/handoff`, { control_owner: "user", expected_control_owner: "core_task", handoff_reason: "user_requested", holder_ref: holder })) };
    if (isInteraction(input.operation)) {
      const interactionAccess = await check();
      const run = (await store.getRunRecord(runId))!;
      await store.updateRunRecord(runId, { public_result_summary: { ...run.public_result_summary, dispatch_state: "dispatched" } });
      const result = await harbor(`/runtime/sessions/${ref}/interactions`, {
        holder_ref: holder, operation_ref: runId, expected_origin: input.origin, controlled_origin: input.origin,
        // Harbor must enforce the Core-checked grant ∩ Profile ∩ task
        // intersection for every request/redirect, not re-derive trust from
        // Agent-supplied origin fields.
        authorized_origins: interactionAccess.authorized_origins, scope_semantics: interactionAccess.scope_semantics,
        action: input.operation.slice("instance.".length),
        ...Object.fromEntries(["page_ref", "observation_ref", "target_ref", "text", "key", "delta_y", "wait_for", "timeout_ms"].filter(key => input[key as keyof Request] !== undefined).map(key => [key, input[key as keyof Request]]))
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
      await harbor(`/runtime/sessions/${ref}/observe`, pageBinding);
      await check();
      const result = await harbor(`/runtime/sessions/${ref}/${input.operation === "instance.navigate" ? "navigate" : "read"}`, {
        holder_ref: holder, expected_origin: input.origin, scope_semantics: access.scope_semantics, ...(input.page_id ? { page_id: input.page_id } : {}),
        ...(input.page_ref ? { page_ref: input.page_ref } : {}), ...(input.document_generation ? { document_generation: input.document_generation } : {}),
        ...(input.url ? { url: input.url } : {}) });
      const boundary = access.scope_semantics === "agent_operations_v2" ? redirectedSessionBoundary(result, access.authorized_origins, input.page_ref) : undefined;
      if (boundary) throw new ScopeBoundaryFailure(boundary);
      return { session: publicSession(result.session), ...(result.text === undefined ? {} : { text: result.text, truncated: result.truncated }), observed_at: result.observed_at };
    }
    const observation = await harbor(`/runtime/sessions/${ref}/observe`, { holder_ref: holder, expected_origin: input.origin, scope_semantics: access.scope_semantics,
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
      const bound = await harbor(`/runtime/identity-environments/${identity}/account-bindings`, {
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
          ...(operation === "profile.read" ? { profile_ref: context.profile_ref } : {}),
          task_scope: { operations: [operation], profile_refs: [context.profile_ref], origins: [] }
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
      if (state === "defined" && exposure === "not_exposed") result.next_steps = [discoveryNextStep("not_exposed", null)];
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
    let harborFacts: ObjectValue | undefined;
    try {
      harborFacts = normalizeHarborCapabilityDescription(await harbor("/runtime/capabilities/describe", {
        operation: input.operation,
        profile_ref: context.profile_ref,
        authorized_origins: context.task_scope.origins,
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
    try {
      const finalConnection = await options.accessStore.checkConnection(credentialHash, connection.connection.connection_id);
      const finalVisible = await readProfileVisibility(credentialHash, finalConnection.connection.connection_id, context);
      if (finalConnection.principal.principal_id !== connection.principal.principal_id ||
          finalConnection.connection.connection_id !== connection.connection.connection_id ||
          accessFingerprint(finalVisible) !== visibilitySnapshot) factsChanged = true;
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
          authorized_origins: context.task_scope.origins,
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
    if ((result.inputs as ObjectValue).state === "incomplete" || (result.inputs as ObjectValue).state === "invalid") result.next_steps = [discoveryNextStep("fill_inputs", input.operation, (result.inputs as ObjectValue).missing as string[])];
    else if ((result.authorization as ObjectValue).state === "denied") result.next_steps = [discoveryNextStep("owner_authorize", input.operation)];
    else if (availability.state === "blocked" && (availability.reason_codes as string[]).includes("human_control")) result.next_steps = [discoveryNextStep("wait_for_owner_return", input.operation)];
    else if (availability.state === "blocked" && (availability.reason_codes as string[]).includes("instance_not_running")) result.next_steps = [discoveryNextStep("start_profile", "instance.start", ["/arguments/origin"])];
    else if (availability.state === "unknown") result.next_steps = [discoveryNextStep("retry_description", input.operation)];
    return finish();
  }
  return {
    describe,
    async getManagementPolicy() {
      return await options.executionPolicyConfigStore.getInstalledSkillConfiguration("harbor:managed-browser") ?? null;
    },
    async putManagementPolicy(value: unknown) {
      // These are the categories declared by Harbor's managed operation catalog.
      const mutation = normalizeExecutionPolicyMutation(value, { allowed_categories: new Set(["read", "prepare", "commit"]) });
      return options.executionPolicyConfigStore.putInstalledSkillConfiguration("harbor:managed-browser", mutation);
    },
    async submit(credentialHash: string, value: unknown) {
      const input = parse(value);
      const principal = await options.accessStore.authenticateCredential(credentialHash);
      const runId = `managed-${digest(`${principal.principal_id}:${input.idempotency_key}`)}`;
      const requestHash = digest(JSON.stringify(input));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      return withFileOwnershipLock(join(directory, `${digest(input.operation === "profile.create" || isProviderPreference(input.operation) ? input.grant_id : input.profile_ref ?? runId)}.lock`), 5000, async () => {
        const previous = await store.getRunRecord(runId);
        if (previous) {
          if (previous.public_result_summary?.request_hash !== requestHash) return fail("managed_browser_idempotency_conflict");
          return response(previous);
        }
        await options.accessStore.checkAccess(credentialHash, accessRequest(input));
        const summary = { principal_id: principal.principal_id, grant_id: input.grant_id, operation: input.operation, request_hash: requestHash,
          ...(isInteraction(input.operation) || isEnvironment(input.operation) || isPageMutation(input.operation) || managedFileOperations.includes(input.operation as typeof managedFileOperations[number]) ? {
            ...(isInteraction(input.operation) || isPageMutation(input.operation) || managedFileOperations.includes(input.operation as typeof managedFileOperations[number]) ? { runtime_session_ref: input.runtime_session_ref } : {}),
            profile_ref: input.profile_ref, origin: input.origin,
            ...(isInteraction(input.operation) || isPageMutation(input.operation) || managedFileOperations.includes(input.operation as typeof managedFileOperations[number]) ? { dispatch_state: "not_dispatched" } : {}),
            ...(input.file_ref === undefined ? {} : { file_ref: input.file_ref })
          } : {}) };
        await store.createRunRecord({ run_id: runId, task_intent_ref: `managed-intent:${runId}`, capability_ref: "harbor:managed-browser", status: "admitted",
          admission: { decision: "accepted", action_risk: (["profile.create", "provider.preference.set", "provider.preference.clear", "account.bind", "environment.update"].includes(input.operation) || isInput(input.operation) || isPageMutation(input.operation) || managedFileOperations.includes(input.operation as typeof managedFileOperations[number])) ? "write" : "read" }, public_result_summary: summary });
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
      if (["running", "admitted", "unknown_outcome"].includes(run.status) && run.public_result_summary?.operation === "profile.create" && run.public_result_summary.reconciliation !== "completed") {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        return withFileOwnershipLock(join(directory, `${digest(text(run.public_result_summary!.grant_id))}.lock`), 5000, async () => {
          const current = (await store.getRunRecord(runId))!;
          if (current.status === "succeeded" || current.public_result_summary?.reconciliation === "completed") return response(current);
          if (current.status === "running" || current.status === "admitted") await completeRunWithFailure(store, runId, {
            status: "unknown_outcome", failure: { category: "write_outcome", code: "managed_browser_outcome_unknown", phase: "query", recovery_hint: "query_operation_without_replay" }
          });
          // A read-only receipt lookup never reissues the original creation.
          const receipt = await harbor(`/runtime/identity-environment-mutations/${encodeURIComponent(runId)}`);
          if (receipt.status === "completed") {
            try {
              const profile = publicProfile(receipt.record);
              const providerSelection = publicProviderSelection(receipt.provider_selection);
              await options.accessStore.recordCreatedProfile({ idempotency_key: runId, grant_id: run.public_result_summary!.grant_id, profile_ref: profile.profile_ref });
              await store.updateRunRecord(runId, { public_result_summary: { ...run.public_result_summary, reconciliation: "completed", result: { profile, provider_selection: providerSelection } } });
            } catch (error) {
              await store.updateRunRecord(runId, { failure: { category: "write_outcome", code: error instanceof ManagedAccessError ? error.code : "managed_browser_creation_unknown", phase: "query", recovery_hint: "query_operation_without_replay" } });
            }
          } else if (receipt.status === "rejected") {
            const failure = object(receipt.failure);
            text(failure.code);
            await store.updateRunRecord(runId, { public_result_summary: { ...run.public_result_summary, reconciliation: "completed", result: { receipt } } });
          }
          return response((await store.getRunRecord(runId))!);
        });
      }
      return response(run);
    }
  };
}
