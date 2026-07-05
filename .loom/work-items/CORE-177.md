# CORE-177

## Static Facts

- Item ID: CORE-177
- Goal: Project validate-only and preview results into Core Result Envelope without implying submitted writes.
- Scope: Covers Core #177/#178/#179/#180 under FR #176; excludes approval execution, true writes, submitted results, unknown outcome, reconciliation, post-submit result, App UI, Lode package truth, and Harbor raw/private material.
- Execution Path: work/core-177-preview-result-envelope
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-177.md
- Review Entry: .loom/reviews/CORE-177.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/schemas test; pnpm conformance; pnpm typecheck; git diff --check
- Closing Condition: PR merged, #177/#178/#179/#180/#176 closeout evidence posted, milestone #11 closed with open_issues=0, and current pointer returns to no_active_item.

## Covered Work Items

- #177 project expected change.
- #178 define preview result schema.
- #179 classify preview failure / page changed / user cancelled.
- #180 associate action refs, evidence refs, and capability version.

## Associated Artifacts

- packages/core/src/result-envelope.ts
- packages/core/src/run-record-store.ts
- packages/core/src/result-query.ts
- packages/core/src/self-check.ts
- packages/schemas/schemas/result-envelope.schema.json
- packages/schemas/schemas/run-record.schema.json
- packages/schemas/fixtures/preview-*.json
- .loom/specs/CORE-177/**
