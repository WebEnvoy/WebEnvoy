# CORE-271 Progress

- State: PR preparation
- Branch: `work/core-271-failure-lock-cleanup`
- Workspace: `.`
- Scope: #271 only; shared current/status carrier untouched.
- Implemented: exact owner/holder-verified release, stop fallback, fail-closed cleanup result, operation timeout abort, and startup recovery for interrupted non-terminal Core runs.
- Latest Validation Summary: `pnpm typecheck`, `pnpm test`, `pnpm lint`, targeted Core/API typecheck/tests, built-process startup recovery smoke, Loom minimal suite/carrier validation, and `git diff --check` pass on the current implementation tree.
- Fault coverage: admission/snapshot/evidence terminalization, read-operation unknown/timeout, exact owner/holder release, stop fallback, cleanup double failure, transient terminal persistence failure, restart recovery, and manual-owner preservation.
- Remaining: commit, current-head semantic review carrier, push, and ready PR.
- Blockers: None.
