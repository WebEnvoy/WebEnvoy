# CORE-231 Contracts

## Consumed Contracts

- Core Run Record, Result Envelope, action request, approval request, result query, failure query, and approval/cancellation query v0.
- Lode write-precheck package refs:
  - `lode://site-capability/xiaohongshu/draft-precheck@0.1.0`
  - `lode://site-capability/boss/greeting-precheck@0.1.0`
- Harbor write-precheck facts:
  - runtime/session/profile/provider refs
  - writable target refs
  - snapshot/refmap/evidence refs
  - no-submit guard facts

## Added Core Contract

- `recordRealSiteWritePreviewResult` records an admitted write-precheck task, optional approval state, terminal preview/cancel/expired state, and queryable Run Record facts.
- Generated preview results always use `submitted: false`.
- Page-changed and user-cancelled states use existing failure/failure-query classes.
- Approval expired is terminal `expired` and queryable through approval/cancellation and result queries.

## Privacy Boundary

Allowed: refs, package/version/lock ids, public capability refs, risk classification, approval status, preview result, expected change summary, evidence refs, source refs, failure reason, post-check status.

Forbidden: credentials, cookies, tokens, profile storage, browser endpoints, viewer URLs, raw DOM, HAR, network bodies, screenshot/video bodies, raw evidence body, production payload, user private business data, submitted result refs, approval execution, and post-submit reconciliation.
