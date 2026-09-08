import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeSessionStore } from "./runtime-session.js";
import { ViewerControlStore } from "./viewer-control.js";
import { trustLocalProviderReadProbe, trustLocalProviderSiteResourceProbe, trustLocalProviderWritePrecheckProbe } from "./read-operation-probe-trust.js";

for (const operation of ["read", "site", "write", "open"] as const) {
  test(`driver ${operation} exception invalidates the session until explicit cleanup`, async () => {
    let calls = 0;
    let closes = 0;
    const failed = async (): Promise<never> => { calls++; throw new Error("private driver failure"); };
    const store = new RuntimeSessionStore(new ViewerControlStore(), async () => ({
      status: "ready", execution_surface: "local_provider", driver_ref: "driver_test", facts: [],
      viewer_entry: { availability: "unsupported", access_mode: "none", transport: "not_applicable", input_capabilities: [] },
      page: { current_url: "https://www.xiaohongshu.com/explore", title: "Test", status: "ready", facts: [] },
      openUrl: failed, captureScreenshot: failed,
      probeReadOperation: trustLocalProviderReadProbe(failed),
      probeSiteResource: trustLocalProviderSiteResourceProbe(failed),
      probeWritePrecheck: trustLocalProviderWritePrecheckProbe(failed),
      close: async () => { closes++; }
    }));
    const session = await store.createSession({ identity_environment_ref: "identity_test", execution_identity_ref: "execution_test", profile_ref: "profile_test", control_owner: "agent" });
    const invoke = () => operation === "open"
      ? store.openIdentityEnvironmentSession({ identity_environment: { identity_environment_ref: "identity_test", execution_identity_ref: "execution_test", profile_ref: "profile_test", site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com" } }, url: "https://www.xiaohongshu.com/explore", control_owner: "agent" })
      : operation === "read"
      ? store.probeReadOperation(session.runtime_session_ref, { site_id: "xiaohongshu", operation_id: "xhs_search_notes", target_url: "https://www.xiaohongshu.com/explore", expected_origin: "https://www.xiaohongshu.com" })
      : operation === "site"
        ? store.probeSiteResource(session.runtime_session_ref, { site_id: "xiaohongshu", task_kind: "authentication_recovery" })
        : store.probeWritePrecheck(session.runtime_session_ref, { target_url: "https://creator.xiaohongshu.com/publish/publish", expected_origin: "https://creator.xiaohongshu.com", target_ref: "target_test" });
    const result = await invoke();
    assert.ok("status" in result);
    assert.notEqual(result.status, "available");
    assert.equal(JSON.stringify(result).includes("private driver failure"), false);
    const lost = store.getRecord(session.runtime_session_ref)!;
    assert.equal(lost.facts.lifecycle_state, "disconnected");
    assert.equal(lost.facts.current_error?.code, "session_lost");
    assert.equal(lost.facts.availability.driver, "unavailable");
    assert.equal(lost.facts.control_owner, "none");
    assert.equal(store.isIdentityEnvironmentInUse("identity_test"), true);
    assert.equal("status" in store.lockSession(session.runtime_session_ref), true);
    await invoke();
    assert.equal(calls, 1);
    assert.equal(closes, 0);
    assert.equal((await store.closeSession(session.runtime_session_ref))?.lifecycle_state, "closed");
    assert.equal(closes, 1);
    assert.equal(store.isIdentityEnvironmentInUse("identity_test"), false);
  });
}
