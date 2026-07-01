# Spec

## Goal

Freeze the docs-only Core technical architecture baseline for milestone #8 without creating code, dependencies, schemas, fixtures, runners, runtime, database implementation, merge, or issue closeout.

## Required Behavior

- ADR 0008 records accepted, rejected, deferred, and constraint decisions for TypeScript / Node.js / pnpm; JSON Schema / Zod / Ajv; API Server / Core Runtime / Run Record / persistence boundaries; shared-entry conformance fixture planning; cross-repo no-copy rules; and research absorption boundaries.
- `docs/contracts/README.md` links ADR 0008 and tells future implementers which contracts to read before API Server, Core Runtime, Run Record, Schema, CLI, MCP, SDK, App-facing API, and conformance work.
- `AGENTS.md` contains concise technical stack, dependency, maintainability, test/validation, change-scope, and safety no-copy constraints.
- GH-80 item-specific Loom carrier binds the branch, scope, coverage, validation plan, and docs-only non-goals.
- `.loom/status/current.md` and `.loom/bootstrap/init-result.json` fact-chain entry points reference GH-80 so Loom fact-chain/build validation does not drift to closed-out GH-77.
- PR metadata must use Refs and state coverage for #79-#88 without closing issues.

## Non-Goals

- Do not create `package.json`, pnpm lockfiles, workspace files, source directories, API routes, CLI/MCP/SDK code, OpenAPI, full JSON Schema, generated types, fixture files, conformance runner, runtime executor, persistence implementation, migrations, or database config.
- Do not modify Harbor, Lode, App, research, sources, issue bodies, milestones, or other repositories.
- Do not merge the PR or close issues.

## Suite Applicability

- Suite path: minimal
- Required artifacts: .loom/specs/GH-80/spec.md and .loom/specs/GH-80/plan.md
- Full-suite artifacts not applicable: suite-index.md, research.md, contracts.md, readiness-checklist.md, evidence-map, consistency-analysis, execution breakdown.
- Rationale: This is a docs-only architecture baseline PR with no code, schema, fixture, generated type, runtime, persistence, or user-facing behavior change. ADR 0008 directly records the required research absorption, contract boundaries, and deferred conditions.
- Consumer boundary: Review and PR Ready should consume ADR 0008, contracts index, AGENTS constraints, GH-80 carrier, `git diff --check`, Markdown/JSON readability checks, and PR body/head readback.
- Recheck condition: Require a real suite, fixtures, schema checks, type checks, API tests, or runtime validation if any later PR adds code, package files, dependencies, JSON Schema, OpenAPI, generated types, fixture files, conformance runner, runtime behavior, persistence, or cross-repo consumers.

## Acceptance

- #79-#88 coverage is visible in ADR 0008 and PR metadata.
- Research locators are explicitly marked as absorbed, pruned, or rejected.
- Core no-copy constraints for Harbor, Lode, and App truth are explicit.
- Worktree remains limited to allowed docs, GH-80 carrier files, and the minimum shared current-status/bootstrap entry-point alignment needed for fact-chain.
