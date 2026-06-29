# WebEnvoy Core 路线图

本文是 `WebEnvoy/.github/ROADMAP.md` 的 Core 仓库级投影。若本文与组织级 ROADMAP 冲突，以组织级 ROADMAP 为准。

本文用于指导 Core GitHub Milestone 的创建和排序，不维护当前 issue、PR 或执行看板。

## 本仓职责

Core 负责统一任务入口、执行准入、资源匹配、Run Record、Result Envelope、Action Risk、失败归因和 API / CLI / MCP / SDK 公共任务路径。

Core 不拥有浏览器现场、站点能力资产或 App UI 状态。

## 路线原则

- GitHub Milestone 必须能映射到本文的阶段路线和组织级 ROADMAP。
- Core 的 milestone 优先形成可被 Harbor、Lode 和 App 消费的公共合同。
- 合同稳定前，不把某个入口、provider 或 UI 流程写成唯一执行路径。
- 涉及当前 milestone 的 pending decision 必须先在 `docs/adr/pending-decisions.md` 标明阻塞级别。
- Core 可以先完成合同层，其他仓的实现节奏不要求同步。

## 阶段路线

### 组织阶段一投影：边界清晰

Core 明确自己是任务运行 truth source，不是浏览器 runtime、能力资产库或产品 UI。

可创建 milestone 的主题：

- Core 边界和 ADR 治理。
- 跨仓任务路径和 truth source 对齐。

### 组织阶段二投影：合同可执行

Core 的第一优先级是把方向性 ADR 压成可实现、可验证、可 review 的最小合同。

可创建 milestone 的主题：

- Task / Run / Capability 引用模型。
- Result Envelope 与 Run Record v0。
- Admission、Action Risk 和资源匹配 v0。
- API、CLI、MCP、SDK 共用的最小任务入口。

阶段二完成前，不应创建依赖稳定执行语义的大规模实现 milestone。

### 组织阶段三投影：能力可复用

Core 按 Lode 能力版本准入和执行任务，并能把结果、失败和证据归因到具体能力资产版本。

可创建 milestone 的主题：

- capability-version-aware execution。
- Lode schema validation 和 result projection。
- 能力失效、post-check 和 failure classification 消费。

### 组织阶段四投影：运行可恢复

Core 把运行状态、unknown outcome、manual recovery 和对账事实写入 durable Run Record。

可创建 milestone 的主题：

- recovery-aware run state machine。
- unknown outcome / requires user action 语义。
- retry、resume、cancel 和 reconcile 的最小合同。

### 组织阶段五投影：产品可操作

Core 为 App 提供稳定查询和操作面，但 App 仍不直接写 Core truth。

可创建 milestone 的主题：

- run history query。
- evidence refs 和 failure reason 查询。
- App-facing API contract hardening。

### 组织阶段六投影：生态可扩展

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
- 是否依赖 Harbor、Lode 或 App 的合同。
- 是否有 `Milestone blocker` 或 `FR blocker` pending decision。
- 完成标准是否可由合同、测试、文档或 API 行为验证。
