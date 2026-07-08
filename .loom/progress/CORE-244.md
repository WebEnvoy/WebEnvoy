# CORE-244 Progress

## Dynamic Facts

- Item ID: CORE-244
- Current Checkpoint: closed_out
- Current Stop: Implementation PR #249 has merged and terminal closeout metadata is recorded for #243/#244/#245/#246/#247/#248.
- Next Step: Close #243/#244/#245/#246/#247/#248 with post-merge evidence, then retire CORE-244 current pointer before starting the next Core batch.
- Blockers: None recorded.
- Latest Validation Summary: `pnpm --filter @webenvoy/core-runtime typecheck`; `pnpm --filter @webenvoy/api-server typecheck`; `pnpm --filter @webenvoy/core-runtime test`; `pnpm --filter @webenvoy/api-server test`; `pnpm typecheck`; `pnpm test`; `pnpm lint`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/CORE-244/build-evidence.json`; `loom fact-chain --target . --json`; `loom build --target . --item CORE-244 --build-evidence .loom/specs/CORE-244/build-evidence.json --json`; `loom resume --target . --item CORE-244 --json`; `loom suite validate/carrier/evidence --target . --item CORE-244 --json`; `loom pr gate 249 --target . --work-item CORE-244 --head-sha 9a6b23af428fcc98b78f35de77cd5f753b57e41a --json`; hosted run 28936264313 passed py-compile, demo-bootstrap, repo-local-cli, loom-check, and loom-pr-merge-gate; PR #249 merged to main as 9101eaa6f42cc6584e8b428de5398f0c1f56539d at 2026-07-08T10:39:22Z. Live Harbor/browser/site evidence was not attempted; this closeout proves the Core refs-only contract path, not App/Harbor live user usability.
- Recovery Boundary: Core runtime task submission chain only; no App UI, Harbor/Lode code mutation, real external site action, real account/profile/Cookie use, true write, submit/publish/send, hosted browser, marketplace, bulk collection, full account cloud hosting, risk-bypass claim, merge without review/gate, or issue closeout without post-merge evidence.
- Current Lane: core runtime task chain implementation

## Execution Ledger

- Ledger Binding: recovery_entry
- Plan Locator: .loom/specs/CORE-244/plan.md
- Acceptance Locator: .loom/specs/CORE-244/spec.md
- Validation Evidence Locator: .loom/specs/CORE-244/evidence-map.md
- Handoff Notes Locator: .loom/specs/CORE-244/task-carrier.md
- Evidence Freshness: current

## Validation Log

- 2026-07-08T07:35Z `pnpm install --frozen-lockfile`: pass; installed workspace dependencies in the formal worktree without lockfile changes.
- 2026-07-08T07:35Z `pnpm --filter @webenvoy/core-runtime typecheck`: pass.
- 2026-07-08T07:35Z `pnpm --filter @webenvoy/api-server typecheck`: pass.
- 2026-07-08T07:35Z `pnpm --filter @webenvoy/core-runtime test`: pass; existing Core self-checks still pass.
- 2026-07-08T07:35Z `pnpm --filter @webenvoy/api-server test`: pass; includes POST `/tasks` mock Lode registry plus mock Harbor readiness/provider/session/snapshot/evidence chain, fail-closed readiness failure, and malformed Harbor JSON failure.
- 2026-07-08T07:40Z `pnpm typecheck`: pass; all workspace TypeScript checks passed.
- 2026-07-08T07:40Z `git diff --check`: pass; no whitespace errors.
- 2026-07-08T07:40Z `pnpm test`: pass; workspace build plus schemas/core/api-server/conformance self-checks passed.
- 2026-07-08T07:40Z `loom verify --target . --json`: pass; installed Loom delivery layers verified.
- 2026-07-08T07:42Z `loom suite carrier validate --target . --item CORE-244 --json`: pass.
- 2026-07-08T07:42Z `loom suite evidence validate --target . --item CORE-244 --json`: pass after evidence map rows were tightened for behavior/test/fresh verification inputs.
- 2026-07-08T07:43Z `loom suite validate --target . --item CORE-244 --json`: pass with minimal suite path and required artifacts present.
- 2026-07-08T07:44Z `pnpm lint`: pass; workspace lint scripts completed.
- 2026-07-08T07:45Z final `pnpm typecheck`: pass after fail-closed Harbor JSON/throwing-client edge fix.
- 2026-07-08T07:45Z final `pnpm test`: pass after fail-closed Harbor JSON/throwing-client edge fix.
- 2026-07-08T07:45Z final `pnpm lint`: pass after fail-closed Harbor JSON/throwing-client edge fix.
- 2026-07-08T09:53Z `pnpm --filter @webenvoy/core-runtime typecheck`: pass after main-controller hardening of Harbor request passthrough removal, HTTP URL restriction, and Lode root confinement.
- 2026-07-08T09:54Z `pnpm --filter @webenvoy/api-server typecheck`: pass after POST `/tasks` request validation and duplicate run-id handling.
- 2026-07-08T09:54Z `pnpm --filter @webenvoy/core-runtime test`: pass.
- 2026-07-08T09:54Z `pnpm --filter @webenvoy/api-server test`: pass; includes boundary assertions that Harbor session/snapshot passthrough cannot override Core-owned fields, invalid run_id returns 400, duplicate run_id returns 409, and Lode registry paths cannot escape the configured root.
- 2026-07-08T09:56Z `git diff --check`: pass.
- 2026-07-08T09:56Z `loom fact-chain --target . --json`: pass for shared no_active_item baseline.
- 2026-07-08T09:56Z `loom suite carrier validate --target . --item CORE-244 --json`: pass.
- 2026-07-08T09:56Z `loom suite evidence validate --target . --item CORE-244 --json`: pass.
- 2026-07-08T09:56Z `loom suite validate --target . --item CORE-244 --json`: pass.
- 2026-07-08T09:57Z `pnpm --filter @webenvoy/api-server test`: pass after CORE-244 associated artifacts carrier fix.
- 2026-07-08T10:00Z `loom resume --target . --item CORE-244 --json`: pass after checkpoint and ownership carrier alignment.
- 2026-07-08T10:03Z `loom fact-chain --target . --json`: blocked after activating CORE-244 current pointer because status surface still carried worker-handoff wording; remediation is aligning work item, progress, and status surface to the main-controller PR path in this carrier update.
- 2026-07-08T10:03Z live Harbor runtime evidence remained not attempted by contract; this is a scope boundary, not an active blocker for the Core mock-runtime PR readiness lane.
- 2026-07-08T10:04Z `loom fact-chain --target . --json`: pass after CORE-244 active current pointer and carrier alignment.
- 2026-07-08T10:04Z `loom build --target . --item CORE-244 --build-evidence .loom/specs/CORE-244/build-evidence.json --json`: pass.
- 2026-07-08T10:04Z `loom resume --target . --item CORE-244 --json`: pass.
- 2026-07-08T10:04Z `git diff --check && jq empty .loom/bootstrap/init-result.json .loom/specs/CORE-244/build-evidence.json`: pass.
- 2026-07-08T10:05Z `pnpm typecheck`: pass; schemas, core-runtime, API server, and conformance packages typecheck.
- 2026-07-08T10:05Z `pnpm test`: pass; workspace build plus schemas/core/api-server/conformance self-checks pass.
- 2026-07-08T10:05Z `pnpm lint`: pass.
- 2026-07-08T10:09Z subagent Core review reported P1 evidence_policy private material passthrough, P1 duplicate run_id race returning 500, and P2 Lode symlink path escape. Main controller fixed all three before PR.
- 2026-07-08T10:10Z `pnpm --filter @webenvoy/api-server typecheck`: pass after reviewer fixes.
- 2026-07-08T10:10Z `pnpm --filter @webenvoy/api-server test`: pass; self-check now covers private `harbor.evidence_policy` rejection, duplicate run_id race 409 mapping, and symlink escape fail-closed.
- 2026-07-08T10:10Z `pnpm --filter @webenvoy/core-runtime typecheck`: pass after `realpath` confinement change.
- 2026-07-08T10:10Z `git diff --check`: pass.
- 2026-07-08T10:12Z `pnpm typecheck`: pass after reviewer fixes.
- 2026-07-08T10:12Z `pnpm test`: pass after reviewer fixes.
- 2026-07-08T10:12Z `pnpm lint`: pass after reviewer fixes.
- 2026-07-08T10:14Z `loom fact-chain --target . --json`: pass after reviewer fixes and carrier evidence update.
- 2026-07-08T10:14Z `loom build --target . --item CORE-244 --build-evidence .loom/specs/CORE-244/build-evidence.json --json`: pass after reviewer fixes and carrier evidence update.
- 2026-07-08T10:14Z `jq empty .loom/bootstrap/init-result.json .loom/specs/CORE-244/build-evidence.json && git diff --check`: pass.

## Runtime Evidence

- Run Entry: not_applicable_live_runtime_not_attempted
- Logs Entry: not_applicable
- Diagnostics Entry: packages/api-server/src/runtime-task-submit-self-check.ts
- Verification Entry: .loom/progress/CORE-244.md
- Lane Entry: .loom/specs/CORE-244/plan.md

## Terminal Closeout Metadata

- Terminal State: merged
- Issue: 244
- PR: 249
- Merge Commit: 9101eaa6f42cc6584e8b428de5398f0c1f56539d
- Target Branch: main
- Closed At: 2026-07-08T10:39:22Z
- Evidence Locator: https://github.com/WebEnvoy/WebEnvoy/pull/249;https://github.com/WebEnvoy/WebEnvoy/actions/runs/28936264313;https://github.com/WebEnvoy/WebEnvoy/issues/243;https://github.com/WebEnvoy/WebEnvoy/issues/244;https://github.com/WebEnvoy/WebEnvoy/issues/245;https://github.com/WebEnvoy/WebEnvoy/issues/246;https://github.com/WebEnvoy/WebEnvoy/issues/247;https://github.com/WebEnvoy/WebEnvoy/issues/248
