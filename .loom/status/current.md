# Current Status

## Derived Fact Chain View

- Item ID: GH-104
- Goal: Bind Harbor runtime refs and evidence refs into Core admission and Run Record.
- Scope: GH-104 is limited to Core-side validation of Harbor public `CoreRuntimeFacts` and `CoreSceneReference` refs, mapping runtime/profile/provider/viewer/snapshot/refmap/source-trace/evidence refs into Run Record admission and top-level ref fields, fail-closed runtime/evidence binding failures, fixtures, and GH-104 item-specific Loom carriers. Ownership is limited to the listed core/schema/conformance files, GH-104 carriers, GH-104 review artifacts when authored, and GH-104 current status alignment.
- Execution Path: implementation/harbor-ref-binding-v0
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-104.md
- Review Entry: .loom/reviews/GH-104.json
- Validation Entry: `pnpm --filter @webenvoy/core-runtime test`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `pnpm conformance`; `git diff --check`; `jq empty .loom/specs/GH-104/build-evidence.json`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-104 --json`; `loom suite carrier validate --target . --item GH-104 --json`; `loom suite evidence validate --target . --item GH-104 --json`; packaged `loom_flow.py flow build --target . --item GH-104 --build-evidence .loom/specs/GH-104/build-evidence.json`; PR body/head readback.
- Closing Condition: PR is merged, post-merge closeout evidence is recorded, issue #104 is closed, and FR #95 remains open until GH-105 completes.
- Current Checkpoint: merge
- Current Stop: PR #125 is open on branch `work/GH-104-harbor-refs`; local validation, PR metadata preflight, packaged source-runtime spec-review, and packaged source-runtime implementation review passed.
- Next Step: Run hosted checks and packaged merge-ready, then complete controlled merge, post-merge closeout evidence, and issue #104 closure.
- Blockers: None recorded.
- Latest Validation Summary: GH-104 PR-ready validation passed on 2026-07-02 local time: local checks passed (`pnpm --filter @webenvoy/core-runtime typecheck`, `pnpm --filter @webenvoy/core-runtime test`, `pnpm --filter @webenvoy/schemas test`, `pnpm conformance`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `git diff --check`, `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-104/build-evidence.json`); Loom checks passed (`loom doctor --target . --json`, `loom verify --target . --json`, `loom fact-chain --target . --json`, `loom suite validate --target . --item GH-104 --json`, `loom suite carrier validate --target . --item GH-104 --json`, `loom suite evidence validate --target . --item GH-104 --json`); packaged source-runtime build/pre-review/spec-review/review passed with attempts `GH-104-build-6d5c1e8eb6cd-18bd1b63fd66`, `GH-104-pre-review-c3e7b0088731-9fe1664b02c0`, `GH-104-spec-review-67a9b5c4de16-27971afe659e`, and `GH-104-review-67a9b5c4de16-a3e9edd7ceb0`; PR #125 metadata preflight passed for branch `work/GH-104-harbor-refs`. Installed `loom build`/`loom merge-ready` v0.25.0 wrapper issues are classified as tooling; packaged source-runtime flow is the consumed gate path. Hosted checks, controlled merge, and issue closeout remain pending.
- Recovery Boundary: Keep GH-104 limited to Core validation and recording of Harbor public runtime/viewer/snapshot/refmap/source-trace/evidence refs. Do not add GH-105 result/failure envelope output, API query/smoke, App integration, Harbor SDK/runtime calls, cross-repo edits, raw Harbor facts, or true writes.
- Current Lane: merge

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-104.md
- Lane Entry: build

## Sources

- Static Truth: .loom/work-items/GH-104.md
- Dynamic Truth: .loom/progress/GH-104.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json

## Notes

- 2026-07-02: Started GH-104 from `origin/main` after GH-103 implementation and closeout were merged and issue #103 was closed.
- 2026-07-02: Read Harbor `origin/main` at `8384967` and consumed public facts from `packages/runtime-api/src/index.ts`, `page-scene.ts`, `viewer-control.ts`, `smoke.ts`, and `index.test.ts`.
- 2026-07-02: Added Core Harbor admission checks and admission-level Run Record refs for runtime/viewer/snapshot/refmap/source-trace/evidence binding.
- 2026-07-02: Pre-PR local validation and Loom suite/fact-chain/source-runtime build flow passed; installed `loom build` CLI surface issue is recorded as a tooling note in `.loom/specs/GH-104/build-evidence.json`.
- 2026-07-02: PR #125 metadata preflight and packaged source-runtime spec-review/review passed; GH-104 checkpoint advanced to merge for hosted checks and controlled merge.
