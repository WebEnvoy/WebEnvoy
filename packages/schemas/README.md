# WebEnvoy Core Schemas

This package contains the first machine-readable Core contract carriers for GH-98.

The JSON Schema files are the contract truth for the current repository. They are derived from:

- `docs/adr/0005-task-intent-and-run-lifecycle-v0.md`
- `docs/adr/0003-result-envelope-and-run-record.md`
- `docs/adr/0004-admission-and-action-risk.md`
- `docs/adr/0006-common-task-entry-v0.md`
- `docs/adr/0007-reference-version-ownership-v0.md`
- `docs/adr/0008-core-technical-architecture-baseline.md`
- `docs/adr/0009-unified-authorization-policy.md`

The files intentionally stay small:

- `schemas/task-intent.schema.json`
- `schemas/run-record.schema.json`
- `schemas/result-envelope.schema.json`
- `schemas/evidence-ref.schema.json`
- `schemas/task-turn-input.schema.json`
- `schemas/task-thread.schema.json`
- `schemas/identity-compatibility-preview-request.schema.json`
- `schemas/identity-compatibility-preview.schema.json`
- `schemas/execution-policy-evaluation.schema.json`
- `schemas/authorization-decision.schema.json`
- `schemas/authorization-decision-ref.schema.json`
- `schemas/execution-policy-configuration.schema.json`
- `schemas/execution-policy-effective-view.schema.json`
- `schemas/execution-policy-mutation.schema.json`
- `schemas/single-action-decision-command.schema.json`
- `schemas/single-action-decision.schema.json`
- `schemas/browser-file-result.schema.json`
- `schemas/harbor-observation-targets.schema.json`
- `schemas/harbor-observation-targets-request.schema.json`
- `schemas/managed-task-operation-request.schema.json`
- `schemas/managed-task-operation-result.schema.json`

Fixtures under `fixtures/` are representative examples used by the package self-check. The self-check verifies that each schema declares owner/status/compatibility metadata and that each fixture is bound to a local schema and matching `schema_version`.

`fixtures/golden-read-only-run-record.fixture.json` is the first reusable terminal read-only Run Record fixture. It binds the existing read-only task intent, Lode capability/package ref, Harbor runtime refs, result ref, and evidence ref so downstream smoke can query one stable run without inventing new fields.

`fixtures/write-action-guardrail-run-record.fixture.json` captures the minimal write-side guardrail shape: true-write submission is deferred as a failed Run Record with `deferred_true_write` admission and a structured `action_risk` failure, without raw evidence or write execution state.

`fixtures/real-site-*-write-preview-run-record.fixture.json` captures the refs-only real-page write-preview shape for Xiaohongshu draft preview and BOSS greeting preview, including action requests, approval requests, preview results, no-submit state, and cancelled/expired/page-changed terminal states.

`fixtures/task-thread.fixture.json` captures an ordered App-created task turn. Bounded scalar summaries remain visible after restart, while files and long text are represented by owner refs.

`fixtures/execution-policy-destructive-auto.fixture.json` proves that Core preserves a user's explicit `auto` mode for a declared destructive action while retaining its risk marker and effective source.

`fixtures/authorization-decision.fixture.json` and the ref fixture cover the business summary shared by API/CLI/MCP/SDK/Agent consumers and the opaque ref embedded by task and environment operation records.

`fixtures/harbor-observation-targets.fixture.json` is a bounded public `instance.snapshot` segment. Its self-check covers the cross-field relationship between the returned controls, continuation offset, captured count, completeness, and cursor state; raw DOM and form values are intentionally absent.

`fixtures/harbor-observation-targets-request*.fixture.json` cover a new `instance.snapshot` batch and a bound continuation request. The matching negative fixtures verify that cursor continuation bindings, the 1–128 snapshot limit, and non-observation fields are rejected at the public request boundary.

The managed-task operation fixtures cover the shared submit/query/stop envelope and its bounded projection of an existing Run. The request self-check also verifies the compact UTF-8 JSON byte limit for inline input.

The execution-policy configuration/effective-view fixtures cover independent global, installed-skill-user, and next-turn thread versions. The single-action fixtures cover only an expiring `allow_once` or `deny_once` binding derived from a current Core confirmation.

Run:

```bash
pnpm --filter @webenvoy/schemas test
```

The self-check uses declared test-only Ajv dependencies for reproducible Draft 2020-12 validation of the execution-policy fixture, negative fixtures, and real evaluator outputs. Generated TypeScript types and broader conformance expansion remain outside this package change.
