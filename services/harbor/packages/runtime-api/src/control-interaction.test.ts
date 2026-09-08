import assert from "node:assert/strict";
import test from "node:test";
import { HarborRuntime } from "./index.js";
import { RuntimeSessionStore } from "./runtime-session.js";
import { trustLocalProviderMediaActionProbe, trustLocalProviderReadProbe, trustLocalProviderSiteResourceProbe, trustLocalProviderWritePrecheckProbe } from "./read-operation-probe-trust.js";

for (const operation of ["media", "write", "read", "site", "open"] as const) {
  for (const throws of [false, true]) test(`${operation} keeps control until Provider settles (${throws ? "exception" : "result"})`, async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    let clicks = 0;
    const probe = async () => {
      await gate;
      if (throws) throw new Error("private driver failure");
      clicks++;
      return { status: "unavailable", failure_class: "provider_probe_unavailable", retryable: false, message: "bounded failure", submitted: false, verified_fact_keys: [] } as const;
    };
    const page = { current_url: "https://creator.xiaohongshu.com/publish/publish", title: "Creator", status: "ready", facts: [] } as const;
    const runtime = new HarborRuntime(async () => ({
      status: "ready", execution_surface: "local_provider", driver_ref: "driver_control_test", facts: [],
      viewer_entry: { availability: "available", access_mode: "interactive", transport: "local_window", input_capabilities: ["keyboard_mouse"] },
      page: { ...page, facts: [] },
      executeMediaAction: trustLocalProviderMediaActionProbe(probe),
      probeWritePrecheck: trustLocalProviderWritePrecheckProbe(probe),
      probeReadOperation: trustLocalProviderReadProbe(probe),
      probeSiteResource: trustLocalProviderSiteResourceProbe(probe),
      openUrl: async () => { await probe(); return { ...page, facts: [] }; },
      captureScreenshot: async () => ({ code: "session_lost", message: "unused", retryable: false }),
      close: async () => undefined
    }));
    const session = await runtime.createSession({ control_owner: "core_task", holder_ref: "run_test", headless: false,
      identity_environment_ref: "identity_test", execution_identity_ref: "execution_test", profile_ref: "profile_test", url: page.current_url });
    const store = (runtime as unknown as { runtimeSessions: RuntimeSessionStore }).runtimeSessions;
    const ref = session.runtime_session_ref;
    const record = store.getRecord(ref)!;
    const input = { target_url: page.current_url, expected_origin: "https://creator.xiaohongshu.com", target_ref: "target_test" } as const;
    const pending = operation === "media" ? store.executeMediaAction(ref, { ...input, action_id: "xhs_publish_note_image_text_media.image_upload", requested_path: "image_text_upload", refs: [], summary: "test", no_submit_guard: "active", authorization_binding: { decision_ref: "decision_test", action_id: "xhs_publish_note_image_text_media.image_upload", target_ref: "target_test", idempotency_key: "operation_test" } })
      : operation === "write" ? store.probeWritePrecheck(ref, { ...input, requested_path: "image_text_upload" })
      : operation === "read" ? store.probeReadOperation(ref, { ...input, site_id: "xiaohongshu", operation_id: "xhs_search_notes" })
      : operation === "site" ? store.probeSiteResource(ref, { site_id: "xiaohongshu", task_kind: "search_notes" })
      : store.openIdentityEnvironmentSession({ identity_environment: { identity_environment_ref: "identity_test", execution_identity_ref: "execution_test", profile_ref: "profile_test", site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com" } }, control_owner: "core_task", holder_ref: "run_test", headless: false, url: page.current_url });
    const before = structuredClone({ facts: record.facts, generation: record.control_generation, viewer: runtime.getViewerControlFacts(ref) });
    for (const result of [runtime.recordHandoff(ref, { control_owner: "user" }), runtime.releaseSession(ref, { control_owner: "core_task" }), runtime.lockSession(ref, { control_owner: "user" })]) {
      assert.equal("failure_class" in result && result.failure_class, "session_locked");
    }
    assert.equal(record.active_provider_interactions, 1);
    assert.deepEqual({ facts: record.facts, generation: record.control_generation, viewer: runtime.getViewerControlFacts(ref) }, before);
    finish();
    await pending;
    assert.equal(record.active_provider_interactions, 0, "finally clears the interaction guard, including exceptions");
    if (!throws) {
      assert.equal("status" in runtime.recordHandoff(ref, { control_owner: "user" }), false);
      assert.equal(record.facts.control_owner, "user");
      await Promise.resolve();
      assert.equal(clicks, 1, "no Provider interaction remains after user control is acknowledged");
    } else {
      assert.equal(record.facts.current_error?.code, "session_lost", "driver exceptions retain existing fail-closed recovery");
    }
    await runtime.closeSession(ref);
  });
}

for (const pageError of [null, { code: "url_unreachable", message: "Page unavailable", retryable: true } as const]) {
  test(`control conflict preserves page health and recovers after user release (${pageError ? "page error" : "healthy"})`, async () => {
    let observations = 0;
    const runtime = new HarborRuntime(async () => ({
      status: "ready", execution_surface: "local_provider", driver_ref: "driver_recovery_test", facts: [],
      viewer_entry: { availability: "available", access_mode: "interactive", transport: "local_window", input_capabilities: ["keyboard_mouse"] },
      page: { current_url: "https://creator.xiaohongshu.com/publish/publish", title: "Creator", status: "ready", facts: [], ...(pageError ? { error: pageError } : {}) },
      probeWritePrecheck: trustLocalProviderWritePrecheckProbe(async () => {
        observations++;
        return { status: "unavailable", failure_class: "provider_probe_unavailable", retryable: false, message: "Observation reached", submitted: false, verified_fact_keys: [] };
      }),
      openUrl: async () => { throw new Error("unused"); },
      captureScreenshot: async () => ({ code: "capture_denied", message: "unused", retryable: false }),
      close: async () => undefined
    }));
    const session = await runtime.createSession({ control_owner: "core_task", holder_ref: "run_recovery", headless: false,
      identity_environment_ref: "identity_recovery", execution_identity_ref: "execution_recovery", profile_ref: "profile_recovery" });
    const ref = session.runtime_session_ref;
    const store = (runtime as unknown as { runtimeSessions: RuntimeSessionStore }).runtimeSessions;
    try {
      runtime.recordHandoff(ref, { control_owner: "user" });
      const before = store.getRecord(ref)!.control_generation;
      const conflict = runtime.lockSession(ref, { control_owner: "core_task", holder_ref: "run_recovery" });
      assert.equal("failure_class" in conflict && conflict.failure_class, "session_locked");
      const held = runtime.getSession(ref)!;
      assert.equal(held.control_owner, "user");
      assert.equal(held.control_lock.conflict_error?.code, "session_locked");
      assert.deepEqual(held.current_error, pageError);
      assert.equal(store.getRecord(ref)!.control_generation, before);
      runtime.releaseSession(ref, { control_owner: "user" });
      const reacquired = runtime.lockSession(ref, { control_owner: "core_task", holder_ref: "run_recovery" });
      assert.equal("status" in reacquired, false);
      const facts = runtime.getSession(ref)!;
      assert.equal(facts.runtime_session_ref, ref);
      assert.equal(facts.control_lock.holder_ref, "run_recovery");
      assert.equal(facts.control_lock.conflict_error, null);
      assert.deepEqual(facts.current_error, pageError, "successful control changes must not erase a genuine page failure");
      if (!facts.current_error) {
        await store.probeWritePrecheck(ref, { target_url: "https://creator.xiaohongshu.com/publish/publish", expected_origin: "https://creator.xiaohongshu.com", target_ref: "target_recovery" });
        assert.equal(observations, 1, "fresh observation is reachable from recovered admission facts");
      }
    } finally {
      await runtime.closeSession(ref);
    }
  });
}
