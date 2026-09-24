import assert from "node:assert/strict";
import { createApiServer } from "./server.js";
import type { SiteTaskAdmissionOwnerApiService } from "./site-task-admission-owner-api.js";

const ownerToken = "owner-site-admission-token-0123456789abcdef";
const agentToken = "a".repeat(32);
const calls: Array<{ operation: string; input?: unknown }> = [];
const service = {
  async selectAuthoringRepository(input: unknown) { calls.push({ operation: "select_authoring_repository", input }); return { repository_ref: "webenvoy:site-task-authoring-repository/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }; },
  async listAuthoringRepositories() { calls.push({ operation: "list_authoring_repositories" }); return []; },
  async inspectCandidate(input: unknown) { calls.push({ operation: "inspect_candidate", input }); return { candidate_ref: "webenvoy:site-task-candidate/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa#sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }; },
  async candidateDiff(input: unknown) { calls.push({ operation: "candidate_diff", input }); return { diff: "" }; },
  async admitSource(input: unknown) { calls.push({ operation: "admit_source", input }); return { admission_ref: "webenvoy.source-admission/site-skill-package/v1#sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }; },
  async admitCode(input: unknown) { calls.push({ operation: "admit_code", input }); return {}; },
  async revokeCode(input: unknown) { calls.push({ operation: "revoke_code", input }); return {}; },
  async revokeSource(input: unknown) { calls.push({ operation: "revoke_source", input }); return {}; },
  async listAdmissions(input?: string) { calls.push({ operation: "list_admissions", input }); return []; }
} as unknown as SiteTaskAdmissionOwnerApiService;

const server = createApiServer({ supervisorToken: ownerToken, siteTaskAdmissionService: service });
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address === "object");
const route = `http://127.0.0.1:${address.port}/owner/site-task-admissions/operations`;
async function post(input: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(route, {
    method: "POST", headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(input)
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

try {
  const base = { schema_version: "webenvoy.site-task-admission-owner-operation/v1", operation: "list_authoring_repositories" };
  assert.equal((await post(base)).status, 401);
  assert.equal((await post(base, agentToken)).status, 401);
  assert.equal((await post(base, ownerToken)).status, 200);
  const inspect = await post({
    schema_version: "webenvoy.site-task-admission-owner-operation/v1", operation: "inspect_candidate",
    repository_ref: "webenvoy:site-task-authoring-repository/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    package_ref: "lode://site-skill/github/trending",
    base_revision_ref: "lode://site-skill/github/trending@1.0.0#0dcd6232cdfd9c88982792d2ce88a39d528a6433",
    task_ref: "read-daily-trending-top5"
  }, ownerToken);
  assert.equal(inspect.status, 200);
  assert.deepEqual(calls[1], { operation: "inspect_candidate", input: {
    repository_ref: "webenvoy:site-task-authoring-repository/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    package_ref: "lode://site-skill/github/trending",
    base_revision_ref: "lode://site-skill/github/trending@1.0.0#0dcd6232cdfd9c88982792d2ce88a39d528a6433",
    task_ref: "read-daily-trending-top5"
  } });
  const extra = await post({ ...base, operation: "admit_source", candidate_ref: "candidate", package_digest: "sha256:untrusted" }, ownerToken);
  assert.equal(extra.status, 400);
  assert.equal(calls.length, 2, "invalid owner input never reaches the admission service");
  const get = await fetch(route, { headers: { authorization: `Bearer ${ownerToken}` } });
  assert.equal(get.status, 405);
} finally {
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

console.log("Validated owner-only Git source/code admission route and strict request framing.");
