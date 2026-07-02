# Current Status

## Derived Fact Chain View

- Item ID: GH-106
- Goal: Provide the minimal run query interface for Core/API consumers.
- Scope: GH-106 is limited to a Core run summary projection, API Server `GET /runs/:run_id`, API server binding to a local Run Record store, targeted self-checks, and GH-106 item-specific Loom carriers. Ownership is limited to the listed core/api files, package dependency metadata, GH-106 carriers, GH-106 review artifacts when authored, and GH-106 current status alignment.
- Execution Path: implementation/run-query-v0
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-106.md
- Review Entry: pending
- Validation Entry: `pnpm --filter @webenvoy/core-runtime typecheck`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm --filter @webenvoy/api-server typecheck`; `pnpm --filter @webenvoy/api-server test`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check`; `jq empty .loom/specs/GH-106/build-evidence.json`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-106 --json`; `loom suite carrier validate --target . --item GH-106 --json`; `loom suite evidence validate --target . --item GH-106 --json`; packaged `loom_flow.py flow build --target . --item GH-106 --build-evidence .loom/specs/GH-106/build-evidence.json`; PR body/head readback.
- Closing Condition: PR is merged, post-merge closeout evidence is recorded, issue #106 is closed, and FR #96 remains open until GH-107 through GH-110 are complete.
- Current Checkpoint: build
- Current Stop: Core run summary projection and API Server `GET /runs/:run_id` are implemented locally on branch `work/GH-106-run-query`; full local validation, Loom suite checks, and packaged build passed. PR creation, pre-review/review, hosted checks, merge, post-merge closeout, and issue closure remain pending.
- Next Step: Commit and push GH-106, create PR for issue #106, then run pre-review/review and hosted merge gates.
- Blockers: None recorded.
- Latest Validation Summary: GH-106 local validation passed on 2026-07-02 UTC: `pnpm --filter @webenvoy/core-runtime typecheck`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm --filter @webenvoy/api-server typecheck`; `pnpm --filter @webenvoy/api-server test`; `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm test`; `pnpm conformance`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-106/build-evidence.json`; `git diff --check`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-106 --json`; `loom suite carrier validate --target . --item GH-106 --json`; `loom suite evidence validate --target . --item GH-106 --json`; packaged build attempt `GH-106-build-f7b903ee2801-29e02f6b95aa`. PR metadata readback, pre-review/review, hosted checks, merge, closeout, and issue closure remain pending.
- Recovery Boundary: Keep GH-106 limited to Core/API run summary query. Do not add result/evidence refs query endpoints (#107), golden run fixture (#108), API/CLI smoke (#109), write-side guardrail (#110), App UI, SDK/MCP full entrypoints, real executor, history search, database/storage backends, Harbor/Lode/App edits, raw evidence retrieval, or true writes.
- Current Lane: build

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-106.md
- Lane Entry: build

## Sources

- Static Truth: .loom/work-items/GH-106.md
- Dynamic Truth: .loom/progress/GH-106.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json

## Notes

- 2026-07-02: Started GH-106 after GH-105 and FR #95 were closed. FR #96 remains open with #106 through #110 open.
- 2026-07-02: Added Core run summary projection and API Server `GET /runs/:run_id` using existing file-backed Run Record truth.
- 2026-07-02: Targeted Core/API typecheck and self-check passed before full validation.
- 2026-07-02: Full local validation, Loom suite checks, and packaged build flow passed; review artifacts remain pending until pre-review/review stage.
