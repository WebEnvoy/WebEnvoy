# Plan

## Implementation

1. Read current Run Record, Result Envelope, API Server, ADR, and contract boundaries.
2. Add narrow Core result and evidence-ref query projections over existing Run Record truth.
3. Add store-backed Core query helpers with structured `phase=query` failures.
4. Add API Server `GET /runs/:run_id/result` and `GET /runs/:run_id/evidence-refs` backed by the existing optional local Run Record store.
5. Extend Core and API Server self-checks for success, failure, redacted/unavailable state, missing run, and invalid run id paths.
6. Add GH-107 item-specific Loom carriers and current status alignment.
7. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep implementation dependency-free.
- Do not add golden fixture, API/CLI smoke, write guardrail, App UI, SDK/MCP full entrypoints, history search, database/storage backends, real executor, raw evidence retrieval, or true writes.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not close FR #96 until GH-107 through GH-110 are merged, closed, and post-merge evidence is complete.

## Validation

- `pnpm --filter @webenvoy/core-runtime typecheck`
- `pnpm --filter @webenvoy/core-runtime test`
- `pnpm --filter @webenvoy/api-server typecheck`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm lint`
- `git diff --check`
- `jq empty .loom/specs/GH-107/build-evidence.json`
- `loom doctor --target . --json`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-107 --json`
- `loom suite carrier validate --target . --item GH-107 --json`
- `loom suite evidence validate --target . --item GH-107 --json`
- packaged `loom_flow.py flow build --target . --item GH-107 --build-evidence .loom/specs/GH-107/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #107 only.
- After GH-107 is merged and closed, FR #96 remains open for GH-108 through GH-110.
