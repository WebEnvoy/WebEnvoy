import assert from "node:assert/strict";
import { managedCapabilityDefinition, managedCapabilityDefinitions, managedCapabilityExample, managedCapabilityExecutionInputSchema, managedCapabilityInputFields } from "./managed-capabilities.js";
import { parseManagedBrowserRequest } from "./managed-browser.js";

const fixtureProfile = "profile:fixture";
const fixtureOrigin = "https://example.com";
const fixtureSession = "session:fixture";
const fixturePage = "page:fixture";
const fixturePageRef = "page-ref:fixture";
const fixtureObservation = "observation:fixture";
const fixtureTarget = "target:fixture";
const fixtureFile = "attachment:runtime/11111111-1111-4111-8111-111111111111";

function fixtureField(field: string, operation: string): unknown {
  if (field === "profile_ref") return fixtureProfile;
  if (field === "origin") return fixtureOrigin;
  if (field === "template_ref") return "template:fixture";
  if (field === "url") return "https://example.com/next";
  if (field === "runtime_session_ref") return fixtureSession;
  if (field === "observation_ref") return fixtureObservation;
  if (field === "page_id") return fixturePage;
  if (field === "page_ref") return fixturePageRef;
  if (field === "document_generation") return 1;
  if (field === "cursor") return "cursor:fixture";
  if (field === "limit") return 8;
  if (field === "target_ref") return fixtureTarget;
  if (field === "file_ref") return fixtureFile;
  if (field === "text") return "ready";
  if (field === "key") return "Enter";
  if (field === "delta_y") return 100;
  if (field === "wait_for") return operation === "instance.wait" ? "text" : "page_changed";
  if (field === "timeout_ms") return 1000;
  if (field === "configuration") return { timezone: "UTC" };
  if (field === "provider_id") return "camoufox";
  throw new Error(`unhandled capability fixture field: ${field}`);
}

function fixtureTaskScope(definition: (typeof managedCapabilityDefinitions.operations)[number]): Record<string, unknown> {
  const scope: Record<string, unknown> = {
    operations: [definition.id],
    profile_refs: definition.context === "profile" ? [fixtureProfile] : [],
    origins: definition.required.includes("origin") ? [fixtureOrigin] : []
  };
  if (definition.file_scope === "upload") scope.file_refs = [fixtureFile];
  if (definition.file_scope === "download") scope.file_refs = [];
  return scope;
}

function parserFixture(definition: (typeof managedCapabilityDefinitions.operations)[number]): Record<string, unknown> {
  const value: Record<string, unknown> = {
    idempotency_key: `capability-${definition.id.replaceAll(".", "-")}`,
    connection_id: "connection:fixture",
    grant_id: "grant:fixture",
    operation: definition.id,
    task_scope: fixtureTaskScope(definition)
  };
  for (const field of definition.allowed) value[field] = fixtureField(field, definition.id);
  // The wait contract deliberately chooses one conditional branch. The text
  // branch requires text and forbids target_ref.
  if (definition.id === "instance.wait") delete value.target_ref;
  return value;
}

const scope = { operations: ["instance.observe"], profile_refs: ["profile:fixture"], origins: ["https://example.com"] };
const observation = {
  idempotency_key: "capability-parser-fixture",
  connection_id: "connection:fixture",
  grant_id: "grant:fixture",
  operation: "instance.observe",
  task_scope: scope,
  profile_ref: "profile:fixture",
  origin: "https://example.com",
  runtime_session_ref: "session:fixture"
};

assert.equal(managedCapabilityDefinitions.operations.length, 32);
assert.deepEqual(managedCapabilityInputFields("instance.observe"), [
  "idempotency_key", "connection_id", "grant_id", "operation", "task_scope",
  "profile_ref", "origin", "runtime_session_ref", "page_id", "page_ref", "document_generation"
]);
assert.doesNotThrow(() => parseManagedBrowserRequest(observation));
assert.throws(() => parseManagedBrowserRequest({ ...observation, runtime_session_ref: undefined }), /managed_browser_invalid_input/);
assert.throws(() => parseManagedBrowserRequest({ ...observation, origin: undefined }), /managed_browser_invalid_input/);
assert.throws(() => parseManagedBrowserRequest({ ...observation, task_scope: { ...scope, file_refs: ["attachment:runtime/11111111-1111-4111-8111-111111111111"] } }), /managed_browser_invalid_input/);

const download = {
  ...observation,
  idempotency_key: "capability-download-fixture",
  operation: "file.download",
  task_scope: { operations: ["file.download"], profile_refs: ["profile:fixture"], origins: ["https://example.com"], file_refs: [] },
  page_id: "page:fixture",
  page_ref: "page-ref:fixture",
  document_generation: 1,
  observation_ref: "observation:fixture",
  target_ref: "target:fixture"
};
assert.doesNotThrow(() => parseManagedBrowserRequest(download));
assert.throws(() => parseManagedBrowserRequest({ ...download, file_ref: "attachment:runtime/11111111-1111-4111-8111-111111111111" }), /managed_browser_invalid_input/);
assert.throws(() => parseManagedBrowserRequest({ ...download, task_scope: { ...download.task_scope, file_refs: ["attachment:runtime/11111111-1111-4111-8111-111111111111"] } }), /managed_browser_invalid_input/);

