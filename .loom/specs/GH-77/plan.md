# Plan

## Implementation

- Change only `.github/workflows/loom-check.yml` from `LOOM_VERSION: 0.21.1` to `LOOM_VERSION: 0.22.1`.
- Keep the existing packaged `loom_flow.py` gate entry unchanged.
- Bind PR #76 to GH-77 with minimum workflow-only Loom carrier evidence.

## Validation

- `git diff --check`
- Verify `.github/workflows/loom-check.yml` contains `LOOM_VERSION: 0.22.1` and no `0.21.1` pin.
- Read back PR body `Loom Work Item`, branch, head SHA, and repository.
- Hosted GitHub Actions checks: py-compile, demo-bootstrap, repo-local-cli, loom-check, loom-pr-merge-gate.

## Closeout

- After merge, record PR URL, PR head, merge commit, target branch, hosted run, and issue closeout evidence.
