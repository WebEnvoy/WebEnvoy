# CORE-271 Spec

## Goal

Every Core task path that obtained a Harbor `core_task` session reaches a durable terminal state and releases that exact lock before success/failure projection. On restart, Core terminalizes non-terminal runs and reclaims only exact `core_task`/run-id matches.

## Suite Path

- Suite path: minimal
- This is a bounded Core runtime reliability correction using the existing Harbor session API and Run Record schema.
- contracts.md not_applicable rationale: no upstream schema or ownership change is authored. Consumer boundary: CORE-271 implementation review. Recheck condition: require `contracts.md` if Harbor/Lode/App contracts or ownership change.
- readiness-checklist.md not_applicable rationale: this PR supplies bounded runtime checks while live product E2E, merge, and closeout remain controller-owned. Consumer boundary: CORE-271 PR readiness. Recheck condition: require `readiness-checklist.md` when live E2E, release, merge, or closeout enters scope.
- research.md not_applicable rationale: current Core/Harbor source and issue #271 are sufficient authoritative inputs. Consumer boundary: CORE-271 implementation. Recheck condition: require `research.md` if the upstream session mechanism becomes ambiguous.
- suite-index.md not_applicable rationale: all minimal artifacts are directly located under `.loom/specs/CORE-271/`. Consumer boundary: suite validation and review. Recheck condition: require `suite-index.md` if governance escalates to full or adds artifact groups.

## Failure Matrix

| Stage | Primary terminal truth | Lock cleanup |
| --- | --- | --- |
| Pre-session validation/Lode failure | Existing admission failure | No lock exists |
| Session open/runtime parse failure | Original admission/runtime failure | Verify exact owner/holder, then release; stop fallback |
| Site facts/snapshot/evidence/admission failure | Existing structured failure and refs-only post-check | Release before returning terminal projection |
| Read operation unavailable/unknown/timeout | Original operation failure or unknown outcome | Abort on timeout; release before terminalization |
| Cancel intent rejected before admission | Existing cancellation/request failure | No session is opened; active-run cancellation is outside the current submit API |
| Result/evidence persistence failure | Persistence remains authoritative failure | Cleanup occurs before terminal write attempt |
| Release failure | Original failure remains primary when present | Stop fallback |
| Release and stop failure | Failed run, never success; `core_task_session_cleanup_failed` in post-check | Opaque session ref only |
| Process restart with non-terminal run | `core_task_interrupted` terminal failure | Reclaim only exact `core_task` + run-id holder |
| Manual/user/other owner | Unchanged | Never reclaimed |

## Non-Goals

No scheduler, retry queue, cross-repo contract change, live account/page action, submit/publish/send, or raw Harbor material persistence.
