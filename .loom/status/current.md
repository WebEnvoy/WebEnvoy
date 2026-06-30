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
- Closing Condition: PR to `main` opened and ready for review for GH-38 / GH-39 / GH-40; no merge and no issue closeout in this execution thread.
- Current Checkpoint: build
- Current Stop: PR #61 opened for docs-only GH-38/GH-39/GH-40 contract convergence.
- Next Step: Keep PR open for review; do not merge or close issues in this execution thread.
- Blockers: PR-ready none; merge-ready remains blocked until authored current-head Loom review evidence exists.
- Latest Validation Summary: 2026-06-30T10:10Z local checks: `git diff --check` pass; Python compile not_applicable because no Python files are tracked; `loom doctor --target /Volumes/2T/.codex/worktrees/stage2/core-task-run-lifecycle --json` pass; `loom verify --target /Volumes/2T/.codex/worktrees/stage2/core-task-run-lifecycle --json` pass; `loom fact-chain --target /Volumes/2T/.codex/worktrees/stage2/core-task-run-lifecycle --json` pass; `loom installed-state validate --target /Volumes/2T/.codex/worktrees/stage2/core-task-run-lifecycle --json` pass; `loom suite validate --target /Volumes/2T/.codex/worktrees/stage2/core-task-run-lifecycle --item GH-38 --json` pass; `loom suite carrier validate --target /Volumes/2T/.codex/worktrees/stage2/core-task-run-lifecycle --item GH-38 --json` pass; `loom build --target /Volumes/2T/.codex/worktrees/stage2/core-task-run-lifecycle --item GH-38 --build-evidence .loom/specs/GH-38/build-evidence.json --json` blocked only because the build flow looks for repo-local `tools/loom.py` suite JSON, while this repo's workflow uses global `loom`; classified as local tool-path mismatch, not contract drift. PR #61 opened at https://github.com/WebEnvoy/WebEnvoy/pull/61.
- Recovery Boundary: Docs-only contract convergence for GH-38/GH-39/GH-40; do not implement API/runtime/schema, do not merge, and do not close issues.
- Current Lane: core

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
