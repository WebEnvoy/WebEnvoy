# Local Runtime Draft

Status: deferred
Owner: future App shell/runtime Work Item owner, tracked for now by [#68](https://github.com/WebEnvoy/App/issues/68)
Linked issue: [#68](https://github.com/WebEnvoy/App/issues/68)
Exit condition: create or select a future App shell/runtime Work Item that defines local service startup, connection, cache, and packaging behavior.

Judgment: this draft still has independent product value, but it is future
runtime/App shell behavior. [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md)
only accepts Settings display, local-only cache boundaries, owner API refs, and
viewer/runtime display facts; it does not accept local service startup,
supervision, packaging, or diagnostics behavior.

Current authority:

- [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md) covers Settings display, local-only cache boundaries, Browser runtime refs, viewer refs, and owner API boundaries.

Deferred scope:

- Desktop shell or localhost UI packaging.
- Starting or supervising local WebEnvoy API Server, Harbor Runtime API, Harbor Viewer, or evidence viewers.
- Concrete local config, diagnostics, sync, or cloud Console behavior.

Do not implement from this draft.
