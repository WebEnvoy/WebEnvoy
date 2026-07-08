# Current Status

## Derived Fact Chain View

- Item ID: CORE-244
- Goal: Implement Core #243 core runtime task chain batch anchored on Work Item #244 and covering #244/#245/#246/#247/#248.
- Scope: App-facing Core API accepts a read-only task request, resolves Lode capability metadata/resource requirements from a local registry asset, calls Harbor local runtime API readiness/provider/session/snapshot/evidence endpoints, writes Run Record admission/failure facts, and returns evidence/runtime refs without claiming live task success. Ownership is limited to Core/WebEnvoy API server, Core runtime clients/orchestration, focused self-checks, and CORE-244 Loom carriers.
- Execution Path: work/core-244-runtime-task-chain
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-244.md
- Review Entry: .loom/reviews/CORE-244.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime typecheck; pnpm --filter @webenvoy/api-server typecheck; pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/api-server test; git diff --check; loom suite validate/carrier/evidence --target . --item CORE-244 --json
- Closing Condition: PR Ready, merge, post-merge closeout for #243/#244/#245/#246/#247/#248, and follow-up current pointer retire if required by gate.
- Current Checkpoint: build
- Current Stop: Core runtime task chain batch implemented and hardened in formal worktree; waiting for main controller PR/review/gate.
- Next Step: Create/update PR, run metadata readback, review, merge-ready gate, merge after checks, then close out #243/#244/#245/#246/#247/#248 only within their Core contract boundaries.
- Blockers: None recorded.
- Latest Validation Summary: 2026-07-08T10:12Z reviewer P1/P2 findings were fixed; full workspace typecheck/test/lint passed. Targeted API/Core typecheck, API self-check, git diff check, previous fact-chain, build, resume, and JSON validation also passed. Live Harbor evidence was not attempted.
- Recovery Boundary: Core runtime task submission chain only; no App UI, Harbor/Lode code mutation, real external site action, real account/profile/Cookie use, true write, submit/publish/send, hosted browser, marketplace, bulk collection, full account cloud hosting, risk-bypass claim, merge without review/gate, or issue closeout without post-merge evidence.
- Current Lane: core runtime task chain implementation

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: packages/api-server/src/runtime-task-submit-self-check.ts
- Verification Entry: .loom/progress/CORE-244.md
- Lane Entry: .loom/specs/CORE-244/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-244.md
- Dynamic Truth: .loom/progress/CORE-244.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
