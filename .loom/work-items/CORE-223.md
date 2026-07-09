# CORE-223

## Static Facts

- Item ID: CORE-223
- Goal: Consume Harbor #234 site-resource facts in Core runtime admission so App-submitted real-site read-only tasks fail closed unless Harbor public runtime facts satisfy Lode resource requirements.
- Scope: Core/WebEnvoy ownership only. This batch adds Core HTTP client calls to Harbor `/runtime/sessions/{runtime_session_ref}/site-resource-facts`, maps Harbor site facts into Core resource admission facts, preserves existing snapshot/evidence-ref verification, and extends API self-checks with a no-external Xiaohongshu package path.
- Execution Path: work/core-223-harbor-site-facts
- Workspace Entry: /Volumes/2T/dev/WebEnvoy/.worktrees/WebEnvoy-core-223-harbor-site-facts
- Recovery Entry: .loom/progress/CORE-223.md
- Review Entry: .loom/reviews/CORE-223.json
- Validation Entry: pnpm exec tsc -p packages/core/tsconfig.json --noEmit; pnpm --filter @webenvoy/core-runtime build; pnpm exec tsc -p packages/api-server/tsconfig.json --noEmit; pnpm --filter @webenvoy/api-server test; pnpm --filter @webenvoy/core-runtime test; pnpm typecheck; git diff --check; loom fact-chain/suite/carrier/evidence after carrier creation.
- Closing Condition: PR ready, merge, post-merge closeout for Core #223/#243 resource admission evidence, without closing final App E2E issues until App-driven live runtime evidence exists.

## Covered Issues

- #223 executes real runtime admission and resource checks.
- #243 receives App real task submission and drives Harbor/Lode run record/result/evidence refs, for the resource-admission slice only.
- #244 submit/admission API, because the admission API now consumes Harbor #234 site facts when package refs identify Xiaohongshu/BOSS packages.

## Explicitly Not Covered

- App, Harbor, or Lode code changes.
- Real Xiaohongshu/BOSS page access, real accounts, browser profile/Cookie import, production page operation, or external visible action.
- BOSS live E2E, identity environment management, true write, submit, publish, send, save, hosted browser, marketplace, bulk collection, or risk-control bypass.
- Final App #14/Core #13 milestone closeout.

## Ownership Constraints

- Writes limited to Core runtime task chain, focused API self-checks, and CORE-223 Loom carriers.
- No subagent edits were integrated; subagent outputs were read-only planning evidence.

## Subagent-Driven Ownership Contract

- task_goal: Consume Harbor #234 site-resource facts in Core runtime admission.
- context_locators: packages/core/src/runtime-task-chain.ts; packages/api-server/src/runtime-task-submit-self-check.ts; https://github.com/WebEnvoy/WebEnvoy/issues/223; https://github.com/WebEnvoy/Harbor/issues/234; https://github.com/WebEnvoy/Lode/issues/252.
- read_scope: Core Harbor runtime client, Lode resource requirement admission, API task submit self-check, Harbor #234 endpoint contract, Lode Xiaohongshu/BOSS package refs.
- write_ownership: packages/core/src/runtime-task-chain.ts; packages/api-server/src/runtime-task-submit-self-check.ts; .loom/work-items/CORE-223.md; .loom/progress/CORE-223.md; .loom/specs/CORE-223/**; .loom/status/current.md; .loom/bootstrap/init-result.json fact_chain entry.
- non_goals: No App/Harbor/Lode code changes; no real browser/account/profile/Cookie/production page access; no submit/publish/send/save; no hosted browser, marketplace, bulk collection, or risk-control bypass.
- validation_expectation: Core/API typecheck and tests pass; API self-check proves Harbor #234 site-resource facts success and unknown required fact fail-closed behavior; Loom fact-chain/suite/carrier/evidence pass.
- output_format: PR-ready code diff, carrier diff, validation commands/results, risk boundary, and downstream App E2E blocker status.
- integration_target: Core #223 PR and Core #243/App #265 downstream live E2E.

## Associated Artifacts

- `.loom/work-items/CORE-223.md`
- `.loom/progress/CORE-223.md`
- `.loom/specs/CORE-223/spec.md`
- `.loom/specs/CORE-223/plan.md`
- `.loom/specs/CORE-223/task-carrier.md`
- `.loom/specs/CORE-223/evidence-map.md`
- `.loom/specs/CORE-223/build-evidence.json`
- `packages/core/src/runtime-task-chain.ts`
- `packages/api-server/src/runtime-task-submit-self-check.ts`
