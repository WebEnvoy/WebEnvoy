# WebEnvoy Core Conformance

`@webenvoy/conformance` provides the first repository-level runnable check that ties the schema fixtures and local Run Record store together.

The check is intentionally small. It verifies local JSON Schema metadata and fixture bindings, then writes and reads successful, failure, and admission-failure Run Records through `@webenvoy/core-runtime`.

It also verifies `packages/schemas/fixtures/golden-read-only-run-record.fixture.json` as the reusable successful read-only Run Record fixture for downstream API/CLI smoke: the generated success path must match the golden fixture, and the fixture can seed a file-backed store for the existing run, result, and evidence-ref query helpers.

```bash
pnpm conformance
```

This package does not add a full JSON Schema validator, hosted service, API/CLI smoke entrypoint, API submission path, Harbor/Lode integration, or true writes.
