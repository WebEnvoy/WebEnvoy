# Plan

## Implementation

- Add `docs/adr/0008-core-technical-architecture-baseline.md`.
- Update `docs/contracts/README.md` with the ADR 0008 index row and future skeleton entry points.
- Update `AGENTS.md` with concise Core technical baseline constraints.
- Add GH-80 item-specific Loom carrier files under `.loom/work-items/GH-80.md`, `.loom/progress/GH-80.md`, and `.loom/specs/GH-80/`.
- Align `.loom/status/current.md` and `.loom/bootstrap/init-result.json` fact-chain entry points to GH-80 after classifying local Loom blocks as drift from closed-out GH-77.

## Constraints

- Docs-only.
- Use GH-80 as the primary real Work Item and state that the PR covers #79-#88.
- Use Refs in PR body, not automatic closing keywords.
- Modify `.loom/status/current.md` and `.loom/bootstrap/init-result.json` only for the classified current-item / fact-chain entry-point drift repair needed by local Loom validation.
- Do not modify other repositories.

## Validation

- `git diff --check`
- Markdown readability check for changed Markdown files.
- JSON readability check for `.loom/specs/GH-80/build-evidence.json`.
- `loom suite validate --target . --item GH-80 --json`
- `loom suite carrier validate --target . --item GH-80 --json`
- `loom build --target . --item GH-80 --build-evidence .loom/specs/GH-80/build-evidence.json --json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This execution thread stops at PR Ready.
- Merge-ready, semantic review, merge, issue closeout, and post-merge closeout evidence are coordinator-owned unless explicitly reassigned.
