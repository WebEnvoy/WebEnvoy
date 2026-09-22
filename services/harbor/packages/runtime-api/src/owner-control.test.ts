import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureLauncher, HarborRuntime } from "./index.js";
import { startHarborRuntimeServer } from "./server.js";

const supervisorToken = Buffer.alloc(32, 7).toString("base64url");
const authHeaders = { authorization: `Bearer ${supervisorToken}` };

async function json(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

async function post(url: string, body: Record<string, unknown>): Promise<{ response: Response; body: Record<string, any> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify(body)
  });
  return { response, body: await json(response) };
}

test("owner session discovery and control CAS keep stale and ABA writes side-effect free", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({
    port: 0,
    runtime,
    manual_authentication_supervisor_token: supervisorToken
  });
  try {
    const session = await runtime.createSession({
      profile_ref: "profile-owner-cas",
      provider_ref: "provider-owner-cas",
      control_owner: "core_task",
      holder_ref: "run-owner-cas",
      headless: false
    });
    const unauthorizedList = await fetch(`${running.url}/runtime/sessions`);
    assert.equal(unauthorizedList.status, 403);
    const listResponse = await fetch(`${running.url}/runtime/sessions`, { headers: authHeaders });
    assert.equal(listResponse.status, 200);
    const list = await json(listResponse);
    assert.equal(list.schema_version, "harbor-runtime-session-list/v1");
    assert.equal(list.sessions.length, 1);
    const row = list.sessions[0];
    assert.equal(row.runtime_session_ref, session.runtime_session_ref);
    assert.equal(row.provider_ref, "provider-owner-cas");
    assert.equal(row.control_generation, 0);
    assert.deepEqual(row.control_lock, {
      owner: "core_task",
      state: "held",
      holder_ref: "run-owner-cas"
    });
    assert.equal(row.current_page.status, "ready");

    const legacyInspectResponse = await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}`);
    assert.equal(legacyInspectResponse.status, 200);
    const legacyInspect = await json(legacyInspectResponse);
    assert.equal("control_generation" in legacyInspect, false);

    const wrongBearerInspect = await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}`, {
      headers: { authorization: "Bearer invalid-supervisor-token" }
    });
    assert.equal(wrongBearerInspect.status, 403);

    const inspectResponse = await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}`, { headers: authHeaders });
    assert.equal(inspectResponse.status, 200);
    const inspect = await json(inspectResponse);
    assert.equal(inspect.control_generation, 0);
    assert.equal(inspect.runtime_session_ref, session.runtime_session_ref);

    const expectedCore = {
      schema_version: "harbor-control-precondition/v1",
      control_owner: "core_task",
      lock_owner: "core_task",
      lock_state: "held",
      holder_ref: "run-owner-cas",
      control_generation: 0
    } as const;
    const handedOff = await post(`${running.url}/runtime/sessions/${session.runtime_session_ref}/handoff`, {
      control_owner: "user",
      expected_control_owner: "core_task",
      handoff_reason: "user_requested",
      expected_control: expectedCore
    });
    assert.equal(handedOff.response.status, 200);
    assert.equal(handedOff.body.control_owner, "user");
    assert.equal(handedOff.body.control_generation, 1);

    const viewerBeforeIllegalHandoff = await json(await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}/runtime-facts`));
    const illegalHandoff = await post(`${running.url}/runtime/sessions/${session.runtime_session_ref}/handoff`, {
      control_owner: "user",
      expected_control_owner: "core_task",
      holder_ref: "harbor_mediated_user",
      handoff_reason: "user_requested",
      expected_control: {
        schema_version: "harbor-control-precondition/v1",
        control_owner: "user",
        lock_owner: "user",
        lock_state: "held",
        holder_ref: "harbor_mediated_user",
        control_generation: 1
      }
    });
    assert.equal(illegalHandoff.response.status, 409);
    assert.equal(illegalHandoff.body.failure_class, "control_state_changed");
    assert.equal(illegalHandoff.body.current_control.control_generation, 1);
    const viewerAfterIllegalHandoff = await json(await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}/runtime-facts`));
    assert.deepEqual(viewerAfterIllegalHandoff.control, viewerBeforeIllegalHandoff.control);

    const staleRelease = await post(`${running.url}/runtime/sessions/${session.runtime_session_ref}/release`, {
      control_owner: "user",
      expected_control: expectedCore
    });
    assert.equal(staleRelease.response.status, 409);
    assert.equal(staleRelease.body.failure_class, "control_state_changed");
    assert.equal(staleRelease.body.current_control.control_generation, 1);
    const unchangedAfterStale = await json(await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}`, { headers: authHeaders }));
    assert.equal(unchangedAfterStale.control_owner, "user");
    assert.equal(unchangedAfterStale.control_generation, 1);

    const expectedUser = {
      schema_version: "harbor-control-precondition/v1",
      control_owner: "user",
      lock_owner: "user",
      lock_state: "held",
      holder_ref: "harbor_mediated_user",
      control_generation: 1
    } as const;
    const released = await post(`${running.url}/runtime/sessions/${session.runtime_session_ref}/release`, {
      control_owner: "user",
      expected_control: expectedUser
    });
    assert.equal(released.response.status, 200);
    assert.equal(released.body.control_generation, 2);

    const expectedReleased = {
      schema_version: "harbor-control-precondition/v1",
      control_owner: "none",
      lock_owner: "none",
      lock_state: "released",
      holder_ref: null,
      control_generation: 2
    } as const;
    const acquired = await post(`${running.url}/runtime/sessions/${session.runtime_session_ref}/lock`, {
      control_owner: "user",
      holder_ref: "same-holder",
      expected_control: expectedReleased
    });
    assert.equal(acquired.response.status, 200);
    assert.equal(acquired.body.control_generation, 3);
    const expectedSameHolder = {
      ...expectedReleased,
      control_owner: "user",
      lock_owner: "user",
      lock_state: "held",
      holder_ref: "same-holder",
      control_generation: 3
    } as const;
    const releasedAgain = await post(`${running.url}/runtime/sessions/${session.runtime_session_ref}/release`, {
      control_owner: "user",
      holder_ref: "same-holder",
      expected_control: expectedSameHolder
    });
    assert.equal(releasedAgain.response.status, 200);
    assert.equal(releasedAgain.body.control_generation, 4);

    const aba = await post(`${running.url}/runtime/sessions/${session.runtime_session_ref}/lock`, {
      control_owner: "user",
      holder_ref: "same-holder",
      expected_control: expectedReleased
    });
    assert.equal(aba.response.status, 409);
    assert.equal(aba.body.failure_class, "control_state_changed");
    assert.equal(aba.body.current_control.control_generation, 4);
    const unchangedAfterAba = await json(await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}`, { headers: authHeaders }));
    assert.equal(unchangedAfterAba.control_owner, "none");
    assert.equal(unchangedAfterAba.control_lock.holder_ref, null);
    assert.equal(unchangedAfterAba.control_lock.conflict_error, null);

    const stopped = await post(`${running.url}/runtime/sessions/${session.runtime_session_ref}/stop`, {});
    assert.equal(stopped.response.status, 200);
    const afterClose = await json(await fetch(`${running.url}/runtime/sessions`, { headers: authHeaders }));
    assert.deepEqual(afterClose.sessions, []);
  } finally {
    await running.close();
  }
});

test("owner takeover from a released session requires a viewer", async () => {
  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const running = await startHarborRuntimeServer({
    port: 0,
    runtime,
    manual_authentication_supervisor_token: supervisorToken
  });
  try {
    const session = await runtime.createSession({ profile_ref: "profile-no-viewer", control_owner: "core_task" });
    const released = runtime.releaseSession(session.runtime_session_ref, { control_owner: "core_task" });
    assert.equal("status" in released, false);
    const expected = {
      schema_version: "harbor-control-precondition/v1",
      control_owner: "none",
      lock_owner: "none",
      lock_state: "released",
      holder_ref: null,
      control_generation: 1
    } as const;
    const takeover = await post(`${running.url}/runtime/sessions/${session.runtime_session_ref}/lock`, {
      control_owner: "user",
      holder_ref: "harbor_mediated_user",
      expected_control: expected
    });
    assert.equal(takeover.response.status, 409);
    assert.equal(takeover.body.failure_class, "viewer_unavailable");
    const inspect = await json(await fetch(`${running.url}/runtime/sessions/${session.runtime_session_ref}`, { headers: authHeaders }));
    assert.equal(inspect.control_owner, "none");
    assert.equal(inspect.control_generation, 1);
  } finally {
    await running.close();
  }
});
