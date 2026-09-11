# Network Runtime Contract V1

状态：Accepted；版本：1.0；owner：Harbor / Provider Driver（观察）、Core（授权与 Run）。产品归口：[Work Item #498](https://github.com/WebEnvoy/WebEnvoy/issues/498)，后续能力由 [FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497) 承载。产品依据：[canonical v1.1](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)；架构依据：[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md)。

## Boundary

`instance.diagnostics` is a read-only, bounded observation operation. It is
available only after the existing Profile, Grant, origin, and Instance checks.
It does not acquire, renew, release, or transfer the Instance ControlLease and
does not replay an earlier operation when its response is lost.

The public path is Driver → Harbor `POST
/runtime/sessions/{runtime_session_ref}/diagnostics` → Core managed-browser
operation → Agent projection. The operation is bound to the authorized
`profile_ref`, `runtime_session_ref`, selected `page_ref`, and document
generation. Core supplies the intersection of one current Grant, the target
Profile policy, and task scope origins; the Agent cannot submit an origin
allowlist or combine multiple Grants. A stale Page, cursor, closed/lost
Instance, provider failure, origin mismatch, or unproven Page relation returns
an explicit unavailable result.

## Public result

The completed result is `harbor-runtime-diagnostics/v1` and contains a bounded
cursor window of Network metadata and a separate Console window. Each event
has an opaque event reference, UTC timestamp, Page reference, and document
generation. Network events expose only request/response/failure kind, method,
sanitized URL and origin, resource kind, optional status/duration, and a small
failure class (`aborted`, `blocked`, `connection`, `dns`, `timeout`, or
`unknown`). Redirects are represented by subsequent sanitized events; no
redirect chain is inferred by the consumer. Authorized same-origin and
cross-origin redirects are allowed after each destination is checked against
the Core-provided origin set; an unauthorized destination is blocked before
its request is sent and appears only as a bounded `blocked` fact.

The normative completed envelope has these fields; arbitrary Provider fields
are not forwarded:

| Field | Wire type and meaning |
| --- | --- |
| `status`, `schema_version` | Exactly `completed`, `harbor-runtime-diagnostics/v1` |
| `runtime_session_ref`, `profile_ref` | Opaque strings bound by Harbor to the selected Instance/Profile |
| `page_ref`, `document_generation` | Opaque selected Page string and positive integer document generation; shared with the selected controlled-page snapshot |
| `page` | `{current_url: string\|null, title: string\|null, status: loading\|ready\|failed\|closed\|unavailable\|unknown}`; sanitized URL and bounded title |
| `cursor`, `next_cursor` | Opaque window checkpoints; never selectors, endpoint IDs or authority |
| `observed_at` | UTC ISO timestamp of the read, distinct from each event's timestamp |
| `truncated` | Boolean indicating the bounded window did not represent all available/history events |
| `network`, `console` | Arrays sharing a total read limit of 64; console items follow [Console V1](console-runtime-contract-v1.md) |

Each Network item contains `event_ref`, `kind` (`request`, `response`,
`failure`), `observed_at`, `page_ref`, `document_generation`, `method` (at
most 16 characters), sanitized `url` and `origin`, and `resource_kind`
(`document`, `script`, `stylesheet`, `image`, `font`, `xhr`, `fetch`,
`websocket`, `other`). Optional fields are `request_ref` (correlates a
response/failure with its started request), `status` (integer 100–599),
`duration_ms` (integer 0–86400000), `redirected` (true only when the
Provider observed a redirected request), and `failure_class` (the enum
above). Missing timing/redirect linkage means unknown, not zero/no redirect.

`request` records dispatch observed by the Provider; `response` records
response headers/status availability, including non-2xx; `failure` records
transport failure. Duration measures the bounded elapsed time from request
start to the observed response/failure, not response body completion. A 503
is a response, not a transport failure. Navigation and controlled-input
redirects are checked against the Core-provided origin set; an unauthorized
destination is blocked before its request is sent. Diagnostics cannot enable
redirects or broaden that set.

`cursor` is the starting checkpoint; `next_cursor` is the last returned
event, not the newest unreturned event. Reads capture a high-water mark and
paginate only current Page/generation, same-origin events up to that mark.
The cursor binds the Instance, Page, generation and ring position. The
provider may report `cursor_stale` when
the bounded ring has evicted the requested position. `truncated` means the
returned window reached its limit or the provider evicted older events.

## Privacy and limits

- URLs contain origin and bounded pathname only; query, fragment, credentials,
  headers, cookies, authorization material, and request/response bodies never
  cross the boundary.
- The event window is bounded to 64 events per read and the provider ring is
  bounded. Console and page-error text is normalized, truncated to 512
  characters, and replaced with `[redacted]` when it resembles a secret.
- Source locations contain only a sanitized URL and non-negative line/column
  numbers. Stack traces, exception objects, DOM, HAR, and raw provider handles
  are private.
- Diagnostics do not grant Network interception, request modification,
  storage, or controlled evaluation.

## Lifecycle and failure

`wrong_page`, `stale_page`, `stale_document`, `cursor_stale`, and
`page_relation_unavailable` are non-success results and must be surfaced
without guessing. Driver loss invalidates the selected Page binding and
returns `provider_unavailable`; a Page list that cannot prove its relation
returns `page_relation_unavailable` and pauses dependent web dispatch.
Subsequent calls cannot revive the old Instance or guess a replacement Page.
Closing or revoking the authorized session prevents further reads.

The observation exists only during the selected Page's lifetime, starting when
the Driver attaches native listeners. Navigation rotates that Page's document
generation and cursor; Instance stop/Driver exit destroys all in-memory
windows.
There is no independent durable observation session or background recorder.
Each Page ring retains at most 128 sanitized events and the Instance applies
an additional total cap. Per-request correlation
state retains at most 256 requests and is released at request completion or
failure. If correlation was evicted, a later response/failure is omitted,
never assigned fabricated timing or request linkage. Document navigation
commits rotate the Page binding; the committing navigation's retained
request/response are associated with that new document. A failed navigation
that leaves the old document intact does not rotate its binding. Other old
document events and late responses remain private, not relabeled as current.
Events are facts at their `observed_at`, not a promise
that the page is still healthy. Historical Core Run summaries remain subject
to existing Run retention/query semantics and do not revive an observation.

The unavailable wire result is `{status: "unavailable", failure_class,
message, retryable}`. `failure_class` is one of `invalid_request` (malformed
or unsupported input), `session_missing` (no such Instance),
`session_not_ready` (stopped/failed/not active), `page_selection_required`
(multiple visible Pages without an explicit selection), `wrong_page` (origin
does not match), `stale_page` (Page binding replaced), `stale_document`
(document generation replaced), `cursor_stale` (window replaced, expired or
invalid), `page_relation_unavailable` (Provider cannot prove the Page
relation), or `provider_unavailable` (missing capability/Driver). Message is a
bounded safe summary. `retryable` never authorizes replay of a page action.
Core preserves the failure class in its existing failure result;
authentication/Grant/Profile/task refusals occur at the Core boundary first.

The trusted internal Harbor route accepts `{origin, authorized_origins?,
page_ref?, document_generation?, cursor?, limit?}` (`origin` and every
authorized origin must be exact HTTP(S), limit integer 1–64). The optional
`authorized_origins` is a Core-derived internal field and is never accepted
from the ordinary Agent projection. Harbor verifies the Core-provided authorized origin set and the
selected Page binding; it requires the existing Core/owner authorization;
ordinary Agents use the
[Installed Plugin projection](plugin-runtime-exposure-v1.md). Inputs cannot
request headers, bodies, interception, mutation, storage or arbitrary script.
This additive v1 payload requires a matching Runtime/Plugin build; unknown,
malformed, or incompatible versions must be rejected as unavailable and must
not be reinterpreted as a raw Provider result or silently downgraded. No data
migration is needed because the event ring is ephemeral.
