# 0005. Library Capability Catalog Fields

## Status

Accepted.

## Context

App Library needs a small display contract for capability catalog metadata before any
UI, store, installer, marketplace, or real package registry exists. Lode already owns
the package minimum format v0: site capability identity, operation, family, lifecycle,
version, resource requirements, fixtures, post-checks, known limitations, and
invalidation markers. Core owns admission, execution, Run Record, result envelope, and
post-check execution facts. Harbor owns runtime session, profile/provider, viewer, and
evidence reference facts.

This ADR defines only what App may display and locally remember. It does not define
the Lode package schema or promote missing upstream facts into completed product
features.

## Decision

Library capability catalog fields v0 is an App display projection over upstream facts.

| Field or state | Owner | Library consumer behavior | Validity / stale rule | Failure display | Non-goal |
|---|---|---|---|---|---|
| Display name | Lode | Show the upstream human label. If absent, show the capability id with an `unknown name` marker. | Refresh with the catalog fact that supplied it. | `unknown` if the field is absent; `unavailable` if the catalog cannot be reached. | App does not invent official names. |
| Capability id | Lode | Show as the stable technical identifier and deep-link key when supplied. | Treat as immutable within a catalog version. | `metadata missing` blocks install/run affordances. | App does not mint ids. |
| Version / lock | Lode for asset version; Core for run attribution; App for local pin preference only | Show available version, installed/locked version, and local pin intent when those facts exist. | Version facts expire with the upstream catalog snapshot; local pin is UI preference until owner API accepts it. | `unknown version`, `lock unavailable`, or `stale lock` instead of pretending the asset is current. | No installer, updater, rollback, or registry implementation. |
| Family / tags | Lode | Use for grouping and lightweight filtering when supplied. | Recompute from upstream metadata; local sort/filter choices are cacheable UI settings. | Hide missing tags or mark `uncategorized`; do not treat absence as a capability defect. | App does not define canonical taxonomy. |
| Operation mode | Lode declares capability intent; Core owns admission/action risk | Show read, validate-only, draft/preview, write-like, or unknown when supplied. Write-like states require owner facts before action affordances. | Re-evaluate when capability metadata or Core admission contract changes. | `unknown mode` disables action claims; `invalid contract` when upstream says the mode is inconsistent. | App does not decide action risk. |
| Lifecycle / deprecation / invalidation | Lode owns lifecycle and invalidation marker; Core may report run-time invalid contract | Show proposed, experimental, stable, deprecated, invalidated, or unavailable with reason/source when supplied. | Invalidation/deprecation wins over cached display facts. | `deprecated`, `invalidated`, `invalid_contract`, or `capability_unavailable`. | App does not repair or clear invalidation. |
| Resource requirement summary | Lode declares abstract requirements; Core matches them against Harbor facts | Show a short requirement summary such as profile/session/provider/evidence needs only as declared requirements, not as current availability. | Current availability must come from Core/Harbor health/admission facts. | `requirement unknown`, `resource unavailable`, or `admission unavailable`. | App does not choose Harbor profile/provider or store runtime truth. |
| Fixture / post-check signals | Lode owns fixture and post-check requirements; Core owns execution result | Show only presence, freshness, and owner status: fixture exists, missing, redacted fixture, post-check required, post-check passed/failed when a Core run reports it. | Package fixture facts refresh with Lode; execution signals refresh with Core run facts. | `fixture missing`, `post-check unavailable`, `post-check failed`, or `redacted`. | App does not inline fixtures, run checks, or store raw evidence. |
| Source and evidence refs | Core/Harbor/Lode as appropriate | Show refs, summaries, and policy-allowed thumbnails only. | Ref freshness follows owning evidence/catalog policy. | `redacted`, `expired`, `permission denied`, or `unavailable`. | App does not copy raw screenshot, HAR, trace, DOM, network body, or payload. |

Library may save these local-only UI values:

