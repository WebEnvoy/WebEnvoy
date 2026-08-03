# 0006. Stage 2 Task Entry and Display Contract

## Status

Accepted for Stage 2 docs-only contract, 2026-06-30.

Superseded for current display hierarchy and authorization UX by
[ADR 0009](0009-human-workbench-information-architecture.md), 2026-07-14.
Owner truth, sensitive-data, cache, query, and unavailable-state boundaries remain valid.

## Context

App Stage 2 needs one user-facing contract for task submission, run viewing,
result/failure display, evidence display, action requests, Browser runtime
facts, and Settings/local cache boundaries.

This ADR covers App issues #36-#53, #55-#57, and #59. The historical #54/#58
Library catalog gap is already covered by [ADR 0005](0005-library-capability-catalog-fields.md)
and is intentionally not reopened here.

This ADR consumes the already merged upstream contracts:

| Upstream fact | App consumption | App must not claim |
|---|---|---|
| Core PR #63 / ADR 0006 common task entry | App maps user input to the shared Task Intent Envelope and consumes the shared fixture/conformance checklist. | Final JSON Schema, API route, CLI/MCP/SDK behavior, or App-specific task truth. |
| Core PR #65 / ADR 0007 reference/version ownership | App displays capability, package, runtime, evidence, source, entrypoint, run, and result refs with owner/freshness/failure states. | Ref owner decisions, registry/storage, or raw material access. |
| Core PR #67 / ADR 0003/0004 Result/Run/Query and Admission/Action Risk | App displays Result Envelope, Run Record query facts, failure taxonomy, recovery hints, admission failures, action risk, validate/draft/preview boundaries, and action requests. | Run Record writes, result shape ownership, admission execution, true-write behavior, or recovery state machine. |
| Harbor PR #58 / ADR 0007 page scene facts | App displays snapshot/refmap/source/evidence/viewer/control/handoff refs and unavailable/redacted/expired states. | Harbor runtime implementation, raw CDP/VNC endpoints, evidence store, browser smoke, or viewer UI implementation. |
| Lode PR #60 / ADR 0003 resource requirements / fixtures / post-check / validator | App explains resource requirements, validator/post-check signals, fixture presence, and write-like deferred conditions. | Package schema, fixture files, validator code, package registry, normalizer, or runtime matching. |

## Decision

App Stage 2 is a display and intent projection over Core, Harbor, and Lode
truth. App can collect user intent, render upstream facts, and store local-only
UI preferences/cache. App does not execute capabilities, write Run Records,
own runtime/session truth, own evidence storage, or own Lode asset truth.

### Task submission intent

