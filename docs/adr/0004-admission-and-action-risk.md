# 0004. Admission and Action Risk

## Status

Proposed.

## Context

WebEnvoy Core must stop unsafe or under-specified work before real browser execution. This is especially important for writes such as upload, publish, edit, delete, submit, cancel and any action that may touch an external system.

Research and drafts converge on one boundary: Harbor provides runtime facts, Lode declares capability requirements and Core applies task policy. These must not be collapsed into a single Browser Profile or provider score.

## Decision

Core admission has three gates before execution:

1. Capability admission: the requested capability is known, stable, versioned and contract-backed.
2. Resource admission: Lode resource requirements match Harbor runtime facts and caller policy.
3. Action risk admission: the requested intent and risk level are allowed, approved when required and evidence-backed.

Core owns the gate result and failure classification. Harbor owns objective runtime facts and evidence capture. Lode owns capability-declared requirements, pre-checks, post-checks and risk declarations. App owns user-facing approval, recovery and handoff UX.

The minimum action risk classes are:

- `read`: observes or extracts without intended external mutation.
- `write`: changes draft, local, account or page state but is not an external final submission.
- `submit`: sends, publishes, uploads, saves, or otherwise may create externally visible state.
- `destructive`: deletes, revokes, cancels, overwrites or performs hard-to-reverse state changes.

The minimum write-side execution intents are:

- `dry_run`
- `validate_only`
- `execute_after_approval`
- `reconcile_status`
- `request_cancel`

For `submit` and `destructive` work, Core must require an explicit policy allow or `approval_evidence_ref`, an idempotency boundary when repeat submission is possible, and a `write_operation_ref` or equivalent recovery reference once external submission may have happened.

Runtime target binding is part of admission. Core should bind the run to public Harbor refs and facts such as runtime session, profile, execution identity, target page or domain, evidence policy and current health. Core must not define Harbor Profile or Runtime Session internals.

`unknown_outcome` is a terminal result, not a recoverable success flag. If a write may have reached the external system but WebEnvoy cannot confirm the outcome, Core records `unknown_outcome` with evidence and reconciliation refs instead of marking the run succeeded.

Reconciliation and cancellation are separate intents around an existing `write_operation_ref`. They should not be hidden as retries of the original submit run.

## Consequences

Real writes become slower to admit but easier to audit, recover and reconcile.

Harbor remains a runtime provider, not a policy oracle. Lode remains a capability contract source, not a runtime owner. App remains the place for visible approval and recovery, not a second execution engine.

Core needs structured pre-accepted failures for missing approval, missing idempotency boundary, target mismatch, unavailable runtime facts, missing post-checks and missing evidence policy.

Early implementation can support only the minimum risk classes and intents above. More detailed site-specific policy belongs in Lode capability declarations and App/user policy, not in hard-coded Core branches.

## Alternatives Considered

- Rely on Skill or prompt wording for sensitive operations: rejected because safety must be machine-checkable and recorded.
- Put allow/deny/confirm only on low-level browser tools: rejected because stable tasks need capability-level admission and result reconciliation.
- Copy the old single-site write gate in full: rejected because it contains useful evidence ideas but too many historical, platform-specific fields.
- Let Harbor decide whether a write is safe: rejected because Harbor only knows runtime facts, not site task intent.
- Mark write timeouts as failed or succeeded optimistically: rejected because external systems may already have received the operation.

## Research Evidence

- [docs/draft/capability-admission.md](../draft/capability-admission.md) defines fail-closed admission and fields that should not enter the admission surface.
- [docs/draft/write-safety.md](../draft/write-safety.md) defines write intents, idempotency, approval evidence, write operation refs, unknown outcome and reconciliation.
- [docs/draft/runtime-contract.md](../draft/runtime-contract.md) defines resource requirement matching and unknown outcome handling.
- [research/synthesis.md](../../../research/synthesis.md) records that runtime facts and task policy must be split and that Core admission/action risk needs product decisions.
- [research/absorability/themes/task-execution-and-admission.md](../../../research/absorability/themes/task-execution-and-admission.md) supports sensitive operation confirmation, resource matching, action policy and write-side fail-closed gates.
- [research/absorability/themes/evidence-and-observability.md](../../../research/absorability/themes/evidence-and-observability.md) supports evidence boundaries, non-proof signals and explicit privacy/telemetry policy.

## Open Questions

- Exact schema for action risk, execution intent, approval evidence and idempotency trace.
- Whether the four minimum risk classes are enough for App policy and MCP/CLI presentation.
- Approval lifetime, revocation behavior and binding to operation, target, payload and identity.
- Locking granularity for write tasks: session, tab, profile, identity, capability or target object.
- Minimum evidence requirements for each action risk class.
- How human handoff, captcha and login recovery map into admission versus terminal results.
