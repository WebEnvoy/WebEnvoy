# CORE-195 Story Readiness

## Story Readiness

- User value: Core can turn a submitted real Xiaohongshu or BOSS read-only task into a durable, queryable Run Record that is attributed to the exact Lode package version and Harbor public runtime/evidence refs.
- Success experience: a Xiaohongshu search, Xiaohongshu note detail, BOSS job search, or BOSS job detail task admits against the Lode package/resource contract and Harbor public refs, enters running, completes with a public result envelope, and exposes Run Record/result/evidence/capability queries without private material.
- Failure states: missing or mismatched Lode package refs, invalid resource requirements, missing identity/runtime/evidence refs, cancellation, timeout, and user takeover are represented as structured Core states and failure codes, not fake successes.
- Sensitive data boundary: Core stores package refs, capability version/source/lock refs, resource requirement refs, identity/runtime/session/profile/provider/viewer/snapshot/refmap/source/evidence refs, public status, public failure code, and public projection state only; it rejects or avoids credentials, cookies, tokens, verification codes, profile storage, raw DOM/HAR/network, raw screenshot/video, CDP/VNC/websocket endpoints, viewer URLs, and private page content.
- Non-goals: App UI, Harbor/Lode/App code changes, live account operation, external visible action, captcha bypass, true writes, Stage 7 write-side behavior, batch tasks, #189/#190/#199-#206, merge, issue closeout, release evidence, or current pointer retire.
- Dependency facts: consumes Core #187/#191 real identity/session admission baseline, Lode milestone #13 Xiaohongshu/BOSS package/resource facts, and Harbor milestone #11 identity/runtime/evidence public facts; all are consumed as public refs/status facts only.

## Suite Path

- Suite path: minimal
- full-path-artifacts not_applicable rationale: bounded Core implementation slice for real-site read-only task execution, Run Record attribution, and interruption state expression; no live runtime operation, external write, new cross-repo schema authority, release, or closeout truth is added in this PR.
- full-path-artifacts consumer boundary: App, Harbor, and Lode consume Core refs/status/result query facts only; no private browser material or site package body is copied into Core.
- full-path-artifacts recheck condition: switch to full suite when adding live account execution, true write flows, App UI, Harbor/Lode code, release packaging, persistent scheduler semantics, or new cross-repo authoritative contracts.
