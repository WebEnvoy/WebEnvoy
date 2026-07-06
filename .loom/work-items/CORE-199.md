# CORE-199

## Static Facts

- Item ID: CORE-199
- Goal: Provide Core real-run query and evidence entry points so App can read run result, evidence refs, session refs, and failure reasons for FR #189 without reading Core internals or private Harbor/Lode material.
- Scope: Covers Core FR #189 and Work Items #199/#200/#201/#202; consumes completed Core #187/#188 plus Harbor #11 and Lode #13 public refs/facts; ownership is limited to Core query/API/schema/conformance code and CORE-199 Loom carriers; excludes #190/#203-#206, App/Harbor/Lode code changes, true writes, live account operation, captcha/risk bypass, Harbor private scene material, account/cookie/token/profile/raw DOM/raw network/raw screenshot/video/CDP/VNC endpoints, and Lode package bodies.
- Execution Path: work/core-189-real-run-query-evidence
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-199.md
- Review Entry: .loom/reviews/CORE-199.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/api-server test; pnpm --filter @webenvoy/schemas test; pnpm conformance; pnpm typecheck; git diff --check; loom fact-chain --target . --json; loom verify --target . --json; loom suite validate/carrier/evidence --target . --item CORE-199 --json; loom pr metadata-preflight after PR readback
- Closing Condition: PR #214 merges, issues #189/#199/#200/#201/#202 receive post-merge closeout evidence, and current pointer returns to no_active_item/idle after closeout.

## Covered Work Items

- #199 binds query-visible evidence refs to source, timestamp, retention/redaction state, and runtime session ref without copying raw evidence.
- #200 maps login-required, page-changed, field-unavailable, and risk-prompt failures to structured reason classes.
- #201 exposes run result, evidence refs, session refs, and failure reason query interfaces through Core/API Server.
- #202 exposes App-consumable recovery hints and app actions without executing recovery.

## Associated Artifacts

- packages/core/src/result-query.ts
- packages/core/src/run-query.ts
- packages/core/src/real-run-query-self-check.ts
- packages/api-server/src/server.ts
- packages/api-server/src/self-check.ts
- packages/conformance/src/real-site-readonly-fixtures.ts
- packages/schemas/schemas/session-refs-query.schema.json
- packages/schemas/schemas/failure-reason-query.schema.json
- packages/schemas/fixtures/session-refs-query.fixture.json
- packages/schemas/fixtures/failure-reason-query.fixture.json
- .loom/specs/CORE-199/**
