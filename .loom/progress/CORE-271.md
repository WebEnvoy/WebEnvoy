# CORE-271 Progress

- State: review findings fixed; current-head review pending
- Branch: `work/core-271-failure-lock-cleanup`
- Workspace: `.`
- Scope: #271 only; shared current/status carrier untouched.
- Implemented: exact owner/holder verification, bounded cleanup-sequence deadline, release/stop plus final GET proof, fail-closed cleanup result, operation timeout abort, and startup recovery for interrupted non-terminal Core runs.
- Latest Validation Summary: after fixing all three independent P1 findings, targeted Core/API typecheck/tests plus full `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `git diff --check` pass on the current implementation tree.
- Review Finding Resolution: cleanup GET/release/verify/stop/verify uses one bounded deadline and returns refs-only `core_task_session_cleanup_timeout`; task and restart recovery never-response tests pass.
- Review Finding Resolution: success requires final explicit idle/closed + owner none + lock owner none/released + null holder proof; owner-none/held and false top-level released/stopped regressions fail closed.
- Review Finding Resolution: session parsing primary failure/remediation remain unchanged while cleanup classification and opaque session ref are separately persisted in blocked post-check; dual-failure regression passes.
- Fault coverage: admission/snapshot/evidence terminalization, read-operation unknown/timeout, exact lock proof, cleanup timeout/double failure, inconsistent responses, transient terminal persistence failure, restart recovery, and manual-owner preservation.
- Previous Product Head: `1d733f24ec5a1e9608cf4669c0bbd2f20475893c` (superseded by this review-finding fix).
- Semantic Review: previous allow is superseded; current product head review pending after commit.
- Remaining: commit product fix, author current-head review carrier, push, and update PR metadata.
- Blockers: None.
