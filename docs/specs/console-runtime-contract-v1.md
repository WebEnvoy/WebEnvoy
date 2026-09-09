# Console Runtime Contract V1

状态：Accepted；版本：1.0；owner：Harbor / Provider Driver。产品归口：[Work Item #498](https://github.com/WebEnvoy/WebEnvoy/issues/498)，后续由 [Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497) 承载。依据：[canonical v1.1](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)、[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md)。

Console and page-error observations use the same `instance.diagnostics` route,
authorization, Page binding, cursor, lifecycle, and bounded window as the
[Network Runtime Contract V1](network-runtime-contract-v1.md).

The public levels are `warn`, `error`, and `pageerror`. A record contains an
opaque event reference, UTC timestamp, Page reference, document generation,
bounded normalized text, a truncation bit, and an optional sanitized source
location. Provider-specific console argument objects, stack traces, DOM,
cookies, headers, tokens, credentials, and raw exception values are never
public fields. Secret-looking `name=value` material is replaced with
`[redacted]` before it leaves the Driver.

An observation is not a control target and never changes the Instance
ControlLease. Page navigation, close, driver loss, stale cursor, origin drift,
or revocation makes the corresponding read unavailable; consumers must not
pretend an empty window means that the browser had no errors.

## Wire fields and interpretation

Each item in the envelope's `console` array has `event_ref` (opaque string),
`level` (`warn`, `error`, `pageerror`), `observed_at` (UTC ISO timestamp),
`page_ref`, `document_generation` (positive integer), `text` (string, at most
512 characters), and `truncated` (boolean). Optional `source` has sanitized
`url` and optional non-negative integer `line`/`column` using the Provider's
zero-based location. Omitted location means unavailable, not the main script.
The containing result binds every item to the authorized Profile/Instance.

`warn` maps native warning, `error` maps native console error, and `pageerror`
maps an uncaught page exception (including a rejection when the Provider emits
it as a page error). Missing Provider events are not inferred. Error objects,
arguments and stack frames are never serialized as a public structure.

Text truncation remains visible after Driver and Harbor normalization. The
shared event limit is 64 per read, with at most 128 retained events per active
Page; lifecycle and unavailable fields are defined by Network V1. Secret-like
text is filtered before retention and again at the public normalization
boundary; filtering must precede truncation. Content is untrusted data and
must never be executed or treated as authority by the consuming Agent.

This slice excludes ordinary `log`/`debug` history, full stack traces, remote
object inspection and arbitrary evaluation. It does not promise to detect
arbitrary unlabeled confidential prose; no raw console recording or argument
dump is offered. Provider/version support and unverified limits must be
reported with the actual fixture/live evidence.
