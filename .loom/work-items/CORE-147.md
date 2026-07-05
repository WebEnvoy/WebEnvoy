# CORE-147

## Static Facts

- Item ID: CORE-147
- Goal: Accept read-only capability refs on Core task intent and preserve attribution in run/result records
- Scope: Add capability source and lock refs to task intent capability, validate refs against Lode package contract, and expose attribution in run record/query/result fixtures
- Execution Path: stage5/read-only-capability-attribution
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-147.md
- Review Entry: .loom/reviews/CORE-147.json
- Validation Entry: pnpm test -- --runInBand && git diff --check
- Closing Condition: Core #147/#149/#153 capability attribution fixture is validated without storing Lode package bodies, Harbor raw evidence, or App UI state

## Associated Artifacts

- `.loom/work-items/CORE-147.md`
- `.loom/progress/CORE-147.md`
- `.loom/reviews/CORE-147.json`
- `.loom/status/current.md`
- `packages/schemas`
- `packages/core`
- `packages/conformance`
