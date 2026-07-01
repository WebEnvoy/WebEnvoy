# Implementation Contract

## Allowed Changes

- `.github/workflows/loom-check.yml`: Loom runtime version pin only.
- `.loom/companion/repo-interface.json`: v0.25 PR metadata carrier declaration only.
- `.loom/specs/GH-91/**`, `.loom/work-items/GH-91.md`, `.loom/progress/GH-91.md`, `.loom/reviews/GH-91*.json`, `.loom/status/current.md`, and `.loom/bootstrap/init-result.json`: item-specific Loom maintenance carrier evidence only.

## Forbidden Changes

- Product behavior, product docs semantics, roadmap scope, issue-tree planning, code skeletons, schema/API/runtime implementation, fixtures, releases, and workstation plugin/cache state.

## Validation

- `git diff --check` must pass.
- `jq empty .loom/companion/repo-interface.json` must pass.
- `loom suite validate --target . --item GH-91 --json` must return not_applicable without missing inputs.
- `loom runtime-upgrade check --target . --to 0.25.0 --item GH-91 --pr 92 --branch work/loom-runtime-0.25.0 --head-sha <head> --json` must pass.
- Hosted checks for WebEnvoy/WebEnvoy PR #92 must pass before merge.
