# Plan

## Implementation

- Replace the PR gate workflow command with the direct Loom flow entry and explicit `$GITHUB_WORKSPACE` target.
- Do not hardcode `--item`; keep Work Item binding in the PR body.
- Do not modify product boundary document semantics.

## Validation

- Run `git diff --check`.
- Run `loom doctor --target <repair-worktree-abs> --json`.
- Run `loom verify --target <repair-worktree-abs> --json`.
- Run `loom fact-chain --target <repair-worktree-abs> --json`.
- Confirm local gate reads owner/repo, PR body Work Item, and fact-chain without `--item`.
- Confirm GitHub Actions runs the updated command.

## Rollback

Revert the workflow line if the direct flow entry regresses.
