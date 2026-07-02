# Current Status

## Derived Fact Chain View

- Item ID: GH-109
- Goal: Add minimal API/CLI smoke validation proving task/run/result/evidence queries share the same Core contract.
- Scope: GH-109 is limited to a repo-local conformance smoke that seeds the GH-108 golden read-only Run Record fixture, reads run/result/evidence projections through a CLI query mode and API Server query routes, compares the outputs, documents the runnable smoke command, and records GH-109 item-specific Loom carriers. Ownership is limited to the listed conformance/API metadata/docs files, GH-109 carriers, GH-109 review artifacts when authored, and GH-109 current status alignment.
- Execution Path: implementation/api-cli-smoke-v0
- Workspace Entry: .
- Recovery Entry: .loom/progress/GH-109.md
- Review Entry: .loom/reviews/GH-109.json
- Validation Entry: `pnpm --filter @webenvoy/conformance smoke`; `pnpm smoke`; `pnpm --filter @webenvoy/conformance typecheck`; `pnpm --filter @webenvoy/conformance test`; `pnpm --filter @webenvoy/api-server typecheck`; `pnpm --filter @webenvoy/api-server test`; `pnpm build`; `pnpm typecheck`; `pnpm lint`; `pnpm test`; `pnpm conformance`; `git diff --check`; `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-109/build-evidence.json`; `loom doctor --target . --json`; `loom verify --target . --json`; `loom fact-chain --target . --json`; `loom suite validate --target . --item GH-109 --json`; `loom suite carrier validate --target . --item GH-109 --json`; `loom suite evidence validate --target . --item GH-109 --json`; packaged `loom_flow.py flow build --target . --item GH-109 --build-evidence .loom/specs/GH-109/build-evidence.json`; PR body/head readback.
- Closing Condition: PR is merged, post-merge closeout evidence is recorded, issue #109 is closed, and FR #96 remains open until GH-110 is complete.
- Current Checkpoint: merge
- Current Stop: GH-109 implementation, PR metadata readback, spec review, and implementation review have passed on `work/GH-109-api-cli-smoke`; merge-ready gate, hosted checks, merge, and closeout remain pending.
- Next Step: Run merge-ready against PR #135 head, wait for hosted checks, merge PR #135, then record post-merge closeout and close issue #109.
- Blockers: None recorded.
- Latest Validation Summary: 2026-07-02 local validation and build readiness passed: `pnpm --filter @webenvoy/conformance smoke`, `pnpm smoke`, `pnpm --filter @webenvoy/conformance typecheck`, `pnpm --filter @webenvoy/conformance test`, `pnpm --filter @webenvoy/api-server typecheck`, `pnpm --filter @webenvoy/api-server test`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm conformance`, `git diff --check`, `jq empty .loom/bootstrap/init-result.json .loom/specs/GH-109/build-evidence.json`, `loom doctor --target . --json`, `loom verify --target . --json`, `loom fact-chain --target . --json`, `loom suite validate --target . --item GH-109 --json`, `loom suite carrier validate --target . --item GH-109 --json`, `loom suite evidence validate --target . --item GH-109 --json`, and packaged `loom_flow.py flow build --target . --item GH-109 --build-evidence .loom/specs/GH-109/build-evidence.json` passed. API/CLI smoke validated golden run `run_fixture_success_001`; packaged build attempt `GH-109-build-fa3e2c52d4bd-533158da6561` passed. Review-readiness source-distribution tools are not applicable to this consumer repo because there is no `tools/` directory and `tools/skills_surface.py check`, `tools/loom_check.py --profile source --source-surface contract-only`, `tools/check_release_surface.py`, `tools/version_surface_check.py`, and `tools/check_npm_package.py` are absent. PR metadata readback, hosted checks, merge, and closeout are pending.
- Recovery Boundary: Keep GH-109 limited to API/CLI smoke over the GH-108 golden read-only fixture and the existing GH-106/GH-107 query interfaces. Do not add write-side action request guardrail (#110), App UI, SDK/MCP full entrypoints, formal product CLI, API submission, real executor, history search, database/storage backends, Harbor/Lode/App edits, raw evidence retrieval, or true writes.
- Current Lane: merge

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/GH-109.md
- Lane Entry: merge

## Sources

- Static Truth: .loom/work-items/GH-109.md
- Dynamic Truth: .loom/progress/GH-109.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
