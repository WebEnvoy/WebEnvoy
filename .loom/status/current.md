# Current Status

## Derived Fact Chain View

- Item ID: GH-102
- Goal: Implement the minimum explicit Run Record lifecycle state machine for read-only task execution records.
- Scope: GH-102 is limited to the Core runtime Run Record transition table, exported lifecycle metadata, core/conformance self-check coverage, and GH-102 item-specific Loom carriers. Ownership is limited to the listed runtime/conformance files, GH-102 carriers, GH-102 review artifacts when authored, and GH-102 current status/bootstrap locator alignment.
- Execution Path: implementation/run-lifecycle-state-machine-v0
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-102.md
- Review Entry: .loom/reviews/GH-102.json
- Validation Entry: `pnpm --filter @webenvoy/core-runtime test`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `pnpm conformance`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-102/build-evidence.json`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-102 --json`; `loom suite carrier validate --target . --item GH-102 --json`; `loom suite evidence validate --target . --item GH-102 --json`; packaged `loom_flow.py flow build --target . --item GH-102 --build-evidence .loom/specs/GH-102/build-evidence.json`; PR body/head readback.
- Closing Condition: PR is merged, post-merge closeout evidence is recorded, issue #102 is closed, and FR #95 remains open until GH-103 through GH-105 and cross-repo dependency evidence are complete.
- Current Checkpoint: build
- Current Stop: GH-102 build readiness passed locally on `work/GH-102-run-lifecycle`; commit, push, PR creation, PR metadata readback, hosted checks, semantic review, merge-ready, and post-merge closeout are pending.
- Next Step: Commit the implementation and GH-102 carriers, push the branch, create PR, and read back PR body/head metadata.
- Blockers: None recorded.
- Latest Validation Summary: GH-102 validation passed on 2026-07-01 UTC: `pnpm --filter @webenvoy/core-runtime test`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `pnpm conformance`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-102/build-evidence.json`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-102 --json`; `loom suite carrier validate --target . --item GH-102 --json`; `loom suite evidence validate --target . --item GH-102 --json`; packaged build flow. First `loom fact-chain`/`suite evidence`/packaged build attempts exposed carrier enum/blocker field issues; these were classified as carrier metadata defects and fixed before the passing runs. Review-readiness source-distribution tools are not applicable to this consumer repo because there is no `tools/` directory and `tools/skills_surface.py check`, `tools/loom_check.py --profile source --source-surface contract-only`, `tools/check_release_surface.py`, `tools/version_surface_check.py`, and `tools/check_npm_package.py` are absent. PR metadata, hosted checks, semantic review, merge-ready, and post-merge closeout remain pending.
- Recovery Boundary: Keep scope limited to the explicit Run Record lifecycle transition table, exported lifecycle metadata, core/conformance self-check coverage, and GH-102 carriers. Do not add HTTP routes, execution workers, retry/recovery orchestration, result envelope changes, Lode/Harbor consumption, evidence retrieval, storage backends, SDK/App integration, or true-write behavior in this PR.
- Current Lane: build

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-102.md
- Lane Entry: build

## Sources

- Static Truth: .loom/work-items/GH-102.md
- Dynamic Truth: .loom/progress/GH-102.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json

## Notes

- 2026-07-02: Started GH-102 from `origin/main` after GH-101 implementation and closeout PRs merged and issue #101 was closed.
- 2026-07-02: Aligned public status behavior with ADR 0005: `accepted` is historical wording for the `admitted` public status, and `canceled` is represented by the existing schema enum `cancelled`.
- 2026-07-02: Replaced rank-based status progression with an explicit transition table so skipped transitions such as `pending -> running` and `admitted -> succeeded` are rejected.
- 2026-07-02: Kept result/failure envelope wiring, Harbor runtime refs, Lode capability/resource consumption, API query/smoke, and write-side guardrails for later Work Items.
