# CORE-199 Contracts

## Contract Delta

| Surface | Delta | Consumer | Compatibility |
|---|---|---|---|
| Core Runtime | `getRunSessionRefs(store, runId)` returns `webenvoy.session-refs-query.v0`. | API Server, App-facing consumers | Additive. |
| Core Runtime | `getRunFailureReason(store, runId)` returns `webenvoy.failure-reason-query.v0`. | API Server, App-facing consumers | Additive. |
| Core Runtime | `EvidenceRefSummary` includes `recorded_at` and optional `runtime_session_ref`. | Result/evidence query consumers | Additive fields. |
| API Server | GET `/runs/:id/session-refs`. | App | Additive route. |
| API Server | GET `/runs/:id/failure`. | App | Additive route. |
| Schemas | `session-refs-query.schema.json` and `failure-reason-query.schema.json`. | App/schema consumers | New accepted-v0 fixtures. |

## No-Copy Guarantees

- Core returns refs and public state only.
- Raw evidence bodies, screenshots, videos, DOM, HAR, network bodies, cookies, tokens, profile storage, CDP/VNC/websocket endpoints, viewer URLs, Lode package bodies, fixtures, and validator code are not copied into query envelopes.
