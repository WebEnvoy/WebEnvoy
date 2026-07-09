# CORE-244 Spec

## Goal

Core accepts a read-only task request from App/API, resolves the referenced Lode package asset, calls Harbor local runtime API for runtime/session/snapshot/evidence refs, and persists a refs-only Run Record.

## Suite Path

- Suite path: minimal
- Path decision: this worker delivers a bounded Core-only implementation slice with focused mock-runtime validation and item-specific carriers; full suite, PR metadata, hosted gate, live Harbor evidence, merge, and issue closeout stay with the main controller.
- contracts.md not_applicable rationale: no new cross-repo contract truth is authored; Core consumes the Harbor/Lode endpoints and refs named in issue context. Consumer boundary: worker handoff and review. Recheck condition: require contracts.md if Harbor/Lode field semantics or ownership change.
- readiness-checklist.md not_applicable rationale: readiness is recorded in `.loom/progress/CORE-244.md` and final worker handoff, with PR/hosted readiness left to the main controller. Consumer boundary: worker handoff only. Recheck condition: require checklist before PR ready or merge-ready.
- research.md not_applicable rationale: required issue/ADR/roadmap context was read directly and no new research decision is introduced. Consumer boundary: scope verification only. Recheck condition: require research.md if upstream API behavior is uncertain or changes.
- suite-index.md not_applicable rationale: minimal suite path is declared here and artifacts are directly locatable under `.loom/specs/CORE-244/`. Consumer boundary: suite validation and worker handoff. Recheck condition: require suite-index.md if this becomes a full suite PR lane.
- Provenance: Core #243/#244/#245/#246/#247/#248, Harbor #218, and Lode #252 read back on 2026-07-08 UTC.

## Scenarios

- S-001 submit/admission API: POST `/tasks` accepts a task intent, run id, package ref, and Harbor binding hint, then returns a Run Record.
- S-002 Lode asset resolution: Core reads Lode registry/manifest/resource requirements and passes only the admission contract into Core runtime admission.
- S-003 Harbor runtime API: Core calls GET `/readiness`, GET `/runtime/browser-providers`, POST `/runtime/identity-environment-sessions`, POST `/runtime/sessions/{ref}/snapshot`, and GET `/runtime/evidence/{ref}`.
- S-004 fail closed: missing/unready Harbor runtime or an invalid/cross-origin Harbor page scene writes a terminal failed/blocked Run Record and never returns real success or a lingering `admitted` state.
- S-005 no leakage: Run Record stores refs/status/failure only, not raw evidence, cookies, tokens, DOM, HAR, screenshots, or provider endpoints.

## Non-Goals

No App UI, no Harbor/Lode code changes, no real site/account/profile/Cookie use, no true write, no Lode runtime runner, no PR/push/issue closeout.
