# CORE-226

## Static Facts

- Item ID: CORE-226
- Goal: Deliver Core's real-site read-only task run record and result projection slice for FR #225.
- Scope: Covers FR #225 and Work Items #226/#227/#228/#229. Anchor Work Item is #226. Consumes Harbor milestone #12 closed facts, Lode #235/#240 closed capability-package facts, Lode PR #248/#250 merged package refs, and Lode milestone #14 closed state. Ownership is limited to Core run/result projection code, schema fixtures, conformance checks, and CORE-226 Loom carriers.
- Execution Path: work/core-226-real-read-task-result
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-226.md
- Review Entry: .loom/reviews/CORE-226.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/schemas test; pnpm --filter @webenvoy/conformance test; pnpm conformance; pnpm typecheck; git diff --check; loom fact-chain --target . --json; loom verify --target . --json; loom suite validate/carrier/evidence --target . --item CORE-226 --json; PR metadata readback/preflight after PR creation.
- Closing Condition: PR Ready only. Do not merge, close issues, or edit GitHub dependencies.

## Covered Issues

- #225 FR: real-site read-only task execution and result projection.
- #226 runs Xiaohongshu search and note-detail read tasks.
- #227 runs BOSS search and job-detail read tasks.
- #228 produces result envelope, projection refs, source refs, and field-source attribution.
- #229 records login, CAPTCHA/challenge, page-change, and field-missing failure reasons.

## Explicitly Not Covered

- #230/#231/#232/#233/#234 write-precheck and approval/no-submit work.
- App UI, Harbor/Lode code changes, real account credentials, live production site access, true writes, Stage 7, GitHub dependency graph edits, merge, and issue closeout.

## Associated Artifacts

- packages/core/src/read-only-result-projection.ts
- packages/core/src/real-site-readonly-result-self-check.ts
- packages/core/src/index.ts
- packages/core/src/result-envelope.ts
- packages/core/src/result-query.ts
- packages/core/src/run-record-store.ts
- packages/core/src/self-check.ts
- packages/schemas/schemas/run-record.schema.json
- packages/schemas/fixtures/*real-site*-read-only*.json
- packages/schemas/fixtures/real-site-xiaohongshu-read-only-run-record.fixture.json
- packages/schemas/fixtures/real-site-boss-read-only-run-record.fixture.json
- packages/schemas/fixtures/golden-read-only-run-record.fixture.json
- packages/conformance/src/real-site-readonly-fixtures.ts
- packages/conformance/src/self-check.ts
- .loom/bootstrap/init-result.json
- .loom/status/current.md
- .loom/specs/CORE-226
