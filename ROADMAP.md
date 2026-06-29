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

## 里程碑阶梯

里程碑只表达阶段顺序和边界。当前哪些里程碑处于活跃状态，以 GitHub 为准。

### M0：边界与治理基线

目标是让四仓后续工作不分叉。

完成边界：

- 跨仓 architecture 已定义四仓角色、数据流和禁止跨界。
- 方向性 ADR 与 pending decision 索引已进入各仓。
- ROADMAP 和 AGENTS 约束已明确路线图、里程碑、FR 和 Work Item 的关系。

不包含：

- 字段级 schema；
- runtime 实现；
- App UI 实现；
- 站点能力资产实现。

### M1：最小合同闭环

目标是让 Core、Harbor、Lode 可以用最小合同描述一次 read capability 的执行条件。

阶段边界：

- Core 定义最小 task request、admission、Run Record 和 Result Envelope spec。
- Harbor 定义 Core 可消费的最小 runtime facts、session refs 和 evidence refs spec。
- Lode 定义最小 capability package、schema、fixture、post-check 和 validator spec。
- App 只准备消费这些事实，不先行定义上游字段。

不包含：

- 写侧提交；
- 人工接管完整状态机；
- 多 provider 策略；
- capability marketplace。

### M2：最小 read capability 跑通

目标是用一个 read capability 验证 Core、Harbor、Lode 的合同可以贯通。

阶段边界：

- Lode 提供一个脱敏、可测试的 read capability package。
- Core 能完成能力准入、资源匹配、运行记录和结果封装。
- Harbor 能提供最小 Runtime Session、Snapshot / Evidence refs。
- App 可以展示 run、result、evidence summary 和 capability metadata。

不包含：

- 真实写入；
- 复杂 workflow；
- 长期 asset 分发；
- 完整 recovery UI。

### M3：写侧安全与恢复

目标是让 submit / destructive 类任务具备可审计、可恢复、可对账的最小安全路径。

阶段边界：

- Core 定义 action risk、approval evidence、idempotency 和 unknown outcome。
- Harbor 暴露 handoff / viewer / control ownership facts。
- Lode 为 write-like capability 提供 post-check 和 failure classification。
- App 提供审批、人工接管、恢复和对账入口。

不包含：

- 通用账号运营系统；
- 内容排期或业务策略系统；
- 反检测承诺；
- 完整远程浏览器平台。

### M4：资产复用与分发

目标是让 capability package、workflow package 和用户 overlay 可以稳定维护和复用。

阶段边界：

- Lode 支持版本、失效标记、registry、fixture regression 和 repair draft。
- Core 可以引用 capability / schema / fixture 版本。
- App Library 支持浏览、安装、锁定、上报和修复入口。

不包含：

- 公共市场运营规则；
- 云同步默认开启；
- benchmark task 作为产品 task contract。

### M5：扩展运行时与协作

目标是支持更多 runtime provider、远程 session、团队协作和可选同步。

阶段边界：

- Harbor 支持更多 provider mode 和 remote browser facts。
- Core 保持 provider-neutral admission 和 result contract。
- App 支持更丰富的 Browser 和 Library 管理表面。

不包含：

- Harbor 对账号安全或站点成功率作承诺；
- Core 内置 provider 排名；
- Lode 绑定某个 provider 实现。

## 更新规则

- 本文只维护稳定路线，不维护当前活跃 issue、Work Item、PR 或执行看板。
- 当前执行状态以 GitHub Milestones、Project、issues 和 PR 为准。
- GitHub Milestone 只承载当前 1-3 个可交付阶段，不承载全部远期设想。
- FR issue 表达用户可见或系统可验证的能力增量。
- Work Item issue 是可由一个 PR 完成的最小执行单元。
- 新建 FR 或 Work Item 前，先确认它属于当前活跃 Milestone；不属于则回到本文或 backlog。
- 单仓 planning 文档只能解释本仓如何服务当前活跃 Milestone，不能新增跨仓 Milestone。
- 不允许在单仓创建与本文冲突的平行路线图。
- 规格文档只服务当前或下一个活跃 Milestone，不提前铺满远期设计。
- 修改目标状态、里程碑阶梯或跨仓边界时，优先在 `WebEnvoy/WebEnvoy` 发起 PR，并说明受影响仓库。
