# CORE-221 Spec

## Goal

Build the Core admission spine for real Harbor sessions and real Lode Xiaohongshu/BOSS capabilities without running a live site task.

## Suite Path

- Suite path: full
- Path decision: reinforced governance because this touches Core admission, runtime identity/session facts, package locks, resource matching, and Run Record privacy boundaries.
- Provenance: GitHub issues #220/#221/#222/#223/#224 read back on 2026-07-06 UTC; Harbor #198/#203 closed public runtime-api exports; Lode #230 contract `docs/contracts/bb-sites-xhs-boss-absorption-freeze.md` read from `origin/main`.

## Scenarios

- S-001 Harbor binding: Given Harbor public identity environment, provider catalog, runtime facts, viewer/control facts, and scene refs, when Core admits a read task, then the Run Record stores refs/status only and carries `runtime_session_binding`.
- S-002 Lode package lock: Given a Xiaohongshu or BOSS package contract with package ref, source ref, lock ref, lifecycle, and resource requirements, when task intent references the same capability/version/lock, then Core admits the package without copying package body or source code.
- S-003 resource matching: Given Lode required Harbor facts and Harbor public resource facts, when a required fact is missing or stale, then Core blocks before execution with `resource_admission` and a precise missing fact code.
- S-004 private material rejection: Given task, Harbor, Lode, or direct Run Record input contains private browser material, when Core parses or persists the record, then Core rejects it before writing a Run Record.

## Boundaries

- In scope: Core admission types/checks, task submission wiring, Run Record private-field guard, self-checks, Loom carriers, PR metadata.
- Out of scope: App UI, Harbor code, Lode code, live external site run, real browser process attach, true write, hosted browser, marketplace, batch collection, CAPTCHA/risk bypass, raw evidence/material storage, merge, issue closeout.

## Acceptance Criteria

- [x] Core consumes Harbor provider status, local identity facts, runtime session refs, viewer/control refs, scene refs, and resource facts through public refs/status only.
- [x] Core consumes Lode Xiaohongshu/BOSS package refs, source refs, lock refs, lifecycle, and resource requirements.
- [x] Core validates Lode required Harbor facts against inferred and explicit Harbor public resource facts.
- [x] Core rejects private browser material and sensitive fields before direct Run Record persistence.
- [x] Targeted runtime, schema, conformance, typecheck, diff, Loom, and suite checks pass on the PR head before review.
