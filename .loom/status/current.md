# Current Status

## Derived Fact Chain View

- Item ID: GH-100
- Goal: Establish a repository-level conformance fixture and self-check command for schema fixtures and minimum Run Record read/write behavior.
- Scope: GH-100 is limited to the `packages/conformance` workspace package, the root `pnpm conformance` command, README command documentation, the narrow core runtime export needed by that check, lockfile importer metadata, and GH-100 item-specific Loom carrier evidence; ownership is limited to the listed conformance package, root docs/script metadata, core export surface, lockfile importer metadata, GH-100 carriers, and GH-100 current status/bootstrap locator alignment.
- Execution Path: implementation/conformance-self-check-v0
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-100.md
- Review Entry: .loom/reviews/GH-100.json
- Validation Entry: `pnpm install --lockfile-only`; `pnpm conformance`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-100/build-evidence.json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-100 --json`; `loom suite carrier validate --target . --item GH-100 --json`; `loom suite evidence validate --target . --item GH-100 --json`; packaged `loom_flow.py flow build --target . --item GH-100 --build-evidence .loom/specs/GH-100/build-evidence.json`; PR body/head readback.
- Closing Condition: PR is merged, post-merge closeout evidence is recorded, issue #100 is closed, and FR #94 can be closed only after #97 through #100 closeout evidence is confirmed.
- Current Checkpoint: build
- Current Stop: PR #117 metadata is refreshed for head `8d8f5ceb6c535a47c32071796a8d41b149908995`; first pre-review attempt blocked only on missing explicit N/A evidence for source-distribution readiness tools, and the repo has no `tools/` directory.
- Next Step: Commit and push the source-distribution N/A evidence carrier sync, refresh PR body/head metadata to the new branch head, then rerun PR metadata preflight and pre-review.
- Blockers: None recorded.
- Latest Validation Summary: GH-100 validation passed on 2026-07-01 UTC for implementation head `53ead2ce21bbd5cbd9fa0d985811abce0a093140`: `pnpm install --lockfile-only`; clean-dist `pnpm conformance`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-100/build-evidence.json`; `loom resume --target . --item GH-100 --json`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-100 --json`; `loom suite carrier validate --target . --item GH-100 --json`; `loom suite evidence validate --target . --item GH-100 --json`; packaged `loom_flow.py flow build --target . --item GH-100 --build-evidence .loom/specs/GH-100/build-evidence.json` attempt `GH-100-build-53ead2ce21bb-3f2c926d3eef`. PR #117 metadata preflight passed for head `8d8f5ceb6c535a47c32071796a8d41b149908995`; packaged `flow pre-review` attempt `GH-100-pre-review-8d8f5ceb6c53-565c5c2af11d` blocked only because the carrier lacked explicit N/A evidence for source-distribution readiness tools. Local readback confirmed this consumer repo has no `tools/` directory, so `tools/skills_surface.py check`, `tools/loom_check.py --profile source --source-surface contract-only`, `tools/check_release_surface.py`, `tools/version_surface_check.py`, and `tools/check_npm_package.py` are not applicable. `loom doctor` reported CLI freshness stale against npm but installed surface diagnostics passed and plugin payload was current. The direct `loom build` wrapper was classified as an adapter/input-consumption mismatch, while the hosted workflow-equivalent packaged build flow passed. This N/A evidence carrier sync changes the branch head; PR metadata, hosted checks, review, merge-ready, merge, and closeout remain pending.
- Recovery Boundary: Keep scope limited to the conformance package, root conformance command docs/script, the narrow core runtime export needed by the check, lockfile importer metadata, and GH-100 Loom carriers. Do not implement API submit/query routes, admission runtime behavior beyond fixture/store checks, Harbor/Lode/App integration, Ajv/generated types, OpenAPI, CLI/MCP/SDK/App-facing API, hosted service storage, database/ORM/migration tooling, or true-write behavior in this PR.
- Current Lane: implementation

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-100.md
- Lane Entry: implementation

## Sources

- Static Truth: .loom/work-items/GH-100.md
- Dynamic Truth: .loom/progress/GH-100.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json

## Notes

- 2026-07-01: Started GH-100 from `origin/main` after GH-99 implementation and closeout PRs merged and issue #99 closed. Created branch `work/GH-100-conformance-self-check`.
- 2026-07-01: Added `packages/conformance` as `@webenvoy/conformance` with no new external runtime dependencies.
- 2026-07-01: Added a root `pnpm conformance` command that builds the core runtime and runs the conformance self-check.
- 2026-07-01: Added a self-check that validates local schema metadata, fixture schema-version bindings, required fixture fields, successful Run Record write/read/list behavior, admission-failure Run Record write/read behavior, and refs-only boundaries.
- 2026-07-01: Added README command documentation and GH-100 item-specific Loom carriers.
