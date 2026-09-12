# Console Runtime Contract V1

状态：Accepted；版本：1.0；owner：Harbor / Provider Driver。产品归口：[Work Item #498](https://github.com/WebEnvoy/WebEnvoy/issues/498)，后续由 [Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497) 承载。依据：[canonical v1.4](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)、[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md)。

> **2026-09-12 Provider 事实**：本合同保持 Provider-neutral 的 Console/Page Error observation 语义；#519 的官方固定 Camoufox 路径只按 `limited` 使用。Console/page-error 事件只有在 Driver 能把事件可靠关联到已登记 Page、当前 `page_ref` 和 `document_generation` 时才投影；popup 首请求关系未知时不创建或猜测 Page ref，迟到的 Page 事件也不回填早先未归属的事件。正式 installed、人工交还和环境连续性仍待 #519 完成门；旧私有 launch binding、patched/native artifact 仅作历史/恢复事实。

Console and page-error observations use the same `instance.diagnostics` route,
one-Grant origin intersection, authorization, selected Page binding, document
generation, cursor, lifecycle, and bounded window as the
[Network Runtime Contract V1](network-runtime-contract-v1.md).

The #519 upstream Driver keeps this projection Page-local. An event from a
known Page is retained with that Page's opaque reference; an event whose Page
relation is unknown, stale, closed, or outside the authorized origin set is
not assigned to the last selected Page, the native active tab, or a newly
observed Page. After takeover/return or a document change, the consumer must
freshly observe the original task Page before using new targets; an old
console cursor is stale. This localizes the popup limitation and leaves the
original task Page and other trusted Pages available.

The public levels are `warn`, `error`, and `pageerror`. A record contains an
opaque event reference, UTC timestamp, Page reference, document generation,
bounded normalized text, a truncation bit, and an optional sanitized source
location. Provider-specific console argument objects, stack traces, DOM,
cookies, headers, tokens, credentials, and raw exception values are never
public fields. Secret-looking `name=value` material is replaced with
`[redacted]` before it leaves the Driver.

An observation is not a control target and never changes the Instance
ControlLease. Page navigation rotates the selected Page's document generation;
close, driver loss, stale cursor, origin drift, unproven Page relation, or
revocation makes the corresponding read unavailable; consumers must not
pretend an empty window means that the browser had no errors. A user-held
Instance is never implicitly taken over to obtain console facts.

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
shared event limit is 64 per read, with at most 128 retained events per Page
and an additional Instance-wide cap; lifecycle, Page/document cursor binding,
relation loss, and unavailable fields are defined by Network V1. Secret-like
text is filtered before retention and again at the public normalization
boundary; filtering must precede truncation. Content is untrusted data and
must never be executed or treated as authority by the consuming Agent.

This slice excludes ordinary `log`/`debug` history, full stack traces, remote
object inspection and arbitrary evaluation. It does not promise to detect
arbitrary unlabeled confidential prose; no raw console recording or argument
dump is offered. Provider/version support and unverified limits must be
reported with the actual fixture/live evidence.
