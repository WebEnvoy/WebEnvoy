# 0002. 运行、任务与能力模型

## 状态

拟议。

> 2026-07-14 correction: [ADR 0009](0009-unified-authorization-policy.md)
> supersedes this draft's action-risk enum, approval evidence and App approval ownership.
> Task/run/result/admission/resource and cross-repo owner boundaries remain useful input.

## 背景

WebEnvoy Core 必须让 API、SDK、CLI、MCP 和 WebEnvoy App 进入同一条任务路径，而不是让每个入口各自运行浏览器动作。核心问题不是打开浏览器，而是判断一个站点能力是否已定义、已版本化、资源满足、可执行、可记录，并且能作为公共任务安全暴露。

当前草稿已经拆出职责：

- Lode 拥有站点知识、能力包、任务封装、输入输出模式、测试样例、版本和失效标记。
- Harbor 拥有 Profile、执行身份、运行时会话、提供方/运行时事实、Viewer/CDP/VNC 和证据采集。
- WebEnvoy App 拥有人类产品界面、配置、观察和恢复体验。
- WebEnvoy Core 拥有公共任务路径、能力准入、资源匹配、执行控制、运行记录和结果封装。

## 决策

WebEnvoy Core 将一次公共执行建模为：

```text
任务请求
  -> 能力准入
  -> 资源需求匹配
  -> Harbor 运行时绑定
  -> 运行
  -> 结果封装 / 运行记录
```

任务请求是 API Server 归一化之后进入 Core 的输入形态。它通过稳定 id 和版本引用 Lode 能力或任务包，包含公共输入、执行策略、证据策略、资源需求和调用入口。

能力不是任意浏览器动作。只有 Lode 至少声明以下内容时，能力才能进入稳定任务路径：

- 能力身份和版本；
- 生命周期；
- 输入合同；
- 输出合同；
- 资源需求；
- 前置检查和后置验证预期；
- 证据预期；
- 测试样例或回归证据；
- 失效标记。

Core 拥有准入决策。当能力未知、未稳定、已失效、缺少合同、缺少资源需求或缺少证据预期时，稳定执行必须失败即关闭路径。

Core 不拥有 Harbor Profile 或运行时会话细节。Core 只通过公共引用和客观事实消费 Harbor 运行时绑定，例如 `runtime_session_ref`、`profile_ref`、`execution_identity_ref`、提供方能力事实、健康事实、Viewer/CDP 可用性和证据能力事实。

Core 不拥有 Lode 站点知识或归一化业务模式。Core 消费 Lode 声明，并在声明不足时拒绝执行。

API Server 是一等入口。CLI、MCP、SDK 和 WebEnvoy App 应通过 API Server 路径提交任务请求，而不是绕过 Core 直接调用 Harbor、CDP 或 Lode。

## 第一阶段归属决策表

本表覆盖 Core #13、#14、#16、#17 和 #18 的第一阶段边界结论。字段名只表达事实类型，不冻结阶段二 Schema。

