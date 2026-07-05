# Implementation Contract

## Ownership

- Core owns Result Envelope, Run Record, and post-check persistence boundaries.
- Lode owns output schema identity and package/catalog truth.
- Harbor owns runtime/session/evidence refs and raw/private evidence.

## Allowed Edits

- `packages/core/src/result-envelope.ts`
- `packages/core/src/self-check.ts`
- `packages/schemas/schemas/result-envelope.schema.json`
- `packages/schemas/fixtures/result-envelope-success.fixture.json`
- `.loom/**/CORE-151*`
- `.loom/status/current.md`
- `.loom/bootstrap/init-result.json`

## Forbidden Edits

- No Lode package truth, Harbor raw evidence, App UI state, private material, hosted runtime, or Stage 6 behavior.

## Verification

- pnpm --filter @webenvoy/core-runtime test
- pnpm --filter @webenvoy/schemas test
- pnpm --filter @webenvoy/conformance test
- pnpm --filter @webenvoy/conformance smoke
- pnpm typecheck
- git diff --check
- loom suite validate --target . --item CORE-151 --json
- loom suite evidence validate --target . --item CORE-151 --json
- loom suite carrier validate --target . --item CORE-151 --json
- loom fact-chain --target . --json
- loom verify --target . --json
