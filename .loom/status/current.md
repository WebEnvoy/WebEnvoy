# Current Status

## Derived Fact Chain View

- Item ID: CORE-148
- Goal: Provide Core capability attribution, post-check, failure attribution, and capability query facts for App Stage 5 read-only capability testing and evidence status.
- Scope: Covers Core #148/#149/#150/#153/#154/#155/#156/#157; excludes #151, App UI, Harbor raw evidence/runtime bodies, Lode package/repair truth, and Stage 6.
- Execution Path: stage5/core-capability-attribution-query
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-148.md
- Review Entry: .loom/reviews/CORE-148.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/api-server test; pnpm --filter @webenvoy/schemas test; pnpm --filter @webenvoy/conformance test; pnpm --filter @webenvoy/conformance smoke; pnpm typecheck; pnpm lint; git diff --check
- Closing Condition: App/API can consume Core run/capability attribution facts without Core storing package/run-session/raw evidence truth outside its owner boundary.
- Current Checkpoint: implemented
- Current Stop: Local implementation and targeted validation are complete; final Loom gates and PR are pending.
- Next Step: Commit, bind review head, push PR, consume hosted gate, then close covered issues with post-merge evidence.
- Blockers: None recorded.
- Latest Validation Summary: targeted core/api/schema/conformance tests, conformance smoke, typecheck, lint, git diff --check, suite validate, and suite carrier validate passed locally; suite evidence/fact-chain are being refreshed.
- Recovery Boundary: Revert CORE-148 PR to remove Core attribution/query/post-check additions; no raw Harbor evidence, Lode package body, App UI state, or Stage 6 behavior is introduced.
- Current Lane: stage5 Core capability attribution

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: loom verify --target . --json
- Lane Entry: .loom/progress/CORE-148.md

## Sources

- Static Truth: .loom/work-items/CORE-148.md
- Dynamic Truth: .loom/progress/CORE-148.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