| Field or state | Owner | App behavior | Validity / stale rule | Failure display | Non-goal |
|---|---|---|---|---|---|
| `entrypoint=app` | API Server/Core normalizes; App declares source. | Include App as the entrypoint source when submitting through the user surface. | Same task semantics as API/CLI/MCP/SDK; entrypoint must not change scope, policy, or lifecycle. | `caller_invalid` / `entrypoint_unsupported`. | App component tree, shell path, or local draft is not Core truth. |
| `correlation_id` | Caller/API Server. | Show as diagnostic/ref when supplied or generated. | Trace-only; not identity, idempotency, or authorization. | `request_identity_invalid`. | Not a user id or runtime identity. |
| `user_intent` | User/App input; API Server sanitizes; Core consumes. | Show a short human-readable intent and submit only safe public intent text. | Must not contain credentials, cookies, full prompt, full DOM, DevTools command, or arbitrary script. | `intent_invalid` / `private_field_rejected`. | No chat transcript or low-level browser command submission. |
| `capability_ref` / `capability_version` | Lode owns; Core validates; App displays. | Show selected capability/package/version and source. | Must be known, stable or explicitly allowed preview, and compatible with the request. | `capability_unknown` / `capability_not_stable` / `capability_version_invalid` / `invalid_contract`. | App does not copy package body, fixture, site knowledge, or adapter source. |
| `input_summary` / public input refs | API Server/Core owns normalized summary; App collects display input. | Show safe summary and refs, not raw large/sensitive payloads. | JSON-safe summary only; files, raw response, secrets, and private materials go by ref. | `input_contract_invalid` / `input_ref_unavailable`. | No local file path, token, account material, raw payload, or provider private object in intent. |
| `scope` | Caller/App declares; Core validates. | Display target site/object/account environment boundary. | Must not be wider than capability and Harbor runtime facts. | `scope_invalid` / `target_type_invalid`. | Not provider routing, account-pool selection, proxy choice, or business policy engine. |
| read-only scope | Core policy and Lode operation mode decide; App labels. | Show `risk=read` and disable write claims for read-only tasks. | Any validate/draft/preview/write-like path must stay visibly separate. | `risk_not_allowed` / `intent_incompatible`. | No true write, submit, destructive, or approval execution in Stage 2. |
| `policy` / `constraints` | Caller/App supplies public policy; Core enforces. | Show execution expiry, cancel boundary, evidence policy, and allowed retry/resubmit semantics. | Re-evaluate after policy, capability, runtime facts, or evidence policy changes. | `policy_denied` / `timeout_invalid` / `evidence_policy_missing`. | App does not implement ACL or admission. |
| `resource_requirement_refs` | Lode declares; Harbor supplies facts; Core matches. | Show requirement summary and current availability explanation from Core/Harbor facts. | Stale after profile switch, login change, session restart, proxy change, or evidence policy change. | `resource_requirement_missing` / `runtime_facts_stale` / `resource_unavailable`. | App does not store Profile, Execution Identity, Runtime Session, provider route, or private facts. |
| cancel / retry / resubmit intent | Core owns run semantics; App sends intent. | `cancel` asks Core to stop progression; `retry`/`resubmit` creates a new run linked to prior run. | Must not rewrite old terminal status. | `action_not_available` / `cancel_unknown` / `run_ref_invalid`. | No local run state mutation or external-system undo promise. |
| App does not write Run Record | Core. | Invalid/private-field request failures show before Run Record; trusted post-admission failures query Core run facts. | App query/cache never becomes durable run truth. | `request_invalid` before Run Record; `failed` Run Record after accepted/admission path. | No App Run Record, local durable task store, or alternate run status machine. |
| shared entry fixture / conformance | Core owns fixture shape; App consumes. | App Stage 2 must map its submit UI semantics to Core ADR 0006 fixture fields. | Recheck when fixture/conformance files or Core fields are added later. | Same failure code as API/CLI/MCP/SDK for missing/private fields. | This PR does not create fixture files or a runner. |

### Run viewer facts

