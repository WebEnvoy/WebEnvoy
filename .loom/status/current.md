# Current Status

## Derived Fact Chain View

- Item ID: GH-71
- Goal: 盘点 `docs/draft/` 文档归宿，并把 WebEnvoy Core 文档草稿收口 milestone 推到 PR Ready。
- Scope: docs-only closeout for docs directory semantics, draft lifecycle rules, draft inventory, accepted contract pointers, and GH-71 item-specific Loom carrier; ownership is limited to docs closeout files and GH-71 carrier files.
- Execution Path: docs-only/draft-closeout-core
- Workspace Entry: /Volumes/2T/.codex/worktrees/docs-draft-closeout/WebEnvoy
- Recovery Entry: .loom/progress/GH-71.md
- Review Entry: .loom/reviews/GH-71.json
- Validation Entry: `git diff --check`; `.loom/**/*.json` validation; available Loom fact-chain / suite / carrier checks; hosted checks after PR creation.
- Closing Condition: PR reaches PR Ready for WebEnvoy/WebEnvoy#69/#70/#71/#72/#73; no merge and no issue closeout in this thread.
- Current Checkpoint: build
- Current Stop: Docs-only draft closeout implemented locally; local validation passed; PR creation pending.
- Next Step: Commit, push, create PR, and record PR locator.
- Blockers: None recorded.
- Latest Validation Summary: `git diff --check` passed; `.loom/**/*.json` passed jq validation; `loom fact-chain --target /Volumes/2T/.codex/worktrees/docs-draft-closeout/WebEnvoy --json` passed; `loom suite validate --target /Volumes/2T/.codex/worktrees/docs-draft-closeout/WebEnvoy --item GH-71 --json` passed; `loom suite carrier validate --target /Volumes/2T/.codex/worktrees/docs-draft-closeout/WebEnvoy --item GH-71 --json` passed. `loom build` blocked on local wrapper input plumbing: suite validate/carrier CLI JSON unavailable via `tools/loom.py`, while the global suite commands passed.
- Recovery Boundary: Continue only docs-only closeout for GH-69/GH-70/GH-71/GH-72/GH-73. Do not merge, close issues, create code/schema/API/runtime/fixture behavior, or create `docs/guides/`.
- Current Lane: docs-draft-closeout

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-71.md
- Lane Entry: core-docs

## Sources

- Static Truth: .loom/work-items/GH-71.md
- Dynamic Truth: .loom/progress/GH-71.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
