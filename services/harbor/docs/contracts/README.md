# Harbor contract index

This directory indexes Stage 2 accepted Harbor contract truth. It does not duplicate ADR specs.

## Accepted contracts

| Contract area | Accepted truth source | Later implementation may depend on |
|---|---|---|
| Runtime Session lifecycle v0 | [ADR 0005](../adr/0005-runtime-session-lifecycle-v0.md) | `runtime_session_ref`, lifecycle states, lease, continuity, unavailable/error classifications, and viewer/CDP/evidence availability. |
| Provider, Profile, and Identity facts v0 | [ADR 0006](../adr/0006-provider-profile-identity-facts-v0.md) | `provider_ref`, `profile_ref`, `execution_identity_ref`, fact source classes, claim/evidence separation, and sensitive data boundaries. |
| Page scene reference facts v0 | [ADR 0007](../adr/0007-page-scene-reference-facts-v0.md) | `snapshot_ref`, `refmap_ref`, `source_trace`, `evidence_ref`, capture-source choices, failure classes, viewer access, and handoff facts. |
| Runtime architecture baseline | [ADR 0008](../adr/0008-harbor-runtime-architecture-baseline.md) | TypeScript/Node/Playwright/CDP/SQLite defaults, module/storage boundaries, page-scene refs, viewer/control ownership, smoke-test minimums, and rejected/deferred runtime scope. |
| Browser provider lifecycle | [ADR 0009](../adr/0009-provider-lifecycle-management.md) | Managed/system/external provider ownership, detection, installation, update, repair, launch verification, integrity, progress, and recoverable failures. |

## Runtime API ownership boundary

`GET /runtime/sessions/{runtime_session_ref}/runtime-facts` is the canonical
owner-clean Harbor surface and returns `harbor-core-runtime-facts/v0`. The
legacy `/site-resource-facts` and `/read-operations` routes remain bounded
rollback adapters until Core #342/#343 provide exact cutover evidence. Their
site admission, Lode pins, `public_summary`, and normalized result fields are
compatibility payloads only, not Harbor-owned facts.

## Required read order for later skeletons

Provider, session, evidence, or viewer implementation PRs must read ADR 0008 first, then the narrower accepted contract:

| Future skeleton | Required contracts |
|---|---|
| Provider or Profile facts/lifecycle | ADR 0008, then ADR 0009, ADR 0006, and ADR 0005. |
| Runtime Session API | ADR 0008, then ADR 0005 and ADR 0006. |
| Snapshot / RefMap / Evidence refs | ADR 0008, then ADR 0007 and ADR 0004. |
| Viewer / handoff / control ownership | ADR 0008, then ADR 0007, ADR 0003, and App ADR `App/docs/adr/0002-run-viewer-and-handoff-surface.md`. |

Deferred by ADR 0008/0009: hosted browser, provider marketplace, credential vault, full desktop console, runtime package scaffold, database schema, and implementation tutorials. ADR 0009 supersedes ADR 0008 only for managed browser binary/dependency installation; that lifecycle is accepted and implemented only by its bounded Work Items.

## Absorbed draft analysis

| Draft source | Still-valid analysis | Accepted landing point | Rejected or deferred boundary |
|---|---|---|---|
| `docs/draft/browser-drivers.md` | Driver is an adapter that launches/connects/configures browser runtime, binds profile data, reaches CDP readiness, reports health/errors, and returns provider capability facts. It must not understand site business, decide task suitability, store user business parameters, replace evidence storage, or leak provider-native flags as public model. | ADR 0006 owns provider facts, observed/configured/claim distinction, known limitations, provider source/license/binary boundaries, and sensitive data exclusions. ADR 0005 consumes driver output through session availability and errors. | Provider directory layout and first provider order are deferred to implementation/provider evaluation. Provider-specific launch flags, success-rate claims, anti-detection guarantees, and task suitability are rejected as contract truth. |
| `docs/draft/evidence-store.md` | Evidence is structured execution-site evidence for debugging, validation, failure tracing, and capability evolution. Harbor may expose refs for raw payload, evidence, snapshot, network summary, screenshot, source trace, and runtime/session/profile/identity context while excluding normalized site results. | ADR 0007 owns `snapshot_ref`, `refmap_ref`, `source_trace`, `evidence_ref`, redaction/retention/source binding, evidence failure classes, and optional screenshot/console/network/diagnostic refs. | Full screenshots, full DOM, full request/response bodies, cookies, tokens, credentials, HAR/trace/video/raw payload by default, normalized result schemas, collection/comment/dataset schemas, business cursor semantics, and Lode capability output are rejected or policy-gated/deferred. |
| `docs/draft/profile-identity-model.md` | Harbor separates browser environment/Profile from site/account Execution Identity; login state, risk events, allowed execution channels, evidence policy, resource requirements, and usage history belong to identity facts rather than one-off errors. | ADR 0006 owns `profile_ref`, `execution_identity_ref`, profile facts, identity facts, login-state provenance, sensitive profile/account data exclusions, and relation to `runtime_session_ref`. | Concrete fingerprint field schema, account health score, credential payloads, and exact Profile-to-Identity cardinality rules are deferred to schema/policy work; task success and account safety scoring are rejected. |
| `docs/draft/resource-lifecycle.md` | Harbor resources need acquire/release/invalidate semantics, leases, resource traces, health evidence, and Core/Lode boundaries so browser identity and runtime state are auditable instead of temporary parameters. | ADR 0005 owns session lifecycle states, lease rules, continuity, unavailable/recovery/takeover errors, and viewer/CDP/evidence availability. ADR 0006 owns provider/profile/identity binding and health-sensitive facts. ADR 0007 owns evidence/source refs that can support diagnostics. | `HarborResourceRecord`, bundle, lease, trace event, and health evidence field schemas remain deferred. Core Run Record, Lode resource lifecycle, normalized results, provider routing scores, and public credential/profile data are rejected. |
| `docs/draft/runtime-capability-facts.md` | Harbor should expose objective facts, not task conclusions: provider, profile, runtime session, automation exposure, and evidence policy facts help Core/Lode/user policy decide requirements while Harbor avoids risk scores and business semantics. | ADR 0005 owns runtime session capability/availability facts. ADR 0006 owns provider/profile/identity capability facts and fact-source classes. ADR 0007 owns evidence policy facts, page-scene refs, viewer access, and handoff facts. | Automation-exposure examples are background, not success guarantees. Black-box risk scoring, provider ranking, target-site suitability, account safety scoring, business strategy, normalized results, and site schema are rejected. Exact versioned field sets remain deferred to API/schema work. |

ADR 0001-0004 and `docs/draft/` remain process/background material unless a later accepted ADR promotes them.
