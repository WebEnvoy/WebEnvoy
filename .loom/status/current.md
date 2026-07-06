# Current Status

## Derived Fact Chain View

- Item ID: CORE-199
- Goal: Provide Core real-run query and evidence entry points so App can read run result, evidence refs, session refs, and failure reasons for FR #189 without reading Core internals or private Harbor/Lode material.
- Scope: Covers Core FR #189 and Work Items #199/#200/#201/#202; consumes completed Core #187/#188 plus Harbor #11 and Lode #13 public refs/facts; ownership is limited to Core query/API/schema/conformance code and CORE-199 Loom carriers; excludes #190/#203-#206, App/Harbor/Lode code changes, true writes, live account operation, captcha/risk bypass, Harbor private scene material, account/cookie/token/profile/raw DOM/raw network/raw screenshot/video/CDP/VNC endpoints, and Lode package bodies.
- Execution Path: work/core-189-real-run-query-evidence
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-199.md
- Review Entry: .loom/reviews/CORE-199.json
- Validation Entry: pnpm --filter @webenvoy/core-runtime test; pnpm --filter @webenvoy/api-server test; pnpm --filter @webenvoy/schemas test; pnpm conformance; pnpm typecheck; git diff --check; loom fact-chain --target . --json; loom verify --target . --json; loom suite validate/carrier/evidence --target . --item CORE-199 --json; loom pr metadata-preflight after PR readback
- Closing Condition: Non-draft PR is ready with metadata covering #189/#199/#200/#201/#202. Merge, issue closeout, release evidence, current-head review, and current pointer retire are out of scope for this execution thread.
- Current Checkpoint: build
- Current Stop: Core/API/schema/conformance changes and Loom carriers for real-run result, evidence, session refs, and failure reason queries are implemented, committed, and pushed for PR readiness on branch work/core-189-real-run-query-evidence.
- Next Step: Create the non-draft PR, read back PR metadata, and run PR metadata preflight; current-head review, merge-ready, merge, closeout, and retire remain outside this execution thread.
- Blockers: None recorded.
- Latest Validation Summary: pnpm --filter @webenvoy/core-runtime test, pnpm --filter @webenvoy/api-server test, pnpm --filter @webenvoy/schemas test, pnpm conformance, pnpm typecheck, git diff --check, loom fact-chain --target . --json, loom verify --target . --json, loom suite validate --target . --item CORE-199 --json, loom suite carrier validate --target . --item CORE-199 --json, and loom suite evidence validate --target . --item CORE-199 --json passed locally on 2026-07-06 UTC; PR metadata preflight is the remaining PR-readiness check.
- Recovery Boundary: Core query and refs-only schema/API facts only; no App/Harbor/Lode code changes, true writes, live account operation, external visible action, captcha/risk bypass, private browser material, raw evidence, merge, closeout, or current pointer retire.
- Current Lane: stage5 real run query evidence

## Runtime Evidence

- Run Entry: not_applicable
- Logs Entry: not_applicable
- Diagnostics Entry: not_applicable
- Verification Entry: .loom/progress/CORE-199.md
- Lane Entry: .loom/specs/CORE-199/plan.md

## Sources

- Static Truth: .loom/work-items/CORE-199.md
- Dynamic Truth: .loom/progress/CORE-199.md
- Locator Truth: .loom/bootstrap/init-result.json
- Fact Chain CLI: loom fact-chain --target . --json
