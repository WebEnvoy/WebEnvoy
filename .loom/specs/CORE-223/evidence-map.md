# CORE-223 Evidence Map

| Evidence ID | Evidence Type | Source Locator | Consumes | Binding | Freshness | Consumer Boundary | Remediation Direction |
|---|---|---|---|---|---|---|---|
| EV-001 | issue_tree_evidence | https://github.com/WebEnvoy/WebEnvoy/issues/223 https://github.com/WebEnvoy/WebEnvoy/issues/243 https://github.com/WebEnvoy/App/issues/265 https://github.com/WebEnvoy/Harbor/issues/234 | Core runtime admission/resource checks and App downstream E2E dependency | CORE-223 scope | present | planning/review only | Re-read before PR metadata, review, or closeout. |
| EV-002 | behavior_evidence | .loom/specs/CORE-223/spec.md | S-001/S-002/S-003/S-004/S-005/S-006 behavior and non-goal boundaries | CORE-223 acceptance | present | Core PR review only | Refresh after behavior or boundary changes. |
| EV-003 | implementation_evidence | packages/core/src/runtime-task-chain.ts | Harbor #234 site-resource facts fetch, normalization into Core resource facts, existing snapshot/evidence validation preservation | CORE-223 Core implementation | present | Core refs-only runtime behavior | Rerun typecheck/tests after changes. |
| EV-004 | test_evidence | packages/api-server/src/runtime-task-submit-self-check.ts | No-external mock Lode Xiaohongshu package and mock Harbor site-resource facts success/fail-closed assertions | CORE-223 validation | present | Mock evidence only; not live runtime evidence | Supplement with live App E2E only after explicit user permission. |
| EV-005 | validation_evidence | .loom/specs/CORE-223/build-evidence.json | Focused validation commands and results | CORE-223 readiness | present | Core PR review only | Refresh after commit/head change. |
| EV-006 | fresh_verification_input | .loom/progress/CORE-223.md | EV-002 EV-003 EV-004 EV-005 | CORE-223 current behavior and validation evidence | present | Core PR review only | Refresh after validation, branch/head, PR metadata, or carrier changes. |
| EV-007 | non_goal_evidence | .loom/work-items/CORE-223.md | Prohibited actions and excluded repos | CORE-223 safety boundary | present | No App/Harbor/Lode mutation and no external visible action | Recheck if scope changes. |

## Local Evidence

- `pnpm exec tsc -p packages/core/tsconfig.json --noEmit`: pass on 2026-07-09T12:35Z UTC.
- `pnpm --filter @webenvoy/core-runtime build`: pass on 2026-07-09T12:35Z UTC.
- `pnpm exec tsc -p packages/api-server/tsconfig.json --noEmit`: pass on 2026-07-09T12:36Z UTC.
- `pnpm --filter @webenvoy/api-server test`: pass on 2026-07-09T12:36Z UTC.
- `pnpm --filter @webenvoy/core-runtime test`: pass on 2026-07-09T12:36Z UTC.
- `pnpm typecheck`: pass on 2026-07-09T12:36Z UTC.
- `git diff --check`: pass on 2026-07-09T12:36Z UTC.

## Runtime Boundary

Evidence is no-external mock Harbor/Lode contract validation only. No real Xiaohongshu/BOSS account, profile, Cookie, production page, browser session, submit, publish, send, save, hosted browser, marketplace, bulk collection, or risk-control bypass occurred.
