# CORE-226 Plan

## Implementation Goal

Reuse existing admission, Run Record store, result envelope, and query helpers. Add only the missing read-only projection slice and refs-only durable fields.

## Phases

### Phase 1

- Objective: Add read-only result projection helper.
- Deliverable: `read-only-result-projection.ts` maps Lode normalized read outputs and failure classes to Core result envelopes/failure records.
- Exit condition: core-runtime self-check covers Xiaohongshu/BOSS success and failure projections.

### Phase 2

- Objective: Persist projection/source refs.
- Deliverable: Run Record create/update/query/schema fixtures carry `result_kind`, `output_schema_id`, `projection_ref`, and `source_refs`.
- Exit condition: schema and conformance checks validate durable refs-only projection.

### Phase 3

- Objective: PR readiness.
- Deliverable: item-specific Loom carriers, validation evidence, commit, push, PR body, metadata readback/preflight.
- Exit condition: PR covers #225/#226/#227/#228/#229 and excludes #230-#234.

## Validation

- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm typecheck`
- `git diff --check`
- `loom fact-chain --target . --json`
- `loom verify --target . --json`
- `loom suite validate --target . --item CORE-226 --json`
- `loom suite carrier validate --target . --item CORE-226 --json`
- `loom suite evidence validate --target . --item CORE-226 --json`
- `loom build --target . --item CORE-226 --build-evidence .loom/specs/CORE-226/build-evidence.json --json`
- PR metadata readback/preflight after PR creation.

## Constraints

- No new dependencies, browser attach, live site access, true write, App UI, Harbor/Lode code, GitHub dependency graph edits, merge, or issue closeout.
- Core stores refs, result envelope metadata, failure reasons, and source attribution only.

## Ready For Review

- [x] Local code/schema/conformance/typecheck/diff validation passed on current worktree.
- [ ] Final Loom/suite checks passed on current head.
- [ ] PR metadata readback matches CORE-226 branch/head/repository and issue coverage.
