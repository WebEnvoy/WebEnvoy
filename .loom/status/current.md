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
- Current Checkpoint: review
- Current Stop: PR #121 is open on `work/GH-102-run-lifecycle` at head `ec779e80119bdf7166cd306113c77b20365acb3a`; local validation, PR metadata preflight, hosted non-merge-gate checks, packaged pre-review, and packaged spec-review passed, while packaged implementation review exposed stale review-head drift from the first review carrier commit and is being refreshed in this carrier-only update.
- Next Step: Commit the refreshed GH-102 review artifacts, push, refresh PR body/head metadata, then rerun packaged implementation review, merge-ready, and hosted checks.
- Blockers: None recorded.
- Latest Validation Summary: GH-102 validation passed on 2026-07-01 UTC at PR head `ec779e80119bdf7166cd306113c77b20365acb3a`: `pnpm --filter @webenvoy/core-runtime test`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `pnpm conformance`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-102/build-evidence.json`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-102 --json`; `loom suite carrier validate --target . --item GH-102 --json`; `loom suite evidence validate --target . --item GH-102 --json`; packaged build flow attempt `GH-102-build-27d37690fb19-b95096d5003d`; PR #121 metadata preflight passed for `merge_ready`; packaged pre-review attempt `GH-102-pre-review-ec779e80119b-d06d921676fa` passed; packaged spec-review attempt `GH-102-spec-review-ec779e80119b-8bd9a0188442` passed; packaged implementation review attempt `GH-102-review-ec779e80119b-2a2c6ef1ef58` completed and exposed stale review head because the first review carrier commit also changed `.loom/work-items/GH-102.md` and `.loom/specs/GH-102/build-evidence.json`; this was classified as carrier head-binding drift and fixed by refreshing review artifacts against head `ec779e80119bdf7166cd306113c77b20365acb3a` with only allowed review/progress/status drift afterward; hosted `py-compile`, `demo-bootstrap`, `repo-local-cli`, and `loom-check` passed on PR #121 run `28549806302`, while hosted `loom-pr-merge-gate` remained blocked before this refresh. First `loom fact-chain`/`suite evidence`/packaged build attempts exposed carrier enum/blocker field issues; these were classified as carrier metadata defects and fixed before the passing runs. Review-readiness source-distribution tools are not applicable to this consumer repo because there is no `tools/` directory and `tools/skills_surface.py check`, `tools/loom_check.py --profile source --source-surface contract-only`, `tools/check_release_surface.py`, `tools/version_surface_check.py`, and `tools/check_npm_package.py` are absent. Merge-ready, hosted merge gate, and post-merge closeout remain pending.
- Recovery Boundary: Keep scope limited to the explicit Run Record lifecycle transition table, exported lifecycle metadata, core/conformance self-check coverage, and GH-102 carriers. Do not add HTTP routes, execution workers, retry/recovery orchestration, result envelope changes, Lode/Harbor consumption, evidence retrieval, storage backends, SDK/App integration, or true-write behavior in this PR.
- Current Lane: review

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-102.md
- Lane Entry: review

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
