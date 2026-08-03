# App Docs

This directory keeps App product decisions and implementation-facing contracts.

## Directories

| Directory | Purpose | Rule |
| --- | --- | --- |
| `adr/` | Decisions, tradeoffs, accepted/rejected options, and pending decision records. | Use for why a product or architecture direction is accepted, rejected, deferred, or still blocked. |
| `contracts/` | Stable contracts that later implementation, tests, or cross-repo consumers may rely on. | Prefer short indexes to accepted ADRs unless a separate contract file is needed. |
| `design/` | Versioned visual references for accepted design checkpoints. | Images are direction references, not pixel specs or data contracts. |
| `draft/` | Temporary planning notes that have not become stable truth. | Drafts must have status, owner, linked issue, and exit condition; they are not implementation authority. |

Do not create `docs/guides/` until there is a real runnable workflow to document.

## Current Desktop Baseline

[ADR 0007](adr/0007-desktop-app-technical-baseline.md) is the authority for the
Desktop App first product shape, UI technology defaults, client connection
state rules, local cache boundary, and the UI product design checkpoint
required before skeleton work treats a design direction as final.

[ADR 0008](adr/0008-desktop-ui-design-checkpoint.md) 是当前 milestone #9 的
Desktop UI 设计 checkpoint。后续 shell、task/run、evidence、capability 和
执行现场 UI Work Item 在实现 #93、#94 或 #95 前必须先消费它。

Root [DESIGN.md](../DESIGN.md) 记录可延续的桌面设计契约；它不是完整组件库或
高保真原型规范。
