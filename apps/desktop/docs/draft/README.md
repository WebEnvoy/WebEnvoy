# WebEnvoy App Drafts

`docs/draft/` is temporary planning space. A draft may exist only while it has:

- Status: `promoted`, `pending`, `deferred`, `removed`, or `pointer`.
- Owner: a person, team, or issue owner responsible for resolving it.
- Linked issue: the GitHub issue that will promote, defer, or remove it.
- Exit condition: the concrete event that moves it out of draft.

Drafts are not implementation authority. App implementation, tests, and cross-repo consumers must rely on accepted ADRs, `docs/contracts/`, or issue-specific specs.

## Lifecycle

| Status | Meaning | Exit rule |
| --- | --- | --- |
| `promoted` | The useful content has moved to an accepted ADR, `docs/contracts/`, or another formal carrier. | Keep only a short pointer here or delete the draft. |
| `pointer` | The file itself has no independent authority, but remains as a landing page for existing links. | Keep only status, reason, and links to the formal authority. |
| `pending` | A real decision is still needed for current work. | Link the blocking issue and promote or defer when decided. |
| `deferred` | Not needed for the current milestone. | Keep owner, linked issue, and the future trigger; do not use for implementation. |
| `removed` | Obsolete or duplicated by a formal carrier. | Delete the file or leave a pointer only when links still need a landing page. |

## Draft Inventory

| File | Current use | Status | Target location | Linked issue | Handling judgment |
| --- | --- | --- | --- | --- | --- |
| `docs/draft/README.md` | Draft lifecycle and inventory entry point. | promoted | `docs/draft/README.md` | [#65](https://github.com/WebEnvoy/App/issues/65), [#66](https://github.com/WebEnvoy/App/issues/66) | Keep and promote this file because lifecycle rules and the inventory table are the actual output of this milestone. It is docs governance, not product behavior. |
| `docs/draft/architecture.md` | Early App/Core/Lode/Harbor boundary notes and suggested module layout. | pointer | [docs/README.md](../README.md), [docs/contracts/README.md](../contracts/README.md), [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md), [ADR 0005](../adr/0005-library-capability-catalog-fields.md) | [#67](https://github.com/WebEnvoy/App/issues/67) | No independent value remains for implementation: ownership boundaries are covered by accepted ADRs and repo docs, while module layout is not accepted Stage 2 contract. Keep only a landing pointer for existing links. |
| `docs/draft/product-surface.md` | Early Work/Library/Browser/Settings surface list. | pointer | [docs/contracts/README.md](../contracts/README.md), [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md), [ADR 0005](../adr/0005-library-capability-catalog-fields.md) | [#67](https://github.com/WebEnvoy/App/issues/67) | No separate truth should remain: Stage 2 accepted display facts live in ADR 0006, Library catalog fields live in ADR 0005, and unaccepted UI layout remains future work. Keep only a short pointer. |
| `docs/draft/library-workbench.md` | Future Library workbench behavior: install/update/lock/rollback, My Assets, Explorer, Reports, repair, and contribution flows. | deferred | [ADR 0005](../adr/0005-library-capability-catalog-fields.md) for current stable catalog display fields; future Library UI Work Item for workbench behavior. | [#68](https://github.com/WebEnvoy/App/issues/68) | Independent product value remains, but not as Stage 2 implementation authority. ADR 0005 intentionally stops at catalog display fields, so broader workbench behavior must wait for a future Library UI Work Item. Owner: future Library UI Work Item owner. Exit condition: promote into that Work Item spec/ADR or delete when superseded. |
| `docs/draft/local-runtime.md` | Future local runtime/App shell shape: local service startup, connection config, diagnostics, local cache, Desktop shell or localhost UI packaging. | deferred | [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md) for current Settings/cache/display boundary; future App shell/runtime Work Item for executable behavior. | [#68](https://github.com/WebEnvoy/App/issues/68) | Independent product value remains, but current accepted Stage 2 content only covers display and local-only cache boundaries. Startup/supervision/packaging would be product behavior and needs a future App shell/runtime Work Item. Owner: future App shell/runtime Work Item owner. Exit condition: promote into that Work Item spec/ADR or delete when superseded. |

## Absorption Record

| Draft | Still valid analysis | Absorbed into | Rejected or deferred from the draft |
| --- | --- | --- | --- |
| `docs/draft/architecture.md` | App sits over Core, Lode, and Harbor; App must not own execution, Lode asset truth, Run Records, or Harbor runtime/session truth. | [docs/contracts/README.md](../contracts/README.md#stable-judgments-absorbed-from-drafts), [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md), [ADR 0005](../adr/0005-library-capability-catalog-fields.md), repository [README](../../README.md). | Suggested source tree/module layout remains an early direction, not a contract. Local/desktop/cloud shape is deferred to future App shell/runtime work. |
| `docs/draft/product-surface.md` | Work/Library/Browser/Settings are the durable product domains; Work consumes Core facts, Library consumes Lode facts, Browser consumes Harbor facts, Settings stays local-only. | [docs/contracts/README.md](../contracts/README.md#stable-judgments-absorbed-from-drafts), [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md), [ADR 0005](../adr/0005-library-capability-catalog-fields.md), [ROADMAP](../../ROADMAP.md). | Detailed UI menu/list layout is not accepted. Explorer, Reports, install/update/rollback, full Profile/session management, and cloud/team Settings remain future Work Items. |
| `docs/draft/library-workbench.md` | Library should eventually be a workbench, not only a read-only catalog; platform assets and user assets need separate handling; Explorer/Reports/repair flows are real future product areas. | Current stable subset absorbed into [ADR 0005](../adr/0005-library-capability-catalog-fields.md) and [docs/contracts/README.md](../contracts/README.md#stable-judgments-absorbed-from-drafts). Broader behavior remains in this deferred draft with owner/issue/exit condition. | Install/update/lock/rollback, My Assets editing, fork/overlay/export/contribution, Explorer, Reports, repair, marketplace, store, sync, and UI behavior are deferred until a future Library UI Work Item promotes them. |
| `docs/draft/local-runtime.md` | App may have local-first UX and local settings/cache, but those must not become Core/Harbor/Lode truth. | Settings/cache/display boundary absorbed into [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md) and [docs/contracts/README.md](../contracts/README.md#stable-judgments-absorbed-from-drafts). Runtime packaging behavior remains in this deferred draft with owner/issue/exit condition. | Starting/supervising local services, Desktop shell vs localhost UI packaging, diagnostics, local evidence viewer behavior, sync, and cloud Console behavior are deferred to a future App shell/runtime Work Item. |
