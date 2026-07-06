# CORE-226 Research

## Inputs Read

- Core `AGENTS.md`, `ROADMAP.md`, `VISION.md`, `docs/contracts/README.md`, and `docs/adr/0008-core-technical-architecture-baseline.md`.
- Core issues #225/#226/#227/#228/#229 and excluded #230/#231/#232/#233/#234.
- Existing Core admission, Run Record, result envelope, result query, schema, conformance, and real-site self-check code.
- Lode #235/#240 closed issue facts, Lode PR #248/#250 merged PR bodies, and Lode milestone #14 closed state.
- Lode `origin/main` read capability package manifests, resource requirements, output schemas, and failure mappings for Xiaohongshu/BOSS.

## Decision

Use a small Core projection helper and durable Run Record refs instead of adding a registry client, schema validator dependency, browser runner, or App API. The helper consumes already-normalized Lode output and public Harbor refs. It does not fetch, navigate, scrape, attach to browser runtime, or store raw evidence.

## No-Copy Boundary

Core records `package_ref`, capability/version/lock refs, Harbor session/evidence/source refs, result/projection refs, output schema id, and failure reasons. Core does not copy Lode package bodies, normalizer code, fixtures, raw DOM, HAR, screenshots, cookies, tokens, profile state, provider private objects, or production payloads.
