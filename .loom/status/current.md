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
- Current Checkpoint: build
- Current Stop: Docs-only reference/version ownership contract drafted for Core #41/#42/#43.
- Next Step: Open PR, run hosted checks, then hand back to coordinator for review/merge/closeout.
- Blockers: None recorded.
- Latest Validation Summary: 2026-06-30 local validation passed: `git diff --check`, JSON validation, `loom_flow.py fact-chain`, `loom suite validate`, and `loom suite carrier validate`; hosted checks pending PR creation.
- Recovery Boundary: Do not implement schema/API/runtime/storage/evidence/viewer code in this Work Item.
- Current Lane: core-reference-version-contract

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-42.md
- Lane Entry: core-reference-version-contract

## Sources

- Static Truth: .loom/work-items/GH-42.md
- Dynamic Truth: .loom/progress/GH-42.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