| Field or state | Owner | App behavior | Validity / stale rule | Failure display | Non-goal |
|---|---|---|---|---|---|
| run identity / status / timestamps | Core Run Record. | Show `accepted`, `running`, terminal state, created/updated/terminal times, and safe summary. | Terminal state is monotonic; evidence expiry does not rewrite outcome. | `run_not_found` / `invalid_state_transition`. | App does not define lifecycle or store durable run truth. |
| timeline / attempts / events | Core; refs may point to Harbor evidence. | Show task-bound event summaries and attempt summaries when provided. | Complete debug log or agent history is not required for v0. | `metric_unavailable` / `source_trace_unavailable`. | No full prompt, LLM response, raw browser trail, or log warehouse. |
| query surface | Core. | `get run`, `get result`, `get failure`, `get evidence ref state`, `get recovery entry` all read Core refs. | App local cache is rebuildable and must carry stale markers. | `permission_denied` distinct from `not_found`; `expired` does not erase run summary. | No App-side query index or product search implementation. |
| polling / loading | App UI state. | May show local loading/retry indicators while querying owner APIs. | Local-only; must not be written as run status. | `connection_unavailable` / `query_timeout`. | No background runner or scheduler. |
| empty | Core result/query state. | Show empty result as a valid outcome when Core returns `empty`. | Empty is not evidence missing or query failure. | `empty_result` only when owner says so. | App does not infer empty from missing UI data. |
| expired | Core/Harbor/Lode owner policy. | Show expired result/evidence/cache separately. | Expired body/ref may leave terminal summary and locator metadata. | `result_expired` / `evidence_expired`. | App cannot restore expired raw material. |
| connection health | App reads API/Harbor/Lode connection facts. | Show source-specific health: Core API unavailable, Harbor session unavailable, Lode catalog unavailable. | Health is source freshness, not task outcome. | `connection_unavailable` / `runtime_session_unavailable` / `catalog_unavailable`. | App does not collapse all outages into task failure. |
| session unavailable | Harbor owns session facts; Core owns run consequence. | Show unavailable/expired/runtime lost and route user to Browser/Settings or retry when Core allows. | Runtime facts can change after run; historical Run Record keeps refs. | `runtime_session_unavailable` / `runtime_ref_expired` / `runtime_lost`. | App does not restart or rebind runtime without owner API. |

### Result and failure display

| Field or state | Owner | App behavior | Validity / stale rule | Failure display | Non-goal |
|---|---|---|---|---|---|
| `envelope_version` / outcome / terminal | Core. | Display supported version, `success`, `partial`, `empty`, `failed`, `blocked`, `requires_user_action`, `manual_recovery_required`, or `unknown_outcome`. | Unsupported version blocks confident rendering. | `unsupported_version` / `projection_failed`. | App does not create a competing result envelope. |
| structured data / items / projection refs | Lode owns public shape; Core validates/envelopes. | Render JSON-safe public payload or summary/projection refs. | Large/heavy/sensitive data remains by ref and may expire. | `output_invalid` / `normalization_failed` / `mapping_incomplete`. | No raw DOM/HAR/screenshot/network body/Cookie/Token/local path. |
| capability/package/run/result refs | Lode/Core. | Show source attribution and historical version/lock summary. | Historical run must not be rewritten by later Lode changes. | `capability_version_incompatible` / `package_lock_mismatch` / `result_unavailable`. | No installer, registry, or package storage. |
| failure reason | Core taxonomy. | Show category, code, phase, safe message, owner, refs, and recovery hint. | Evidence unavailability does not delete failure detail. | Core taxonomy including `request_invalid`, `capability_contract`, `resource_admission`, `action_risk`, `runtime_execution`, `result_projection`, `evidence_reference`, `persistence_observability`. | App does not classify arbitrary exceptions into business outcomes. |
| recovery prompt | Core/Harbor facts; App renders intent. | Show owner-provided hint such as `fix_input`, `select_capability_version`, `connect_runtime`, `login_or_select_profile`, `request_approval`, `manual_handoff`, or `repair_package`. | Prompt actions must be rechecked against current owner facts. | `action_not_available` when stale. | App does not decide recovery result. |
| validate-only | Core/Lode/Harbor contract. | Show validation as validation, not execution. | Must be rerun after capability/runtime/evidence policy changes. | `validated` or structured failure. | No external mutation and no result history success. |
| draft | App/Core depending on surface; owner API confirms. | Show local/product draft or payload ref as pending. | Expires or revalidates before submission. | `draft_unavailable` / `draft_expired`. | Draft is not Core result, Lode asset truth, or external state. |
| preview | Core/App displays expected change/risk/refs. | Show expected change and evidence/risk material for confirmation. | True write must rerun admission with current facts. | `preview_ready` / `preview_blocked` / `preview_expired`. | Preview is not submitted result or run success. |
| result history boundary | Core owns history; App queries. | Only accepted Core runs and result refs enter history. | Preview/draft/validate-only stay outside result history unless Core later records a run fact. | `run_not_found` / `result_unavailable`. | No App-owned history truth. |

