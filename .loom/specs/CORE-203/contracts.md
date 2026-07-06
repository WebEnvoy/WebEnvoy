# CORE-203 Contracts

## Contract Inputs

- Lode capability/package refs: `lode://site-capability/xiaohongshu/draft-precheck@0.1.0`, `lode://site-capability/boss/greeting-precheck@0.1.0`.
- Harbor public refs: runtime session, profile, provider, viewer, identity environment, execution identity, writable target, snapshot, refmap, and evidence refs.
- App/Core intent refs: task intent, action request, approval request.

## Core Output Shape

- Run Record remains `webenvoy.run-record.v0`.
- Action request remains `webenvoy.action-request.v0`.
- Approval request remains `webenvoy.approval-request.v0`.
- Preview result remains `webenvoy.preview-result.v0`.
- Preview records set `submitted: false` and never write `submitted_result` or true-write output.

## Failure and State Mapping

| State | Core Carrier | Query Behavior |
|---|---|---|
| preview available | `status=succeeded`, `preview_result.state=available`, `submitted=false` | result query returns preview envelope |
| page changed | `status=failed`, `failure.code=page_changed`, `preview_result.failure_class=page_changed` | failure reason maps to page_changed |
| user cancelled | `status=cancelled`, `failure.code=user_cancelled` | result outcome is cancelled |
| expired | `status=expired`, `approval_request.status=expired` | result payload_state is expired; approval summary is expired |

## Excluded Contract Surface

No true write execution, submitted result, write operation ref, unknown outcome, reconciliation entry, live site connector, raw evidence retrieval, App UI state, Harbor private runtime state, or Lode package body.
