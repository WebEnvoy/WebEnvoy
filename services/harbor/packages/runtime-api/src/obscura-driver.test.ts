import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HarborRuntime } from "./index.js";

const binary = process.env.HARBOR_OBSCURA_PATH;

test("Obscura runs through managed Profile, Instance, snapshot, input and restart persistence", { skip: !binary }, async () => {
  const root = await mkdtemp(join(tmpdir(), "harbor-obscura-live-"));
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/first") response.setHeader("set-cookie", "sid=alpha; Path=/; HttpOnly; SameSite=Lax");
    const persisted = request.headers.cookie?.includes("sid=alpha") ?? false;
    response.end(`<!doctype html><meta charset=utf-8><title>${persisted ? "Persisted" : "Fresh"}</title><body style="min-height:3000px"><input aria-label="内容"><input aria-label="普通字段" value="correct-horse-battery-staple"><input aria-label="延迟替换"><button onclick="this.textContent='已保存'">保存</button><button aria-label="安排替换" onclick="setTimeout(()=>{const old=document.querySelector('[aria-label=延迟替换]'),next=old.nextSibling;old.remove();const el=document.createElement('input');el.setAttribute('aria-label','延迟替换');document.body.insertBefore(el,next)},50)">安排替换</button><p>eyJhbGciOiJIUzI1NiJ9.payload.signature</p><p>${request.headers.cookie ?? "missing"}</p></body>`);
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const previousRoot = process.env.HARBOR_PROFILE_STORAGE_ROOT;
  const previousPrivate = process.env.HARBOR_OBSCURA_ALLOW_PRIVATE_NETWORK;
  process.env.HARBOR_PROFILE_STORAGE_ROOT = root;
  process.env.HARBOR_OBSCURA_ALLOW_PRIVATE_NETWORK = "1";
  const runtime = new HarborRuntime();
  try {
    const created = runtime.mutateLocalIdentityEnvironment({ operation: "create", idempotency_key: "obscura-live-create", identity_environment: { requested_provider_id: "obscura", site: { site_id: "controlled", origin, display_name: "Controlled" } } });
    assert.equal(created.status, "completed");
    const identityRef = created.identity_environment_ref!;
    const opened = await runtime.openManagedIdentityEnvironmentSession({ identity_environment_ref: identityRef, operation_scope: "profile_management", url: `${origin}/first`, control_owner: "core_task", holder_ref: "run_obscura_live", headless: true });
    assert.equal("status" in opened, false);
    if ("status" in opened) throw new Error(opened.message);
    assert.equal(opened.facts.some(fact => fact.key === "provider.id" && fact.value === "obscura"), true);
    assert.equal(opened.availability.driver, "available");
    assert.equal(opened.availability.viewer, "unsupported");

    let snapshot = await runtime.operateManagedInteraction(opened.runtime_session_ref, { action: "snapshot", expected_origin: origin, controlled_origin: origin, holder_ref: "run_obscura_live", operation_ref: "operation_obscura_snapshot" });
    assert.equal(snapshot.status, "completed");
    assert.equal(JSON.stringify(snapshot).includes("correct-horse-battery-staple"), false);
    assert.equal(JSON.stringify(snapshot).includes("sid=alpha"), false);
    assert.equal(JSON.stringify(snapshot).includes("eyJhbGciOiJIUzI1NiJ9"), false);
    assert.equal(snapshot.snapshot?.text, "");
    assert.equal(snapshot.snapshot?.truncated, true);
    const schedule = snapshot.snapshot?.controls.find(control => control.name === "安排替换");
    const delayed = snapshot.snapshot?.controls.find(control => control.name === "延迟替换");
    assert.ok(schedule && delayed);
    const scheduled = await runtime.operateManagedInteraction(opened.runtime_session_ref, { action: "click", expected_origin: origin, controlled_origin: origin, holder_ref: "run_obscura_live", operation_ref: "operation_obscura_schedule_replace", page_ref: snapshot.snapshot!.page_ref, observation_ref: snapshot.snapshot!.observation_ref, target_ref: schedule.target_ref });
    assert.equal(scheduled.status, "completed");
    await new Promise(resolve => setTimeout(resolve, 100));
    const stale = await runtime.operateManagedInteraction(opened.runtime_session_ref, { action: "input", expected_origin: origin, controlled_origin: origin, holder_ref: "run_obscura_live", operation_ref: "operation_obscura_stale_target", page_ref: scheduled.snapshot!.page_ref, observation_ref: scheduled.snapshot!.observation_ref, target_ref: scheduled.snapshot!.controls.find(control => control.name === "延迟替换")!.target_ref, text: "不得派发" });
    assert.equal(stale.status, "unavailable");
    assert.equal(stale.dispatch_state, "not_dispatched");
    assert.equal(stale.failure_class, "managed_interaction_stale_target");
    snapshot = await runtime.operateManagedInteraction(opened.runtime_session_ref, { action: "snapshot", expected_origin: origin, controlled_origin: origin, holder_ref: "run_obscura_live", operation_ref: "operation_obscura_snapshot_after_replace" });
    assert.equal(snapshot.status, "completed");
    const textbox = snapshot.snapshot?.controls.find(control => control.role === "textbox");
    assert.ok(textbox);
    const input = await runtime.operateManagedInteraction(opened.runtime_session_ref, { action: "input", expected_origin: origin, controlled_origin: origin, holder_ref: "run_obscura_live", operation_ref: "operation_obscura_input", page_ref: snapshot.snapshot!.page_ref, observation_ref: snapshot.snapshot!.observation_ref, target_ref: textbox!.target_ref, text: "中文验证" });
    assert.equal(input.status, "completed");
    assert.equal(input.snapshot?.controls.find(control => control.role === "textbox")?.value, undefined);
    const button = input.snapshot?.controls.find(control => control.role === "button");
    assert.ok(button);
    const clicked = await runtime.operateManagedInteraction(opened.runtime_session_ref, { action: "click", expected_origin: origin, controlled_origin: origin, holder_ref: "run_obscura_live", operation_ref: "operation_obscura_click", page_ref: input.snapshot!.page_ref, observation_ref: input.snapshot!.observation_ref, target_ref: button!.target_ref });
    assert.equal(clicked.status, "completed");
    assert.equal(clicked.snapshot?.controls.some(control => control.name === "已保存"), true);
    const scrolled = await runtime.operateManagedInteraction(opened.runtime_session_ref, { action: "scroll", expected_origin: origin, controlled_origin: origin, holder_ref: "run_obscura_live", operation_ref: "operation_obscura_scroll", page_ref: clicked.snapshot!.page_ref, observation_ref: clicked.snapshot!.observation_ref, delta_y: 300 });
    assert.equal(scrolled.status, "completed");
    const captured = await runtime.captureLiveSnapshot(opened.runtime_session_ref);
    assert.equal(captured.status, "captured");
    await runtime.stopSession(opened.runtime_session_ref, { control_owner: "core_task", holder_ref: "run_obscura_live" });

    const reopened = await runtime.openManagedIdentityEnvironmentSession({ identity_environment_ref: identityRef, operation_scope: "profile_management", url: `${origin}/echo`, control_owner: "core_task", holder_ref: "run_obscura_reopen", headless: true });
    assert.equal("status" in reopened, false);
    if ("status" in reopened) throw new Error(reopened.message);
    assert.equal(reopened.current_page.title, "Persisted");
    const persisted = await runtime.operateManagedInteraction(reopened.runtime_session_ref, { action: "snapshot", expected_origin: origin, controlled_origin: origin, holder_ref: "run_obscura_reopen", operation_ref: "operation_obscura_persisted" });
    assert.equal(persisted.status, "completed");
    assert.equal(JSON.stringify(persisted).includes("sid=alpha"), false);
    const providerPids = execFileSync("/bin/ps", ["-axo", "pid=,command="], { encoding: "utf8" }).split("\n")
      .filter(line => line.includes("obscura serve") && line.includes(root)).map(line => Number(line.trim().split(/\s+/, 1)[0])).filter(Number.isSafeInteger);
    assert.equal(providerPids.length, 1);
    process.kill(providerPids[0]!, "SIGKILL");
    const deadline = Date.now() + 2000;
    while (runtime.getSession(reopened.runtime_session_ref)?.lifecycle_state !== "disconnected" && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(runtime.getSession(reopened.runtime_session_ref)?.lifecycle_state, "disconnected");
    assert.equal(runtime.getSession(reopened.runtime_session_ref)?.control_owner, "none");
    assert.equal((await runtime.captureLiveSnapshot(reopened.runtime_session_ref)).status, "unavailable");
  } finally {
    await runtime.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT; else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    if (previousPrivate === undefined) delete process.env.HARBOR_OBSCURA_ALLOW_PRIVATE_NETWORK; else process.env.HARBOR_OBSCURA_ALLOW_PRIVATE_NETWORK = previousPrivate;
    await rm(root, { recursive: true, force: true });
  }
});
