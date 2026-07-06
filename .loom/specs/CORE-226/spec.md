# CORE-226 Spec

## Goal

Build the minimum Core contract slice that records real-site read-only Xiaohongshu and BOSS task runs and projects Lode normalized read results with refs-only source/evidence attribution.

## Suite Path

- Suite path: full
- Path decision: strong governance because this changes Core runtime contracts, result projection, Run Record durable fields, schema fixtures, conformance, and failure taxonomy.
- Provenance: Core #225/#226/#227/#228/#229; Lode #235/#240 closed; Lode PR #248/#250 merged; Lode milestone #14 closed; Harbor milestone #12 closed.

## Scenarios

- S-001 Xiaohongshu read runs: Given a real Harbor session ref and Lode Xiaohongshu search/note-detail package refs, Core records admitted/running/succeeded read tasks and stores refs only.
- S-002 BOSS read runs: Given a real Harbor session ref and Lode BOSS job-search/job-detail package refs, Core records admitted/running/succeeded read tasks and stores refs only.
- S-003 result projection: Given Lode normalized read output with source/evidence refs, Core returns a result envelope and persists result kind, output schema id, projection ref, source refs, evidence refs, and package/version refs.
- S-004 failure projection: Given Lode/Harbor failure classes for not logged in, CAPTCHA/safety challenge, page change, and field missing, Core records stable failure reasons and App-facing reason classes without raw browser material.

## Boundaries

- In scope: Core projection helpers, Run Record refs-only fields, result query projection, schema/conformance fixtures, targeted self-checks, item-specific Loom carriers, PR metadata.
- Out of scope: #230/#231/#232/#233/#234 write-precheck work, App UI, Harbor/Lode code, real production site access, real credentials, cookie/token/profile/raw DOM/HAR/network/screenshot storage, true write, Stage 7, GitHub dependency graph edits, merge, and issue closeout.

## Acceptance Criteria

- [x] Core records Xiaohongshu search and note-detail read task runs using Lode package refs and Harbor session/evidence refs.
- [x] Core records BOSS job-search and job-detail read task runs using Lode package refs and Harbor session/evidence refs.
- [x] Core result envelopes and durable Run Records expose result/source/projection refs and do not persist raw browser material.
- [x] Core failure reason projection covers not logged in, CAPTCHA/challenge, page changed, and field missing.
- [x] Targeted runtime, schema, conformance, typecheck, diff, Loom, suite, and PR metadata checks pass before PR Ready.
