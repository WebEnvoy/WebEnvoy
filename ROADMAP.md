# WebEnvoy 路线图

本文是 WebEnvoy 四仓共同遵循的长期路线图。它只描述目标状态和阶段阶梯，不维护当前活跃 issue、Work Item、PR 或执行看板。

当前执行状态以 GitHub Milestones、Project、issues 和 PR 为准。

## 目标状态

WebEnvoy 的目标是让用户、Agent、自动化程序和上游系统通过统一任务入口复用稳定的网站能力，并让每次网页操作任务都可准入、可执行、可记录、可验证、可恢复、可对账。

目标状态包括：

- `WebEnvoy/WebEnvoy` 提供统一 API Server、Core Runtime、Run Record、Result Envelope、Admission 和 Action Risk 合同。
- `WebEnvoy/Harbor` 提供 Profile、Execution Identity、Runtime Session、Provider facts、Snapshot、RefMap、Evidence refs 和 Viewer / handoff facts。
- `WebEnvoy/Lode` 提供 capability package、workflow package、schema、fixtures、post-check、asset registry、版本和失效标记。
- `WebEnvoy/App` 提供 Work、Library、Browser 三个用户表面，展示上游事实并发送用户意图，不复制上游 truth。

最终产品应满足：

- API、CLI、MCP、SDK 和 App 共用同一条 Core 任务路径。
- Core 不直接拥有浏览器现场、站点知识或 App UI 状态。
- Harbor 不判断任务业务成功，不拥有 Lode schema 或 Core Run Record。
- Lode 不选择具体 Runtime Session，不保存真实账号状态或生产运行现场。
- App 不直接执行能力、不写 Run Record、不绕过 Harbor 操作 Runtime Session。

## 阶段阶梯

阶段阶梯描述 WebEnvoy 从当前状态到目标状态的产品和架构成熟度。它不是 GitHub Milestone，也不指定近期 issue 顺序。

### 阶段一：边界清晰

四仓职责、truth source、主要数据流和禁止跨界稳定下来，后续工作不会各自发明平行路线。

达到该阶段时：

- 跨仓 architecture 说明四仓角色、数据流和禁止跨界。
- 方向性 ADR 记录关键取舍，pending decision 集中索引。
- 总 ROADMAP 和四仓 AGENTS 约束路线图、GitHub Milestone、功能需求和工作项的关系。
- 单仓文档不创建与总路线冲突的平行路线图。

### 阶段二：合同可执行

四仓之间的公共合同稳定到可以被实现、验证和 review 消费，而不是停留在方向性描述。

达到该阶段时：

- Core 的 task、run、result、admission 和 action risk 合同可被 API、CLI、MCP、SDK 和 App 复用。
- Harbor 的 runtime facts、session refs、snapshot refs 和 evidence refs 可被 Core 消费。
- Lode 的 capability package、workflow package、schema、fixtures 和 post-check 可被 Core 准入和校验。
- App 只消费上游合同，不自行定义 Core、Harbor 或 Lode 的字段真相。

### 阶段三：能力可复用

网站经验从一次性脚本或提示词，变成可版本化、可测试、可失效、可修复、可安装的能力资产。

达到该阶段时：

- Lode 能力资产有稳定生命周期、版本、fixtures、回归检查和失效标记。
- Core 可以按能力版本准入、执行、记录和归因。
- Harbor 提供足够的 runtime facts 和 evidence refs 支撑能力验证。
- App Library 能让用户浏览、安装、锁定、上报和修复能力资产。

### 阶段四：运行可恢复

任务运行不只返回成功或失败，还能在异常、人工接管、未知结果和对账场景下保持可解释和可恢复。

达到该阶段时：

- Core Run Record 能记录 accepted、running、terminal、unknown outcome 和 recovery 事实。
- Harbor 能提供 viewer、handoff、control ownership 和 evidence provenance。
- Lode 能声明 post-check、failure classification 和修复线索。
- App 能让用户观察、接管、恢复、停止、重试或对账，而不复制上游状态机。

### 阶段五：产品可操作

用户可以通过 App 完成任务运行、结果查看、异常处理、能力管理和浏览器身份管理，而不需要理解四仓内部结构。

达到该阶段时：

- Work 表面覆盖任务提交、运行状态、结果、证据和恢复入口。
- Library 表面覆盖能力浏览、安装、更新、锁定、草稿、修复和上报。
- Browser 表面覆盖 Profile、Runtime Session、Viewer、接管和 provider facts。
- Settings 能表达本地 API、Harbor、Lode 资产来源、数据目录和连接状态。

### 阶段六：生态可扩展

WebEnvoy 可以扩展到更多 provider、更多资产来源、团队协作、可选同步和外部集成，而不破坏核心边界。

达到该阶段时：

- Harbor 支持多 provider 和远程 session，但仍只输出 runtime facts。
- Lode 支持平台资产、用户 overlay、fork、draft 和可选同步。
- Core 保持 provider-neutral 和 capability-version-aware。
- SDK、MCP、CLI 和外部集成消费同一套公共合同。
- Benchmark、crawler、hosted runtime 和 marketplace 都不越界变成默认产品合同。

## 更新规则

- 本文只维护稳定路线，不维护当前活跃 issue、Work Item、PR 或执行看板。
- 当前执行状态以 GitHub Milestones、Project、issues 和 PR 为准。
- GitHub Milestone 只承载当前 1-3 个可交付阶段，不承载全部远期设想。
- 功能需求（FR）issue 表达用户可见或系统可验证的能力增量。
- 工作项（Work Item）issue 是可由一个 PR 完成的最小执行单元。
- 新建功能需求或工作项前，先确认它属于当前活跃 Milestone；不属于则回到本文或 backlog。
- 单仓 planning 文档只能解释本仓如何服务当前活跃 Milestone，不能新增跨仓 Milestone。
- 不允许在单仓创建与本文冲突的平行路线图。
- 规格文档只服务当前或下一个活跃 Milestone，不提前铺满远期设计。
- 修改目标状态、阶段阶梯或跨仓边界时，优先在 `WebEnvoy/WebEnvoy` 发起 PR，并说明受影响仓库。
