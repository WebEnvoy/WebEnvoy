import assert from "node:assert/strict";
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
    if (request.url === "/first") response.setHeader("set-cookie", "session=alpha; Path=/; HttpOnly; SameSite=Lax");
    response.end(`<!doctype html><meta charset=utf-8><title>Obscura controlled fixture</title><body style="min-height:3000px"><label>内容 <input aria-label="内容"></label><button onclick="this.textContent='已保存'">保存</button><p>${request.headers.cookie ?? "cookie=missing"}</p></body>`);
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

    const snapshot = await runtime.operateManagedInteraction(opened.runtime_session_ref, { action: "snapshot", expected_origin: origin, controlled_origin: origin, holder_ref: "run_obscura_live", operation_ref: "operation_obscura_snapshot" });
    assert.equal(snapshot.status, "completed");
    const textbox = snapshot.snapshot?.controls.find(control => control.role === "textbox");
    assert.ok(textbox);
    const input = await runtime.operateManagedInteraction(opened.runtime_session_ref, { action: "input", expected_origin: origin, controlled_origin: origin, holder_ref: "run_obscura_live", operation_ref: "operation_obscura_input", page_ref: snapshot.snapshot!.page_ref, observation_ref: snapshot.snapshot!.observation_ref, target_ref: textbox!.target_ref, text: "中文验证" });
    assert.equal(input.status, "completed");
    assert.equal(input.snapshot?.controls.find(control => control.role === "textbox")?.value, "中文验证");
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
    const persisted = await runtime.operateManagedInteraction(reopened.runtime_session_ref, { action: "snapshot", expected_origin: origin, controlled_origin: origin, holder_ref: "run_obscura_reopen", operation_ref: "operation_obscura_persisted" });
    assert.equal(persisted.status, "completed");
    assert.match(persisted.snapshot?.text ?? "", /session=alpha/);
  } finally {
    await runtime.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previousRoot === undefined) delete process.env.HARBOR_PROFILE_STORAGE_ROOT; else process.env.HARBOR_PROFILE_STORAGE_ROOT = previousRoot;
    if (previousPrivate === undefined) delete process.env.HARBOR_OBSCURA_ALLOW_PRIVATE_NETWORK; else process.env.HARBOR_OBSCURA_ALLOW_PRIVATE_NETWORK = previousPrivate;
    await rm(root, { recursive: true, force: true });
  }
});
