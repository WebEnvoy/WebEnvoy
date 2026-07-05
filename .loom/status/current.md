# Current Status

## Derived Fact Chain View

- Item ID: CORE-147
- Goal: Accept read-only capability refs on Core task intent and preserve attribution in run/result records
- Scope: Add capability source and lock refs to task intent capability, validate refs against Lode package contract, and expose attribution in run record/query/result fixtures
- Execution Path: stage5/read-only-capability-attribution
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-147.md
- Review Entry: .loom/reviews/CORE-147.json
- Validation Entry: pnpm test -- --runInBand && git diff --check
- Closing Condition: Core #147/#149/#153 capability attribution fixture is validated without storing Lode package bodies, Harbor raw evidence, or App UI state
- Current Checkpoint: build
- Current Stop: Core capability attribution fixture, schema/runtime/conformance updates, and validation evidence are implemented on PR #160.
- Next Step: Record current-head review, update PR metadata, and run hosted gate for Core #160.
- Blockers: None recorded.
- Latest Validation Summary: pnpm test -- --runInBand, git diff --check, suite validate, suite evidence validate, suite carrier validate, fact-chain, and verify passed on CORE-147.
- Recovery Boundary: Core attribution fixture only; no Lode package body persistence, Harbor raw evidence, App UI state, credential, or Stage 6 write behavior.
- Current Lane: stage5 capability attribution fixture

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: loom verify --target . --json
- Lane Entry: not_applicable

## Sources

- Static Truth: .loom/work-items/CORE-147.md
- Dynamic Truth: .loom/progress/CORE-147.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
