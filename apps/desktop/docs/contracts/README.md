# App Contracts

This directory indexes stable App contracts without duplicating the accepted ADRs.

| Contract area | Authority | Consumer boundary |
| --- | --- | --- |
| Human Workbench IA, information hierarchy, provider recovery, and authorization UX | [ADR 0009](../adr/0009-human-workbench-information-architecture.md) | Current UI planning and review must use Work/Browser/Library, business-result-first display, on-demand diagnostics, provider recovery, and Core-owned authorization. |
| Desktop App product shape, UI stack, IA, connection state, and local cache boundary | [ADR 0007](../adr/0007-desktop-app-technical-baseline.md) | App Desktop/UI skeleton planning and review may rely on Desktop App first, Electron/React/TypeScript/Vite/Radix UI/lucide-react defaults, client boundaries, and no-store rules. |
| Milestone #9 Desktop UI 历史 checkpoint | [ADR 0008](../adr/0008-desktop-ui-design-checkpoint.md) | Retains historical component and shell input; fixed Task Thread IA is superseded by ADR 0009. |
| Task entry, run, result, failure, evidence, action request, Browser runtime, viewer, handoff, and Settings ownership | [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md) | Owner truth, sensitive-data, and cache boundaries remain valid; default display hierarchy and approval UI are superseded by ADR 0009. |
| Library capability catalog fields | [ADR 0005](../adr/0005-library-capability-catalog-fields.md) | App Library planning and UI implementation may rely on the display fields and local-only cache boundary. |

## Stable Judgments Absorbed From Drafts

These are implementation-consumable summaries. The ADRs above remain the authority.

| Judgment | Authority | Draft source | Implementation consequence |
| --- | --- | --- | --- |
| App is a user-facing display and intent surface over Core, Lode, and Harbor facts. | [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md), [ADR 0005](../adr/0005-library-capability-catalog-fields.md) | `docs/draft/architecture.md`, `docs/draft/product-surface.md` | Later implementation may render upstream facts and send owner API intents, but must not create App-owned Run Record, runtime/session, evidence, or Lode asset truth. |
| Work consumes task intent, result/failure, recovery, and authorization facts; business results are primary. | [ADR 0009](../adr/0009-human-workbench-information-architecture.md), [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md) | `docs/draft/product-surface.md` | Use ADR 0009 for display hierarchy; ADR 0006 remains authority only for owner facts and sensitive-data boundaries. |
| Browser consumes account identity, provider/environment/instance lifecycle and owner-provided runtime facts. | [ADR 0009](../adr/0009-human-workbench-information-architecture.md), [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md) | `docs/draft/architecture.md`, `docs/draft/product-surface.md`, `docs/draft/local-runtime.md` | Show user actions and recoverable state first; refs and raw facts are diagnostic only. Never expose raw CDP/VNC endpoints, profile paths, cookies, browser processes, or provider drivers as App truth. |
| Settings and cache are local-only, non-sensitive, rebuildable display state. | [ADR 0006](../adr/0006-stage2-task-entry-and-display-contract.md) | `docs/draft/local-runtime.md` | Store endpoint choices, recent views, filters, and stale markers only; do not store credentials, raw evidence, Run Records, package bodies, fixtures, or Harbor profile/session facts. |
| Library catalog v0 is a display projection over Lode/Core/Harbor facts. | [ADR 0005](../adr/0005-library-capability-catalog-fields.md) | `docs/draft/library-workbench.md`, `docs/draft/product-surface.md` | Consume catalog display fields and local UI preferences only; installer/update/lock/rollback/repair/workbench behavior is deferred. |
| Desktop App first is the product shape; localhost Web UI is a development carrier only. | [ADR 0007](../adr/0007-desktop-app-technical-baseline.md) | GitHub issues #74-#83, `docs/draft/local-runtime.md`, `research/synthesis.md` | Later skeleton work may use Electron/React/TypeScript/Vite/Radix UI/lucide-react defaults, but must not install dependencies or implement UI in docs-only PRs. |
| Historical Milestone #9 desktop checkpoint; not current implementation authority. | [ADR 0008](../adr/0008-desktop-ui-design-checkpoint.md) | GitHub issues #92/#96/#97/#98/#99 与 Desktop Taste checkpoint 输出 | Fixed Task Thread IA, evidence-first display, and approval-first interaction are superseded by ADR 0009; retain only reusable historical input. |

Add a standalone contract file only when an accepted ADR is too broad for a direct implementation or test consumer.
