# Implementation Contract

## Work Item

- Item: GH-80
- Execution Entry: .loom/progress/GH-80.md
- Covered Host Issues: #79, #80, #81, #82, #83, #84, #85, #86, #87, #88

## Approved Spec

- Spec Path: .loom/specs/GH-80/spec.md
- Spec Review Entry: .loom/reviews/GH-80.spec.json

## Implementation Scope

- In Scope: ADR 0008, contracts index, AGENTS technical baseline constraints, GH-80 carrier files, `.loom/status/current.md` current-item alignment, and `.loom/bootstrap/init-result.json` fact-chain entry-point alignment.
- Out Of Scope: code, package files, dependencies, OpenAPI, full JSON Schema, generated types, fixtures, runners, runtime, persistence, database choice, cross-repo edits, issue closure, merge, and closeout.

## Validation Plan

- Automated Checks: `git diff --check`; Markdown/JSON readability; Loom suite/carrier/build validation where available.
- Manual Verification: PR body uses Refs, covers #79-#88, binds branch `work/tech-baseline-core`, and head SHA matches the pushed branch.

## Risks And Rollback

- Risks: Local Loom suite templates may not exist in this repository; if validation blocks on missing template/runtime surface, classify as environment/tooling gap rather than product failure.
- Rollback Boundary: Revert this docs-only PR; no code, dependency, schema, runtime, database, or external state is created.

## Host Binding

- Pull Request: pending
- Reviewed Head: pending
