# Current Status

## Derived Fact Chain View

- Item ID: GH-80
- Goal: Freeze the Core TypeScript, Node.js, pnpm, schema, service-boundary, run-record, shared-entry, and cross-repo no-copy technical baseline for milestone #8.
- Scope: Docs-only baseline covering GH-79 through GH-88 by adding ADR 0008, updating the contracts index and AGENTS constraints, recording the minimum GH-80 Loom carrier and ownership constraints, and aligning `.loom/status/current.md` plus `.loom/bootstrap/init-result.json` fact-chain entry points so fact-chain resolves GH-80.
- Execution Path: docs-only/core-technical-baseline
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-80.md
- Review Entry: .loom/reviews/GH-80.json
- Validation Entry: `git diff --check`; Markdown/JSON readability checks; Loom suite/carrier/build validation; PR body/head readback.
- Closing Condition: PR is merged, post-merge closeout evidence is recorded, and covered issues remain open until coordinator closeout.
- Current Checkpoint: merge
- Current Stop: Closeout carrier sync is ready for hosted gate and merge.
- Next Step: Merge this closeout-only carrier PR; no product work remains in this batch.
- Blockers: None recorded.
- Latest Validation Summary: Post-merge closeout consumed PR https://github.com/WebEnvoy/WebEnvoy/pull/89, PR head 4e483d3437d4cb509f50b1004cc5830775d56849, merge commit 2ee8c13bde9796baf13396568c159e94b1b0e959, target branch main, hosted run https://github.com/WebEnvoy/WebEnvoy/actions/runs/28493861163, closed issues #79-#88, and closed milestone Core 协议与运行架构基线 (#8). Scope remains docs-only technical architecture baseline; code skeleton, schema/API/runtime/persistence, CLI/MCP/SDK/App implementation were not completed.
- Recovery Boundary: Closed docs-only planning batch. Reopen or create a new Work Item if future work changes code skeleton, schema/API/runtime/persistence, CLI/MCP/SDK/App implementation.
- Current Lane: merge-ready

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-80.md
- Lane Entry: core-docs

## Sources

- Static Truth: .loom/work-items/GH-80.md
- Dynamic Truth: .loom/progress/GH-80.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json

## Notes

- 2026-07-01: Post-merge closeout recorded PR https://github.com/WebEnvoy/WebEnvoy/pull/89, merge commit `2ee8c13bde9796baf13396568c159e94b1b0e959`, hosted run https://github.com/WebEnvoy/WebEnvoy/actions/runs/28493861163, closed issues #79-#88, and closed milestone Core 协议与运行架构基线 (#8).
