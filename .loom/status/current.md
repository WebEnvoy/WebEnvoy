# Current Status

## Derived Fact Chain View

- Item ID: GH-106
- Goal: Provide the minimal run query interface for Core/API consumers.
- Scope: GH-106 is limited to a Core run summary projection, API Server `GET /runs/:run_id`, API server binding to a local Run Record store, targeted self-checks, and GH-106 item-specific Loom carriers. Ownership is limited to the listed core/api files, package dependency metadata, GH-106 carriers, GH-106 review artifacts when authored, and GH-106 current status alignment.
- Execution Path: implementation/run-query-v0
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-106.md
- Review Entry: .loom/reviews/GH-106.json
- Validation Entry: `pnpm --filter @webenvoy/core-runtime typecheck`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm --filter @webenvoy/api-server typecheck`; `pnpm --filter @webenvoy/api-server test`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check`; `jq empty .loom/specs/GH-106/build-evidence.json`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-106 --json`; `loom suite carrier validate --target . --item GH-106 --json`; `loom suite evidence validate --target . --item GH-106 --json`; packaged `loom_flow.py flow build --target . --item GH-106 --build-evidence .loom/specs/GH-106/build-evidence.json`; PR body/head readback.
- Closing Condition: PR is merged, post-merge closeout evidence is recorded, issue #106 is closed, and FR #96 remains open until GH-107 through GH-110 are complete.
- Current Checkpoint: build
- Current Stop: PR #129 is open for branch `work/GH-106-run-query` at head `f55483dd895076f27dc601cc5447be1728bcc30a`; full local validation, Loom suite checks, packaged build, and PR metadata readback passed. Pre-review/review, hosted checks, merge, post-merge closeout, and issue closure remain pending.
- Next Step: Re-run pre-review after this carrier N/A sync, then run spec-review/review and hosted merge gates for PR #129.
- Blockers: None recorded.
- Latest Validation Summary: GH-106 local validation passed on 2026-07-02 UTC: `pnpm --filter @webenvoy/core-runtime typecheck`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm --filter @webenvoy/api-server typecheck`; `pnpm --filter @webenvoy/api-server test`; `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm test`; `pnpm conformance`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-106/build-evidence.json`; `git diff --check`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-106 --json`; `loom suite carrier validate --target . --item GH-106 --json`; `loom suite evidence validate --target . --item GH-106 --json`; packaged build attempt `GH-106-build-f7b903ee2801-29e02f6b95aa`; PR #129 metadata readback passed for `work/GH-106-run-query` at head `9f7dffcbb1a89a312869d37fe96312be95cfe1c8`. Review-readiness source-distribution tools are not applicable to this consumer repo because there is no `tools/` directory and `tools/skills_surface.py check`, `tools/loom_check.py --profile source --source-surface contract-only`, `tools/check_release_surface.py`, `tools/version_surface_check.py`, and `tools/check_npm_package.py` are absent. Pre-review passed with attempt `GH-106-pre-review-9f7dffcbb1a8-9d4c96ec25a1`; review, hosted checks, merge, closeout, and issue closure remain pending.
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
- 2026-07-02: PR #129 was created and read back at head `f55483dd895076f27dc601cc5447be1728bcc30a`; source-distribution review-readiness tool checks are not applicable because this consumer repo has no `tools/` directory.
