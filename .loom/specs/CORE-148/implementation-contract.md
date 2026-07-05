# Implementation Contract CORE-148

## Inputs

- App #133/#135 needs recent test/run/failure/evidence status facts.
- Lode #145/#146/#147/#148/#152 provides lifecycle/version/lock/rollback facts.
- Harbor #118/#119/#123/#124/#125/#126/#127 provides runtime/evidence status refs.

## Outputs

- Core TS types and API route for capability run summaries.
- Run Record/Result Envelope optional post-check fields.
- Failure attribution categories and normalized query projection.
- JSON Schema fixture for capability run query and post-check failure attribution.

## Validation Contract

- Build/typecheck/tests must pass locally.
- Conformance smoke must pass.
- `git diff --check` must pass.
- Loom suite/carrier/fact-chain/verify must pass.
- PR metadata must list covered issues and excluded #151/App/Harbor/Lode/Stage 6 scope.
