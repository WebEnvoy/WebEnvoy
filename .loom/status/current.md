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
- Current Stop: PR #125 merged into `main` as `9898322125e80c8c4d1ccc64b9cdf268fdaa55ea`; GH-104 terminal closeout metadata is staged in this progress carrier for the closeout PR.
- Next Step: Merge this carrier closeout sync, then close GitHub issue #104 with post-merge evidence while keeping FR #95 open for GH-105.
- Blockers: None recorded.
- Latest Validation Summary: GH-104 validation and merge evidence passed on 2026-07-02 UTC: `pnpm --filter @webenvoy/core-runtime typecheck`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm --filter @webenvoy/schemas test`; `pnpm conformance`; `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm test`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-104/build-evidence.json .loom/reviews/GH-104.json .loom/reviews/GH-104.spec.json`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-104 --json`; `loom suite carrier validate --target . --item GH-104 --json`; `loom suite evidence validate --target . --item GH-104 --json`; packaged build attempt `GH-104-build-6d5c1e8eb6cd-18bd1b63fd66`; packaged pre-review attempt `GH-104-pre-review-c3e7b0088731-9fe1664b02c0`; packaged spec-review attempt `GH-104-spec-review-6dbaf703ef4a-7be7d73c2a29`; packaged implementation review attempt `GH-104-review-6dbaf703ef4a-0dbc071a926a`; packaged merge-ready attempt `GH-104-merge-ready-6dbaf703ef4a-eccc3c54e402`; PR #125 metadata preflight passed for `merge_ready` and final head `6dbaf703ef4acb6dbc07c3b656a1c238282ff2a4`; hosted `py-compile`, `demo-bootstrap`, `repo-local-cli`, `loom-check`, and `loom-pr-merge-gate` passed on PR #125 in run `28556223148`; PR #125 merged into `main` as `9898322125e80c8c4d1ccc64b9cdf268fdaa55ea`. Earlier attempts exposed installed-runtime suite JSON, review-readiness-summary, retained validation-summary, and checkpoint-state drift; these were classified as carrier/runtime metadata defects and fixed before merge. Review-readiness source-distribution tools are not applicable to this consumer repo because there is no `tools/` directory and `tools/skills_surface.py check`, `tools/loom_check.py --profile source --source-surface contract-only`, `tools/check_release_surface.py`, `tools/version_surface_check.py`, and `tools/check_npm_package.py` are absent. Issue closeout remains pending until this post-merge carrier sync is merged; FR #95 remains open until GH-105 completes.
- Recovery Boundary: Keep GH-104 limited to Core validation and recording of Harbor public runtime/viewer/snapshot/refmap/source-trace/evidence refs. Do not add GH-105 result/failure envelope output, API query/smoke, App integration, Harbor SDK/runtime calls, cross-repo edits, raw Harbor facts, or true writes.
- Current Lane: merge_ready

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-104.md
- Lane Entry: merge_ready

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
- 2026-07-02: PR #125 passed local merge-ready attempt `GH-104-merge-ready-6dbaf703ef4a-eccc3c54e402`, hosted required checks in run `28556223148`, and merged into `main` as `9898322125e80c8c4d1ccc64b9cdf268fdaa55ea`; terminal closeout metadata was recorded in `.loom/progress/GH-104.md`.
