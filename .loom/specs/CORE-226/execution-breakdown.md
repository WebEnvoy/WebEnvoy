# CORE-226 Execution Breakdown

## U-001 Real-Site Read Projection

- Files: `packages/core/src/read-only-result-projection.ts`, `packages/core/src/real-site-readonly-result-self-check.ts`.
- Goal: Project Xiaohongshu/BOSS Lode read outputs and failure classes into Core result envelopes and failure reasons.
- Validation: `pnpm --filter @webenvoy/core-runtime test`.

## U-002 Durable Run Record Refs

- Files: `packages/core/src/run-record-store.ts`, `packages/core/src/result-envelope.ts`, `packages/core/src/result-query.ts`.
- Goal: Persist result kind, output schema id, projection refs, source refs, and evidence refs without raw browser material.
- Validation: `pnpm --filter @webenvoy/core-runtime test`, `pnpm typecheck`.

## U-003 Schema And Conformance

- Files: `packages/schemas/schemas/run-record.schema.json`, `packages/schemas/fixtures/*read-only*.json`, `packages/conformance/src/real-site-readonly-fixtures.ts`, `packages/conformance/src/self-check.ts`.
- Goal: Keep schema/conformance fixtures aligned with refs-only projection.
- Validation: `pnpm --filter @webenvoy/schemas test`, `pnpm conformance`.

## U-004 Carrier And PR Ready

- Files: `.loom/work-items/CORE-226.md`, `.loom/progress/CORE-226.md`, `.loom/specs/CORE-226/**`.
- Goal: Keep Work Item, validation, PR metadata, and evidence chain aligned.
- Validation: Loom fact-chain, verify, suite, carrier, evidence, build, and PR metadata preflight.