| 对象/事实 | 本仓归属 | 非本仓归属 | 消费方 | 依据 | 状态 |
|---|---|---|---|---|---|
| task request / request snapshot | Core 拥有 API Server 归一化后的公共任务请求、调用入口和可脱敏请求快照。 | App 拥有提交前 UI 状态和用户草稿；Lode 拥有能力包输入声明；Harbor 不拥有任务语义。 | API、CLI、MCP、SDK、App、Run Record。 | 本 ADR、`ROADMAP.md`、`docs/architecture/cross-repo-architecture.md`、Core #14。 | accepted |
| run lifecycle / terminal outcome | Core 拥有 `accepted` 之后的 run id、状态推进、终态和失败阶段。 | Harbor 拥有 Runtime Session 内部状态；App 拥有展示状态；Lode 不拥有生产运行状态。 | API、CLI、MCP、SDK、App、后续对账。 | 本 ADR、[0003](0003-result-envelope-and-run-record.md)、Core #14。 | accepted |
| result envelope | Core 拥有公共结果封装、失败分类、引用边界和调用方响应。 | Lode 拥有能力输出 schema 和业务 normalizer；Harbor 拥有 raw payload / evidence store；App 不生成第二份结果真相。 | API、CLI、MCP、SDK、App、Run Record。 | [0003](0003-result-envelope-and-run-record.md)、`docs/draft/result-envelope.md`、Core #14。 | accepted |
| admission decision | Core 拥有能力准入、资源匹配和接受前失败分类。 | Lode 声明能力生命周期、资源需求和验证要求；Harbor 提供客观 runtime facts；App 提供用户策略输入。 | API、CLI、MCP、SDK、App、Run Record。 | 本 ADR、[0004](0004-admission-and-action-risk.md)、Core #14。 | accepted |
| action risk / execution intent | Core 拥有公共风险类别、执行意图、写侧准入结果、`unknown_outcome` 和对账入口语义。 | App 拥有审批、取消和恢复 UI；Lode 声明能力风险、pre-check、post-check；Harbor 提供运行现场和证据引用。 | API、CLI、MCP、SDK、App、Run Record。 | [0004](0004-admission-and-action-risk.md)、`docs/draft/write-safety.md`、Core #14。 | accepted；最终字段见 [PD-0013](pending-decisions.md#pd-0013) |
| Harbor runtime facts | Core 只消费 `runtime_session_ref`、`profile_ref`、`execution_identity_ref`、provider / health / capability facts、Snapshot / RefMap 和 evidence refs。 | Harbor 拥有 Profile、Execution Identity、Runtime Session、browser process、Viewer、provider driver、Snapshot / RefMap 生产和 evidence store。 | Core admission、Core execution、Run Record、App 展示。 | `docs/architecture/cross-repo-architecture.md`、Harbor `ROADMAP.md`、research `browser-identity-and-runtime` / `execution-space-and-context` / `evidence-and-observability`、Core #17。 | accepted（Core 消费边界）；跨仓字段需调度收敛，见 [PD-0019](pending-decisions.md#pd-0019) |
| Lode capability / workflow package | Core 消费 package ref、capability ref/version、input/output schema、resource requirements、fixtures、post-check 和 lifecycle / invalidation facts。 | Lode 拥有站点知识、package body、schema、fixtures、post-check、asset registry、authoring draft 和 marketplace/content lifecycle。 | Core admission、Core result validation、App Library 展示。 | `docs/architecture/cross-repo-architecture.md`、Lode `ROADMAP.md`、research `site-knowledge-and-capability-assets` / `workflow-and-task-package`、Core #18。 | accepted（Core 消费边界）；跨仓字段需调度收敛，见 [PD-0019](pending-decisions.md#pd-0019) |
| App user intent / approval / recovery intent | Core 消费 App 提交的用户意图、调用上下文、审批证据引用、恢复/取消/对账意图。 | App 拥有 Work / Library / Browser UI、展示状态、用户草稿、审批体验和 handoff 入口。 | Core admission、Core execution、Run Record、App run viewer。 | `docs/architecture/cross-repo-architecture.md`、App `ROADMAP.md`、research `human-handoff-and-recovery`、Core #18。 | accepted（Core 消费边界）；跨仓字段需调度收敛，见 [PD-0019](pending-decisions.md#pd-0019) |
| 通用 browser agent loop 作为 Core 正式路径 | Core 不把任意浏览器动作、通用 eval、低层 tool loop 或一次性 helper 当成稳定任务合同。 | 探索、authoring、debug 可以在 Harbor / Lode / App 的对应模式中存在，但不能绕过 Core 准入成为公共任务路径。 | 后续能力设计、准入设计。 | 本 ADR、research `execution-space-and-context` / `task-execution-and-admission`。 | rejected |
| 完整阶段二 JSON Schema / API 字段 | 本轮只冻结归属和消费边界。 | 具体字段、枚举、API 和生成类型属于后续阶段二规格。 | 后续 Core 协议规格。 | Core #13、#14、#16、#17、#18。 | deferred；见 [PD-0003](pending-decisions.md#pd-0003)、[PD-0005](pending-decisions.md#pd-0005)、[PD-0013](pending-decisions.md#pd-0013) |

