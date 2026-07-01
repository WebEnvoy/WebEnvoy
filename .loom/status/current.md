# Current Status

## Derived Fact Chain View

- Item ID: GH-99
- Goal: Implement the minimum local durable Run Record store for accepted/running/terminal/failure/evidence refs.
- Scope: GH-99 is limited to the `packages/core` workspace package, the file-backed Run Record store, a no-dependency self-check, README command documentation, lockfile importer metadata, and GH-99 item-specific Loom carrier evidence; ownership is limited to the listed core runtime package, root docs metadata, lockfile importer metadata, GH-99 carriers, and GH-99 current status/bootstrap locator alignment.
- Execution Path: implementation/run-record-local-store-v0
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-99.md
- Review Entry: .loom/reviews/GH-99.json
- Validation Entry: `pnpm install --lockfile-only`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-99/build-evidence.json`; `loom suite validate --target . --item GH-99 --json`; `loom suite carrier validate --target . --item GH-99 --json`; `loom suite evidence validate --target . --item GH-99 --json`; packaged `loom_flow.py flow build --target . --item GH-99 --build-evidence .loom/specs/GH-99/build-evidence.json`; PR body/head readback.
- Closing Condition: PR is merged, post-merge closeout evidence is recorded, issue #99 is closed, and FR #94 remains open until #100 is also complete.
- Current Checkpoint: build
- Current Stop: PR #115 is open for GH-99 at branch `work/GH-99-run-record-store`; PR body/head readback matched Work Item, branch, repository, and head `c1d93a290afffba4af90a6b0576f4ade9344dfb2` before this PR URL carrier sync.
- Next Step: Commit and push the PR URL carrier sync, refresh PR body/head metadata to the new head, run PR metadata preflight, then enter review and merge-ready.
- Blockers: None recorded.
- Latest Validation Summary: Pre-PR validation passed on 2026-07-01 UTC: `pnpm install --lockfile-only`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm build`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-99/build-evidence.json`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-99 --json`; `loom suite carrier validate --target . --item GH-99 --json`; `loom suite evidence validate --target . --item GH-99 --json`; packaged `loom_flow.py flow build --target . --item GH-99 --build-evidence .loom/specs/GH-99/build-evidence.json`. Initial PR #115 body/head readback passed at head `c1d93a290afffba4af90a6b0576f4ade9344dfb2`; PR body/head metadata must be refreshed after this PR URL carrier sync push. Semantic review, hosted checks, merge-ready, merge, and closeout remain pending.
- Recovery Boundary: Keep scope limited to the `packages/core` file-backed Run Record store, self-check, root README command docs, lockfile importer metadata, and GH-99 Loom carriers. Do not implement API submit/query routes, admission runtime behavior, Harbor/Lode/App integration, database/ORM/migration tooling, full conformance runner, generated types, OpenAPI, CLI/MCP/SDK/App-facing API, hosted service storage, or true writes in this PR.
- Current Lane: implementation

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-99.md
- Lane Entry: implementation

## Sources

- Static Truth: .loom/work-items/GH-99.md
- Dynamic Truth: .loom/progress/GH-99.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json

## Notes

- 2026-07-01: Started GH-99 from `origin/main` after GH-98 implementation and closeout PRs merged and issue #98 closed. Created branch `work/GH-99-run-record-store`.
- 2026-07-01: Added `packages/core` as `@webenvoy/core-runtime` with no runtime dependencies.
- 2026-07-01: Added file-backed Run Record storage with one JSON file per safe `run_id`, atomic temp-file rename, create/get/update/list operations, monotonic status transition checks, terminal timestamp handling, failed-run failure requirement, and refs-only guard assertions in self-check.
- 2026-07-01: Added a self-check covering pending -> admitted -> running -> succeeded, admission failure -> failed, persisted reload, illegal terminal transition rejection, illegal `run_id` rejection, and sorted listing.
- 2026-07-01: Pre-PR validation passed across pnpm workspace commands, JSON/diff checks, Loom doctor/verify/fact-chain, suite validate/carrier/evidence, and packaged build flow.
- 2026-07-01: Created PR #115 at head `c1d93a290afffba4af90a6b0576f4ade9344dfb2`; PR URL carrier sync is being committed separately, so PR metadata will be refreshed after push.
