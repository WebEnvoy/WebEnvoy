# CORE-270 Specification

- Suite Path: full

## Acceptance

1. XHS search completion persists Harbor-minted opaque detail targets with search-run, site, identity, session, freshness and consumption provenance.
2. XHS detail submit accepts only an eligible persisted opaque ref; caller-authored URL/note ID/xsec token, cross-binding, expired and replayed refs fail closed before Harbor.
3. Core consumes the pinned XHS detail capability/lock and dispatches `xhs_read_note_detail` with no raw target material.
4. Success requires Harbor completed output, matching capability truth, bounded result/source/evidence refs and passed post-check; malformed or missing facts terminalize fail closed/unknown outcome.
5. BOSS production admission remains disabled and no BOSS page is accessed.

## Evidence Boundary

Unit/API tests prove Core contract and persistence only. Closing #270 additionally requires merged packaged App XHS search -> opaque ref -> detail -> result/source/evidence/post-check E2E.
