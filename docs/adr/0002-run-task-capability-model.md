# 0002. Run Task Capability Model

## Status

Proposed.

## Context

WebEnvoy Core must give API, SDK, CLI, MCP and WebEnvoy App one task path instead of letting every entrypoint run browser actions differently. The core problem is not opening a browser. It is deciding whether a site capability is defined, versioned, resource-backed, executable, recorded and safe to expose as a public task.

Current drafts already split responsibilities:

- Lode owns site knowledge, capability packages, task packages, input/output schemas, fixtures, versions and invalidation markers.
- Harbor owns Profile, Execution Identity, Runtime Session, provider/runtime facts, Viewer/CDP/VNC and evidence capture.
- WebEnvoy App owns the human product surface, configuration, observation and recovery UX.
- WebEnvoy Core owns the public task path, capability admission, resource matching, execution control, Run Record and Result Envelope.

## Decision

WebEnvoy Core will model a public execution as:

```text
Task Request
  -> Capability Admission
  -> Resource Requirement Matching
  -> Harbor Runtime Binding
  -> Run
  -> Result Envelope / Run Record
```

`Task Request` is the Core-owned input shape after API Server normalization. It references a Lode capability or task package by stable id and version, includes public input, execution policy, evidence policy and resource requirements, and carries the caller entrypoint.

`Capability` is not a free-form browser action. A capability can enter the stable task path only when Lode declares at least:

- capability identity and version;
- lifecycle;
- input contract;
- output contract;
- resource requirements;
- pre-check and post-check expectations;
- evidence expectations;
- fixture or regression evidence;
- invalidation marker.

Core owns the admission decision. Stable execution fails closed when the capability is unknown, not stable, invalidated, missing contracts, missing resource requirements or missing evidence expectations.

Core does not own Harbor Profile or Runtime Session details. It only consumes Harbor runtime binding through public references and objective facts such as `runtime_session_ref`, `profile_ref`, `execution_identity_ref`, provider capability facts, health facts, Viewer/CDP availability and evidence capability facts.

Core does not own Lode site knowledge or normalized business schemas. It consumes Lode declarations and rejects execution when they are insufficient.

API Server remains the first-class entrypoint. CLI, MCP, SDK and WebEnvoy App should submit task requests through the API Server path rather than bypass Core to call Harbor, CDP or Lode directly.

## Consequences

All public entrypoints get the same admission, resource matching, failure categories, Run Record and Result Envelope.

Low-level browser tools remain useful for exploration and Lode authoring, but they are not the stable site task interface.

Core must reject some tasks before browser execution. This is expected: pre-accepted failure is safer than discovering missing contracts after a real site action starts.

Future schemas can be small because this ADR freezes ownership and flow, not every field name.

## Alternatives Considered

- Use a generic browser agent loop as Core: rejected because it lacks capability versioning, admission records, public result envelopes and reconciliation.
- Let Harbor decide whether a task should run: rejected because Harbor owns runtime facts, not site task policy.
- Let Lode execute tasks directly: rejected because Lode owns reusable capability assets, not runtime sessions or task records.
- Give CLI, MCP and SDK independent execution paths: rejected because behavior, safety and evidence would drift.
- Put provider routing, fallback priority, marketplace state or credentials into Core admission: rejected because these are runtime, product or secret-management concerns, not the public capability contract.

## Research Evidence

- [docs/draft/architecture.md](../draft/architecture.md) defines the single Core task path and repo boundaries.
- [docs/draft/runtime-contract.md](../draft/runtime-contract.md) defines Task Request, Capability Admission, Resource Requirement, Runtime Capability Facts and Run Record concepts.
- [docs/draft/capability-admission.md](../draft/capability-admission.md) defines stable capability admission and fail-closed behavior.
- [research/synthesis.md](../../../research/synthesis.md) records that capability/workflow/task assets need schema and that runtime facts must be split from task policy.
- [research/absorability/themes/task-execution-and-admission.md](../../../research/absorability/themes/task-execution-and-admission.md) supports public operation admission, resource matching and write-side fail-closed gates.
- [research/absorability/themes/api-cli-mcp-and-agent-interface.md](../../../research/absorability/themes/api-cli-mcp-and-agent-interface.md) supports a shared task interface and warns against exposing low-level browser tools as the stable site task API.

## Open Questions

- Exact JSON Schema names and field names for Task Request, Capability Admission, Resource Requirement and Runtime Capability Facts.
- Whether `experimental` capabilities can run through a separate explicitly marked exploration mode.
- Which public contract artifacts should stay in this AGPL repository and which should later move to a permissive contracts or SDK repository.
- The first minimum API surface for CLI, MCP and SDK generation.
- The lock or concurrency granularity for task execution against the same runtime identity.
