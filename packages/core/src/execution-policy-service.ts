import {
  executionPolicyConfigConsumerBoundary,
  executionPolicyEffectiveViewSchemaVersion,
  normalizeExecutionPolicyRef
} from "./execution-policy-config.js";
import type { FileExecutionPolicyConfigStore } from "./execution-policy-config-store.js";
import {
  readLodeBusinessActionCatalog,
  type BusinessActionCategory,
  type BusinessActionTargetScope,
  type LodeBusinessActionCatalog
} from "./execution-policy-owner-proof.js";
import {
  resolveCurrentExecutionPolicy,
  type EffectiveExecutionPolicy,
  type ExecutionPolicyContext,
  type ExecutionPolicySources
} from "./execution-policy.js";
import type { LodePackageAdmissionContract } from "./lode-admission.js";
import type { FailureRecord } from "./run-record-store.js";
import type { LodePackageResolver } from "./runtime-task-chain.js";
import type { FileTaskThreadStore, TaskThreadView } from "./task-thread-types.js";

export type EffectiveBusinessActionPolicy = {
  action_id: string;
  category: BusinessActionCategory;
  target_scope: BusinessActionTargetScope;
  risk_marker: "destructive" | null;
  effective_policy: EffectiveExecutionPolicy | null;
  stop_reason?: "policy_unavailable";
};

export type ExecutionPolicyEffectiveView = {
  schema_version: typeof executionPolicyEffectiveViewSchemaVersion;
  skill_ref: string;
  owner_declaration_ref: string;
  owner_declaration_version: string;
  thread_ref?: string;
  turn_sequence?: number;
  actions: EffectiveBusinessActionPolicy[];
  consumer_boundary: typeof executionPolicyConfigConsumerBoundary;
};

export type ExecutionPolicyServiceDependencies = {
  configStore: FileExecutionPolicyConfigStore;
  lodePackageResolver?: LodePackageResolver;
  taskThreadStore?: FileTaskThreadStore;
};

function isFailure(value: LodePackageAdmissionContract | FailureRecord): value is FailureRecord {
  return "category" in value;
}

function ownerContract(resolved: LodePackageAdmissionContract): unknown {
  return {
    package_ref: resolved.package_ref,
    version: resolved.version,
    action_declaration: resolved.action_declaration
  };
}

export async function resolveSkillActionCatalog(
  skillRefValue: unknown,
  resolver?: LodePackageResolver
): Promise<{ resolved: LodePackageAdmissionContract; catalog: LodeBusinessActionCatalog }> {
  const skillRef = normalizeExecutionPolicyRef(skillRefValue, "skill_ref");
  if (!resolver) throw new Error("execution_policy_owner_unavailable");
  let resolved: Awaited<ReturnType<LodePackageResolver>>;
  try {
    resolved = await resolver({ package_ref: skillRef, task_intent: null });
  } catch {
    throw new Error("execution_policy_owner_unavailable");
  }
  if (isFailure(resolved)) {
    throw new Error(resolved.code === "package_not_found" ? "execution_policy_skill_not_found" : "execution_policy_owner_unavailable");
  }
  if (resolved.package_ref !== skillRef) throw new Error("execution_policy_owner_mismatch");
  const catalog = readLodeBusinessActionCatalog(ownerContract(resolved));
  if (!catalog) throw new Error("execution_policy_owner_invalid");
  return { resolved, catalog };
}

function capabilityRef(resolved: LodePackageAdmissionContract): string {
  return `lode:capability/${resolved.capability_id}`;
}

export async function resolveThreadPolicyContext(
  threadRef: string,
  resolved: LodePackageAdmissionContract,
  store?: FileTaskThreadStore
): Promise<{ thread: TaskThreadView; next_turn_sequence: number }> {
  if (!store) throw new Error("execution_policy_thread_store_unavailable");
  const thread = await store.getTaskThread(threadRef);
  if (!thread) throw new Error("execution_policy_thread_not_found");
  return validateThreadPolicyContext(thread, resolved);
}

export function validateThreadPolicyContext(
  thread: TaskThreadView,
  resolved: LodePackageAdmissionContract
): { thread: TaskThreadView; next_turn_sequence: number } {
  if (thread.capability_ref !== capabilityRef(resolved)) throw new Error("execution_policy_thread_binding_mismatch");
  return { thread, next_turn_sequence: thread.turns.length + 1 };
}

function actionView(
  action: LodeBusinessActionCatalog["actions"][number],
  context: ExecutionPolicyContext,
  policies: ExecutionPolicySources
): EffectiveBusinessActionPolicy {
  const effective = resolveCurrentExecutionPolicy({ context, policies }, action.category);
  return {
    action_id: action.action_id,
    category: action.category,
    target_scope: action.target_scope,
    risk_marker: action.category === "destructive" ? "destructive" : null,
    effective_policy: effective ?? null,
    ...(effective === undefined ? { stop_reason: "policy_unavailable" as const } : {})
  };
}

export async function getExecutionPolicyEffectiveView(
  input: { skill_ref: unknown; thread_ref?: string },
  dependencies: ExecutionPolicyServiceDependencies
): Promise<ExecutionPolicyEffectiveView> {
  const { resolved, catalog } = await resolveSkillActionCatalog(input.skill_ref, dependencies.lodePackageResolver);
  const threadContext = input.thread_ref === undefined
    ? undefined
    : await resolveThreadPolicyContext(input.thread_ref, resolved, dependencies.taskThreadStore);
  const context: ExecutionPolicyContext = {
    skill_ref: catalog.package_ref,
    ...(threadContext === undefined ? {} : {
      thread_ref: threadContext.thread.thread_id,
      turn_sequence: threadContext.next_turn_sequence
    })
  };
  const policies = await dependencies.configStore.resolveSources({
    skill_ref: catalog.package_ref,
    ...(context.thread_ref === undefined ? {} : { thread_ref: context.thread_ref }),
    ...(context.turn_sequence === undefined ? {} : { turn_sequence: context.turn_sequence })
  });
  return {
    schema_version: executionPolicyEffectiveViewSchemaVersion,
    skill_ref: catalog.package_ref,
    owner_declaration_ref: `${catalog.package_ref}#action_declaration`,
    owner_declaration_version: catalog.version,
    ...(context.thread_ref === undefined ? {} : { thread_ref: context.thread_ref }),
    ...(context.turn_sequence === undefined ? {} : { turn_sequence: context.turn_sequence }),
    actions: catalog.actions.map((action) => actionView(action, context, policies)),
    consumer_boundary: executionPolicyConfigConsumerBoundary
  };
}

export function declaredActionCategories(catalog: LodeBusinessActionCatalog): ReadonlySet<BusinessActionCategory> {
  return new Set(catalog.actions.map((action) => action.category));
}
