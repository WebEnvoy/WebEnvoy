# Plan

## Implementation

1. Read the existing task intent, result envelope, evidence ref, run query, result query, and conformance contracts.
2. Add `golden-read-only-run-record.fixture.json` as the successful terminal Run Record for `run_fixture_success_001`.
3. Extend conformance to verify the generated success path matches the golden fixture and that the fixture can seed a file-backed store.
4. Reuse existing run/result/evidence query helpers in conformance to prove downstream smoke can query the seeded golden run.
5. Update schema and conformance README text to identify the fixture and its boundary.
6. Add GH-108 item-specific Loom carriers and current status alignment.
7. Run local validation and refresh evidence before PR creation.

## Constraints

- Keep implementation dependency-free.
- Do not add API/CLI smoke, write guardrail, App UI, SDK/MCP full entrypoints, history search, database/storage backends, real executor, raw evidence retrieval, or true writes.
- Do not modify Harbor, Lode, App, or other repositories.
- Do not close FR #96 until GH-108 through GH-110 are merged, closed, and post-merge evidence is complete.

## Validation

- `pnpm --filter @webenvoy/schemas test`
- `pnpm --filter @webenvoy/conformance typecheck`
- `pnpm --filter @webenvoy/conformance test`
- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm conformance`
- `git diff --check`
- `jq empty packages/schemas/fixtures/golden-read-only-run-record.fixture.json .loom/bootstrap/init-result.json .loom/specs/GH-108/build-evidence.json`
- `loom doctor --target . --json`
- `loom verify --target . --json`
- `loom fact-chain --target . --json`
- `loom suite validate --target . --item GH-108 --json`
- `loom suite carrier validate --target . --item GH-108 --json`
- `loom suite evidence validate --target . --item GH-108 --json`
- packaged `loom_flow.py flow build --target . --item GH-108 --build-evidence .loom/specs/GH-108/build-evidence.json`
- PR body/head readback after push and PR creation.

## Closeout Boundary

- This PR should reach PR Ready for Work Item #108 only.
- After GH-108 is merged and closed, FR #96 remains open for GH-109 and GH-110.
