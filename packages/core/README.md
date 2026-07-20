# WebEnvoy Core Runtime

`@webenvoy/core-runtime` contains the first local Core runtime helpers.

GH-99 adds the minimal file-backed Run Record store. It persists public Run Record JSON files by `run_id` and keeps Core inside the refs-only boundary from ADR 0003, ADR 0005, ADR 0007, and ADR 0008.

GH-103 adds static Lode package admission checks for package refs, capability id/version, package lock presence, resource requirement refs, invalid-contract failures, and read-only operation mode.

GH-104 adds Core-side validation for Harbor public runtime, viewer, snapshot, refmap, source-trace, and evidence refs; Run Record stores refs only and rejects private runtime/evidence fields.

GH-105 adds the minimal structured result/failure output helpers. They advance an existing Run Record to terminal success or structured failure and return a public Result Envelope without adding a result store or query API.

GH-106 adds a minimal run summary projection for API/App consumers. It returns status, timestamps, capability/package refs, admission summary, runtime binding refs, and terminal summary from the Run Record without adding history search or a new storage backend.

GH-107 adds minimal result and evidence-ref query projections. They return public Result Envelope state, structured failure reason, evidence refs, and unavailable/redacted/expired/access-denied states from existing Run Record refs without retrieving raw evidence or adding a result store.

GH-110 adds the minimal write-side guardrail. Non-read task policy requests are recorded as failed/deferred Run Records with `deferred_true_write` admission and structured `action_risk` failures before Lode/Harbor admission or any executor path can run.

GH-295 adds durable task threads bound to one Lode capability and one Harbor identity environment. Accepted business inputs receive ordered `turn_id` values, idempotent retries return the original turn, and the thread remains locked while a turn is active or `status_unknown`. If Core restarts after the Run Record is created but before its submission response is written back to the thread, the public view recovers status from the Run Record without inventing success. Inline storage is limited to bounded display summaries; long text, files, and attachments use opaque owner refs from restricted namespaces. A configured owner availability checker fails closed on timeout or invalid refs and projects precise restore, reselect, or retry-check gaps; without one, Core validates and stores the ref without claiming availability. The public `task-thread.v0` schema excludes Core's private idempotency fingerprint and persistence metadata.

It does not implement Harbor SDK/runtime calls, Lode registry/package body loading, result/evidence body retrieval, database migrations, multi-tenant storage, or true writes.

```bash
pnpm --filter @webenvoy/core-runtime test
```
