import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const guard = moduleUrl(await readFile(new URL("../src/renderer/ownerPayloadGuards.ts", import.meta.url), "utf8"));
const source = (await readFile(new URL("../src/renderer/runInstanceClient.ts", import.meta.url), "utf8"))
  .replace('import { requestOwnerJson } from "./ownerApiClient";', 'const requestOwnerJson = (...args: unknown[]) => globalThis.instanceRequest(...args);')
  .replace('"./ownerPayloadGuards"', JSON.stringify(guard));
const { fetchRunInstance, projectRunInstance } = await import(moduleUrl(source));
const refs = { runtime_session_ref: "session_verified", profile_ref: "profile_verified", identity_environment_ref: "identity_verified", raw_access: "not_available_from_core" };
const session = { schema_version: "harbor-runtime-facts/v0", ...refs, lifecycle_state: "active", control_owner: "core_task", control_lock: { state: "held" }, current_page: { status: "ready", observed_at: "2026-09-08T00:00:00Z", title: "not-rendered" } };
assert.equal(projectRunInstance(refs, session).status, "ready");
for (const mismatch of [{ runtime_session_ref: "session_other" }, { profile_ref: "profile_other" }, { identity_environment_ref: "identity_other" }, { schema_version: "wrong" }]) {
  assert.equal(projectRunInstance(refs, { ...session, ...mismatch }).status, "unavailable");
}
assert.equal(projectRunInstance(refs, { status: "unavailable" }).status, "unavailable");
const projected = projectRunInstance(refs, { ...session, control_owner: "unknown", current_page: { status: "unknown" } });
assert.equal(projected.instance.controlOwner, "unknown");
assert.equal(projected.instance.pageStatus, "unknown");
assert.ok(!("current_page" in projected.instance));
assert.ok(!("canCommit" in projected.instance));
const calls = [];
globalThis.instanceRequest = async (_base, path) => {
  calls.push(path);
  return path.endsWith("/session-refs") ? { ok: true, session_refs: { schema_version: "webenvoy.session-refs-query.v0", run_id: "run_selected", session_refs: refs } } : session;
};
assert.equal((await fetchRunInstance("core", "harbor", "run_selected")).status, "ready");
assert.deepEqual(calls, ["/runs/run_selected/session-refs", "/runtime/sessions/session_verified"]);
calls.length = 0;
assert.equal((await fetchRunInstance("core", "harbor", "run_other")).status, "unavailable");
assert.deepEqual(calls, ["/runs/run_other/session-refs"]);
globalThis.instanceRequest = async () => { throw new Error("offline"); };
assert.equal((await fetchRunInstance("core", "harbor", "run_selected")).status, "unavailable");
assert.equal(projectRunInstance(refs, { ...session, control_owner: "user" }).instance.controlOwner, "user");
assert.equal(projectRunInstance(refs, { ...session, lifecycle_state: "idle", control_owner: "none", control_lock: { state: "released" } }).instance.controlOwner, "none");
delete globalThis.instanceRequest;
console.log("Run Instance binding regression passed (local API fixture; not live acceptance).");
