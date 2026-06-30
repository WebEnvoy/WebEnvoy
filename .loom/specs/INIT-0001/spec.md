# Spec

## Goal

Repair the Loom PR merge gate workflow so GitHub Actions evaluates the checked out repository, while leaving the Work Item binding to the PR body.

## Scope

- In scope: `.github/workflows/loom-check.yml` gate command for PR checks.
- Out of scope: product boundary documents, product behavior, Loom CLI internals, and global gate policy.

## Behavior

- `loom-pr-merge-gate` calls `loom flow pr-gate check --target "$GITHUB_WORKSPACE" --pr <number> --head-sha <sha> --json`.
- The workflow does not pass `--item INIT-0001`; gate reads the real `Loom Work Item` from the PR body.
- Repair PR body may use `Loom Work Item: INIT-0001` because this repair is part of Loom bootstrap/adoption repair.

## Validation

- `git diff --check`
- `loom doctor --target <repair-worktree-abs> --json`
- `loom verify --target <repair-worktree-abs> --json`
- `loom fact-chain --target <repair-worktree-abs> --json`
- CI stable checks: `py-compile`, `demo-bootstrap`, `repo-local-cli`, `loom-check`
- Local gate readback proves owner/repo, PR body Work Item, and fact-chain are readable without workflow hardcoded item.

## Suite Applicability

- Suite path: not_applicable
- Artifact: suite-level
- Rationale: This PR changes only workflow invocation for Loom gate plumbing and does not change product code, runtime behavior, schema, API, or user-facing docs semantics.
- Consumer boundary: This N/A applies only to the workflow/gate repair in this PR and only to the current repair PR head.
- Recheck condition: Re-run suite applicability and workflow validation if product code changes, workflow inputs change, runner checkout behavior changes, Loom CLI version changes, or the PR head changes.