const fileRef = "attachment:runtime/11111111-1111-4111-8111-111111111111";
const upload = { ...download, idempotency_key: "capability-upload-fixture", operation: "file.upload", file_ref: fileRef,
  task_scope: { ...download.task_scope, operations: ["file.upload"], file_refs: [fileRef] } };
assert.doesNotThrow(() => parseManagedBrowserRequest(upload));
assert.throws(() => parseManagedBrowserRequest({ ...upload, task_scope: { ...upload.task_scope, file_refs: ["attachment:runtime/22222222-2222-4222-8222-222222222222"] } }), /managed_browser_invalid_input/);
assert.throws(() => parseManagedBrowserRequest({ ...upload, task_scope: { ...upload.task_scope, file_refs: [fileRef, fileRef] } }), /managed_browser_invalid_input/);

const pageOpen = { ...observation, idempotency_key: "capability-page-open-fixture", operation: "page.open",
  task_scope: { operations: ["page.open"], profile_refs: ["profile:fixture"], origins: ["https://example.com"] } };
assert.doesNotThrow(() => parseManagedBrowserRequest(pageOpen));
assert.doesNotThrow(() => parseManagedBrowserRequest({ ...pageOpen, url: "https://example.com/" }));
assert.throws(() => parseManagedBrowserRequest({ ...pageOpen, url: "https://other.example/" }), /managed_browser_invalid_input/);
assert.throws(() => parseManagedBrowserRequest({ ...observation, operation: "instance.navigate" }), /managed_browser_invalid_input/);
assert.equal(managedCapabilityDefinition("page.open")?.required.includes("url"), false);
assert.equal(managedCapabilityDefinition("page.open")?.allowed.includes("page_id"), false);
assert.equal(managedCapabilityDefinition("account.bind")?.exposure, "not_exposed");

for (const definition of managedCapabilityDefinitions.operations.filter(item => item.exposure === "exposed")) {
  const fixture = parserFixture(definition);
  assert.doesNotThrow(() => parseManagedBrowserRequest(fixture), `${definition.id} parser fixture`);
  const inputSchema = managedCapabilityExecutionInputSchema(definition.id) as Record<string, any>;
  assert.deepEqual(inputSchema.properties.operation.enum, [definition.id]);
  assert.deepEqual(inputSchema.required, ["idempotency_key", "grant_id", "operation", "task_scope", ...definition.required]);
  for (const field of definition.required) assert.ok(inputSchema.properties[field], `${definition.id} schema field ${field}`);
  for (const field of definition.required) {
    const missing = { ...fixture };
    delete missing[field];
    assert.throws(() => parseManagedBrowserRequest(missing), /managed_browser_invalid_input/, `${definition.id} missing ${field}`);
  }
  if (definition.file_scope === "upload") assert.deepEqual(inputSchema["x-webenvoy-equals"], { left: "task_scope.file_refs[0]", right: "file_ref" });
  if (definition.file_scope === "download") assert.equal(inputSchema.properties.task_scope.properties.file_refs.maxItems, 0);
  for (const condition of definition.conditions ?? []) assert.ok((inputSchema["x-webenvoy-conditions"] as unknown[]).some(item => JSON.stringify(item) === JSON.stringify(condition)), `${definition.id} generated condition`);
  if (definition.id !== "account.bind") assert.ok(managedCapabilityExample(definition.id), `${definition.id} illustrative example`);
}

const wait = parserFixture(managedCapabilityDefinition("instance.wait")!);
assert.doesNotThrow(() => parseManagedBrowserRequest({ ...wait, wait_for: "enabled", target_ref: fixtureTarget, text: undefined }));
assert.doesNotThrow(() => parseManagedBrowserRequest({ ...wait, wait_for: "page_changed", text: undefined }));
assert.throws(() => parseManagedBrowserRequest({ ...wait, wait_for: "enabled", text: "unexpected" }), /managed_browser_invalid_input/);
assert.throws(() => parseManagedBrowserRequest({ ...wait, wait_for: "text", target_ref: fixtureTarget }), /managed_browser_invalid_input/);
const pageNavigate = parserFixture(managedCapabilityDefinition("page.navigate")!);
assert.throws(() => parseManagedBrowserRequest({ ...pageNavigate, page_id: undefined, page_ref: undefined }), /managed_browser_invalid_input/);
const pageOpenWithoutUrl = parserFixture(managedCapabilityDefinition("page.open")!);
delete pageOpenWithoutUrl.url;
assert.doesNotThrow(() => parseManagedBrowserRequest(pageOpenWithoutUrl));
