# 0001. Record Architecture Decisions

## Status

Accepted.

## Context

WebEnvoy App 已经有规划草稿，但还没有轻量 ADR 约定来记录需要长期保留的架构决策。App 仓库的边界也很明确：它是统一人类用户入口，不是 Core run、Harbor runtime session 或 Lode capability asset 的真相源。

当前需要记录 App viewer、handoff、evidence 和 capability browser 的决策，同时避免把 ADR 写成完整产品规格或跨仓合同。

## Decision

在 `docs/adr/` 下使用按编号递增的 Markdown ADR 文件。

每个 ADR 使用以下精简格式：

- `Status`
- `Context`
- `Decision`
- `Consequences`
- `Alternatives Considered`
- `Research Evidence`
- 未决事项章节：
  - Draft ADR 使用 `Open Questions`。
  - Accepted ADR 使用 `Deferred Decisions`、`Follow-up ADRs` 或 `Implementation-time Decisions`。

ADR 状态值为：

- `Draft`：草案决策，尚不作为实现约束。
- `Accepted`：当前仓库接受的决策。
- `Superseded`：已被后续 ADR 替代。

ADR 编号单调递增且不复用。后续 ADR 可以 supersede 旧 ADR，而不是重写历史。

## Consequences

- App-facing 架构决策有独立位置，不混入探索性草稿。
- ADR 足够短，适合文档-only PR 审阅。
- 跨仓合同仍留给对应 owner 仓库确认，不在 App ADR 中先行定义。

## Alternatives Considered

- 继续只写在 `docs/draft/`：拒绝，因为草稿混合探索、候选方案和决策。
- 引入完整 ADR 模板，包括 owner、日期、实施计划：暂不采用，因为本仓当前还处在实现前阶段。
- 只用 issue 记录：拒绝，因为仓库本地架构决策应能随源码树阅读。

## Research Evidence

- `AGENTS.md` 明确 App 是统一人类入口，不拥有 Core、Harbor 或 Lode 真相。
- `README.md` 和 `docs/draft/architecture.md` 已经把 App 拆成 Work、Library、Browser 三个产品域。
- `docs/draft/README.md` 将现有规划文档标为草稿，因此稳定决策需要单独承载。

## Implementation-time Decisions

- [PD-0001](pending-decisions.md#pd-0001)：后续实现 PR 是否需要在改变 App 边界时引用对应 ADR。
- [PD-0002](pending-decisions.md#pd-0002)：如果决策变成跨仓合同，ADR 是否应迁移或同步到共享 WebEnvoy 架构位置。
