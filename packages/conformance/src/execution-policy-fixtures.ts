import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtureDir = join(packageRoot, "..", "schemas", "fixtures");
const consumerBoundary =
  "Business action modes and versioned owner refs only; credentials, browser storage, raw evidence, page content, and App drafts are excluded.";
const forbiddenKeys = new Set([
  "cookie",
  "cookies",
  "token",
  "browser_storage",
  "profile_storage",
  "raw_evidence",
  "dom",
  "har",
  "video",
  "page_content",
  "draft",
  "draft_body"
]);

function asObject(value: unknown, label: string): JsonObject {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as JsonObject;
}

function asString(value: unknown, label: string): string {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert((value as string).length > 0, `${label} must not be empty`);
  return value as string;
}

async function readFixture(name: string): Promise<JsonObject> {
  return asObject(JSON.parse(await readFile(join(fixtureDir, name), "utf8")), name);
}

function assertNoSensitiveFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveFields(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as JsonObject)) {
    assert(!forbiddenKeys.has(key.toLowerCase()), `${path} must not expose ${key}`);
    assertNoSensitiveFields(entry, `${path}.${key}`);
  }
}

function assertConfiguration(
  fixture: JsonObject,
  source: "global_user_config" | "installed_skill_user_version" | "thread_revision"
): JsonObject {
  assert.equal(fixture.schema_version, "webenvoy.execution-policy-configuration.v0");
  assert.equal(fixture.source, source);
  assert.match(asString(fixture.source_ref, `${source}.source_ref`), new RegExp(`^execution-policy:${source}:[a-f0-9]{32}$`));
  assert.match(asString(fixture.source_version, `${source}.source_version`), /^[1-9][0-9]*$/);
  assert.equal(fixture.consumer_boundary, consumerBoundary);
  return asObject(fixture.modes, `${source}.modes`);
}

function assertEffectiveView(fixture: JsonObject): void {
  assert.equal(fixture.schema_version, "webenvoy.execution-policy-effective-view.v0");
  assert.equal(fixture.consumer_boundary, consumerBoundary);
  assert.equal(fixture.turn_sequence, 2);
  const actions = fixture.actions;
  assert(Array.isArray(actions) && actions.length > 0, "effective view must expose every declared business action");
  for (const [index, value] of actions.entries()) {
    const action = asObject(value, `effective-view.actions[${index}]`);
    assert(["read", "prepare", "commit", "destructive"].includes(asString(action.category, `actions[${index}].category`)));
    if (action.effective_policy === null) {
      assert.equal(action.stop_reason, "policy_unavailable");
      continue;
    }
    const policy = asObject(action.effective_policy, `actions[${index}].effective_policy`);
    assert(["auto", "confirm", "deny"].includes(asString(policy.mode, `actions[${index}].mode`)));
    assert(["thread_revision", "installed_skill_user_version", "global_user_config"].includes(
      asString(policy.source, `actions[${index}].source`)
    ));
    asString(policy.source_ref, `actions[${index}].source_ref`);
    assert.match(asString(policy.source_version, `actions[${index}].source_version`), /^[1-9][0-9]*$/);
  }
  assert(actions.some((value) => asObject(value, "effective-view.action").effective_policy === null),
    "effective view must make unavailable policy explicit");
}

export async function assertExecutionPolicyFixtureConformance(): Promise<number> {
  const [globalConfig, skillConfig, threadConfig, effectiveView, mutation, command, decision] = await Promise.all([
    readFixture("execution-policy-global-configuration.fixture.json"),
    readFixture("execution-policy-skill-configuration.fixture.json"),
    readFixture("execution-policy-thread-configuration.fixture.json"),
    readFixture("execution-policy-effective-view.fixture.json"),
    readFixture("execution-policy-mutation.fixture.json"),
    readFixture("single-action-decision-command.fixture.json"),
    readFixture("single-action-decision.fixture.json")
  ]);

  const globalModes = assertConfiguration(globalConfig, "global_user_config");
  assert.deepEqual(Object.keys(globalModes).sort(), ["commit", "destructive", "prepare", "read"]);
  assert.equal(globalModes.destructive, "auto", "dangerous actions may remain automatic");

  assertConfiguration(skillConfig, "installed_skill_user_version");
  const skillRef = asString(skillConfig.skill_ref, "skill.skill_ref");
  assert.match(skillRef, /@[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.notEqual(skillConfig.source_version, skillRef.split("@").at(-1), "skill release and user policy versions must be independent");

  assertConfiguration(threadConfig, "thread_revision");
  assert.equal(threadConfig.effective_from_turn_sequence, 2, "thread revisions must begin with a future turn");
  assert.match(asString(threadConfig.thread_ref, "thread.thread_ref"), /^thread_[a-f0-9]{32}$/);

  assertEffectiveView(effectiveView);

  assert.equal(mutation.schema_version, "webenvoy.execution-policy-mutation.v0");
  assert.deepEqual(Object.keys(mutation).sort(), ["$schema", "expected_source_version", "idempotency_key", "modes", "schema_version"]);
  assert.equal(command.schema_version, "webenvoy.single-action-decision-command.v0");
  assert(["allow_once", "deny_once"].includes(asString(command.choice, "single-action-command.choice")));
  assert.deepEqual(Object.keys(command).sort(), ["$schema", "choice", "idempotency_key", "schema_version"]);
  assert.equal(decision.schema_version, "webenvoy.single-action-decision.v0");
  assert.match(asString(decision.confirmation_decision_ref, "single-action-decision.confirmation_decision_ref"),
    /^authorization-decision:[a-f0-9]{32}:[a-f0-9]{32}$/);
  assert.match(asString(decision.source_ref, "single-action-decision.source_ref"), /^execution-policy:single-action:[a-f0-9]{32}$/);

  for (const [name, fixture] of Object.entries({ globalConfig, skillConfig, threadConfig, effectiveView, mutation, command, decision })) {
    assertNoSensitiveFields(fixture, name);
  }
  return 7;
}
