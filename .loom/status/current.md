# Current Status

## Derived Fact Chain View

- Item ID: GH-38
- Goal: 定义 Task Intent Envelope v0，并同批收敛 FR #37 下 GH-39 Run 生命周期与 GH-40 准入前失败 / Run Record 创建规则。
- Scope: docs-only contract ADR plus minimal item-specific Loom carrier for GH-38; ownership is limited to allowed docs and GH-38 carrier files.
- Execution Path: docs-only/core-task-run-lifecycle-v0
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-38.md
- Review Entry: .loom/reviews/GH-38.json
- Validation Entry: `git diff --check`; available low-cost repository and Loom local checks; hosted checks after PR creation.
- Closing Condition: PR #61 merged into `main`; hosted required checks passed; issue closeout is owned by the coordinator as the next external step.
- Current Checkpoint: closed_out
- Current Stop: Post-merge carrier closeout recorded for WebEnvoy/WebEnvoy#61.
- Next Step: No further action for GH-38/GH-39/GH-40 after coordinator issue closeout comments are posted and covered issues are closed.
- Blockers: None
- Latest Validation Summary: Post-merge closeout consumed PR #61, head 68ac1da8bf7d69c53c536c81df1891ab552a1ad7, merge commit 51ddf5515244123768c5c3af31b2243c2ab32226, target branch main, and hosted run 28437893051 with all required checks passing.
- Recovery Boundary: Terminal carrier for docs-only Core task/run lifecycle contract; open new Work Items for schema/API/runtime implementation.
- Current Lane: terminal closeout

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-38.md
- Lane Entry: core

## Sources

- Static Truth: .loom/work-items/GH-38.md
- Dynamic Truth: .loom/progress/GH-38.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
