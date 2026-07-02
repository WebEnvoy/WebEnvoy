# Plan

## Implementation

1. Read the existing GH-106/GH-107 query interfaces and the GH-108 golden fixture.
2. Add a repo-local conformance smoke script that seeds the golden fixture into a temporary file-backed Run Record store.
3. Add a narrow CLI query mode inside the smoke script that uses Core query helpers for run, result, and evidence-ref projections.
4. Start the API Server against the same temporary store and query the matching API endpoints.
5. Assert API responses exactly match CLI/Core projections for run, result, and evidence refs.
6. Add package/root smoke scripts and the minimal workspace package metadata needed for TypeScript consumption.
7. Update README/conformance docs with the smoke command and non-product-CLI boundary.
8. Add GH-109 item-specific Loom carriers and current status alignment.
9. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep implementation dependency-free.
- Reuse the GH-108 golden fixture; do not add another run fixture.
- Do not add write guardrail, App UI, SDK/MCP full entrypoints, formal product CLI, API submission path, history search, database/storage backends, real executor, raw evidence retrieval, or true writes.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not close FR #96 until GH-110 is merged, closed, and post-merge evidence is complete.

## Validation

- `pnpm --filter @webenvoy/conformance smoke`
- `pnpm smoke`
- `pnpm --filter @webenvoy/conformance typecheck`
- `pnpm --filter @webenvoy/conformance test`
- `pnpm --filter @webenvoy/api-server typecheck`
- `pnpm --filter @webenvoy/api-server test`
- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm conformance`
- `git diff --check`
- `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-109/build-evidence.json`
- `loom doctor --target . --json`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-109 --json`
- `loom suite carrier validate --target . --item GH-109 --json`
- `loom suite evidence validate --target . --item GH-109 --json`
- packaged `loom_flow.py flow build --target . --item GH-109 --build-evidence .loom/specs/GH-109/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #109 only.
- After GH-109 is merged and closed, FR #96 remains open for GH-110.
