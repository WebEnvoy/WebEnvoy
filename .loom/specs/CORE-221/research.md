# CORE-221 Research

## Readback

- Core issues #220/#221/#222/#223/#224 were read with `gh issue view` on 2026-07-06 UTC.
- Harbor public exports read from `/Volumes/2T/dev/WebEnvoy/Harbor/packages/runtime-api/src/{index,identity-environment,provider-management,runtime-session,runtime-session-types,viewer-control,provider-capabilities}.ts`.
- Lode #230 freeze contract read from `WebEnvoy/Lode origin/main:docs/contracts/bb-sites-xhs-boss-absorption-freeze.md`.
- Lode package refs/locks/resource requirements read from `sites/xiaohongshu/{search-notes,read-note-detail}` and `sites/boss/{job-search,read-job-detail}`.

## Findings

- Harbor exposes public provider status, local identity environment facts, runtime session refs, viewer/control facts, and redacted status boundaries.
- Lode freezes Xiaohongshu/BOSS read capabilities at `0.1.0` with package locks and required Harbor facts.
- Core already had a refs-only Run Record shape; the missing piece was matching Lode-required Harbor facts and refusing direct private-material persistence in the store.

## No-Copy Boundary

- No bb-sites source code, Lode package body, Harbor private provider object, raw browser evidence, raw DOM/HAR/screenshot body, CDP/VNC endpoint, cookie, token, or profile storage is copied into Core.
