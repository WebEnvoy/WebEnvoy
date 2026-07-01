# Plan

## Scope

- Update the repository Loom workflow runtime pin to 0.25.0.
- Keep the v0.25 repo PR metadata carrier declaration readable by PR metadata preflight.
- Refresh item-specific Loom carriers so fact-chain, review, PR gate, and runtime-upgrade closeout consume GH-91.

## Steps

1. Read back global Loom CLI and Codex plugin payload version 0.25.0.
2. Apply the runtime-upgrade-only repository refresh.
3. Validate workflow pin, repo-interface JSON, PR metadata, suite path decision, and runtime-upgrade readback.
4. Run hosted checks for PR #92.
5. Merge only after PR gate and hosted checks pass for the same head.

## Excluded Changes

- Product code, product roadmap, schema/API/runtime behavior, fixtures, release publishing, and workstation plugin/cache mutation are outside this PR.

## Suite Path Rationale

- Suite-level not_applicable: rationale: this runtime-upgrade-only PR changes only the repository Loom workflow pin, v0.25 PR metadata declaration, and item-specific maintenance carriers; consumer boundary: suite validate, spec review, implementation review, PR gate, merge-ready, and closeout may consume this only as workflow/runtime-maintenance non-applicability and not as product readiness; recheck condition: require a real suite path if this PR changes product behavior, product docs semantics, code, schema/API/runtime behavior, fixtures, releases, workstation plugin/cache state, or dependencies unrelated to Loom.
