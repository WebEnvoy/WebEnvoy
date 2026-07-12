# CORE-275

## Static Facts

- Item ID: CORE-275
- Goal: Normalize Harbor `safety_challenge` to the pinned Lode BOSS `captcha_required` failure without weakening unknown-response handling.
- Scope: Shared Core Harbor-to-Lode failure adapter, focused API integration regressions, and CORE-275 item-specific carriers.
- Execution Path: work/core-275-safety-challenge
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-275.md
- Validation Entry: Core/API targeted checks, full repository checks, diff checks, and Loom item checks.
- Closing Condition: Ready PR for #275; no merge, issue closure, packaged rebuild, or live rerun.

## Non-Goals

- No Harbor, Lode, or App changes; no new canonical failure class; no browser/account/page access or external action.
- Shared `.loom/status/current.md`, live E2E, merge, and closeout remain controller-owned.

## Associated Artifacts

- .loom/specs/CORE-275/spec.md
- .loom/specs/CORE-275/plan.md
- .loom/specs/CORE-275/implementation-contract.md
- .loom/specs/CORE-275/evidence-map.md
- .loom/specs/CORE-275/task-carrier.md
- packages/core/src/runtime-task-chain.ts
- packages/api-server/src/runtime-task-submit-self-check.ts
