# Current Status

## Derived Fact Chain View

- Item ID: GH-100
- Goal: Establish a repository-level conformance fixture and self-check command for schema fixtures and minimum Run Record read/write behavior.
- Scope: GH-100 is limited to the `packages/conformance` workspace package, the root `pnpm conformance` command, README command documentation, the narrow core runtime export needed by that check, lockfile importer metadata, GH-100 item-specific Loom carrier evidence, and `.loom/reviews/GH-100*.json` review artifacts; ownership is limited to the listed conformance package, root docs/script metadata, core export surface, lockfile importer metadata, GH-100 carriers, GH-100 review artifacts, and GH-100 current status/bootstrap locator alignment.
- Execution Path: implementation/conformance-self-check-v0
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-100.md
- Review Entry: .loom/reviews/GH-100.json
- Validation Entry: `pnpm install --lockfile-only`; `pnpm conformance`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-100/build-evidence.json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-100 --json`; `loom suite carrier validate --target . --item GH-100 --json`; `loom suite evidence validate --target . --item GH-100 --json`; packaged `loom_flow.py flow build --target . --item GH-100 --build-evidence .loom/specs/GH-100/build-evidence.json`; PR body/head readback.
- Closing Condition: PR is merged, post-merge closeout evidence is recorded, issue #100 is closed, and FR #94 can be closed only after #97 through #100 closeout evidence is confirmed.
- Current Checkpoint: review
- Current Stop: PR #117 metadata preflight, current-head local validation, and packaged spec review passed for head `4e596e4b4f28f607ebfb9bd9fe0dfb4546c645d8`; implementation review flow is ready to consume a GH-100 code review artifact after this status sync.
- Next Step: Commit and push this GH-100 status sync, refresh PR body/head metadata to the new branch head, rerun review-surface metadata/spec checks, then record and consume `.loom/reviews/GH-100.json`.
- Blockers: None recorded.
- Latest Validation Summary: GH-100 validation passed on 2026-07-01 UTC for current PR head `4e596e4b4f28f607ebfb9bd9fe0dfb4546c645d8`: `pnpm conformance`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check origin/main...HEAD`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-100/build-evidence.json .loom/reviews/GH-100.spec.json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-100 --json`; `loom suite carrier validate --target . --item GH-100 --json`; `loom suite evidence validate --target . --item GH-100 --json`; PR metadata preflight for surface `review` and head `4e596e4b4f28f607ebfb9bd9fe0dfb4546c645d8`; packaged `flow spec-review` attempt `GH-100-spec-review-4e596e4b4f28-78bb026ad3a1`. Earlier implementation head `53ead2ce21bbd5cbd9fa0d985811abce0a093140` passed `pnpm install --lockfile-only`, clean-dist `pnpm conformance`, full workspace build/typecheck/test/lint, suite validations, and packaged build flow attempt `GH-100-build-53ead2ce21bb-3f2c926d3eef`. Packaged pre-review passed at head `61c7ca18bf5ddded629d75e3388c6368f19729a9` with attempt `GH-100-pre-review-61c7ca18bf5d-01596b4f004b` after explicit N/A evidence confirmed this consumer repo has no `tools/` directory; `tools/skills_surface.py check`, `tools/loom_check.py --profile source --source-surface contract-only`, `tools/check_release_surface.py`, `tools/version_surface_check.py`, and `tools/check_npm_package.py` are not applicable. The direct `loom build` wrapper was classified as an adapter/input-consumption mismatch, while the hosted workflow-equivalent packaged build flow passed. Implementation review artifact, hosted checks, merge-ready, merge, and closeout remain pending.
- Recovery Boundary: Keep scope limited to the conformance package, root conformance command docs/script, the narrow core runtime export needed by the check, lockfile importer metadata, GH-100 Loom carriers, and GH-100 review artifacts. Do not implement API submit/query routes, admission runtime behavior beyond fixture/store checks, Harbor/Lode/App integration, Ajv/generated types, OpenAPI, CLI/MCP/SDK/App-facing API, hosted service storage, database/ORM/migration tooling, or true-write behavior in this PR.
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
