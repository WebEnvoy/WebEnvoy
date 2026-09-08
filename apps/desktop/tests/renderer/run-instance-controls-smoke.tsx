import { createRoot } from "react-dom/client";
import { RunInstancePanel } from "../../src/renderer/RunInstancePanel";

export async function checkRunInstanceControls() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const shell = window.webenvoyShell!;
  const originalRequest = shell.requestOwnerJson;
  const sessionRef = "session_control-regression";
  const refs = { runtime_session_ref: sessionRef, profile_ref: "profile_control-regression", identity_environment_ref: "identity_control-regression", raw_access: "not_available_from_core" };
  let session = { schema_version: "harbor-runtime-facts/v0", ...refs, lifecycle_state: "idle", control_owner: "none", control_lock: { state: "released" }, current_page: { status: "ready", observed_at: "2026-09-08T00:00:00Z" } };
  let unavailable = false;
  let loseControlResponse = false;
  const commands: WebEnvoyOwnerApiJsonRequest[] = [];
  const button = (label: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label);
  const waitFor = async (predicate: () => boolean, message: string) => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(message);
  };
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  shell.requestOwnerJson = async (request) => {
    if (request.path === "/runs/run-control-regression/session-refs") return { ok: true, body: { ok: true, session_refs: { schema_version: "webenvoy.session-refs-query.v0", run_id: "run-control-regression", session_refs: refs } } };
    if (request.method === "POST") {
      commands.push(request);
      const body = request.body as { control_owner?: string; expected_control_owner?: string; handoff_reason?: string };
      assert(body.control_owner === "user", "Control must use the existing user lease intent.");
      if (request.path.endsWith("/handoff")) {
        assert(session.control_owner === "core_task" && body.expected_control_owner === "core_task" && body.handoff_reason === "user_requested", "Core takeover must use the exact Harbor handoff contract.");
        session = { ...session, lifecycle_state: "locked", control_owner: "user", control_lock: { state: "held" } };
      } else if (request.path.endsWith("/lock")) {
        if (session.control_owner !== "none") return { ok: true, body: { status: "unavailable", failure_class: "session_locked", message: "Another lease is held.", retryable: true } };
        session = { ...session, lifecycle_state: "locked", control_owner: "user", control_lock: { state: "held" } };
      }
      else if (request.path.endsWith("/release")) session = { ...session, lifecycle_state: "idle", control_owner: "none", control_lock: { state: "released" } };
      else throw new Error(`Unexpected mutation: ${request.path}`);
      if (loseControlResponse) throw new Error("Control response lost after owner applied the command.");
      return { ok: true, body: session };
    }
    if (request.path === `/runtime/sessions/${sessionRef}`) return unavailable ? { ok: false, error: "Unavailable" } : { ok: true, body: session };
    throw new Error(`Unexpected request: ${request.path}`);
  };
  try {
    root.render(<RunInstancePanel coreEndpoint="http://core.owner" harborEndpoint="http://harbor.owner" runId="run-control-regression" />);
    await waitFor(() => Boolean(button("接管同一实例")), "Idle released Instance did not offer takeover.");
    button("接管同一实例")!.click();
    await waitFor(() => Boolean(button("交还控制")), "Successful lock did not restore the return button.");
    assert(commands.length === 1 && commands[0]?.path === `/runtime/sessions/${sessionRef}/lock`, "Takeover targeted another Instance or replayed.");
    button("交还控制")!.click();
    await waitFor(() => Boolean(button("接管同一实例")) && container.textContent?.includes("已交还控制；Agent 必须重新观察") === true, "Actual none/released response was not accepted or idle takeover did not recover.");
    assert(commands.length === 2 && commands[1]?.path === `/runtime/sessions/${sessionRef}/release`, "Return must only release the same Instance.");
    session = { ...session, lifecycle_state: "active", control_owner: "core_task", control_lock: { state: "held" } };
    button("刷新现场状态")!.click();
    await waitFor(() => container.textContent?.includes("core_task / held") === true && Boolean(button("接管同一实例")), "Core owner was not refreshed.");
    button("接管同一实例")!.click();
    await waitFor(() => Boolean(button("交还控制")), "Core-owned Instance did not transfer through the Harbor handoff contract.");
    assert(session.control_owner === "user" && commands.length === 3 && commands[2]?.path.endsWith("/handoff"), "App did not transfer the exact Core-owned Instance.");
    button("交还控制")!.click();
    await waitFor(() => Boolean(button("接管同一实例")), "Transferred Instance did not release back to idle.");
    session = { ...session, lifecycle_state: "active", control_owner: "agent", control_lock: { state: "held" } };
    button("刷新现场状态")!.click();
    await waitFor(() => container.textContent?.includes("agent / held") === true, "Conflicting owner was not refreshed.");
    button("接管同一实例")!.click();
    await waitFor(() => container.textContent?.includes("控制权操作未确认") === true && Boolean(button("接管同一实例")), "Conflicting owner refusal did not restore the panel.");
    assert(session.control_owner === "agent" && commands.length === 5 && commands[4]?.path.endsWith("/lock"), "App stole conflicting control or issued a second mutation after refusal.");
    unavailable = true;
    button("刷新现场状态")!.click();
    await waitFor(() => container.textContent?.includes("不匹配或已不可用") === true, "Missing session did not fail closed.");
    assert(!button("接管同一实例") && !button("交还控制"), "Unavailable Instance retained control buttons.");
    unavailable = false;
    session = { ...session, lifecycle_state: "idle", control_owner: "none", control_lock: { state: "released" } };
    button("刷新现场状态")!.click();
    await waitFor(() => Boolean(button("接管同一实例")), "Read-only refresh did not recover the same idle Instance.");
    loseControlResponse = true;
    const beforeLostResponse = commands.length;
    button("接管同一实例")!.click();
    await waitFor(() => Boolean(button("交还控制")) && container.textContent?.includes("控制权操作未确认") === true, "Lost response must recover through a read of the same Instance.");
    assert(commands.length === beforeLostResponse + 1, "Unknown control response must not replay through a fallback endpoint.");
  } finally {
    root.unmount();
    container.remove();
    shell.requestOwnerJson = originalRequest;
  }
}
