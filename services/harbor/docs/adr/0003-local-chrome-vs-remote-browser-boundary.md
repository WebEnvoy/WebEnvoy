# 0003. 本地 Chrome 与远程浏览器边界

## 状态

草案，2026-06-29。

## 背景

Harbor 必须支持本地优先的浏览器身份，同时为 server、Docker、remote CDP 和 hosted browser providers 留出空间。Local Chrome 可以复用真实登录态和用户可见窗口，但隐私和控制风险更高。Remote browser sessions 可以提供隔离的 CDP 和 viewer URLs，但持久化、Profile 所有权和 handoff 语义取决于 provider。

这个边界需要让 Core 请求 runtime resources，而不需要知道 Harbor 使用的是 local Chrome、专用 local Profile，还是 remote browser session。

## 决策

Harbor 将本地和远程浏览器都视为 Browser Drivers 背后的 provider modes，但不假装它们有相同的安全语义。

Harbor 至少应区分这些 provider modes：

- `local_dedicated_profile`：Harbor 启动并拥有一个专用本地浏览器 Profile。这是可重复 Agent 工作的首选本地 baseline，因为 Profile ownership、process lifecycle、CDP 和 evidence policy 更清楚。
- `local_user_chrome`：Harbor 通过 extension、native bridge 或 CDP 连接或借用现有用户 Chrome/Profile/tab。该模式需要用户显式选择，并应标记为 user-owned、privacy-sensitive 和 handoff-oriented。
- `remote_browser_session`：Harbor 连接 provider-owned 或 container-owned browser session。Harbor 记录 session id、CDP/websocket refs、viewer refs、TTL、persistence facts、proxy facts、storage/import facts、files/download support 和 provider limitations。

Browser Drivers 负责启动或连接、配置 runtime、检查健康状态、停止或释放 sessions，并返回 provider/session facts。它们不决定任务策略，也不运行 Lode 站点能力。

Harbor 将 CDP 和 Viewer 暴露为 refs 或受限能力，不把 raw public endpoints 暴露给所有调用方。App 可以渲染 Viewer；Core 可以通过 Harbor-controlled session refs 请求自动化访问。

对 `local_user_chrome`，Harbor 必须报告这些 facts：

- user-owned Profile 或 tab；
- 显式授权要求；
- profile selection source；
- control owner；
- 用户控制期间是否可以 pause 或 lock mutating automation；
- evidence policy limits。

Core 拥有 task run state 和 admission。Harbor 拥有 runtime session state 和 control facts。App 拥有面向用户的 viewer、approval 和 handoff UI。

当用户接管控制时，Harbor 应让 control state 可观测。Core 应按策略暂停或停止 mutating automation；如果用户动作改变了任务状态且 Core 无法验证，应记录 `unknown_outcome`。

## 影响

Dedicated local Profiles 是最简单的早期本地 runtime，因为它们避免默认访问用户日常浏览器状态。

Local user Chrome 仍可支持，但只能作为显式 provider/handoff 路径，并带有清楚的隐私和控制 facts。

只要 Harbor 返回同类 refs 和 facts，remote providers 可以加入而不改变 Core task model。

App 需要清楚展示 provider mode 和 control owner，因为 “local user Chrome” 与 “remote isolated session” 对用户的含义不同。

## 备选方案

- 默认让所有任务使用用户日常 Chrome：拒绝，因为除非用户显式选择，否则它会暴露个人 tabs、history、extensions 和 login state。
- Harbor 只支持 remote browser：拒绝，因为 WebEnvoy 的 local-first 目标需要 durable local Profiles 和用户可见 handoff。
- 把所有 providers 都视为相同的 `BrowserSession`：拒绝，因为 local user Chrome、local dedicated Profile 和 remote sessions 在 ownership、privacy、lifecycle 和 evidence limits 上不同。
- 把 raw CDP/VNC URLs 作为主要公共 API：拒绝，因为 access control、evidence policy 和 handoff state 属于 Harbor session boundary。

## 研究证据

- [docs/draft/browser-drivers.md](../draft/browser-drivers.md) 将 Browser Drivers 定义为 launch/connect/configure/health/facts adapters，而不是站点任务执行器。
- [docs/draft/resource-lifecycle.md](../draft/resource-lifecycle.md) 将 Profile、Execution Identity、Runtime Session、Viewer、proxy binding、evidence policy 和 snapshot context 定义为 Harbor resources，并通过 acquire/release/invalidate traces 追踪。
- [browser-identity-and-runtime.md](https://github.com/WebEnvoy/research/blob/main/absorability/themes/browser-identity-and-runtime.md) 将 local Chrome、extension bridge、CDP launch 和 remote container sessions 作为不同 provider boundaries 比较。
- [browser-identity-and-runtime.md](https://github.com/WebEnvoy/research/blob/main/absorability/themes/browser-identity-and-runtime.md) 标记 daily Chrome reuse 有价值但隐私敏感，因为它携带真实 history、extensions 和 login state。
- [human-handoff-and-recovery.md](https://github.com/WebEnvoy/research/blob/main/absorability/themes/human-handoff-and-recovery.md) 显示 VNC/noVNC viewers 和 local Profile Browser windows 解决观察/控制，但它们本身不是完整 task recovery。
- [human-handoff-and-recovery.md](https://github.com/WebEnvoy/research/blob/main/absorability/themes/human-handoff-and-recovery.md) 指出 explicit control ownership 与 handoff/takeover state 是 Viewer 与 recoverable task 之间缺失的部分。

## 未决问题

- [PD-0008](pending-decisions.md#pd-0008)：第一阶段实现应先支持 `local_dedicated_profile`、`remote_browser_session`，还是两者都支持？
- [PD-0009](pending-decisions.md#pd-0009)：使用 `local_user_chrome` 前需要哪种精确用户授权？
- [PD-0010](pending-decisions.md#pd-0010)：用户控制期间 Harbor 应如何 lock 或 pause automation？
- [PD-0011](pending-decisions.md#pd-0011)：哪些 remote session TTL、persistence、file 和 download facts 是必需字段？
- [PD-0012](pending-decisions.md#pd-0012)：Viewer 支持应先从本地浏览器窗口、noVNC-style remote viewer，还是两者开始？
