# WebEnvoy Core Runtime

`@webenvoy/core-runtime` contains the first local Core runtime helpers.

GH-99 adds the minimal file-backed Run Record store. It persists public Run Record JSON files by `run_id` and keeps Core inside the refs-only boundary from ADR 0003, ADR 0005, ADR 0007, and ADR 0008.

GH-103 adds static Lode package admission checks for package refs, capability id/version, package lock presence, resource requirement refs, invalid-contract failures, and read-only operation mode.

It does not implement API routes, Harbor runtime binding, Lode registry/package body loading, result projection, query APIs, database migrations, multi-tenant storage, or true writes.

```bash
pnpm --filter @webenvoy/core-runtime test
```
