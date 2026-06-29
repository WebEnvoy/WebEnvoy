# WebEnvoy Core 路线图

本文是 `WebEnvoy/.github/ROADMAP.md` 的 Core 仓库级投影。若本文与组织级 ROADMAP 冲突，以组织级 ROADMAP 为准。

本文用于指导 Core GitHub Milestone 的创建和排序，不维护当前 issue、PR 或执行看板。

## 本仓职责

Core 负责统一任务入口、执行准入、资源匹配、Run Record、Result Envelope、Action Risk、失败归因和 API / CLI / MCP / SDK 公共任务路径。

Core 不拥有浏览器现场、站点能力资产或 App UI 状态。

## 路线原则

- GitHub Milestone 必须能映射到本文的阶段路线和组织级 ROADMAP。
- Core 的 milestone 优先形成可被 Harbor、Lode 和 App 消费、并能被纵向任务切片验证的公共合同。
- 合同稳定前，不把某个入口、provider 或 UI 流程写成唯一执行路径。
- 涉及当前 milestone 的 pending decision 必须先在 `docs/adr/pending-decisions.md` 标明阻塞级别。
- Core 合同可以先行，但每个稳定合同都必须绑定一个可验证的任务、运行、结果、证据或动作切片。

## 阶段路线

### 组织阶段一投影：用户任务与吸收边界

Core 明确自己是任务运行 truth source，不是浏览器 runtime、能力资产库或产品 UI；同时明确首个低风险只读任务和早期写前验证边界。

可创建 milestone 的主题：

- Core 边界和 ADR 治理。
- 跨仓任务路径和 truth source 对齐。
- 首个低风险只读任务的 Core 责任边界。
- 写侧 validate-only、draft、preview 与真实写入的边界。
- Syvert Run Record / TaskRecord / admission、旧 WebEnvoy runtime store / CLI envelope / risk gate 的裁剪吸收评估。
- 通用 browser agent loop 不作为 Core 正式执行路径。

### 组织阶段二投影：最小统一协议

Core 的第一优先级是把 `task`、`run`、`result`、`evidence` 和 `action request` 压成 App、API、CLI、MCP 和 SDK 共用的最小协议骨架。

可创建 milestone 的主题：

- Task / Run / Capability 引用模型 v0。
- Result Envelope 与 Run Record v0。
- Admission、Action Risk 和资源匹配 v0。
- API、CLI、MCP、SDK 共用的最小任务入口。
- App-facing task / run / result 查询合同 v0。

阶段二完成前，不应创建依赖完整执行语义、完整入口矩阵或真实写入的大规模实现 milestone。

### 组织阶段三投影：可信可引用运行现场

Core 只消费 Harbor 对外 runtime facts、Snapshot / RefMap、session refs、evidence refs 和 viewer refs，不拥有浏览器现场。

可创建 milestone 的主题：

- Harbor runtime facts 消费合同。
- Snapshot / RefMap / evidence ref 引用模型。
- viewer / handoff refs 在 Run Record 中的表达。
- provider-neutral resource matching。

### 组织阶段四投影：最小只读任务闭环

Core 跑通首个低风险只读任务的准入、执行记录、结果封装、失败归因和证据引用。

可创建 milestone 的主题：

- low-risk read task admission。
- Run Record / Result Envelope read slice。
- structured failure reason 和 evidence refs。
- Lode capability package v0 消费。
- App / API 共同入口的 read task 验证。

### 组织阶段五投影：只读能力产品化

Core 按 Lode 只读能力版本准入和执行任务，并能把结果、失败和证据归因到具体能力资产版本。

可创建 milestone 的主题：

- capability-version-aware read execution。
- Lode schema validation 和 result projection。
- 能力失效、post-check 和 failure classification 消费。
- run history、evidence refs 和 failure reason 查询。
- App Library 需要的能力运行归因。

### 组织阶段六投影：写前验证闭环

Core 支持 validate-only、draft 和 preview 写前验证，能表达风险、预期变更和审批请求，但不把预览当作真实提交结果。

可创建 milestone 的主题：

- action request 和 risk classification v0。
- approval request / cancellation 语义。
- validate-only / preview Result Envelope。
- 写前验证失败和用户取消写入 Run Record。

### 组织阶段七投影：受控写入闭环

Core 支持首批低风险真实写入的审批、幂等、post-check、unknown outcome 和对账入口。

可创建 milestone 的主题：

- approval-gated write execution。
- idempotency key 和 write operation ref。
- post-check、unknown outcome 和 reconciliation entry。
- write-side evidence refs 和 failure attribution。

### 组织阶段八投影：可恢复多步读写工作流

Core 把多步任务、读写混合、manual recovery、handoff 和对账事实写入 durable Run Record。

可创建 milestone 的主题：

- recovery-aware run state machine。
- retry、resume、cancel 和 reconcile 合同。
- handoff / requires user action 语义。
- workflow step facts 和 step-level failure classification。

### 组织阶段九投影：日常产品与多入口稳定

Core 为 App、API、CLI、MCP 和 SDK 提供稳定查询和操作面；所有入口仍共用同一条 Core 任务路径。

可创建 milestone 的主题：

- App-facing API contract hardening。
- SDK / MCP / CLI 入口一致性验证。
- run history、evidence、failure、approval 和 recovery 查询稳定化。
- 多入口错误语义一致性。

### 组织阶段十投影：生态与协作扩展

Core 保持 provider-neutral 和 capability-version-aware，让外部 SDK、MCP、CLI 和集成消费同一任务合同。

可创建 milestone 的主题：

- SDK / MCP / CLI 合同生成。
- 外部集成兼容性。
- 公共合同是否拆分到宽松许可证仓库。

## 不进入 Core 路线图

- Profile、Runtime Session、browser driver、Viewer 和 evidence store 实现。
- 站点知识、capability package、fixtures、registry 和 marketplace 资产。
- App Shell、Library、Browser 和 Work UI。
- 账号运营、内容策略、广告投放、CRM 或业务决策。

## Milestone 创建检查

创建 Core milestone 前必须确认：

- 对应组织级 ROADMAP 阶段。
- 对应的 Core 阶段路线主题。
- 是否服务当前组织阶段的纵向闭环，而不是只完成 Core 横向合同。
- 是否依赖 Harbor、Lode 或 App 的合同。
- 是否有 `Milestone blocker` 或 `FR blocker` pending decision。
- 完成标准是否可由合同、测试、文档或 API 行为验证。
