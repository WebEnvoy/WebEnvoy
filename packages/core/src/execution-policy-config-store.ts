import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseAuthorizationDecisionRef } from "./authorization-decision.js";
import {
  executionPolicyConfigConsumerBoundary,
  executionPolicyConfigurationSchemaVersion,
  executionPolicySourceRef,
  normalizeExecutionPolicyModes,
  normalizeExecutionPolicyMutation,
  normalizeExecutionPolicyRef,
  normalizeExecutionPolicyTimestamp,
  normalizeExecutionPolicyVersion,
  normalizeThreadRef,
  type ConfigurableExecutionPolicySource,
  type ExecutionPolicyConfiguration,
  type ExecutionPolicyMutation
} from "./execution-policy-config.js";
import {
  normalizeSingleActionDecision,
  type ExecutionPolicySources,
  type SingleActionDecision
} from "./execution-policy.js";
import { FileOwnershipError, withFileOwnershipLock } from "./file-ownership.js";

type StoredConfiguration = ExecutionPolicyConfiguration & {
  idempotency_key_hash: string;
  request_hash: string;
};

type StoredSingleActionDecision = {
  confirmation_decision_ref: string;
  idempotency_key_hash: string;
  request_hash: string;
  decision: SingleActionDecision;
};

type ExecutionPolicyStoreDocument = {
  schema_version: "webenvoy.execution-policy-store.v0";
  configurations: StoredConfiguration[];
  single_action_decisions: StoredSingleActionDecision[];
};

export class ExecutionPolicyVersionConflictError extends Error {
  constructor(readonly current: ExecutionPolicyConfiguration | undefined) {
    super("execution_policy_version_conflict");
  }
}

export type FileExecutionPolicyConfigStore = {
  readonly directory: string;
  getGlobalConfiguration(): Promise<ExecutionPolicyConfiguration | undefined>;
  getInstalledSkillConfiguration(skillRef: string): Promise<ExecutionPolicyConfiguration | undefined>;
  getThreadRevision(threadRef: string, turnSequence?: number): Promise<ExecutionPolicyConfiguration | undefined>;
  putGlobalConfiguration(input: ExecutionPolicyMutation): Promise<ExecutionPolicyConfiguration>;
  putInstalledSkillConfiguration(skillRef: string, input: ExecutionPolicyMutation): Promise<ExecutionPolicyConfiguration>;
  putThreadRevision(threadRef: string, effectiveFromTurnSequence: number, input: ExecutionPolicyMutation): Promise<ExecutionPolicyConfiguration>;
  resolveSources(input: { skill_ref: string; thread_ref?: string; turn_sequence?: number }): Promise<ExecutionPolicySources>;
  sourceVersionApplies(input: {
    source: ConfigurableExecutionPolicySource;
    source_ref: string;
    source_version: string;
    thread_ref?: string;
    turn_sequence?: number;
  }): Promise<boolean>;
  getSingleActionDecision(confirmationDecisionRef: string, idempotencyKey: string): Promise<SingleActionDecision | undefined>;
  recordSingleActionDecision(input: {
    confirmation_decision_ref: string;
    idempotency_key: string;
    decision: SingleActionDecision;
  }): Promise<SingleActionDecision>;
};

export type FileExecutionPolicyConfigStoreOptions = {
  directory: string;
  clock?: () => Date;
  lockTimeoutMs?: number;
};

const hashPattern = /^[a-f0-9]{64}$/;
const maxEntries = 1024;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("execution_policy_store_invalid");
  const object = value as Record<string, unknown>;
  if (!fields.every((field) => Object.hasOwn(object, field)) || Object.keys(object).some((field) => !fields.includes(field))) {
    throw new Error("execution_policy_store_invalid");
  }
  return object;
}

function publicConfiguration(value: StoredConfiguration): ExecutionPolicyConfiguration {
  const { idempotency_key_hash: _key, request_hash: _request, ...configuration } = value;
  return structuredClone(configuration);
}

