# Browser Drivers draft

- Status: pointer
- Owner: GH-62
- Linked issue: #63, #64
- Exit condition: delete this pointer after consumers use `docs/contracts/README.md` directly.

## Reading judgment

This draft contains valid architecture analysis: Browser Driver is an adapter boundary, not a task runner. It launches or connects a browser/runtime, prepares environment/profile/proxy inputs, reaches CDP readiness, reports health/errors, and returns provider capability facts. It must not understand site business, choose whether a task should run, store user business parameters, replace Evidence Store, leak provider-specific flags as Harbor public model, or decide provider suitability for a website task.

## Absorbed

- Provider capability facts, observed/configured/provider-claim separation, provider source/license/binary boundary, known limitations, and sensitive data exclusions are absorbed by [ADR 0006](../adr/0006-provider-profile-identity-facts-v0.md).
- Runtime session availability, lifecycle errors, and driver-output consumption by sessions are absorbed by [ADR 0005](../adr/0005-runtime-session-lifecycle-v0.md).
- The compact implementation-facing summary is indexed in [contracts/README.md](../contracts/README.md#absorbed-draft-analysis).

## Background

- [ADR 0003](../adr/0003-local-chrome-vs-remote-browser-boundary.md) remains useful provider-mode background for local and remote browser boundaries, but it is not the Stage 2 accepted facts contract.

## Rejected or deferred

- Rejected as contract truth: provider-native public flags, target-site success claims, anti-detection guarantees, provider ranking, and task suitability decisions.
- Deferred: concrete provider directory layout, first provider order, provider evaluation packet, and browser driver implementation.

This draft is not an implementation basis.
