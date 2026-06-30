# Spec

## Goal

Upgrade the Core repository Loom workflow pin from 0.21.1 to 0.22.1.

## Required Behavior

- `.github/workflows/loom-check.yml` sets `LOOM_VERSION: 0.22.1`.
- The existing packaged `loom_flow.py` PR gate entry remains unchanged.
- PR metadata binds to GitHub Work Item GH-77, not INIT-0001.
- No product files or historical Loom bootstrap files are semantically migrated.

## Non-Goals

- Do not modify product behavior, product docs, roadmap, issue-tree planning, schema/API/runtime contracts, fixtures, or generated facts.
- Do not introduce a new governance process.
- Do not claim that v0.22.1 has new product implications until a future gate or issue exposes them.

## Suite Applicability

- Suite path: not_applicable
- Artifact: suite-level
- Rationale: This PR changes only a CI workflow version pin and item-specific maintenance carrier files. There is no product code, schema, API, runtime, fixture, migration, or user-facing behavior change to test.
- Consumer boundary: Hosted GitHub Actions checks are the relevant validation for this workflow maintenance PR.
- Recheck condition: Require a fresh review and stronger validation if this PR changes workflow command structure, product files, runtime behavior, schemas, APIs, fixtures, generated facts, or any non-GH-77 Loom carrier.