function parseConfiguration(value: unknown): StoredConfiguration {
  const baseFields = [
    "schema_version", "source", "source_ref", "source_version", "modes", "updated_at",
    "consumer_boundary", "idempotency_key_hash", "request_hash"
  ];
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).source
    : undefined;
  const fields = source === "installed_skill_user_version"
    ? [...baseFields, "skill_ref"]
    : source === "thread_revision"
      ? [...baseFields, "thread_ref", "effective_from_turn_sequence"]
      : baseFields;
  const object = exactObject(value, fields);
  if (object.schema_version !== executionPolicyConfigurationSchemaVersion ||
    object.consumer_boundary !== executionPolicyConfigConsumerBoundary ||
    !hashPattern.test(String(object.idempotency_key_hash)) || !hashPattern.test(String(object.request_hash))) {
    throw new Error("execution_policy_store_invalid");
  }
  const sourceRef = normalizeExecutionPolicyRef(object.source_ref, "execution_policy_source_ref");
  const sourceVersion = normalizeExecutionPolicyVersion(object.source_version);
  const updatedAt = normalizeExecutionPolicyTimestamp(object.updated_at, "execution_policy_updated_at");
  if (source === "global_user_config") {
    const modes = normalizeExecutionPolicyModes(object.modes, { require_all: true });
    if (sourceRef !== executionPolicySourceRef(source)) throw new Error("execution_policy_store_invalid");
    return {
      schema_version: executionPolicyConfigurationSchemaVersion,
      source,
      source_ref: sourceRef,
      source_version: sourceVersion,
      modes,
      updated_at: updatedAt,
      consumer_boundary: executionPolicyConfigConsumerBoundary,
      idempotency_key_hash: object.idempotency_key_hash as string,
      request_hash: object.request_hash as string
    };
  }
  if (source === "installed_skill_user_version") {
    const skillRef = normalizeExecutionPolicyRef(object.skill_ref, "skill_ref");
    if (sourceRef !== executionPolicySourceRef(source, skillRef)) throw new Error("execution_policy_store_invalid");
    return {
      schema_version: executionPolicyConfigurationSchemaVersion,
      source,
      source_ref: sourceRef,
      source_version: sourceVersion,
      skill_ref: skillRef,
      modes: normalizeExecutionPolicyModes(object.modes),
      updated_at: updatedAt,
      consumer_boundary: executionPolicyConfigConsumerBoundary,
      idempotency_key_hash: object.idempotency_key_hash as string,
      request_hash: object.request_hash as string
    };
  }
  if (source === "thread_revision") {
    const threadRef = normalizeThreadRef(object.thread_ref);
    const effectiveFrom = object.effective_from_turn_sequence;
    if (!Number.isSafeInteger(effectiveFrom) || (effectiveFrom as number) < 1 ||
      sourceRef !== executionPolicySourceRef(source, threadRef)) throw new Error("execution_policy_store_invalid");
    return {
      schema_version: executionPolicyConfigurationSchemaVersion,
      source,
      source_ref: sourceRef,
      source_version: sourceVersion,
      thread_ref: threadRef,
      effective_from_turn_sequence: effectiveFrom as number,
      modes: normalizeExecutionPolicyModes(object.modes),
      updated_at: updatedAt,
      consumer_boundary: executionPolicyConfigConsumerBoundary,
      idempotency_key_hash: object.idempotency_key_hash as string,
      request_hash: object.request_hash as string
    };
  }
  throw new Error("execution_policy_store_invalid");
}

function parseSingleAction(value: unknown): StoredSingleActionDecision {
  const object = exactObject(value, ["confirmation_decision_ref", "idempotency_key_hash", "request_hash", "decision"]);
  if (!hashPattern.test(String(object.idempotency_key_hash)) || !hashPattern.test(String(object.request_hash))) {
    throw new Error("execution_policy_store_invalid");
  }
  return {
    confirmation_decision_ref: parseAuthorizationDecisionRef(object.confirmation_decision_ref),
    idempotency_key_hash: object.idempotency_key_hash as string,
    request_hash: object.request_hash as string,
    decision: normalizeSingleActionDecision(object.decision)
  };
}

