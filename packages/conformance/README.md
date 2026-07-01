# WebEnvoy Core Conformance

`@webenvoy/conformance` provides the first repository-level runnable check that ties the schema fixtures and local Run Record store together.

The check is intentionally small. It verifies local JSON Schema metadata and fixture bindings, then writes and reads one successful read-only Run Record and one admission-failure Run Record through `@webenvoy/core-runtime`.

```bash
pnpm conformance
```

This package does not add a full JSON Schema validator, hosted service, API submission path, Harbor/Lode integration, or true writes.
