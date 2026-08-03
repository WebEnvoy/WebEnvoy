# 0003. Login, Captcha, and User Takeover

## Status

Draft.

## Context

登录墙、验证码、访问受限和页面状态不明确，是自动化需要人工帮助的常见场景。App 必须把这些情况变成用户能理解和操作的入口，同时保持任务真相在 Core、运行现场真相在 Harbor。

这些情况在 App 中是用户体验状态，不是 App 定义完整 Core run 状态机、拥有 credential 或直接修改 Harbor session 的理由。

## Decision

App 将 login、captcha 和 takeover 表达为附着在 run 与 runtime session 上的用户恢复提示。

提示应展示：

- Core 或 Harbor 提供的需要人工处理原因。
- 受影响的 run、capability、site、Profile 和 Runtime Session。
- Harbor viewer 或本地 session 入口。
- 解释为什么需要人工处理的 evidence summary。
- 清晰操作：open viewer、take control、report done、leave for later、stop run。

takeover 期间，App 只记录 UI-level intent，并把 recovery action 发送给对应 owner API。Core 继续拥有 run state、retry/resume 决策、unknown outcome 处理和 result reconciliation。Harbor 继续拥有 session control、viewer connection 和 runtime evidence capture。Lode 继续拥有 capability 或 task package 后续是否应标记失效或进入修复。

App 不保存 credential，不自动解 captcha，也不把登录成功当作任务成功。登录和验证码处理只是 recovery step；任务仍需要 Core result check 和 evidence。

## Consequences

- 用户可以处理阻塞站点条件，而不需要理解 Core 或 Harbor 内部结构。
- UI 可以用同一套窄交互覆盖 QR login、password login、captcha、access denied 和 generic takeover。
- App 避免拥有 secret、browser storage 或隐藏 recovery state。
- 在 Core 和 Harbor 提供更精确 recovery reason 前，部分 UI label 会保持通用。

## Alternatives Considered

- 在 App 内新增 `captcha_required`、`login_done` 等 recovery state：拒绝，因为这会变成 shadow Core state machine。
- 用户有输入后让 agent 自动抢回控制权：拒绝，因为用户接管可能造成 unknown outcome，应由 Core 对账。
- 把登录成功当作 run success：拒绝，因为登录只移除 blocker，不证明用户请求的任务完成。
- 在 App settings 中保存 credential 来优化恢复体验：拒绝，因为 credential ownership 和 injection policy 不属于本 ADR。

## Research Evidence

- <https://github.com/WebEnvoy/research/blob/main/synthesis.md> 指出 runtime facts 与 task policy 必须分开，包括 captcha 和 human handoff。
- <https://github.com/WebEnvoy/research/blob/main/absorability/themes/human-handoff-and-recovery.md> 将显式 control ownership 和 handoff 识别为比裸 viewer 更强的参考机制。
- <https://github.com/WebEnvoy/research/blob/main/absorability/themes/human-handoff-and-recovery.md> 也提醒 setup/profile recovery 不应混同业务 task failure。
- <https://github.com/WebEnvoy/research/blob/main/absorability/themes/workflow-and-task-package.md> 显示 human interaction 可以出现在 workflow 语义中，但 package/runtime 合同归 Lode 和 Core。

## Open Questions

- [PD-0007](pending-decisions.md#pd-0007)：Core 和 Harbor 应向 App 暴露什么最小 recovery reason taxonomy。
- [PD-0008](pending-decisions.md#pd-0008)：App 是否需要为用户 takeover prompt 显示倒计时、超时或 SLA。
- [PD-0009](pending-decisions.md#pd-0009)：用户手动改变页面状态后，App 应如何展示 unknown outcome。
- [PD-0010](pending-decisions.md#pd-0010)：哪些 recovery prompt 可以 deferred，而不保持 Harbor session 存活。
- [PD-0011](pending-decisions.md#pd-0011)：clipboard 和 file upload 支持属于 viewer UX，还是后续 Harbor 决策。
