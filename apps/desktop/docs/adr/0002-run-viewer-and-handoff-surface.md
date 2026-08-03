# 0002. Run Viewer and Handoff Surface

## Status

Draft.

## Context

App 需要让用户在一个地方查看 run、进入实时浏览器现场、处理异常，并把任务交还给自动化继续执行。现有 App 草稿已定义三个产品域：

- Work 消费 WebEnvoy Core 的 task、run、result、evidence 和 recovery 数据。
- Browser 消费 Harbor 的 Profile、Runtime Session、Viewer、Takeover 和 provider facts。
- Library 消费 Lode 的 capability 与 task package metadata。

App 不能定义新的 Core run 状态机，也不能拥有 Harbor session 状态。App 只能展示事实，并向对应 owner API 发起用户意图。

## Decision

App run viewer 是组合 UI surface，不是新的 runtime。

它展示：

- Core 拥有的 run identity、status、result summary、failure reason 和 recovery prompt。
- Harbor 拥有的 Runtime Session identity、health、viewer entry 和 takeover availability。
- 附着在 run 或 runtime session 上的 evidence references 和摘要。
- Lode 拥有的 capability 或 task package identity、version 和 source。

它提供这些用户入口：

- 打开当前 Runtime Session 的 Harbor viewer。
- 当 Core 或 Harbor 标记需要用户处理时，请求用户 takeover。
- 用户处理完成后，向 owning run/recovery API 请求 resume。
- 通过 Core-owned operation stop、retry，或让 run 保持 manual recovery。
- 按 reference 打开 evidence item，不把 evidence 复制进 App-owned storage。

App 不把 raw CDP、VNC 或 provider endpoint 暴露为稳定任务接口。这些 endpoint 仍是 Harbor implementation detail，除非 Harbor 把它们发布为 viewer/session capability。

## Consequences

- 用户获得单一 run 页面，但系统 ownership 仍然清楚。
- viewer 可从本地浏览器窗口演进到 remote viewer，而不改变 App ownership。
- 在 Core 和 Harbor 合同完全稳定前，App 可以先渲染 handoff 事实，但不能把这些事实写成 App 自己的 truth。
- App 实现必须明确处理 viewer 缺失、session 过期和 evidence 不可用状态。

## Alternatives Considered

- 让 App 拥有 run recovery state：拒绝，因为 Core 拥有 run/admission/result state 和 Run Record。
- 只用 Harbor viewer 表示 handoff：拒绝，因为 live viewer 不表达任务暂停、恢复、恢复结果或 unknown outcome。
- 向用户和 agent 暴露 raw CDP/VNC controls：拒绝，因为这会绕过 Core admission、evidence 和 capability 边界。

## Research Evidence

- <https://github.com/WebEnvoy/research/blob/main/synthesis.md> 将 Run Record 和 evidence 识别为 Core/Harbor/App 的公共决策边界。
- <https://github.com/WebEnvoy/research/blob/main/absorability/themes/human-handoff-and-recovery.md> 说明 viewer endpoint 适合作为 Runtime Session 观察入口，但 live VNC 不等于完整 handoff workflow。
- <https://github.com/WebEnvoy/research/blob/main/absorability/themes/evidence-and-observability.md> 区分 runtime session facts 和 durable run records，并把 viewer/CDP evidence ownership 标为产品决策。
- <https://github.com/WebEnvoy/research/blob/main/absorability/themes/api-cli-mcp-and-agent-interface.md> 拒绝把低层 browser tools 当作稳定站点任务 API。

## Open Questions

- [PD-0003](pending-decisions.md#pd-0003)：Core 应暴露哪些最小 handoff facts 供 App 渲染，而不要求 App 理解完整状态机。
- [PD-0004](pending-decisions.md#pd-0004)：Harbor 第一阶段只提供 mediated viewer URL，还是同时提供本地浏览器窗口入口。
- [PD-0005](pending-decisions.md#pd-0005)：用户控制 session 时，mutating automation 是否必须硬暂停，read-only observation 是否可继续。
- [PD-0006](pending-decisions.md#pd-0006)：哪些 viewer failure 应作为 run recovery blocker，哪些只作为 Harbor runtime health issue。
