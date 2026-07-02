# WebEnvoy Core Runtime

`@webenvoy/core-runtime` contains the first local Core runtime helpers.

GH-99 adds the minimal file-backed Run Record store. It persists public Run Record JSON files by `run_id` and keeps Core inside the refs-only boundary from ADR 0003, ADR 0005, ADR 0007, and ADR 0008.

GH-103 adds static Lode package admission checks for package refs, capability id/version, package lock presence, resource requirement refs, invalid-contract failures, and read-only operation mode.

GH-104 adds Core-side validation for Harbor public runtime, viewer, snapshot, refmap, source-trace, and evidence refs; Run Record stores refs only and rejects private runtime/evidence fields.

GH-105 adds the minimal structured result/failure output helpers. They advance an existing Run Record to terminal success or structured failure and return a public Result Envelope without adding a result store or query API.

GH-106 adds a minimal run summary projection for API/App consumers. It returns status, timestamps, capability/package refs, admission summary, runtime binding refs, and terminal summary from the Run Record without adding history search or a new storage backend.

GH-107 adds minimal result and evidence-ref query projections. They return public Result Envelope state, structured failure reason, evidence refs, and unavailable/redacted/expired/access-denied states from existing Run Record refs without retrieving raw evidence or adding a result store.

It does not implement Harbor SDK/runtime calls, Lode registry/package body loading, result/evidence body retrieval, database migrations, multi-tenant storage, or true writes.

```bash
pnpm --filter @webenvoy/core-runtime test
```
