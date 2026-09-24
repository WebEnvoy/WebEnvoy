import assert from "node:assert/strict";
import { createApiServer } from "./server.js";
import type { AccountSystemOwnerApiService } from "./account-system-owner-api.js";

const ownerToken = "owner-account-system-token-0123456789abcdef";
const agentToken = "a".repeat(32);
const calls: Array<{ operation: string; value?: unknown }> = [];

const service = {
  async importTemplate(input: { template_ref: string }) {
    calls.push({ operation: "import_template", value: input.template_ref });
    return { local_definition_ref: "webenvoy:account-system/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revision_ref: "webenvoy:account-system-revision/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa@1#sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", template_ref: input.template_ref };
  },
  async list() { return []; },
  async createDraft(input: unknown) { calls.push({ operation: "create_draft", value: input }); return {}; },
  async updateDraft(input: unknown) { calls.push({ operation: "update_draft", value: input }); return {}; },
  async checkDraft(input: unknown) { calls.push({ operation: "check_draft", value: input }); return {}; },
  async pinDraft(input: unknown) { calls.push({ operation: "pin_draft", value: input }); return {}; },
  async enable(input: unknown) { calls.push({ operation: "enable", value: input }); return {}; },
  async disable(input: unknown) { calls.push({ operation: "disable", value: input }); return {}; },
  async rollback(input: unknown) { calls.push({ operation: "rollback", value: input }); return {}; },
  async resolve(input: unknown) { calls.push({ operation: "resolve", value: input }); return {}; }
} as unknown as AccountSystemOwnerApiService;

const server = createApiServer({ supervisorToken: ownerToken, accountSystemDefinitionService: service });
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address === "object");
const route = `http://127.0.0.1:${address.port}/owner/account-systems/operations`;
async function post(input: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(route, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(input)
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

try {
  const importRequest = { schema_version: "webenvoy.account-system-owner-operation/v1", operation: "import_template", template_ref: "lode://account-system/github@1.0.0" };
  const unauthorized = await post(importRequest);
  assert.equal(unauthorized.status, 401);
  const agentDenied = await post(importRequest, agentToken);
  assert.equal(agentDenied.status, 401);
  const imported = await post(importRequest, ownerToken);
  assert.equal(imported.status, 200);
  assert.equal(imported.body.ok, true);
  assert.deepEqual(calls, [{ operation: "import_template", value: "lode://account-system/github@1.0.0" }]);
  const rejectedExtra = await post({ ...importRequest, identity_method: "inferred" }, ownerToken);
  assert.equal(rejectedExtra.status, 400);
  assert.equal(calls.length, 1, "invalid fields do not reach the owner service");
  const resolve = await post({ schema_version: "webenvoy.account-system-owner-operation/v1", operation: "resolve", local_definition_ref: "webenvoy:account-system/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", historical: false }, ownerToken);
  assert.equal(resolve.status, 200);
  assert.equal(calls.at(-1)?.operation, "resolve");
  const get = await fetch(route, { headers: { authorization: `Bearer ${ownerToken}` } });
  assert.equal(get.status, 405);
} finally {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

console.log("Validated the owner-only AccountSystem API route, strict operation framing, and Agent denial.");
