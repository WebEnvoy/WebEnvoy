import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { RuntimeSessionStore } from "./runtime-session.js";
import { ViewerControlStore } from "./viewer-control.js";
import { profileStoragePath } from "./profile-storage.js";
import { HARBOR_PROFILE_RECOVERY_SCHEMA, HARBOR_PROFILE_RECOVERY_OPERATION_SCHEMA } from "./profile-recovery.js";

test("an interrupted apply journal blocks the original Profile even with a present directory; another Profile can start", async () => {
  const root = mkdtempSync(join(tmpdir(), "harbor-recovery-start-"));
  process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
  let launches = 0;
  const sessions = new RuntimeSessionStore(new ViewerControlStore(), async () => {
    launches++;
    return { status: "ready", execution_surface: "local_provider", driver_ref: "fixture", facts: [],
      viewer_entry: { availability: "unsupported", access_mode: "none", transport: "not_applicable", input_capabilities: [] },
      page: { current_url: "about:blank", title: "Fixture", status: "ready", facts: [] },
      openUrl: async () => { throw new Error("unused fixture navigation"); }, captureScreenshot: async () => { throw new Error("unused fixture screenshot"); }, close: async () => {} };
  });
  try {
    const path = profileStoragePath("storage-p1");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "marker"), "retained-after-interrupted-switch");
    const recovery = join(dirname(path), ".recovery");
    mkdirSync(recovery);
    // This is the durable state left if the process stops after switching the
    // browser directory but before completing the environment/receipt commit.
    writeFileSync(join(recovery, "operations.json"), JSON.stringify({ schema_version: HARBOR_PROFILE_RECOVERY_SCHEMA, backups: [], operations: [{ schema_version: HARBOR_PROFILE_RECOVERY_OPERATION_SCHEMA, kind: "apply", status: "running", profile_ref: "p1", operation_ref: "recovery:interrupted", idempotency_hash: "a".repeat(64), request_hash: "b".repeat(64), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }));
    const refused = await sessions.createSession({ profile_ref: "p1", profile_storage_ref: "storage-p1" });
    assert.equal(refused.current_error?.code, "recovery_operation_unfinished");
    assert.equal(launches, 0);
    assert.equal(existsSync(join(path, "marker")), true);
    const p2 = await sessions.createSession({ profile_ref: "p2", profile_storage_ref: "storage-p2" });
    assert.equal(launches, 1);
    assert.equal(p2.lifecycle_state, "active");
    await sessions.closeSession(p2.runtime_session_ref);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
