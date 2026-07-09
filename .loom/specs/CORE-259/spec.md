# CORE-259 Spec

## Goal

Core can leave the CORE-248 stale current pointer state without losing the implementation review evidence for PR #257, so the next Core #243/#244 runtime Work Item can start from a clean fact chain.

## Suite Path

- Suite path: not_applicable
- Path decision: this is a carrier-only governance repair with no implementation execution material. It changes no product code, schema, API behavior, runtime behavior, or external integration.
- suite-level not_applicable rationale: CORE-259 only repairs Loom carrier truth and current-pointer locators; consumer boundary: suite validation, spec review, PR gate, and closeout-specific gate consume the carrier boundary only and must not infer product runtime readiness; recheck condition: switch to minimal or full suite when any product code, schema/API/runtime behavior, App/Harbor/Lode file, live browser/account/profile/production page action, release, or non-carrier change enters scope.
- contracts.md not_applicable rationale: no cross-repo contract or runtime payload changes. Consumer boundary: Core carrier repair review only. Recheck condition: require contract review if product code or API fields change.
- readiness-checklist.md not_applicable rationale: product readiness is owned by App/Core/Harbor/Lode live E2E and remains open. Consumer boundary: this PR only unblocks the next Work Item. Recheck condition: require readiness checklist before final milestone closeout.
- research.md not_applicable rationale: no new product or technical research decision. Consumer boundary: closeout drift classification only. Recheck condition: require research if the gate failure recurs with a new signature.
- suite-index.md not_applicable rationale: CORE-259 has no full or minimal implementation suite to execute. Consumer boundary: carrier repair admission and PR gate only. Recheck condition: require minimal or full suite if any product code, schema, runtime, or non-carrier path changes.

## Scenarios

- S-001 carrier repair: `.loom/status/current.md` and `.loom/bootstrap/init-result.json` fact-chain entry points point at CORE-259 during the repair PR, and CORE-259 has item-specific progress/spec/plan/evidence carriers.
- S-002 review preservation: `.loom/reviews/CORE-248.json` is not modified, so PR #257 implementation review evidence remains retained.
- S-003 next-work readiness: after this PR merges and Core #259 is closed, the master controller can continue Core #243/#244 live runtime work without a CORE-248 current-item mismatch.
- S-004 safety boundary: the PR contains no product code and no live account/profile/browser/production-page action.

## Non-Goals

No Core runtime behavior change, no App/Harbor/Lode change, no final Core #243 closeout, no App #265 E2E, no real Xiaohongshu/BOSS page access, and no submit/publish/send/save or other external-visible write.
