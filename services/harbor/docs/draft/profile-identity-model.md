# Profile and Execution Identity draft

- Status: pointer
- Owner: GH-62
- Linked issue: #63, #64
- Exit condition: delete this pointer after consumers use `docs/contracts/README.md` directly.

## Reading judgment

This draft contains valid product/architecture analysis: Harbor separates browser environment/Profile from site/account Execution Identity. Login state, risk events, allowed execution channels, evidence policy, resource requirements, linked capabilities/tasks, and usage history belong to identity facts rather than one-off errors.

The old `Fingerprint < Profile < Execution Identity` framing remains useful background, but it is not a standalone contract.

## Absorbed

- `profile_ref`, `execution_identity_ref`, profile facts, identity facts, login-state provenance, sensitive profile/account data exclusions, and relation to `runtime_session_ref` are absorbed by [ADR 0006](../adr/0006-provider-profile-identity-facts-v0.md).
- Runtime binding and continuity with `profile_ref` / `execution_identity_ref` are absorbed by [ADR 0005](../adr/0005-runtime-session-lifecycle-v0.md).
- The compact implementation-facing summary is indexed in [contracts/README.md](../contracts/README.md#absorbed-draft-analysis).

## Background

- [ADR 0002](../adr/0002-profile-session-and-provider-facts.md) remains background for the earlier Profile/Session/Provider boundary.

## Rejected or deferred

- Rejected: credential payloads, account safety scores, task success judgments, business results, and treating login/provider claims as observed identity facts.
- Deferred: concrete fingerprint field schema, exact Profile-to-Identity cardinality rules, account policy details, and versioned API fields.

This draft is not an implementation basis.
