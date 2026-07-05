# CORE-148

## Static Facts

- Item ID: CORE-148
- Goal: Provide Core capability attribution, post-check, failure attribution, and capability query facts for App Stage 5 read-only capability testing and evidence status.
- Scope: Covers Core #148/#149/#150/#153/#154/#155/#156/#157; excludes #151, App UI, Harbor raw evidence/runtime bodies, Lode package/repair truth, and Stage 6.
- Execution Path: stage5/core-capability-attribution-query
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-148.md
- Review Entry: .loom/reviews/CORE-148.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/api-server test; pnpm --filter @webenvoy/schemas test; pnpm --filter @webenvoy/conformance test; pnpm --filter @webenvoy/conformance smoke; pnpm typecheck; pnpm lint; git diff --check
- Closing Condition: App/API can consume Core run/capability attribution facts without Core storing package/run-session/raw evidence truth outside its owner boundary.

## Associated Artifacts

- `.loom/work-items/CORE-148.md`
- `.loom/progress/CORE-148.md`
- `.loom/reviews/CORE-148.json`
- `.loom/reviews/CORE-148.spec.json`
- `.loom/specs/CORE-148/spec.md`
- `.loom/specs/CORE-148/plan.md`
- `.loom/specs/CORE-148/implementation-contract.md`
- `.loom/specs/CORE-148/evidence-map.md`
- `.loom/specs/CORE-148/task-carrier.md`
- `packages/core`
- `packages/api-server`
- `packages/schemas`
- `packages/conformance`

## Boundaries

Core records refs, public summaries, failure taxonomy, and result envelopes. Lode remains capability/package/version truth owner. Harbor remains runtime/session/evidence body truth owner. App remains UI state owner.
