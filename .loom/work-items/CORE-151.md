# CORE-151

## Static Facts

- Item ID: CORE-151
- Goal: Project Lode-owned output schema identity into Core Result Envelope.
- Scope: Batch covers Core #151 and #152 through refs-only Result Envelope projection and schema fixture validation.
- Execution Path: stage5/lode-result-envelope-projection
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-151.md
- Review Entry: .loom/reviews/CORE-151.json
- Validation Entry: pnpm core/schemas/conformance targeted tests; pnpm conformance smoke; pnpm typecheck; git diff --check
- Closing Condition: Result Envelope can carry Lode output_schema_id while Core keeps Run Record and result envelope truth and does not inline Lode package bodies or Harbor raw evidence.

## Covered Work Items

- #151 project Result Envelope according to Lode output schema.
- #152 consume post-check result and write Run Record.

## Associated Artifacts

- `.loom/work-items/CORE-151.md`
- `.loom/progress/CORE-151.md`
- `.loom/reviews/CORE-151.json`
- `.loom/specs/CORE-151/spec.md`
- `.loom/specs/CORE-151/plan.md`
- `.loom/specs/CORE-151/implementation-contract.md`
- `.loom/specs/CORE-151/evidence-map.md`
- `.loom/specs/CORE-151/task-carrier.md`
- `.loom/status/current.md`
- `packages/core/src/result-envelope.ts`
- `packages/core/src/self-check.ts`
- `packages/schemas/schemas/result-envelope.schema.json`
- `packages/schemas/fixtures/result-envelope-success.fixture.json`
