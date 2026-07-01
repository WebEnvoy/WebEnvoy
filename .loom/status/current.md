# Current Status

## Derived Fact Chain View

- Item ID: GH-80
- Goal: Freeze the Core TypeScript, Node.js, pnpm, schema, service-boundary, run-record, shared-entry, and cross-repo no-copy technical baseline for milestone #8.
- Scope: Docs-only baseline covering GH-79 through GH-88 by adding ADR 0008, updating the contracts index and AGENTS constraints, recording the minimum GH-80 Loom carrier and ownership constraints, and aligning `.loom/status/current.md` plus `.loom/bootstrap/init-result.json` fact-chain entry points so fact-chain resolves GH-80.
- Execution Path: docs-only/core-technical-baseline
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-80.md
- Review Entry: .loom/reviews/GH-80.json
- Validation Entry: `git diff --check`; Markdown/JSON readability checks; Loom suite/carrier/build validation; PR body/head readback.
- Closing Condition: PR is merged, post-merge closeout evidence is recorded, and covered issues remain open until coordinator closeout.
- Current Checkpoint: merge
- Current Stop: Merge-ready carrier prepared for docs-only technical baseline; hosted PR gate, merge and post-merge closeout are coordinator-owned next steps.
- Next Step: Create or update PR, read back PR body/head metadata, run hosted gate, merge, then write post-merge closeout evidence.
- Blockers: None recorded.
- Latest Validation Summary: Review artifact approves the docs-only Core 技术架构基线 at head a6d516b43b8d6a4ec76e5bfd70fc298b6c4e4928. The final PR head may differ only by Loom review/progress/status carrier refresh and PR metadata updates; no code, dependency, schema, runtime, generated artifact, UI behavior, or product semantics changed after the reviewed head.
- Recovery Boundary: Re-review if this branch adds code, package files, dependencies, OpenAPI, full JSON Schema, generated types, fixture files, conformance runner, runtime implementation, database choice, other repository changes, Loom carriers beyond GH-80/current status/bootstrap fact-chain entry points, issue closure, or merge.
- Current Lane: merge-ready

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-80.md
- Lane Entry: core-docs

## Sources

- Static Truth: .loom/work-items/GH-80.md
- Dynamic Truth: .loom/progress/GH-80.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
