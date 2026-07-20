# WebEnvoy Core Schemas

This package contains the first machine-readable Core contract carriers for GH-98.

The JSON Schema files are the contract truth for the current repository. They are derived from:

- `docs/adr/0005-task-intent-and-run-lifecycle-v0.md`
- `docs/adr/0003-result-envelope-and-run-record.md`
- `docs/adr/0004-admission-and-action-risk.md`
- `docs/adr/0006-common-task-entry-v0.md`
- `docs/adr/0007-reference-version-ownership-v0.md`
- `docs/adr/0008-core-technical-architecture-baseline.md`

The files intentionally stay small:

- `schemas/task-intent.schema.json`
- `schemas/run-record.schema.json`
- `schemas/result-envelope.schema.json`
- `schemas/evidence-ref.schema.json`
- `schemas/task-turn-input.schema.json`
- `schemas/task-thread.schema.json`

Fixtures under `fixtures/` are representative examples used by the package self-check. The self-check verifies that each schema declares owner/status/compatibility metadata and that each fixture is bound to a local schema and matching `schema_version`.

`fixtures/golden-read-only-run-record.fixture.json` is the first reusable terminal read-only Run Record fixture. It binds the existing read-only task intent, Lode capability/package ref, Harbor runtime refs, result ref, and evidence ref so downstream smoke can query one stable run without inventing new fields.

`fixtures/write-action-guardrail-run-record.fixture.json` captures the minimal write-side guardrail shape: true-write submission is deferred as a failed Run Record with `deferred_true_write` admission and a structured `action_risk` failure, without raw evidence or write execution state.

`fixtures/real-site-*-write-preview-run-record.fixture.json` captures the refs-only real-page write-preview shape for Xiaohongshu draft preview and BOSS greeting preview, including action requests, approval requests, preview results, no-submit state, and cancelled/expired/page-changed terminal states.

`fixtures/task-thread.fixture.json` captures an ordered App-created task turn. Bounded scalar summaries remain visible after restart, while files and long text are represented by owner refs.

Run:

```bash
pnpm --filter @webenvoy/schemas test
```

This package does not add Ajv or generated TypeScript types yet. Full JSON Schema validation and conformance cases belong to GH-100.
