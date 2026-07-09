# Current Status

## Derived Fact Chain View

- Item ID: CORE-248
- Goal: Complete the Core #248 terminal read-only result/evidence refs slice after successful App-facing task submission, Lode package resolution, and Harbor runtime admission.
- Scope: Core/WebEnvoy only. POST `/tasks` may complete a read-only run to a terminal refs-only result when Harbor returns valid scene/evidence refs. Query endpoints must expose run/result/evidence/session refs without raw browser material. Ownership is limited to Core runtime task-chain code, focused API self-checks, and CORE-248 carriers.
- Execution Path: work/core-248-terminal-read-result
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-248.md
- Review Entry: .loom/reviews/CORE-248.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime typecheck; pnpm --filter @webenvoy/api-server typecheck; pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/api-server test; pnpm typecheck; git diff --check; loom suite validate/carrier/evidence --target . --item CORE-248 --json
- Closing Condition: PR ready, merge, post-merge closeout for Core #248 and covered Core runtime result/evidence refs, with App E2E left open until App consumes the API.
- Current Checkpoint: closed_out
- Current Stop: CORE-248 closed out by closeout run: PR #255 merged at 65c6a3989d12112ddb536e5ad9a58c1fe7d5ac19, issue #248 closed, host reconciliation consumed, and terminal carrier metadata written. The final shadow refresh step blocked on missing `.loom/bootstrap/manifest.json`; this is tracked as Loom shadow/adoption surface drift, not Core product behavior.
- Next Step: No further CORE-248 implementation work remains.
- Blockers: None recorded.
- Latest Validation Summary: 2026-07-09T05:12Z UTC: `pnpm --filter @webenvoy/core-runtime typecheck`, `pnpm --filter @webenvoy/api-server typecheck`, `pnpm --filter @webenvoy/core-runtime test`, `pnpm --filter @webenvoy/api-server test`, `pnpm typecheck`, `git diff --check`, `loom suite carrier validate --target . --item CORE-248 --json`, `loom suite validate --target . --item CORE-248 --json`, `loom suite evidence validate --target . --item CORE-248 --json`, and `loom build --target . --item CORE-248 --build-evidence .loom/specs/CORE-248/build-evidence.json --json` passed after requiring valid same-origin Harbor scene URLs for terminal read completion and adding missing-URL/invalid-evidence regression coverage. Deterministic review-readiness evidence: `tools/skills_surface.py check` is not present in this repo; equivalent `loom skills check --target . --json` returned block on pre-existing `.loom/bootstrap` repo-local payload residue and is classified as Loom tool-surface blocker, not Core behavior. `tools/loom_check.py --profile source --source-surface contract-only` is not present in this repo; hosted `loom-check` passed for PR #255 run 28995492402 and local `loom verify --target . --json` passed. `tools/check_release_surface.py`, `tools/version_surface_check.py`, and `tools/check_npm_package.py` are not present in this repo; global `loom skills release-check --target . --json` blocked on Loom release/runtime-copy surfaces outside this no-release Core PR, while `loom version --json`, `loom doctor --target . --json`, `loom installed-state validate --target . --json`, and `loom host doctor --host codex --scope user --json` passed. PR metadata declares `release_judgment: no_release`.
- Recovery Boundary: Revert this branch. No App/Harbor/Lode code changes, real account/profile/Cookie/production page access, submit, publish, send, save, hosted browser, marketplace, bulk collection, or risk-bypass action occurred. App E2E remains blocked until App submits through this API and user authorizes any real account/profile/production page action.
- Current Lane: post-merge-closeout-run

## Runtime Evidence

- Run Entry: packages/api-server/src/runtime-task-submit-self-check.ts
- Logs Entry: not_applicable
- Diagnostics Entry: packages/core/src/runtime-task-chain.ts
- Verification Entry: .loom/progress/CORE-248.md
- Lane Entry: .loom/specs/CORE-248/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-248.md
- Dynamic Truth: .loom/progress/CORE-248.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
