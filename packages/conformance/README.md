# WebEnvoy Core Conformance

`@webenvoy/conformance` provides the first repository-level runnable check that ties the schema fixtures and local Run Record store together.

The check is intentionally small. It verifies local JSON Schema metadata and fixture bindings, then writes and reads successful, failure, and admission-failure Run Records through `@webenvoy/core-runtime`.

It also verifies `packages/schemas/fixtures/golden-read-only-run-record.fixture.json` as the reusable successful read-only Run Record fixture for downstream API/CLI smoke: the generated success path must match the golden fixture, and the fixture can seed a file-backed store for the existing run, result, and evidence-ref query helpers.

It verifies `packages/schemas/fixtures/write-action-guardrail-run-record.fixture.json` through the same query helpers so write-side guardrail records stay App/API-readable without adding a write executor.

It also verifies real-site Xiaohongshu and BOSS write-preview Run Record fixtures: action request, risk classification, approval request, preview result, no-submit state, page-changed, cancelled, and expired states.

The App-facing execution-policy fixtures are consumed here as a separate conformance boundary. They fix the owner-resolved action category, effective mode and source, next-turn thread revision, independent skill/policy versions, single-action choices, and sensitive-field exclusions so downstream clients do not reproduce Core policy resolution.

```bash
pnpm conformance
```

GH-109 adds the minimal API/CLI smoke over that fixture:

```bash
pnpm smoke
```

The smoke seeds a temporary file-backed Run Record store from the golden read-only fixture, reads the run/result/evidence projections through a repo-local CLI query mode, reads the same projections through the API Server query routes, and asserts both paths return the same Core contract shapes.

This package does not add a full JSON Schema validator, hosted service, product CLI, API submission path, Harbor/Lode integration, or true writes.