### Evidence display

| Field or state | Owner | App behavior | Validity / stale rule | Failure display | Non-goal |
|---|---|---|---|---|---|
| evidence card identity | Harbor/Core evidence refs. | Show ref id, type, producer, captured_at, redaction, retention/access state, owner, and safe summary. | Follows owning evidence policy. | `evidence_missing` / `evidence_unavailable`. | No raw evidence store in App. |
| source trace | Harbor/Core/Lode according to ref. | Show source binding, capture method, producer, and upstream source locator when safe. | Missing refs still show which source is missing when owner provides it. | `source_missing` / `source_stale` / `source_unavailable`. | No provider stack trace, raw endpoint, secret, or unredacted log. |
| thumbnail | Harbor/App policy. | Show only policy-allowed thumbnails or safe placeholders. | Must respect redaction and expiration; cached thumbnail is display cache only. | `redacted` / `expired` / `permission_denied`. | No default full screenshot, video, HAR, trace, or network body. |
| viewer link | Harbor viewer facts; App authorization UI. | Link through `viewer_ref` / `viewer_access` and show availability. | Expires with session/viewer policy. | `viewer_unavailable` / `permission_denied` / `expired` / `unsupported`. | No raw VNC/CDP/ws endpoint or viewer implementation in this PR. |
| redacted | Evidence owner. | Show redacted state and owner/source; do not replace with cached raw value. | Redaction wins over local cache. | `evidence_redacted`. | No bypass or local reveal. |
| expired | Evidence owner. | Show historical locator/summary if owner allows. | Cannot be refreshed unless owner provides rerun/recapture path. | `evidence_expired`. | App cannot recover deleted raw evidence. |
| unavailable / access denied | Owner endpoint/policy. | Distinguish source down, missing, access denied, capture denied, and policy denied. | Recheck owner API before enabling actions. | `evidence_access_denied` / `capture_denied` / `policy_denied`. | No fallback to stale cache as fresh evidence. |

### Action request display

| Field or state | Owner | App behavior | Validity / stale rule | Failure display | Non-goal |
|---|---|---|---|---|---|
| `action_request_ref` | Core. | Show requested intent, owner, target, payload/preview refs, and allowed user choices. | Must bind to current operation, target, payload, identity, risk, and expiry. | `intent_unsupported` / `approval_required`. | App does not execute the action. |
| risk level | Core derives from Lode declaration + caller policy. | Show `read`, `write`, `submit`, or `destructive`, with Stage 2 true-write deferred. | Re-evaluate when capability/runtime/policy changes. | `risk_not_allowed` / `approval_required`. | No site-specific risk engine in App. |
| expected change | Core/App preview material; Lode input/output contract. | Show concise expected change and affected target when supplied. | Preview material expires and must be revalidated. | `target_unavailable` / `payload_invalid` / `preview_expired`. | Not proof of external write. |
| approve intent | App sends user decision to owner API. | Submit approval intent only when owner action request is current. | Approval must not outlive expiry or mismatch target/payload/identity. | `approval_expired` / `approval_mismatch`. | No local approval truth or policy bypass. |
| decline intent | App sends user decision to owner API. | Record user decline through owner API when supported. | Does not mutate run outcome until Core records it. | `action_not_available`. | App does not rewrite run state. |
| cancel intent | App sends cancel/request_cancel to Core. | Show cancellation scope and uncertainty. | Cancel may not undo external writes; Stage 2 has no true-write execution. | `cancel_unknown`. | No external-system rollback promise. |
| expiry | Core/owner. | Show expires_at / stale marker when supplied. | Disable stale approval/preview/draft affordances. | `approval_expired` / `preview_expired`. | No local extension of owner expiry. |

### Browser runtime, viewer, handoff, and Settings

