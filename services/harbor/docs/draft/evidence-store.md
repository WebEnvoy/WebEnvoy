# Evidence Store draft

- Status: pointer
- Owner: GH-62
- Linked issue: #63, #64
- Exit condition: delete this pointer after consumers use `docs/contracts/README.md` directly.

## Reading judgment

This draft contains valid product and contract analysis: Evidence Store is structured execution-site evidence for debugging, validation, failure tracing, and capability evolution. Harbor can expose refs for raw payload, evidence, snapshot, network summary, screenshot, source trace, and runtime/session/profile/identity context, while explicitly excluding normalized site results and business schemas.

## Absorbed

- `snapshot_ref`, `refmap_ref`, `source_trace`, `evidence_ref`, redaction/retention/source binding, evidence failure classes, and optional screenshot/console/network/diagnostic refs are absorbed by [ADR 0007](../adr/0007-page-scene-reference-facts-v0.md).
- Evidence privacy defaults and source-binding background are retained as context in [ADR 0004](../adr/0004-snapshot-refmap-and-evidence-capture.md), but Stage 2 implementation dependencies should consume ADR 0007.
- The compact implementation-facing summary is indexed in [contracts/README.md](../contracts/README.md#absorbed-draft-analysis).

## Rejected or deferred

- Rejected by default: uploading cookies, tokens, credentials, full storage, full DOM, full request/response bodies, full screenshots, HAR, trace, video, raw payload, user business parameters, and unredacted private runtime material.
- Rejected as Harbor scope: normalized result, collection/comment/dataset schema, site business field mapping, business cursor semantics, and Lode capability output.
- Deferred/policy-gated: concrete retention, encryption-at-rest, deletion implementation, export policy, and high-sensitivity capture enablement.

This draft is not an implementation basis.