function emptyDocument(): ExecutionPolicyStoreDocument {
  return { schema_version: "webenvoy.execution-policy-store.v0", configurations: [], single_action_decisions: [] };
}

function parseDocument(value: unknown): ExecutionPolicyStoreDocument {
  const object = exactObject(value, ["schema_version", "configurations", "single_action_decisions"]);
  if (object.schema_version !== "webenvoy.execution-policy-store.v0" ||
    !Array.isArray(object.configurations) || !Array.isArray(object.single_action_decisions) ||
    object.configurations.length > maxEntries || object.single_action_decisions.length > maxEntries) {
    throw new Error("execution_policy_store_invalid");
  }
  const configurations = object.configurations.map(parseConfiguration);
  const singleActionDecisions = object.single_action_decisions.map(parseSingleAction);
  const groups = Map.groupBy(configurations, (configuration) => configuration.source_ref);
  for (const revisions of groups.values()) {
    const versions = revisions.map((revision) => Number(revision.source_version));
    if (new Set(versions).size !== versions.length || versions.some((version, index) => version !== index + 1) ||
      new Set(revisions.map((revision) => revision.idempotency_key_hash)).size !== revisions.length) {
      throw new Error("execution_policy_store_invalid");
    }
  }
  if (new Set(singleActionDecisions.map((entry) => entry.confirmation_decision_ref)).size !== singleActionDecisions.length) {
    throw new Error("execution_policy_store_invalid");
  }
  return {
    schema_version: "webenvoy.execution-policy-store.v0",
    configurations,
    single_action_decisions: singleActionDecisions
  };
}

class FileExecutionPolicyConfigStoreImpl implements FileExecutionPolicyConfigStore {
  readonly directory: string;
  private readonly clock: () => Date;
  private readonly lockTimeoutMs: number;

  constructor(options: FileExecutionPolicyConfigStoreOptions) {
    this.directory = options.directory;
    this.clock = options.clock ?? (() => new Date());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 30_000;
  }

  private get path(): string {
    return join(this.directory, "execution-policy-store.json");
  }