## 首个低风险只读任务楔子

本节覆盖 Core #19、#20 和 #21 的第一阶段楔子，只冻结责任路径和字段族，不定义阶段二完整 Schema。

| 步骤/场景 | 本仓责任 | 输入 | 输出 | 失败/证据 | 状态 |
|---|---|---|---|---|---|
| 用户提交低风险只读意图 | API Server 归一化调用入口、用户意图和请求快照，进入同一条 Core 任务路径。 | App/API 提交的目标页面或账号环境意图、调用上下文、用户策略摘要。 | `task_request` 字段族、调用入口、脱敏请求摘要。 | 输入缺失、目标不清、策略不允许时返回接受前失败；不创建 Run Record。 | accepted |
| 能力与运行时引用绑定 | Core 消费一个 `capability_ref` 和一个 `runtime_ref`，做能力准入、资源匹配和读风险准入。 | Lode capability/package refs、resource requirements、Harbor runtime facts refs、证据策略。 | admission decision、resource match、read action risk、run accepted/refused。 | 能力未知、非稳定、缺少资源需求、runtime facts 不满足或证据策略缺失时 fail-closed。 | accepted |
| 已接受运行记录 | Core 生成 run id，记录 accepted/running/terminal 生命周期和引用，不拥有浏览器现场。 | 已准入任务、runtime binding refs、capability refs。 | Run Record 字段族：run identity、status、timestamps、request summary、binding refs、attempt summary。 | runtime unavailable、capability contract drift、manual recovery need 等进入结构化失败阶段。 | accepted |
| 只读结果投影 | Core 根据 Lode 输出合同投影公共 result envelope，不把 raw runtime material 内联。 | 能力输出、Harbor evidence/raw/source/resource refs、Lode output schema。 | result envelope、public payload/ref、run_record_ref、evidence refs、failure reason。 | 输出不符合 schema、证据不可用、页面变化或抽取失败返回结构化失败。 | accepted |
| 通用浏览器代理循环 | 不作为正式执行路径；只能作为探索、authoring 或 debug 输入。 | 低层 tool loop、任意 action history、prompt-only browser agent。 | 无 Core 稳定合同输出。 | 缺少 capability version、admission record、result envelope 和对账边界。 | rejected |

## 第一阶段研究吸收边界

本表覆盖 Core #7、#8、#9、#10、#11 和 #12 的可吸收机制边界。

| 候选项 | 吸收方式 | 源码复用判断 | 依据 locator | Owner | 状态 |
|---|---|---|---|---|---|
| Syvert Run Record / TaskRecord / admission / resource trace | 吸收机制：运行记录、公共准入、资源匹配、终态封装和 fail-closed 错误边界。 | 仅可裁剪小型状态/校验/证据思想；不迁入 Syvert runtime 主链。 | `research/synthesis.md`、`research/absorability/themes/task-execution-and-admission.md`、`sources/lodcel/Syvert/syvert/runtime.py`、`sources/lodcel/Syvert/syvert/task_record.py`、`sources/lodcel/Syvert/syvert/resource_lifecycle.py`。 | Core | accepted |
| 旧 WebEnvoy runtime store / CLI envelope / risk gate | 吸收机制：CLI 结构化错误、运行时状态摘要、风险门禁、证据边界和 local state 经验。 | 自有旧代码可作为 schema/fixture/helper seed；不得复制 XHS 专用平台流程为 Core 通用合同。 | `research/synthesis.md`、`research/absorability/themes/api-cli-mcp-and-agent-interface.md`、`sources/lodcel/WebEnvoy/src/cli.ts`、`sources/lodcel/WebEnvoy/src/commands/xhs-runtime.ts`。 | Core | accepted |
| browser-use failure budget / ActionResult / domain constraints | 只吸收字段族参考：失败预算、动作结果、allowed/prohibited domain 和结构化错误思想。 | 不复用源码，不采用 agent loop 作为正式路径。 | `research/absorability/themes/task-execution-and-admission.md`、`sources/browser-use/browser-use/browser_use/agent/views.py`、`sources/browser-use/browser-use/browser_use/browser/profile.py`。 | Core / Harbor 边界 | candidate |
| Skyvern hosted workflow / generic browser agent loop | 仅参考任务/工作流产品形态和错误分类；不作为 Core 路径。 | 不复用源码；hosted platform、UI shell、credential/vault 和 org workflow runtime 不进入 Core。 | `research/synthesis.md`、`sources/Skyvern-AI/skyvern/CLAUDE.md`、`sources/Skyvern-AI/skyvern/skyvern/forge/agent.py`。 | 不进入 Core | rejected |
| Harbor runtime / Lode assets / App UI truth | Core 只消费 refs、facts 和 user intent，不复制 truth。 | 不复用其他仓实现为 Core 内部状态。 | `ROADMAP.md`、Harbor/Lode/App `ROADMAP.md`、`docs/architecture/cross-repo-architecture.md`。 | Harbor / Lode / App | accepted |

