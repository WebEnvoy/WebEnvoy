import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileRunRecordStore } from "./run-record-store.js";
import { createManagedRecoveryService } from "./profile-recovery.js";

test("Core binds one confirmed plan, rejects changed requests and reconciles a lost apply response without replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webenvoy-recovery-core-"));
  const receipts = new Map<string, Record<string, unknown>>();
  let applyCount = 0, dropResponse = true;
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer controlled-fixture");
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const input = raw ? JSON.parse(raw) : {};
    response.setHeader("content-type", "application/json");
    if (request.url === "/runtime/profile-recovery/plan") {
      response.end(JSON.stringify({ plan_inputs: {
        schema_version: "webenvoy.profile-recovery-plan.v1", profile_ref: input.profile_ref, backup_ref: input.backup_ref,
        backup_time: "2026-01-01T00:00:00.000Z", current_material_fingerprint: "a".repeat(64), backup_material_fingerprint: "b".repeat(64),
        current_material_version: "v1", backup_material_version: "v1", owner_binding: "c".repeat(64),
        scope: "profile_storage_and_matching_environment_bundle", compatibility: { provider_id: "camoufox", bundle_schema_version: 1 }
      } }));
    } else if (request.url === "/runtime/profile-recovery/apply") {
      applyCount++;
      assert.equal(input.confirmation.idempotency_key, input.idempotency_key);
      const receipt = { schema_version: "harbor.profile-recovery-operation.v1", operation_ref: input.operation_ref, profile_ref: input.plan.profile_ref, status: "completed", result: { restored: true } };
      receipts.set(input.operation_ref, receipt);
      if (dropResponse) response.destroy();
      else response.end(JSON.stringify(receipt));
    } else {
      const receipt = receipts.get(decodeURIComponent(request.url!.split("/").at(-1)!));
      response.statusCode = receipt ? 200 : 404;
      response.end(JSON.stringify(receipt ?? { status: "unavailable" }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const store = createFileRunRecordStore({ directory });
  const service = createManagedRecoveryService({ runRecordStore: store, harborBaseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, supervisorToken: "controlled-fixture" });
  const plan = async (key: string) => (await service.plan({ idempotency_key: key, profile_ref: "profile_test", backup_ref: "backup:test" })).result!.plan as Record<string, unknown>;
  const requestFor = (plan: Record<string, unknown>, key: string) => ({ idempotency_key: key, plan, confirmation: {
    schema_version: "webenvoy.profile-recovery-confirmation.v1", confirmation_ref: `confirmation:${key}`, plan_ref: plan.plan_ref,
    confirmed_at: new Date().toISOString(), confirmed_by: "owner", idempotency_key: key, decision: "apply"
  } });
  try {
    const firstPlan = await plan("plan-one"), input = requestFor(firstPlan, "apply-one");
    await assert.rejects(service.apply({ ...input, plan: { ...firstPlan, backup_ref: "backup:other" } }), /recovery_plan_changed/);
    const unknown = await service.apply(input);
    assert.equal(unknown.status, "unknown_outcome");
    assert.equal((await store.getRunRecord(unknown.run_id))!.status, "unknown_outcome");
    assert.equal(applyCount, 1);
    assert.equal((await service.apply(input)).status, "unknown_outcome");
    assert.equal(applyCount, 1);
    await assert.rejects(service.apply({ ...input, confirmation: { ...input.confirmation, confirmation_ref: "confirmation:changed" } }), /recovery_idempotency_conflict/);
    await assert.rejects(service.status({ operation_ref: unknown.operation_ref }, "profile_other"), /recovery_operation_not_found/);
    const reconciled = await service.status({ operation_ref: unknown.operation_ref });
    assert.equal(reconciled.status, "unknown_outcome");
    assert.equal(reconciled.reconciliation, "completed");
    assert.equal((reconciled.result!.operation as { status: string }).status, "completed");
    assert.equal((await store.getRunRecord(unknown.run_id))!.status, "unknown_outcome");
    assert.equal(applyCount, 1);
    await assert.rejects(service.apply(requestFor(firstPlan, "second-apply")), /recovery_confirmation_already_consumed/);
    dropResponse = false;
    const secondPlan = await plan("plan-two");
    const concurrent = await Promise.allSettled([service.apply(requestFor(secondPlan, "apply-two")), service.apply(requestFor(secondPlan, "apply-three"))]);
    assert.equal(concurrent.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(applyCount, 2);
    const expiringPlan = await plan("plan-expired");
    expiringPlan.expires_at = "2020-01-01T00:00:00.000Z";
    const planRun = (await store.listRunRecords()).find(run => (run.public_result_summary?.result as { plan?: { plan_ref: unknown } } | undefined)?.plan?.plan_ref === expiringPlan.plan_ref)!;
    await store.updateRunRecord(planRun.run_id, { public_result_summary: { ...planRun.public_result_summary, result: { plan: expiringPlan } } });
    await assert.rejects(service.apply(requestFor(expiringPlan, "expired-apply")), /recovery_confirmation_invalid/);
    assert.equal(applyCount, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
