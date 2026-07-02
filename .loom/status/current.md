# Current Status

## Derived Fact Chain View

- Item ID: GH-107
- Goal: Provide minimal result and evidence-ref query interfaces for Core/API consumers.
- Scope: GH-107 is limited to Core result/evidence-ref query projections, API Server `GET /runs/:run_id/result` and `GET /runs/:run_id/evidence-refs`, targeted self-checks, and GH-107 item-specific Loom carriers. Ownership is limited to the listed core/api files, GH-107 carriers, GH-107 review artifacts when authored, and GH-107 current status alignment.
- Execution Path: implementation/result-evidence-query-v0
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-107.md
- Review Entry: pending
- Validation Entry: `pnpm --filter @webenvoy/core-runtime typecheck`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm --filter @webenvoy/api-server typecheck`; `pnpm --filter @webenvoy/api-server test`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check`; `jq empty .loom/specs/GH-107/build-evidence.json`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-107 --json`; `loom suite carrier validate --target . --item GH-107 --json`; `loom suite evidence validate --target . --item GH-107 --json`; packaged `loom_flow.py flow build --target . --item GH-107 --build-evidence .loom/specs/GH-107/build-evidence.json`; PR body/head readback.
- Closing Condition: PR is merged, post-merge closeout evidence is recorded, issue #107 is closed, and FR #96 remains open until GH-108 through GH-110 are complete.
- Current Checkpoint: build
- Current Stop: Core result/evidence-ref query projections and API Server result/evidence-ref routes are implemented locally on branch `work/GH-107-result-evidence-query`; full local validation, Loom suite checks, and packaged build passed. PR creation, review, hosted checks, merge, post-merge closeout, and issue closure remain pending.
- Next Step: Commit and push GH-107, create PR for issue #107, then run pre-review/review and hosted merge gates.
- Blockers: None recorded.
- Latest Validation Summary: GH-107 local validation passed on 2026-07-02 UTC: `pnpm --filter @webenvoy/core-runtime typecheck`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm --filter @webenvoy/api-server typecheck`; `pnpm --filter @webenvoy/api-server test`; `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm test`; `pnpm conformance`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-107/build-evidence.json`; `git diff --check`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-107 --json`; `loom suite carrier validate --target . --item GH-107 --json`; `loom suite evidence validate --target . --item GH-107 --json`; packaged build attempt `GH-107-build-67d13d2bf99b-075ee8ba408f`. Review-readiness source-distribution tools are not applicable to this consumer repo because there is no `tools/` directory and `tools/skills_surface.py check`, `tools/loom_check.py --profile source --source-surface contract-only`, `tools/check_release_surface.py`, `tools/version_surface_check.py`, and `tools/check_npm_package.py` are absent. PR metadata readback, pre-review/review, hosted checks, merge, closeout, and issue closure remain pending.
- Recovery Boundary: Keep GH-107 limited to result envelope/failure/evidence-ref query projections and API routes. Do not add golden run fixture (#108), API/CLI smoke (#109), write-side guardrail (#110), App UI, SDK/MCP full entrypoints, real executor, history search, database/storage backends, Harbor/Lode/App edits, raw evidence retrieval, or true writes.
- Current Lane: build

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-107.md
- Lane Entry: build

## Sources

- Static Truth: .loom/work-items/GH-107.md
- Dynamic Truth: .loom/progress/GH-107.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json

## Notes

- 2026-07-02: Started GH-107 after GH-106 was closed. FR #96 remains open with GH-107 through GH-110 open.
- 2026-07-02: Added Core result/evidence-ref projections and API Server `GET /runs/:run_id/result` plus `GET /runs/:run_id/evidence-refs` using existing Run Record refs only.
- 2026-07-02: Targeted Core/API typecheck and self-check passed before full validation.
- 2026-07-02: Full workspace validation and Loom suite checks passed; packaged build remains pending.
- 2026-07-02: Packaged build flow passed; review artifacts remain pending until pre-review/review stage.