## 后果

所有公共入口都会获得同一套准入、资源匹配、失败分类、运行记录和结果封装。

低层浏览器工具仍可用于探索和 Lode 能力编写，但不是稳定站点任务接口。

Core 必须在浏览器执行前拒绝一部分任务。这是预期行为：接受前失败比真实站点动作开始后才发现合同缺失更安全。

后续 Schema 可以保持较小，因为本 ADR 冻结的是所有权和流程，不是每个字段名。

## 备选方案

- 用通用浏览器智能体循环作为 Core：拒绝，因为它缺少能力版本、准入记录、公共结果封装和对账能力。
- 让 Harbor 判断任务是否应该运行：拒绝，因为 Harbor 拥有运行时事实，不拥有站点任务策略。
- 让 Lode 直接执行任务：拒绝，因为 Lode 拥有可复用能力资产，不拥有运行时会话或任务记录。
- 让 CLI、MCP 和 SDK 各自拥有独立执行路径：拒绝，因为行为、安全和证据会漂移。
- 把提供方路由、回退优先级、市场状态或凭据放进 Core 准入：拒绝，因为它们属于运行时、产品或密钥管理关注点，不属于公共能力合同。

## 研究证据

- [docs/draft/architecture.md](../draft/architecture.md) 定义了单一 Core 任务路径和仓库边界。
- [docs/draft/runtime-contract.md](../draft/runtime-contract.md) 定义了任务请求、能力准入、资源需求、运行时能力事实和运行记录概念。
- [docs/draft/capability-admission.md](../draft/capability-admission.md) 定义了稳定能力准入和失败即关闭路径的行为。
- [研究综合](https://github.com/WebEnvoy/research/blob/main/synthesis.md) 记录了能力、工作流和任务资产需要模式化，以及运行时事实必须与任务策略拆开。
- [任务执行与准入主题](https://github.com/WebEnvoy/research/blob/main/absorability/themes/task-execution-and-admission.md) 支撑公共操作准入、资源匹配和写侧失败即关闭路径门禁。
- [API、CLI、MCP 与 Agent 接口主题](https://github.com/WebEnvoy/research/blob/main/absorability/themes/api-cli-mcp-and-agent-interface.md) 支撑共享任务接口，并警示不要把低层浏览器工具暴露成稳定站点任务 API。

## 未决问题

- [PD-0003](pending-decisions.md#pd-0003)：任务请求、能力准入、资源需求和运行时能力事实的最终 JSON Schema 名称与字段名。
- [PD-0004](pending-decisions.md#pd-0004)：`experimental` 能力是否可以通过单独标记的探索模式运行。
- [PD-0001](pending-decisions.md#pd-0001)：哪些公共合同产物留在这个 AGPL 仓库，哪些后续拆到宽松许可证合同仓库或 SDK 仓库。
- [PD-0005](pending-decisions.md#pd-0005)：CLI、MCP 和 SDK 生成所需的第一版最小 API 面。
- [PD-0006](pending-decisions.md#pd-0006)：同一运行时身份下任务执行的锁或并发粒度。
