# Runtime Capability Facts draft

- Status: pointer
- Owner: GH-62
- Linked issue: #63, #64
- Exit condition: delete this pointer after consumers use `docs/contracts/README.md` directly.

## Reading judgment

This draft contains valid contract analysis: Harbor should expose objective facts, not task conclusions. Provider, Profile, Runtime Session, automation exposure, and evidence policy facts help Core, Lode, user policy, and upstream systems decide requirements while Harbor avoids risk scores and business semantics.

## Absorbed

- Runtime session capability and availability facts are absorbed by [ADR 0005](../adr/0005-runtime-session-lifecycle-v0.md).
- Provider/Profile/Identity capability facts, fact-source classes, provider claims, and sensitive-data boundaries are absorbed by [ADR 0006](../adr/0006-provider-profile-identity-facts-v0.md).
- Evidence policy facts, page-scene refs, viewer access, and handoff facts are absorbed by [ADR 0007](../adr/0007-page-scene-reference-facts-v0.md).
- The compact implementation-facing summary is indexed in [contracts/README.md](../contracts/README.md#absorbed-draft-analysis).

## Rejected or deferred

- Rejected: black-box risk scoring, provider ranking, website task suitability, account safety score, anti-detection success guarantees, business strategy, normalized results, and site schemas.
- Deferred: exact versioned field sets, API/OpenAPI schema, generated client types, and concrete automation-exposure measurement fields.
- Background only: examples of reducing temporary automation exposure; these are not guarantees and are not accepted contract truth.

This draft is not an implementation basis.
