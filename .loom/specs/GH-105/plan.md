# Plan

## Implementation

1. Read current Core Run Record, task submission, schema, fixture, conformance, and ADR result/failure boundaries.
2. Add a narrow Core result envelope helper for terminal success and terminal structured failure.
3. Reuse the existing Run Record store lifecycle instead of adding a result store or query layer.
4. Tighten Result Envelope schema so `ok` is required and failure category/phase match the public Run Record taxonomy.
5. Add a failure Result Envelope fixture beside the existing success fixture.
6. Extend core self-check and conformance to cover success envelope, failure envelope, Run Record terminal fields, and refs-only/private-field rejection.
7. Add GH-105 item-specific Loom carriers and current status alignment.
8. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep implementation dependency-free and limited to existing core/schemas/conformance packages.
- Do not implement API query routes, UI, smoke, Harbor runtime calls, Lode package consumption, execution workers, database storage, generated clients, complex recovery, or true writes.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not close FR #95 until GH-105 is merged, GH-105 is closed, all sub-issues are closed, blockedBy dependencies are closed, and post-merge evidence is complete.

## Validation

- `pnpm --filter @webenvoy/core-runtime typecheck`
- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/schemas test`
- `pnpm conformance`
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `git diff --check`
- `jq empty .loom/specs/GH-105/build-evidence.json`
- `loom doctor --target . --json`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-105 --json`
- `loom suite carrier validate --target . --item GH-105 --json`
- `loom suite evidence validate --target . --item GH-105 --json`
- packaged `loom_flow.py flow build --target . --item GH-105 --build-evidence .loom/specs/GH-105/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #105 only.
- After GH-105 is merged and closed, the controller must close FR #95 only after confirming GH-101 through GH-105 are closed, blockedBy dependencies are closed, hosted checks and merge evidence are recorded, and post-merge carrier closeout is complete.
