# CORE-231 Spec

## Goal

Build the minimum Core runtime slice that turns real-site write-precheck inputs from Lode and Harbor into queryable Run Records and preview result envelopes for Xiaohongshu draft preview and BOSS greeting preview, while preserving no-submit boundaries.

## Suite Path

- Suite path: full
- Path decision: strong governance because this changes Core runtime behavior, App-facing result facts, write-precheck safety semantics, self-checks, and issue closeout.
- Provenance: Core #230/#231/#232/#233/#234; Harbor #12 closed; Lode #14 closed.

## Scenarios

- S-001 Xiaohongshu draft preview: Given Lode Xiaohongshu draft-precheck package refs and Harbor write-precheck facts, Core records a succeeded preview result with `submitted=false`.
- S-002 BOSS greeting preview: Given Lode BOSS greeting-precheck package refs and Harbor write-precheck facts, Core records a succeeded preview result with `submitted=false`.
- S-003 risk and approval states: Given a write-precheck action request, Core records risk classification, no-submit guard, pending approval refs, cancellation, page-changed failure, and expired approval state.
- S-004 downstream consumption: Result/failure/approval queries can read the generated Run Records without raw browser material or submitted-result truth.

## Boundaries

- In scope: Core helper, exports, self-check coverage, item-specific Loom carriers, validation evidence, PR metadata, merge, post-merge closeout.
- Out of scope: App UI, Harbor/Lode implementation changes, real account/profile/Cookie use, browser launch/attach, live production page operation, true writes/submits, risk bypass, hosted browser, marketplace, bulk collection, account cloud hosting.

## Acceptance Criteria

- [x] Core generates Xiaohongshu draft write-precheck Run Record/result envelope from Lode package refs and Harbor write-precheck facts.
- [x] Core generates BOSS greeting write-precheck Run Record/result envelope from Lode package refs and Harbor write-precheck facts.
- [x] Core records risk classification, approval request, page-changed, user-cancelled, and approval-expired states.
- [x] Generated records and query envelopes preserve `submitted=false`, no-submit guard, and no submitted result refs.
- [ ] Targeted runtime, schema, conformance, typecheck, diff, Loom, suite, hosted checks, PR metadata, and post-merge issue closeout evidence pass before milestone close.
