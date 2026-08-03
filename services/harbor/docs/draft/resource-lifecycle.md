# Resource Lifecycle draft

- Status: pointer
- Owner: GH-62
- Linked issue: #63, #64
- Exit condition: delete this pointer after consumers use `docs/contracts/README.md` directly.

## Reading judgment

This draft contains valid architecture analysis: Harbor resources need acquire/release/invalidate semantics, leases, resource traces, health evidence, and Core/Lode boundaries so browser identity and runtime state are auditable instead of temporary parameters.

## Absorbed

- Runtime session lifecycle states, lease rules, continuity, unavailable/recovery/takeover errors, and viewer/CDP/evidence availability are absorbed by [ADR 0005](../adr/0005-runtime-session-lifecycle-v0.md).
- Provider/profile/identity binding and health-sensitive facts are absorbed by [ADR 0006](../adr/0006-provider-profile-identity-facts-v0.md).
- Evidence/source refs that can support diagnostics are absorbed by [ADR 0007](../adr/0007-page-scene-reference-facts-v0.md).
- The compact implementation-facing summary is indexed in [contracts/README.md](../contracts/README.md#absorbed-draft-analysis).

## Rejected or deferred

- Deferred: `HarborResourceRecord`, `HarborResourceBundle`, `HarborResourceLease`, `HarborResourceTraceEvent`, and health-evidence field schemas.
- Rejected as Harbor scope: Core Run Record, Lode resource lifecycle, normalized result lifecycle, public credential/profile data, provider routing scores, and task-adaptation scoring.

This draft is not an implementation basis.
