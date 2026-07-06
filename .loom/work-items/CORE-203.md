# CORE-203

## Static Facts

- Item ID: CORE-203
- Goal: Let Core consume real-page Xiaohongshu and BOSS write-precheck inputs and produce no-submit write-preview records for FR #190.
- Scope: Covers Core FR #190 and Work Items #203/#204/#205/#206; consumes completed Core #187/#188/#189, Harbor milestone #11 public runtime/evidence refs, and Lode milestone #13 write-precheck capability facts; ownership is limited to Core schema/conformance fixtures and CORE-203 Loom carriers; excludes App/Harbor/Lode code, live site operation, true writes, submitted results, reconciliation, unknown outcome, cookies, tokens, passwords, profile storage, raw DOM, raw network, raw evidence body, CDP/VNC/websocket endpoints, merge, issue closeout, release evidence, and current pointer retire.
- Execution Path: work/core-190-write-preview-real-page
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-203.md
- Review Entry: .loom/reviews/CORE-203.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/schemas test; pnpm conformance; pnpm typecheck; git diff --check; loom fact-chain --target . --json; loom verify --target . --json; loom suite validate/carrier/evidence --target . --item CORE-203 --json; loom pr metadata-preflight after PR readback
- Closing Condition: Implementation PR merges, issues #190/#203/#204/#205/#206 receive post-merge closeout evidence, and current pointer returns to no_active_item/idle after closeout.

## Covered Work Items

- #203 accepts Xiaohongshu draft and BOSS greeting write-precheck intent records.
- #204 records action request, risk classification, no-submit guard, and approval request.
- #205 records write-preview result, evidence refs, and submitted=false state.
- #206 records user-cancelled, expired, and page-changed terminal states without submitted truth.

## Associated Artifacts

- packages/schemas/fixtures/real-site-xiaohongshu-write-preview-run-record.fixture.json
- packages/schemas/fixtures/real-site-boss-write-preview-run-record.fixture.json
- packages/schemas/fixtures/real-site-write-preview-page-changed-run-record.fixture.json
- packages/schemas/fixtures/real-site-write-preview-cancelled-run-record.fixture.json
- packages/schemas/fixtures/real-site-write-preview-expired-run-record.fixture.json
- packages/conformance/src/real-site-write-preview-fixtures.ts
- packages/conformance/src/self-check.ts
- packages/conformance/README.md
- packages/schemas/README.md
- .loom/specs/CORE-203/**
