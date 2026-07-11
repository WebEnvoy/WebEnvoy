# CORE-227 Implementation Contract

## Write Ownership

- `packages/core/src/runtime-task-chain.ts`
- `packages/api-server/src/server.ts`
- `packages/api-server/src/runtime-task-submit-self-check.ts`
- `packages/api-server/src/runtime-process-self-check.ts`
- `.loom/work-items/CORE-227.md`
- `.loom/progress/CORE-227.md`
- `.loom/specs/CORE-227/**`
- `.loom/status/current.md`
- `.loom/bootstrap/init-result.json`

## Read Scope

- Core runtime task chain and focused API self-check.
- Harbor merge `387265eb`, especially allowlisted read-operation and BOSS probe contracts.
- Lode canonical pin `e36a4a7` and BOSS job-search package assets.

## Acceptance

- Exact BOSS query/city reaches Harbor after admission.
- API Server accepts only exact BOSS `query/city_code/page/limit`, requires `page=1`, caps `limit` at 15 and BOSS query at 80 characters, while non-BOSS tasks remain query-only.
- Only operation-specific public summaries can create a successful BOSS Run Record.
- Pin, session/control/challenge, refs, post-check, and unknown-outcome failures fail closed.
- XHS remains valid under its own exact summary contract.
- Core persists no raw or sensitive browser material.
