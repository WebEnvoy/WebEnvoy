# Implementation Contract

## Write Ownership

- `docs/adr/0003-result-envelope-and-run-record.md`
- `docs/adr/0004-admission-and-action-risk.md`
- `.loom/work-items/GH-45.md`
- `.loom/progress/GH-45.md`
- `.loom/specs/GH-45/**`
- `.loom/status/current.md`
- `.loom/bootstrap/init-result.json`

## Non-goals

- No schema/API/runtime/storage/evidence/viewer/App code.
- No Harbor/Lode/App changes.
- No merge or issue closeout in this content PR.
- No INIT-0001 carrier reuse.

## Consumer Boundary

Downstream consumers may cite ADR 0003/0004 for Stage 2 Result/Run/Query and Admission/Action Risk docs-only contracts. They must not treat this PR as implementation, generated schema, API behavior, storage, evidence capture, runtime validation, viewer behavior, or App UI completion.
