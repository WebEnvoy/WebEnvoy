# Current Status

## Derived Fact Chain View

- Item ID: GH-42
- Goal: 收敛 Core 引用和版本归属合同 v0，并同批覆盖 Core #41/#42/#43。
- Scope: docs-only ADR plus GH-42 item-specific Loom carrier; ownership is limited to allowed docs and GH-42 carrier files.
- Execution Path: docs-only/core-reference-version-v0
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-42.md
- Review Entry: .loom/reviews/GH-42.json
- Validation Entry: `git diff --check`; JSON validation; Loom fact-chain / suite / carrier checks; hosted checks after PR creation.
- Closing Condition: PR reaches PR Ready for WebEnvoy/WebEnvoy#41/#42/#43; no merge and no issue closeout in this thread.
- Current Checkpoint: closed_out
- Current Stop: Post-merge carrier closeout recorded for WebEnvoy/WebEnvoy#65.
- Next Step: No further action for GH-41/GH-42/GH-43 after coordinator issue closeout comments are posted and covered issues are closed.
- Blockers: None recorded.
- Latest Validation Summary: Post-merge closeout consumed PR #65, head 0aa1fbc7af4e7b3003bf3fe4b70811da63389285, merge commit 1062ab2308284bb05b18f351901a5e7996a3e307, target branch main, and hosted run 28442669022 with all required checks passing.
- Recovery Boundary: Terminal carrier for docs-only Core reference/version ownership contract; open new Work Items for schema/API/runtime/storage/evidence/viewer/App behavior.
- Current Lane: terminal closeout

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-42.md
- Lane Entry: core

## Sources

- Static Truth: .loom/work-items/GH-42.md
- Dynamic Truth: .loom/progress/GH-42.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