| Local value | App may save | Boundary |
|---|---|---|
| Sorting, grouping, visible columns, collapsed families, recent Library view | Yes | Non-sensitive UI preference only. |
| Search text, filter chips, selected tags/family, dismissed local hints | Yes | Local convenience; not catalog truth. |
| Cached non-sensitive catalog display snapshot | Yes, short-lived and rebuildable | Must keep upstream source, fetched-at, and stale/unknown markers. |
| Local pin/lock intent before owner confirmation | Yes, as pending UI intent | It is not a real lock until Lode/Core owner API returns a fact. |
| Package body, fixture body, raw evidence, credentials, Harbor profile/session facts, Core Run Record facts | No | App may store refs or summaries only when owner policy allows. |

Unknown, redacted, and unavailable are distinct display states:

| State | Meaning | Library display rule |
|---|---|---|
| `unknown` | Upstream fact exists or may exist, but the field was not supplied or not yet standardized. | Show an unknown marker and avoid enabling claims that require the field. |
| `redacted` | Owner intentionally hid the value. | Show redacted with owner/source; never replace with cached raw value. |
| `unavailable` | Owner endpoint, catalog, evidence, or admission source cannot be reached. | Show unavailable and source; do not treat cached data as fresh success. |
| `metadata_missing` | Required catalog identity/version/lifecycle field is missing for the action being displayed. | Disable dependent action affordances and classify as contract gap. |
| `invalid_contract` | Owner says metadata is inconsistent or not consumable. | Show invalid contract; route repair/report intent to Lode/Core owner flow. |

## Consequences

- App can build Library browsing and filtering later without owning Lode asset truth.
- Missing facts stay visible as missing facts, so a pretty card cannot imply install,
  run, or validation readiness.
- This contract can consume Lode local package metadata now and a future registry later,
  but it does not require or promise marketplace, hosted sync, install, update, or repair.
- Fixture and post-check signals are summaries only; raw fixtures and real post-check
  execution remain outside App.

## Alternatives Considered

- Define an App-owned catalog schema: rejected because it would duplicate Lode truth.
- Implement a local catalog store now: rejected because this is a docs-only field
  contract and no UI/store behavior is needed.
- Treat missing metadata as empty strings: rejected because it hides contract gaps.
- Promise marketplace or installer fields now: rejected because Lode package minimum v0
  only needs local metadata and version identity.

## Research Evidence

| Input | Absorbed | Trimmed | Reference only | Rejected |
|---|---|---|---|---|
| Lode ADR 0002/0003/0004 and pending decisions | Capability id, operation, family, lifecycle, version, resource requirements, fixture/post-check, invalidation, and local registry identity are upstream owner facts. | App keeps only display projection and local UI settings. | Registry shape may later change without changing App ownership. | App-owned package schema, hosted registry promise, or runtime/provider selection. |
| `research/absorability/themes/api-cli-mcp-and-agent-interface.md` | Small deterministic interfaces, reference-over-value outputs, and owner-specific tool surfaces. | No CLI/MCP/API surface is designed in this ADR. | Browser tool registries are useful for future entry consistency. | Directly exposing low-level CDP/eval/browser tools as Library capability truth. |
| `research/absorability/themes/evidence-and-observability.md` | Evidence refs, redaction, expiration, unavailable states, and post-check/result separation. | Library shows summaries and owner markers only. | Broad artifact taxonomies can inform later Work/Evidence UI. | Default raw screenshot/HAR/trace/video/network body storage in App. |
| App ADR 0004 | Capability browser reads Lode metadata and marks unknown/unavailable states. | This ADR narrows that to catalog field display only. | Run history and evidence browser remain separate surfaces. | App-defined package schema or evidence store. |

## Deferred Decisions

- [PD-0015](pending-decisions.md#pd-0015): full Lode catalog filtering/search stable fields.
- Real install, update, lock confirmation, rollback, repair, marketplace, and hosted
  registry behavior remain future Work Items.
- UI component layout, App shell, catalog store, and synchronization are intentionally
  outside this docs-only ADR.
