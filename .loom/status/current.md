# Current Status

## Derived Fact Chain View

- Item ID: CORE-151
- Goal: Project Lode-owned output schema identity into Core Result Envelope.
- Scope: Batch covers Core #151 and #152 through refs-only Result Envelope projection and schema fixture validation.
- Execution Path: stage5/lode-result-envelope-projection
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-151.md
- Review Entry: .loom/reviews/CORE-151.json
- Validation Entry: pnpm core/schemas/conformance targeted tests; pnpm conformance smoke; pnpm typecheck; git diff --check
- Closing Condition: Result Envelope can carry Lode output_schema_id while Core keeps Run Record and result envelope truth and does not inline Lode package bodies or Harbor raw evidence.
- Current Checkpoint: implemented
- Current Stop: Result Envelope output_schema_id projection and schema fixture validation are implemented locally.
- Next Step: Commit, push PR, consume hosted gate, then merge and close covered issues after post-merge evidence.
- Blockers: None recorded.
- Latest Validation Summary: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/schemas test; pnpm --filter @webenvoy/conformance test; pnpm --filter @webenvoy/conformance smoke; pnpm typecheck; git diff --check passed locally on CORE-151.
- Recovery Boundary: Core Result Envelope/Run Record projection only; no Lode package truth, Harbor raw evidence, App UI state, private material, or Stage 6 behavior.
- Current Lane: stage5 Core Lode result projection

## Runtime Evidence

- Run Entry: .loom/progress/CORE-151.md
- Logs Entry: local terminal validation
- Diagnostics Entry: .loom/specs/CORE-151/evidence-map.md
- Verification Entry: loom verify --target . --json
- Lane Entry: not_applicable

## Sources

- Static Truth: .loom/work-items/CORE-151.md
- Dynamic Truth: .loom/progress/CORE-151.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
