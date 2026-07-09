# CORE-259

## Static Facts

- Item ID: CORE-259
- Goal: Retire the stale CORE-248 current pointer after PR #257 merged and Core #248 closed, without overwriting CORE-248 implementation review evidence.
- Scope: Core/WebEnvoy governance carrier only. Ownership is limited to CORE-259 item-specific Loom carriers, `.loom/status/current.md`, and `.loom/bootstrap/init-result.json` fact-chain locator truth so later Core #243/#244 live-runtime work can start from a clean fact chain.
- Execution Path: work/core-259-carrier-retire
- Workspace Entry: .
- Recovery Entry: .loom/progress/CORE-259.md
- Review Entry: .loom/reviews/CORE-259.json
- Validation Entry: git diff --check; loom fact-chain --target . --item CORE-259 --json; loom verify --target . --json; loom suite validate/carrier/evidence --target . --item CORE-259 --json; loom pr gate <PR> --target . --head-sha <HEAD> --json
- Closing Condition: Carrier-only PR merged, Core #259 closed with PR/head/merge evidence, and Core #243/#244 remain open until App-driven runtime E2E passes.

## Covered Issues

- #259 carrier drift repair for CORE-248 stale current pointer.
- #243 only as the parent execution unblocker; no user-story completion is claimed.

## Explicitly Not Covered

- Product code changes.
- Reimplementation or semantic review replacement for CORE-248.
- Closing Core #243, #244, #225, #230, or any App/Harbor/Lode user story.
- App packaged runtime, live Harbor/browser runtime evidence, Xiaohongshu/BOSS account/profile/Cookie/production page access, or Computer Use E2E.
- Submit, publish, send, save, hosted browser, marketplace, batch collection, account cloud hosting, or risk-control bypass.

## Ownership Constraints

- Writes are limited to CORE-259 Loom carriers, `.loom/status/current.md`, and `.loom/bootstrap/init-result.json` fact-chain entry points.
- `.loom/reviews/CORE-248.json` must remain untouched so PR #257 implementation review evidence is retained.
- No App, Harbor, or Lode files may be changed in this Work Item.

## Associated Artifacts

- `.loom/work-items/CORE-259.md`
- `.loom/progress/CORE-259.md`
- `.loom/specs/CORE-259/spec.md`
- `.loom/specs/CORE-259/plan.md`
- `.loom/specs/CORE-259/evidence-map.md`
- `.loom/specs/CORE-259/task-carrier.md`
- `.loom/specs/CORE-259/build-evidence.json`
- `.loom/reviews/CORE-259.json`
- `.loom/reviews/CORE-259.spec.json`
- `.loom/status/current.md`
- `.loom/bootstrap/init-result.json`