| Field or state | Owner | App behavior | Validity / stale rule | Failure display | Non-goal |
|---|---|---|---|---|---|
| `runtime_session_ref` | Harbor. | Show session id/ref, provider family, health summary, bound time, and safe state. | Fresh only for current session lease/health window. | `runtime_session_unavailable` / `runtime_ref_expired`. | No browser process, raw CDP/VNC URL, profile path, cookie, token, or provider driver in App truth. |
| `profile_ref` / `execution_identity_ref` | Harbor. | Show public profile/identity availability and login/setup hints. | Recheck after login state, policy, profile, or identity changes. | `profile_unavailable` / `identity_unavailable` / `login_required`. | No credential, account payload, persona, or profile data storage. |
| viewer fields | Harbor + App authorization. | Show `viewer_ref`, `viewer_access`, transport summary, input capability, expires_at, and current availability. | Link must be rechecked before open/takeover. | `viewer_unavailable` / `input_disabled` / `policy_denied`. | No viewer UI, raw endpoint, or remote browser implementation. |
| control owner | Harbor records runtime fact; Core/App consume. | Show `agent`, `user`, `app`, `provider`, `none`, or `unknown` plus reason/time when provided. | Owner is not task outcome. | `control_owner_unknown` / `control_lost` / `locked`. | App does not infer business success from control owner. |
| handoff/takeover | Core/App request, Harbor runtime fact. | Show reason such as login, captcha, policy requires user, user requested, automation blocked, viewer only, control lost, provider limit, or unknown outcome risk. | Recovery action must re-query Core/Harbor. | `handoff_required` / `takeover_denied` / `control_lost`. | No full handoff state machine here. |
| Settings connection state | App local settings; owner APIs supply health. | Store API endpoint choices, Harbor/Lode source locators, recent view preference, and non-sensitive diagnostics. | Local-only, user-editable, rebuildable. | `connection_unavailable` / `configuration_invalid`. | Not Core/Harbor/Lode truth. |
| local-only cache | App. | May cache non-sensitive display snapshots, recent views, filters, collapsed sections, and stale markers. | Must carry source, fetched_at, and stale/unknown/redacted markers; owner fact wins. | `cache_stale` / `source_unavailable`. | No Run Record, runtime truth, raw evidence, credentials, package body, fixture body, or profile/session facts. |

## Research absorption boundary

