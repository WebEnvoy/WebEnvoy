# WebEnvoy Core Runtime

`@webenvoy/core-runtime` contains the first local Core runtime helpers.

GH-99 adds the minimal file-backed Run Record store. It persists public Run Record JSON files by `run_id` and keeps Core inside the refs-only boundary from ADR 0003, ADR 0005, ADR 0007, and ADR 0008.

It does not implement API routes, admission execution, Harbor runtime binding, Lode package loading, result projection, query APIs, database migrations, multi-tenant storage, or true writes.

```bash
pnpm --filter @webenvoy/core-runtime test
```
