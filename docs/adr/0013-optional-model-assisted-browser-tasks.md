# ADR 0013：可选模型辅助与 TanStack AI 采用边界

- 状态：Proposed；接受前须先合并组织级 canonical 的对应修订，并完成独立审查。
- 日期：2026-09-17
- 产品依据：[canonical v1.5](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)。本 ADR 不独立改变产品定位或 V1 完成门。
- 产品归口：[#558 按需使用模型辅助网页任务，并保留原有操作方式](https://github.com/WebEnvoy/WebEnvoy/issues/558)；首个条件验证：[#559](https://github.com/WebEnvoy/WebEnvoy/issues/559)。
- 行为规格：[Model Usage V1](../specs/model-usage-v1.md)；已有边界：[ADR 0012](0012-runtime-capability-plane-and-plugin-first.md)。

## 背景与决策状态

2026-09-17 的产品讨论确认：模型可以在 WebEnvoy 提供的可信、有限候选中连续判断下一步，而不只替 Host Agent 选择单个按钮。用户仍使用同一长期 Profile、浏览器现场、权限和结果路径。Jev 是首个候选，不是 Browser Provider，也不是新的产品中心。

认可可选模型辅助的方向，不代表已证实 Jev 的速度、成本或可靠性，也不代表新增 V1 阻塞。#558/#559 属于 M25 条件性后续；条件齐备可以提前验证，无须等完整 V1 结束。#555/#556/#557 的既有范围继续独立。

## 决策

### 1. 使用通用 Model Provider，不创建用途专属 Provider 体系

Model Provider 表示模型接入服务（直连、Gateway 或未来本地服务）；Model 表示具体模型；Model Capability 表示模型实际提供的能力；Model Usage 表示 WebEnvoy 为什么、在什么边界内使用它。四者分开。

Browser Provider 继续表示浏览器供应方；原 ProviderBinding、迁移和长期身份规则不套用到模型。配置一个模型连接可以被合格用途复用；本次实际模型选择与全局默认分开，不随默认变化在途静默切换。

语义分离不等于现在新建四种数据库实体、服务或注册平台。只在首个正式用户闭环需要时细化字段与存储。

### 2. 通用模型连接优先采用 TanStack AI 的正式能力

复用 Activity/Adapter 与所需模型连接，不自建多厂商 AI SDK。TanStack AI 是实现依赖，不是用户配置、授权、Run 或结果的 owner；SDK 的类型和状态不得直接成为 WebEnvoy 的长期公共合同。

按用途要求选择真实能力。Jev 的共享 state + typed questions + 有限选择返回不能仅因结果外形类似 JSON，就伪装成普通 TextAdapter、聊天生成或 rerank；也不为调用 Jev 额外套一层通用 LLM 的 tool loop。

首个候选路线为 TanStack 原生 evaluation → Vercel AI Gateway → Jev。进入验证时必须核对可安装发布包、实际能力、来源和版本；上游 main、模型目录、普通 Gateway adapter 可用或“很快支持”的判断不能代替。

默认等待原生支持，不建立长期 TypeSafe bridge，不 fork TanStack 维护专属 activity。确有当前交付需要的临时适配必须另行批准产品目标、允许范围和删除/替换条件；本 ADR 不授权临时桥接、上游开发或自动监控。

### 3. 只增加必要的模型使用协调，不再造任务系统

| 现有 owner | 职责 |
| --- | --- |
| Core／现有受管 Runtime 服务侧 | 模型连接的非敏感配置与凭据引用、用途选择、外发/使用授权检查、有限循环协调、实际调用归因和原 Run/结果关联。凭据由可信存储提供，不落入 Plugin/页面。 |
| Harbor／共享执行层 | 原 Profile/Instance/Page、观察批次和可信目标、目标状态/适用动作、ControlLease、动作前新鲜度与实际浏览器执行；不决定业务下一步。 |
| App／可信 owner 入口 | 用户配置、外发与费用决定、关闭、停止和待处理事项；不形成第二份运行或授权事实。 |
| Plugin | 将明确任务委托、查询、退出和接续投影给真实宿主；不保存密钥、复刻状态机或在薄层运行另一套浏览器。 |
| Lode／SKILL | 站点知识、身份/经营对象核对方法及任务实际具备的核验/恢复说明；不是自动可信 DSL 或授权源。 |

模型辅助依赖现有 Run、operation、receipt、取消与恢复事实；需要表达循环进度时附于现有模型，不建设通用 DAG、队列、调度器或第二份持久 Run。不得让 SDK 的 agent loop、tool approval、stream resume 或 persistence 取代 WebEnvoy 的授权与不重放规则。

### 4. 允许完整的有界网页循环

首次正式消费优先使用 installed Plugin。模型可以连续进行观察、选择、执行和重观察，并选择 DONE/BLOCKED；不要求 Host Agent 逐步批准，也不要求 DONE 后必经另一模型。

DONE 只结束辅助循环，业务结果由该任务实际存在的独立核验确认；没有核验办法就保留不确定性，不能假设有万能 Verifier。BLOCKED 表示该辅助路径不能继续，交回实际宿主或进入待处理，不自动等于任务失败。

明确给定的文本可直接作为候选动作的输入；开放文本生成是另一项需要批准的模型能力，不冒充 Jev 的原生选择能力。本轮只验证明确给定文本，不建设完整聊天入口。

### 5. 不转移安全与结果职责

候选使用 WebEnvoy 既有操作定义、目标和 owner 事实；模型返回只是一项建议。实际派发仍重新检查权限、Page/document、目标身份/状态与 ControlLease。有限候选不保证业务选择正确，confidence 不是授权或成功概率承诺。

网页读取权不等于第三方数据外发许可；模型使用、费用与实际接收方须由 owner 批准，并沿现有授权体系落实。停止、撤权、断连或接管后，不得消费迟到模型回复继续派发；交回宿主也不能重放 unknown 写入。

### 6. 用第二个真实需求验证扩展，不预建平台

新增模型复用已有用途合同与适配；新增用途复用连接与通用调用归因。Provider 的能力、限制、取消、错误、usage 和版本差异保留，缺少 probabilities/confidence 不得补成假值，也不承诺所有模型任意互换。

只暴露经过该用途验证的模型；SDK 有 adapter、Gateway 有目录不等于 WebEnvoy 支持。未来 SKILL 分支、页面选择或证据分类仅为可能用途，不在本 ADR 提前创建实现任务。权限、正式账号归属、能否发布/删除以及 unknown 能否重放仍不是模型决策。

## 未采用的方案与后果

不采用 Jev 整包替换 Harbor、强制模型依赖、Decision/Text/Vision 多套 Provider、原始 selector/坐标/脚本入口、完整自建 AI SDK，以及为了生态时间差创建永久 bridge。代价是原生上游能力未满足时，#559 保持 Backlog；这不阻塞 #555/#556 或当前 V1。

“减少等待、费用和错误”是需要测量的收益，不是本次文档可保证的结果。实际比较须包含必要观察、执行、核验、文本辅助（若有）、失败与接续，不只比较模型响应。

## 验证与接受

#559 固定无账号受控表单、明确给定文本和独立回读；按同一 WebEnvoy 基线比较 Host Agent 与 Jev 的连续循环。必须保留全部尝试，并验证拒绝、迟到回复、接管、断连及 unknown 不重放。采用后才细化正式产品化交付；验证项关闭不关闭 #558。

本 ADR 与行为规格只固定语义、采用原则及进入条件，不新增运行代码、依赖、公开 schema、fixture、预算平台或空证据文档。正式接口形成前必须同步兑现 Plugin/Grant/必要 App IA 的设计义务。

## 研究依据与时效边界

- 已有项目资料：《调研 Jev Ultrafast》《深度介绍 TanStack AI》《Jev 讨论》；产品讨论的可回读落点为 #558/#559，而不是将完整聊天记录复制成第二规范。
- [Jev Ultrafast design](https://github.com/browser-use/jev-ultrafast/blob/452c1ad2dd628008f1d5608f28158d76e49e6cc0/docs/design.md)：动态动作空间、选择/生成分离和 DONE 与独立核验的区别。
- [Vercel Jev model](https://vercel.com/ai-gateway/models/jev)：2026-09-17 回读到模型判断、typed questions 和并行 evaluation 的官方说明；它证明 Gateway 路线存在，不证明 WebEnvoy 已接入。
- [TanStack Vercel Gateway adapter](https://tanstack.com/ai/latest/docs/adapters/vercel-gateway)：2026-09-17 的公开页面列出 chat/text、embedding、image、summarization，未列出本项所需原生 evaluation。该观察不是永久限制或交付日期；进入实现时重查发布包。
