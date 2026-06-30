# Current Status

## Derived Fact Chain View

- Item ID: GH-20
- Goal: 用最小 docs-only PR 收敛第一阶段 Core 首个低风险只读任务楔子和研究吸收边界。
- Scope: 更新现有 ADR 中的责任路径、字段族和边界表；新增本事项最小 Loom carrier。
- Execution Path: docs-only/boundary-spine
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-20.md
- Review Entry: .loom/reviews/GH-20.json
- Validation Entry: `git diff --check`; Loom direct hosted-equivalent entry or available local gate; hosted Loom checks
- Closing Condition: PR 创建并通过 required checks；本线程不 merge、不关闭 issue。
- Current Checkpoint: merge
- Current Stop: PR #35 is ready for hosted merge gate consumption as a docs-only boundary spine; do not merge or close issues in this thread.
- Next Step: Let hosted `loom-pr-merge-gate` consume the GH-20 merge checkpoint; no host merge in this thread.
- Blockers: none
- Latest Validation Summary: git diff --check passed; PR metadata preflight passed; hosted py-compile/demo-bootstrap/repo-local-cli/loom-check passed on run 28426605340; hosted pr-gate pre-sync consumed GH-20 with no missing inputs and only the merge checkpoint blocker.
- Recovery Boundary: Continue from this branch and GH-20 carrier; do not reuse INIT-0001 or GH-32.
- Current Lane: docs-only boundary spine

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: loom verify --target . --json
- Lane Entry: not_applicable

## Sources

- Static Truth: .loom/work-items/GH-20.md
- Dynamic Truth: .loom/progress/GH-20.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