  private async read(): Promise<ExecutionPolicyStoreDocument> {
    try {
      return parseDocument(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return emptyDocument();
      if (error instanceof Error && error.message === "execution_policy_store_invalid") throw error;
      throw new Error(error instanceof SyntaxError ? "execution_policy_store_invalid" : "execution_policy_persistence_failed");
    }
  }

  private async write(document: ExecutionPolicyStoreDocument): Promise<void> {
    parseDocument(document);
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `.execution-policy-store.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
      await rename(temporary, this.path);
    } catch {
      throw new Error("execution_policy_persistence_failed");
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async locked<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await withFileOwnershipLock(`${this.directory}.lock`, this.lockTimeoutMs, action);
    } catch (error) {
      if (error instanceof FileOwnershipError && error.message === "file_lock_timeout") {
        throw new Error("execution_policy_lock_timeout");
      }
      throw error;
    }
  }

  private matching(document: ExecutionPolicyStoreDocument, sourceRef: string): StoredConfiguration[] {
    return document.configurations.filter((configuration) => configuration.source_ref === sourceRef);
  }

  private latest(document: ExecutionPolicyStoreDocument, sourceRef: string): StoredConfiguration | undefined {
    return this.matching(document, sourceRef).at(-1);
  }

  private async getLatest(source: ConfigurableExecutionPolicySource, binding = "global"): Promise<ExecutionPolicyConfiguration | undefined> {
    const latest = this.latest(await this.read(), executionPolicySourceRef(source, binding));
    return latest ? publicConfiguration(latest) : undefined;
  }

  async getGlobalConfiguration(): Promise<ExecutionPolicyConfiguration | undefined> {
    return this.getLatest("global_user_config");
  }

  async getInstalledSkillConfiguration(skillRef: string): Promise<ExecutionPolicyConfiguration | undefined> {
    const ref = normalizeExecutionPolicyRef(skillRef, "skill_ref");
    return this.getLatest("installed_skill_user_version", ref);
  }

  async getThreadRevision(threadRef: string, turnSequence?: number): Promise<ExecutionPolicyConfiguration | undefined> {
    const ref = normalizeThreadRef(threadRef);
    if (turnSequence !== undefined && (!Number.isSafeInteger(turnSequence) || turnSequence < 1)) {
      throw new Error("turn_sequence_invalid");
    }
    const revisions = this.matching(await this.read(), executionPolicySourceRef("thread_revision", ref));
    const selected = turnSequence === undefined
      ? revisions.at(-1)
      : revisions.filter((revision) => revision.source === "thread_revision" && revision.effective_from_turn_sequence <= turnSequence).at(-1);
    return selected ? publicConfiguration(selected) : undefined;
  }

  private async put(
    source: ConfigurableExecutionPolicySource,
    binding: string,
    rawInput: ExecutionPolicyMutation,
    effectiveFromTurnSequence?: number
  ): Promise<ExecutionPolicyConfiguration> {
    const input = normalizeExecutionPolicyMutation(rawInput, { require_all: source === "global_user_config" });
    if (source === "thread_revision" && (!Number.isSafeInteger(effectiveFromTurnSequence) || effectiveFromTurnSequence! < 1)) {
      throw new Error("turn_sequence_invalid");
    }
    const sourceRef = executionPolicySourceRef(source, binding);
    const keyHash = hash(input.idempotency_key);
    const requestHash = hash(JSON.stringify({ source, binding, expected: input.expected_source_version, modes: input.modes, effectiveFromTurnSequence }));
    return this.locked(async () => {
      const document = await this.read();
      const revisions = this.matching(document, sourceRef);
      const replay = revisions.find((revision) => revision.idempotency_key_hash === keyHash);
      if (replay) {
        if (replay.request_hash !== requestHash) throw new Error("execution_policy_idempotency_conflict");
        return publicConfiguration(replay);
      }
      const current = revisions.at(-1);
      if ((current?.source_version ?? null) !== input.expected_source_version) {
        throw new ExecutionPolicyVersionConflictError(current ? publicConfiguration(current) : undefined);
      }
      if (document.configurations.length >= maxEntries) throw new Error("execution_policy_store_budget_exceeded");
      const common = {
        schema_version: executionPolicyConfigurationSchemaVersion as typeof executionPolicyConfigurationSchemaVersion,
        source_ref: sourceRef,
        source_version: String(revisions.length + 1),
        modes: input.modes,
        updated_at: this.clock().toISOString(),
        consumer_boundary: executionPolicyConfigConsumerBoundary as typeof executionPolicyConfigConsumerBoundary,
        idempotency_key_hash: keyHash,
        request_hash: requestHash
      };
      const next: StoredConfiguration = source === "global_user_config"
        ? { ...common, source }
        : source === "installed_skill_user_version"
          ? { ...common, source, skill_ref: binding }
          : { ...common, source, thread_ref: binding, effective_from_turn_sequence: effectiveFromTurnSequence! };
      const updated = { ...document, configurations: [...document.configurations, next] };
      await this.write(updated);
      return publicConfiguration(next);
    });
  }

  putGlobalConfiguration(input: ExecutionPolicyMutation): Promise<ExecutionPolicyConfiguration> {
    return this.put("global_user_config", "global", input);
  }

  putInstalledSkillConfiguration(skillRef: string, input: ExecutionPolicyMutation): Promise<ExecutionPolicyConfiguration> {
    return this.put("installed_skill_user_version", normalizeExecutionPolicyRef(skillRef, "skill_ref"), input);
  }

  putThreadRevision(threadRef: string, effectiveFromTurnSequence: number, input: ExecutionPolicyMutation): Promise<ExecutionPolicyConfiguration> {
    return this.put("thread_revision", normalizeThreadRef(threadRef), input, effectiveFromTurnSequence);
  }

  async resolveSources(input: { skill_ref: string; thread_ref?: string; turn_sequence?: number }): Promise<ExecutionPolicySources> {
    const [global, skill, thread] = await Promise.all([
      this.getGlobalConfiguration(),
      this.getInstalledSkillConfiguration(input.skill_ref),
      input.thread_ref === undefined ? undefined : this.getThreadRevision(input.thread_ref, input.turn_sequence)
    ]);
    return {
      ...(global?.source === "global_user_config" ? { global_user_config: global } : {}),
      ...(skill?.source === "installed_skill_user_version" ? { installed_skill_user_version: skill } : {}),
      ...(thread?.source === "thread_revision" ? { thread_revision: thread } : {})
    };
  }

  async sourceVersionApplies(input: {
    source: ConfigurableExecutionPolicySource;
    source_ref: string;
    source_version: string;
    thread_ref?: string;
    turn_sequence?: number;
  }): Promise<boolean> {
    const sourceRef = normalizeExecutionPolicyRef(input.source_ref, "execution_policy_source_ref");
    const sourceVersion = normalizeExecutionPolicyVersion(input.source_version);
    const document = await this.read();
    let selected: StoredConfiguration | undefined;
    if (input.source === "thread_revision") {
      if (!input.thread_ref || input.turn_sequence === undefined) return false;
      const expectedRef = executionPolicySourceRef("thread_revision", normalizeThreadRef(input.thread_ref));
      if (sourceRef !== expectedRef) return false;
      selected = this.matching(document, sourceRef)
        .filter((revision) => revision.source === "thread_revision" && revision.effective_from_turn_sequence <= input.turn_sequence!)
        .at(-1);
    } else {
      selected = this.latest(document, sourceRef);
    }
    return selected?.source === input.source && selected.source_version === sourceVersion;
  }

  async recordSingleActionDecision(input: {
    confirmation_decision_ref: string;
    idempotency_key: string;
    decision: SingleActionDecision;
  }): Promise<SingleActionDecision> {
    const confirmationRef = parseAuthorizationDecisionRef(input.confirmation_decision_ref);
    const idempotencyKey = normalizeExecutionPolicyRef(input.idempotency_key, "execution_policy_idempotency_key");
    const decision = normalizeSingleActionDecision(input.decision);
    const keyHash = hash(idempotencyKey);
    const requestHash = hash(JSON.stringify(decision));
    return this.locked(async () => {
      const document = await this.read();
      const existing = document.single_action_decisions.find((entry) => entry.confirmation_decision_ref === confirmationRef);
      if (existing) {
        if (existing.idempotency_key_hash === keyHash && existing.request_hash === requestHash) return structuredClone(existing.decision);
        if (existing.idempotency_key_hash === keyHash) throw new Error("single_action_idempotency_conflict");
        throw new Error("single_action_already_decided");
      }
      if (document.single_action_decisions.length >= maxEntries) throw new Error("execution_policy_store_budget_exceeded");
      const entry = { confirmation_decision_ref: confirmationRef, idempotency_key_hash: keyHash, request_hash: requestHash, decision };
      await this.write({ ...document, single_action_decisions: [...document.single_action_decisions, entry] });
      return structuredClone(decision);
    });
  }

  async getSingleActionDecision(
    confirmationDecisionRef: string,
    idempotencyKey: string
  ): Promise<SingleActionDecision | undefined> {
    const confirmationRef = parseAuthorizationDecisionRef(confirmationDecisionRef);
    const key = normalizeExecutionPolicyRef(idempotencyKey, "execution_policy_idempotency_key");
    const existing = (await this.read()).single_action_decisions.find((entry) =>
      entry.confirmation_decision_ref === confirmationRef
    );
    if (!existing) return undefined;
    if (existing.idempotency_key_hash !== hash(key)) throw new Error("single_action_already_decided");
    return structuredClone(existing.decision);
  }
}

export function createFileExecutionPolicyConfigStore(
  options: FileExecutionPolicyConfigStoreOptions
): FileExecutionPolicyConfigStore {
  return new FileExecutionPolicyConfigStoreImpl(options);
}
