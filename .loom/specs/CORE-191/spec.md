# CORE-191 Story Readiness

## Story Readiness

- User value: Core can bind a submitted task to a real Harbor identity environment and browser session while preserving Core as the task/run truth source.
- Success experience: a read or validate-only Core task consumes Harbor identity environment facts, runtime session facts, page scene refs, and evidence refs; Run Record admission stores public refs/status only and records the binding as a Core task run.
- Failure states: missing identity environment, expired/manual-auth-required identity, missing storage, unavailable provider, runtime missing/busy/expired/unreachable, identity/runtime mismatch, missing or unavailable page scene, resource mismatch, and raw/private Harbor material all fail closed with structured failure codes.
- Sensitive data boundary: Core stores identity/runtime/session/provider/profile/viewer/snapshot/refmap/source/evidence refs and public status facts only; it rejects passwords, verification codes, cookies, tokens, browser storage values, profile paths, raw DOM/HAR/screenshots/video, CDP/VNC/websocket endpoints, and provider private objects.
- Non-goals: Harbor #160 live evidence, real account login, cookie/token/profile storage ingestion, App UI, Lode site execution, true writes, browser process control, hosted runtime, merge, issue closeout, or current pointer retire.
- Dependency facts: consumes Harbor #177 provider facts, #157 local identity environment facts, #158 runtime session/control facts, and #159 identity consistency/readiness facts; Harbor #160 live evidence remains out of scope.

## Suite Path

- Suite path: minimal
- full-path-artifacts not_applicable rationale: bounded Core admission/Run Record/schema fixture slice for real identity/session public refs; consumer boundary: App/Core/Lode consume refs, readiness state, controller/session-use status, failure codes, and no-private-material guarantees only; recheck condition: switch to full suite when adding live Harbor #160 evidence, true runtime execution, App UI, Lode site execution, real external account/profile material, hosted runtime, true writes, or release/closeout changes.
