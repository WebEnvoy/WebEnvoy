# Plan

## Implementation Goal

- Add the Core-side attribution slice required by App Library read task launch.
- Keep Core as task intent/admission/run/result truth owner while consuming Lode refs and Harbor evidence refs only.

## Phases

### Phase 1

- Objective: Extend capability attribution fixtures with source and lock refs.
- Deliverable: schema/runtime fixture updates.
- Exit condition: targeted Core/schema tests pass.

### Phase 2

- Objective: Preserve attribution through run record/query/result fixtures.
- Deliverable: conformance fixture updates.
- Exit condition: repo test suite passes.

## Validation

- `pnpm test -- --runInBand`
- `git diff --check`
- `loom suite validate --target . --item CORE-147 --json`
- `loom suite evidence validate --target . --item CORE-147 --json`
- `loom suite carrier validate --target . --item CORE-147 --json`
- `loom fact-chain --target . --json`
- `loom verify --target . --json`

## Dependencies

- Consumes Lode package refs/version/source/lock facts from Lode #153.
- App #146 consumes Core task projection attribution.
- Harbor remains evidence-ref owner and raw evidence stays out of Core.

## Ready For Review

- [x] Scope and non-goals are explicit.
- [x] Tests cover the attribution fixture path.
- [x] Core does not store package bodies, raw evidence, credentials, or App UI state.
