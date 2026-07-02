# Plan

## Implementation

1. Read current Run Record, Result Envelope, API Server, ADR, and contract boundaries.
2. Add a narrow Core run summary projection over existing Run Record truth.
3. Add a store-backed Core run query helper with structured `phase=query` failures.
4. Add API Server `GET /runs/:run_id` backed by an optional local Run Record store.
5. Bind executable API Server startup to `WEBENVOY_RUN_RECORD_DIR` for later smoke reuse.
6. Extend Core and API Server self-checks for success and safe failure query paths.
7. Add GH-106 item-specific Loom carriers and current status alignment.
8. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep implementation dependency-free except for the API Server workspace dependency on `@webenvoy/core-runtime`.
- Do not add result/evidence detail query, golden fixture, API/CLI smoke, write guardrail, App UI, SDK/MCP full entrypoints, history search, database/storage backends, real executor, raw evidence retrieval, or true writes.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not close FR #96 until GH-106 through GH-110 are merged, closed, and post-merge evidence is complete.

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
- `jq empty .loom/specs/GH-106/build-evidence.json`
- `loom doctor --target . --json`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-106 --json`
- `loom suite carrier validate --target . --item GH-106 --json`
- `loom suite evidence validate --target . --item GH-106 --json`
- packaged `loom_flow.py flow build --target . --item GH-106 --build-evidence .loom/specs/GH-106/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #106 only.
- After GH-106 is merged and closed, FR #96 remains open for GH-107 through GH-110.
