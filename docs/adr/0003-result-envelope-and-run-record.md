# 0003. Result Envelope and Run Record

## Status

Proposed.

## Context

WebEnvoy Core needs a result contract that is useful to agents and programs without exposing raw browser state. It also needs a durable record that can answer what ran, why it was allowed, what resources were used, what happened, what failed and how to recover or reconcile.

Draft docs currently use both `Task Record` and `Run Record`. This ADR chooses one canonical name.

## Decision

Use `Run Record` as the canonical durable truth for one accepted Core run. `Task Record` is treated as a historical alias and should not become a second public concept.

Core owns two separate but linked contracts:

- `Result Envelope`: the public response returned to API, SDK, CLI, MCP and App callers.
- `Run Record`: the durable run truth queried after acceptance.

Lode owns the capability output schema and normalized schema. Harbor owns raw payload storage, runtime evidence capture and runtime/session evidence references. Core validates the capability output against Lode contracts, projects the public envelope and writes the Run Record.

The Result Envelope must prefer references over inline runtime material. Public results may include normalized data, item envelopes, cursor or continuation, failure classification, recovery hints, `run_record_ref`, `raw_payload_ref`, `evidence_ref`, `source_trace_ref`, `resource_trace_ref` and `write_operation_ref`. Public results must not inline raw payloads, full DOM, full request or response bodies, screenshots, videos, HAR files, local paths, credentials, cookies, tokens or provider-private objects.

The minimum Run Record lifecycle is:

```text
accepted -> running -> succeeded / failed / unknown_outcome / manual_recovery_required
```

Failures before `accepted` may return a structured pre-accepted failure without creating a Run Record. After `accepted`, status transitions are monotonic and terminal state is not overwritten by later observations.

The Run Record should record the request snapshot, entrypoint, capability reference, Lode package reference, resource requirement summary, resource match result, runtime binding refs, attempts, terminal Result Envelope, failure signals, run events, metric samples, evidence refs, raw payload refs, source trace refs, resource trace refs, write operation refs and reconciliation refs.

Failure classification belongs in the envelope and the record. It should include at least category, code, phase, evidence refs and recovery or user-action hints. Free-form exception text is supporting detail, not the public contract.

Dataset projection is optional and stays a public carrier. Core may record dataset refs or normalized public payloads, but Core does not become a business data warehouse or platform-specific ETL layer.

## Consequences

Callers can consume the same envelope across API, SDK, CLI, MCP and App.

Operators can inspect a Run Record without replaying the task or reading temporary runtime memory.

Sensitive browser artifacts stay behind evidence references and policy, reducing accidental leakage.

Implementations must validate and project results before returning success. A capability can execute correctly but still fail projection if it violates the output contract.

## Alternatives Considered

- Return adapter-specific JSON directly: rejected because it lacks stable versioning, evidence boundaries and cross-entrypoint consistency.
- Treat logs, profile status or live activity as the Run Record: rejected because they do not capture capability version, admission, resource matching and terminal result.
- Copy Browser Agent history wholesale: rejected because agent traces are useful evidence but are not the Core public contract.
- Inline raw payloads or screenshots for convenience: rejected because evidence can contain credentials, business data, local paths and provider internals.
- Make Core a dataset warehouse: rejected because normalized schemas and business meaning belong to Lode and downstream consumers.

## Research Evidence

- [docs/draft/result-envelope.md](../draft/result-envelope.md) defines public projection, normalized results and reference-only raw/evidence boundaries.
- [docs/draft/run-record.md](../draft/run-record.md) defines the durable Run Record lifecycle and minimum fields.
- [docs/draft/runtime-contract.md](../draft/runtime-contract.md) connects Result Envelope, Run Record, Evidence, Unknown Outcome and Reconciliation.
- [research/synthesis.md](../../../research/synthesis.md) records Result Envelope, Unknown Outcome, evidence refs and Run Record as a cross-theme public boundary.
- [research/absorability/themes/result-normalization-and-reconciliation.md](../../../research/absorability/themes/result-normalization-and-reconciliation.md) supports low-noise structured results, typed errors and heavy result references.
- [research/absorability/themes/evidence-and-observability.md](../../../research/absorability/themes/evidence-and-observability.md) supports Run Record baselines, evidence refs and the distinction between runtime status and task truth.

## Open Questions

- Exact Result Envelope and Run Record JSON Schema.
- Minimum evidence taxonomy, retention policy and redaction policy.
- CLI exit code mapping for failure categories.
- Whether cost, token and latency metrics are part of the durable Run Record or a separate metric stream.
- How much step-level history enters the default Run Record versus evidence-only artifacts.
- Whether dataset projection stores normalized payloads in Core or only stores projection refs.
