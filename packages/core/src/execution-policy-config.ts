import { createHash } from "node:crypto";

import type {
  BusinessActionCategory,
  ExecutionPolicyMode,
  ExecutionPolicyModes,
  ExecutionPolicySource
} from "./execution-policy.js";
import {
  normalizeNonSensitiveText,
  persistentReferenceMaxLength,
  persistentVersionMaxLength
} from "./sensitive-field-taxonomy.js";

export const executionPolicyConfigurationSchemaVersion = "webenvoy.execution-policy-configuration.v0";
export const executionPolicyEffectiveViewSchemaVersion = "webenvoy.execution-policy-effective-view.v0";
export const singleActionDecisionCommandSchemaVersion = "webenvoy.single-action-decision-command.v0";
export const executionPolicyMutationSchemaVersion = "webenvoy.execution-policy-mutation.v0";
export const executionPolicyConfigConsumerBoundary =
  "Business action modes and versioned owner refs only; credentials, browser storage, raw evidence, page content, and App drafts are excluded.";

export type ConfigurableExecutionPolicySource = Exclude<ExecutionPolicySource, "single_action_decision">;

type ExecutionPolicyConfigurationBase = {
  schema_version: typeof executionPolicyConfigurationSchemaVersion;
  source: ConfigurableExecutionPolicySource;
  source_ref: string;
  source_version: string;
  modes: ExecutionPolicyModes;
  updated_at: string;
  consumer_boundary: typeof executionPolicyConfigConsumerBoundary;
};

export type ExecutionPolicyConfiguration =
  | (ExecutionPolicyConfigurationBase & { source: "global_user_config" })
  | (ExecutionPolicyConfigurationBase & { source: "installed_skill_user_version"; skill_ref: string })
  | (ExecutionPolicyConfigurationBase & {
      source: "thread_revision";
      thread_ref: string;
      effective_from_turn_sequence: number;
    });

export type ExecutionPolicyMutation = {
  schema_version: typeof executionPolicyMutationSchemaVersion;
  idempotency_key: string;
  expected_source_version: string | null;
  modes: ExecutionPolicyModes;
};

export type SingleActionDecisionCommand = {
  schema_version: typeof singleActionDecisionCommandSchemaVersion;
  idempotency_key: string;
  choice: "allow_once" | "deny_once";
};

const categories = new Set<BusinessActionCategory>(["read", "prepare", "commit", "destructive"]);
const modes = new Set<ExecutionPolicyMode>(["auto", "confirm", "deny"]);
const threadRefPattern = /^thread_[a-f0-9]{32}$/;

export function normalizeExecutionPolicyRef(value: unknown, label: string): string {
  const normalized = normalizeNonSensitiveText(value, persistentReferenceMaxLength);
  if (!normalized || /^https?:\/\//i.test(normalized)) throw new Error(`${label}_invalid`);
  return normalized;
}

export function normalizeExecutionPolicyVersion(value: unknown, label = "execution_policy_source_version"): string {
  const normalized = normalizeNonSensitiveText(value, persistentVersionMaxLength);
  if (!normalized || !/^[1-9][0-9]*$/.test(normalized)) throw new Error(`${label}_invalid`);
  return normalized;
}

export function normalizeExecutionPolicyTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label}_invalid`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || Number(match[1]) === 0 || !Number.isFinite(Date.parse(value)) || Number(match[7] ?? 0) > 23 || Number(match[8] ?? 0) > 59) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

export function normalizeExecutionPolicyModes(
  value: unknown,
  options: { require_all?: boolean; allowed_categories?: ReadonlySet<BusinessActionCategory> } = {}
): ExecutionPolicyModes {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("execution_policy_modes_invalid");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.some(([category, mode]) =>
    !categories.has(category as BusinessActionCategory) ||
    !modes.has(mode as ExecutionPolicyMode) ||
    options.allowed_categories && !options.allowed_categories.has(category as BusinessActionCategory)
  )) throw new Error("execution_policy_modes_invalid");
  if (options.require_all && entries.length !== categories.size) throw new Error("execution_policy_modes_incomplete");
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))) as ExecutionPolicyModes;
}

export function normalizeExecutionPolicyMutation(
  value: unknown,
  options: { require_all?: boolean; allowed_categories?: ReadonlySet<BusinessActionCategory> } = {}
): ExecutionPolicyMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("execution_policy_mutation_invalid");
  const object = value as Record<string, unknown>;
  const fields = Object.keys(object).filter((field) => field !== "$schema").sort().join(",");
  if (fields !== "expected_source_version,idempotency_key,modes,schema_version" ||
    object.$schema !== undefined && object.$schema !== "execution-policy-mutation.schema.json" ||
    object.schema_version !== executionPolicyMutationSchemaVersion) throw new Error("execution_policy_mutation_invalid");
  const idempotencyKey = normalizeNonSensitiveText(object.idempotency_key, 128);
  if (!idempotencyKey) throw new Error("execution_policy_idempotency_key_invalid");
  const expected = object.expected_source_version === null
    ? null
    : normalizeExecutionPolicyVersion(object.expected_source_version, "expected_source_version");
  return {
    schema_version: executionPolicyMutationSchemaVersion,
    idempotency_key: idempotencyKey,
    expected_source_version: expected,
    modes: normalizeExecutionPolicyModes(object.modes, options)
  };
}

export function normalizeSingleActionDecisionCommand(value: unknown): SingleActionDecisionCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("single_action_command_invalid");
  const object = value as Record<string, unknown>;
  const fields = Object.keys(object).filter((field) => field !== "$schema").sort().join(",");
  if (fields !== "choice,idempotency_key,schema_version" ||
    object.$schema !== undefined && object.$schema !== "single-action-decision-command.schema.json" ||
    object.schema_version !== singleActionDecisionCommandSchemaVersion ||
    object.choice !== "allow_once" && object.choice !== "deny_once") throw new Error("single_action_command_invalid");
  const idempotencyKey = normalizeNonSensitiveText(object.idempotency_key, 128);
  if (!idempotencyKey) throw new Error("execution_policy_idempotency_key_invalid");
  return {
    schema_version: singleActionDecisionCommandSchemaVersion,
    idempotency_key: idempotencyKey,
    choice: object.choice
  };
}

export function normalizeThreadRef(value: unknown): string {
  const ref = normalizeExecutionPolicyRef(value, "thread_ref");
  if (!threadRefPattern.test(ref)) throw new Error("thread_ref_invalid");
  return ref;
}

export function executionPolicySourceRef(
  source: ConfigurableExecutionPolicySource,
  bindingRef = "global"
): string {
  const binding = normalizeExecutionPolicyRef(bindingRef, "execution_policy_binding_ref");
  const digest = createHash("sha256").update(`${source}\0${binding}`).digest("hex").slice(0, 32);
  return `execution-policy:${source}:${digest}`;
}

export function executionPolicyCategorySet(): ReadonlySet<BusinessActionCategory> {
  return categories;
}