| Input | Absorb | Trimmed reuse | Reference only | Rejected from MVP |
|---|---|---|---|---|
| `App/ROADMAP.md` and existing App ADRs | App is Work/Library/Browser/Settings display + intent surface; App does not own Core/Harbor/Lode truth. | This ADR narrows Stage 2 to task/run/result/evidence/action/browser/settings display contracts. | Later stages may add UI, viewer, Library, and write workflows. | Building App shell, UI implementation, local truth store, or hosted Console now. |
| Core ADR 0006 common task entry | Shared Task Intent Envelope fields, read-only fixture intent, conformance checklist, cancel/retry semantics. | App consumes fixture shape but does not create fixture files or runner in this PR. | API/CLI/MCP/SDK projections remain upstream details. | App-specific task schema or result history. |
| Core ADR 0007 reference/version ownership | Owner/ref/freshness/failure semantics for capability/package/runtime/evidence/source/run/result refs. | App displays refs and states only. | Future schema names may differ. | Copying package, runtime, evidence, or App UI state into Core/App truth. |
| Core ADR 0003/0004 result/run/query and admission/action risk | Result Envelope fields, Run Record query shape, taxonomy, recovery hints, action request/risk/validate/draft/preview boundaries. | App renders and sends intent; Core remains owner. | Write reconciliation and true-write are future Work Items. | Treating preview/draft/validate-only as result history or submitted outcome. |
| Harbor ADR 0007 page scene facts | `snapshot_ref`, `refmap_ref`, `source_trace`, `evidence_ref`, viewer/control/handoff facts and redacted/expired/unavailable states. | App displays refs, thumbnails, viewer links, and handoff prompts under policy. | Manager/VNC/CDP mechanisms inform later viewer implementation. | Raw DOM/HAR/screenshot/video/network body, raw CDP/VNC endpoint, provider private ids, viewer code. |
| Lode ADR 0003 resource/fixtures/post-check/validator | Resource requirement summary, fixture/post-check signals, validator status, write-like deferred conditions. | App turns Lode/Core/Harbor statuses into explainable display rows. | Package schema and validator report details may later stabilize. | Package/fixture/schema/validator/registry implementation in App. |
| `research/synthesis.md` | Runtime facts vs task policy split; Run Record/evidence as shared boundary; mechanism/source reuse layering. | App records only display and intent consequences. | Product-stage owner decisions remain in Core/Harbor/Lode. | Hosted browser/vault/persona platform, full crawler queue, generic browser agent loop. |
| `research/absorability/README.md` | Use the absorb/trim/reference/reject method. | No product field comes directly from the index file. | Product repo routing guidance. | Treating research notes as executable contract. |
| `research/absorability/themes/api-cli-mcp-and-agent-interface.md` | Small deterministic interfaces, typed diagnostics, shared envelope, reference-over-value. | Use as contract seed for App shared entry fixture and diagnostics only. | CLI/MCP transports and command names can inform later entry UX. | Exposing CDP/eval/DevTools/Profile APIs as App task interface. |
| `research/absorability/themes/evidence-and-observability.md` | Evidence refs, retention/redaction, Run Record baseline, non-proof policy. | Evidence card uses refs/summaries/states only. | Larger artifact taxonomy can inform future Evidence UI. | Default raw screenshot/HAR/trace/video/network body/prompt/agent history storage. |
| `research/subjects/CloakHQ/CloakBrowser-Manager/wiki/index.md` and source mirror | Confirms runtime/viewer/profile manager evidence was captured. | Viewer/VNC/CDP proxy and access isolation are mechanism seeds for Harbor/App later. | Wiki structure only; not a product contract. | Migrating Manager backend/frontend/UI shell, `RunningProfile`, provider lifecycle, or raw endpoints into App MVP. |

## Covered issues

| Issue | Covered by |
|---|---|
| #36 / #37 / #38 / #39 / #57 | Task submission intent, App no Run Record boundary, cancel/retry/resubmit, shared fixture/conformance. |
| #40 / #41 / #42 / #43 | Run viewer status/timeline, query/polling/loading/empty/expired, connection/session unavailable. |
| #44 / #45 / #46 / #47 | Structured result, failure/recovery display, preview/draft/validate-only boundary. |
| #48 / #49 / #50 / #51 | Evidence card fields, redacted/expired/unavailable, thumbnail/source trace/viewer link. |
| #52 / #53 | Action request display, approval request, approve/decline/cancel intent, risk/expected change/expiry. |
| #55 / #56 / #59 | Browser runtime/viewer/handoff facts, Settings and local-only cache boundary. |

## Consequences

- App can proceed to later UI Work Items with a stable display contract, but this PR
  does not create that UI.
- Missing, redacted, expired, unavailable, stale, and permission denied remain distinct
  states instead of being hidden behind empty cards.
- App local settings and cache stay useful for UX without becoming a second truth
  source.

## Non-goals

- No UI/App shell implementation.
- No schema, API client, generated types, runtime, storage, evidence viewer, Settings
  implementation, fixture, conformance runner, package validator, or real write behavior.
- No Core/Harbor/Lode modification.
- No issue closeout and no merge.

## Deferred

- Concrete App UI layout, routing, component states, accessibility behavior, and App
  shell.
- Actual shared entry fixture files, conformance runner, API client, and schema/types.
- Full Browser viewer implementation and handoff state machine.
- Real write approval/execute/reconcile/cancel workflows.
- Evidence export, raw viewer, hosted Console, team/cloud settings, marketplace, and
  sync behavior.
