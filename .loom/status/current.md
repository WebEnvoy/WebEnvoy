# Current Status

## Derived Fact Chain View

- Item ID: GH-91
- Goal: Upgrade the repository Loom runtime workflow pin to 0.25.0.
- Scope: Runtime-upgrade-only maintenance PR that updates `.github/workflows/loom-check.yml`, declares the v0.25 PR metadata carrier in `.loom/companion/repo-interface.json`, and records item-specific Loom carrier evidence.
- Execution Path: ci-maintenance/loom-runtime-upgrade
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-91.md
- Review Entry: .loom/reviews/GH-91.json
- Validation Entry: `git diff --check`; `jq empty .loom/companion/repo-interface.json`; `loom suite validate --item GH-91`; `loom runtime-upgrade check --item GH-91`; hosted GitHub checks for PR #92.
- Closing Condition: PR #92 is merged, runtime-upgrade closeout evidence is recorded, issue #91 is closed, and main reads back Loom workflow pin 0.25.0.
- Current Checkpoint: merge
- Current Stop: Merge-ready carrier refresh for the Loom 0.25.0 runtime-upgrade maintenance PR.
- Next Step: Run PR gate and hosted checks for PR #92 at the current head, then merge only if they pass.
- Blockers: None recorded.
- Latest Validation Summary: The initial PR updated the workflow pin to 0.25.0 and added the v0.25 repo metadata declaration/spec. Hosted checks consumed v0.25.0 and exposed that fact-chain and semantic review must be item-specific for GH-91; this refresh aligns the current fact-chain and records workflow-only review evidence. Product/runtime tests remain not applicable.
- Recovery Boundary: Runtime-upgrade-only maintenance. Re-review if the diff touches product code, product docs semantics, schema/API/runtime behavior, fixtures, releases, workstation plugin/cache state, or dependencies unrelated to Loom.
- Current Lane: merge-ready

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-91.md
- Lane Entry: ci-maintenance

## Sources

- Static Truth: .loom/work-items/GH-91.md
- Dynamic Truth: .loom/progress/GH-91.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json

## Notes

- 2026-07-01: Runtime-upgrade carrier refreshed for Loom 0.25.0 maintenance PR #92; this does not claim product or runtime implementation.
