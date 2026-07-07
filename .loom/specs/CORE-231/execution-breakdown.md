# CORE-231 Execution Breakdown

## U-001 Real-Site Write-Precheck Helper

- Files: `packages/core/src/real-site-write-preview.ts`, `packages/core/src/index.ts`.
- Goal: Generate queryable Core Run Records from write-precheck task submissions and refs-only Lode/Harbor facts.
- Validation: `pnpm --filter @webenvoy/core-runtime test`, `pnpm typecheck`.

## U-002 Write-Precheck Self-Check

- Files: `packages/core/src/real-site-write-preview-self-check.ts`, `packages/core/src/self-check.ts`.
- Goal: Cover Xiaohongshu draft preview, BOSS greeting preview, page_changed, user_cancelled, approval expired, and no-submit evidence.
- Validation: `pnpm --filter @webenvoy/core-runtime test`.

## U-003 Schema And Conformance Regression

- Files: `packages/schemas/fixtures/*write-preview*.json`, `packages/conformance/src/real-site-write-preview-fixtures.ts`.
- Goal: Preserve existing schema/conformance coverage for the write-preview Run Record shape.
- Validation: `pnpm --filter @webenvoy/schemas test`, `pnpm --filter @webenvoy/conformance test`, `pnpm conformance`.

## U-004 Carrier And PR Ready

- Files: `.loom/work-items/CORE-231.md`, `.loom/progress/CORE-231.md`, `.loom/status/current.md`, `.loom/specs/CORE-231/**`.
- Goal: Keep Work Item, validation, PR metadata, review, merge, and closeout chain aligned.
- Validation: Loom fact-chain, verify, suite, carrier, evidence, build, PR metadata preflight, hosted checks, and post-merge closeout.
