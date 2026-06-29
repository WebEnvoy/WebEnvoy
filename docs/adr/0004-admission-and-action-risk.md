# 0004. 准入与动作风险

## 状态

拟议。

## 背景

WebEnvoy Core 必须在真实浏览器执行前拦住不安全或规格不足的工作。对于上传、发布、编辑、删除、提交、取消，以及任何可能触达外部系统的动作，这一点尤其重要。

研究和草稿已经收敛到同一条边界：Harbor 提供运行时事实，Lode 声明能力需求，Core 应用任务策略。三者不能合并成一个 Browser Profile 或提供方分数。

## 决策

Core 准入在执行前包含三道门：

1. 能力准入：请求的能力已知、稳定、已版本化，并有合同支撑。
2. 资源准入：Lode 资源需求与 Harbor 运行时事实和调用方策略匹配。
3. 动作风险准入：请求的执行意图和风险级别被允许，在必要时已批准，并有证据支撑。

Core 拥有门禁结果和失败分类。Harbor 拥有客观运行时事实和证据采集。Lode 拥有能力声明的需求、前置检查、后置验证和风险声明。App 拥有面向用户的审批、恢复和接管体验。

最小动作风险类别是：

- `read`：观察或抽取，不意图产生外部变更。
- `write`：改变草稿、本地、账号或页面状态，但不是外部最终提交。
- `submit`：发送、发布、上传、保存，或可能创建外部可见状态。
- `destructive`：删除、撤销、取消、覆盖，或执行难以逆转的状态变更。

最小写侧执行意图是：

- `dry_run`
- `validate_only`
- `execute_after_approval`
- `reconcile_status`
- `request_cancel`

对于 `submit` 和 `destructive` 工作，Core 必须要求显式策略允许或 `approval_evidence_ref`；在可能重复提交时必须要求幂等边界；当外部提交可能已经发生时，必须保留 `write_operation_ref` 或等价恢复引用。

运行时目标绑定是准入的一部分。Core 应把运行绑定到公共 Harbor 引用和事实，例如运行时会话、Profile、执行身份、目标页面或域名、证据策略和当前健康状态。Core 不定义 Harbor Profile 或运行时会话内部细节。

`unknown_outcome` 是终态结果，不是可恢复成功标记。如果写入可能已经到达外部系统，但 WebEnvoy 无法确认结果，Core 应记录带证据和对账引用的 `unknown_outcome`，而不是把运行标记为 `succeeded`。

对账和取消是围绕既有 `write_operation_ref` 的独立执行意图，不应被隐藏成原提交运行的重试。

## 后果

真实写入的准入会变慢，但更容易审计、恢复和对账。

Harbor 保持为运行时提供方，而不是策略判定者。Lode 保持为能力合同来源，而不是运行时拥有者。App 保持为可见审批和恢复入口，而不是第二套执行引擎。

Core 需要为缺少审批、缺少幂等边界、目标不匹配、运行时事实不可用、缺少后置检查和缺少证据策略提供结构化接受前失败。

早期实现可以只支持上述最小风险类别和执行意图。更细的站点专用策略属于 Lode 能力声明和 App/用户策略，不应硬编码进 Core 分支。

## 备选方案

- 依赖 Skill 或提示词文案约束敏感操作：拒绝，因为安全边界必须可机器检查并可记录。
- 只在低层浏览器工具上做允许、拒绝、确认：拒绝，因为稳定任务需要能力级准入和结果对账。
- 完整复制旧单站点写入门禁：拒绝，因为其中有用的是证据思想，但历史和平台专用字段过多。
- 让 Harbor 判断写入是否安全：拒绝，因为 Harbor 只知道运行时事实，不知道站点任务意图。
- 乐观地把写入超时标记为 `failed` 或 `succeeded`：拒绝，因为外部系统可能已经收到操作。

## 研究证据

- [docs/draft/capability-admission.md](../draft/capability-admission.md) 定义了失败即关闭路径的准入，以及不应进入准入面的字段。
- [docs/draft/write-safety.md](../draft/write-safety.md) 定义了写侧执行意图、幂等、审批证据、写操作引用、未知结果和对账。
- [docs/draft/runtime-contract.md](../draft/runtime-contract.md) 定义了资源需求匹配和未知结果处理。
- [研究综合](https://github.com/WebEnvoy/research/blob/main/synthesis.md) 记录了运行时事实与任务策略必须拆开，以及 Core 准入/动作风险仍需产品决策。
- [任务执行与准入主题](https://github.com/WebEnvoy/research/blob/main/absorability/themes/task-execution-and-admission.md) 支撑敏感操作确认、资源匹配、动作策略和写侧失败即关闭路径门禁。
- [证据与可观测性主题](https://github.com/WebEnvoy/research/blob/main/absorability/themes/evidence-and-observability.md) 支撑证据边界、不能作为证明的信号和显式隐私/遥测策略。

## 未决问题

- [PD-0013](pending-decisions.md#pd-0013)：动作风险、执行意图、审批证据和幂等追踪的最终 Schema。
- [PD-0014](pending-decisions.md#pd-0014)：四个最小风险类别是否足够支撑 App 策略和 MCP/CLI 展示。
- [PD-0015](pending-decisions.md#pd-0015)：审批有效期、撤销行为，以及与操作、目标、载荷和身份的绑定方式。
- [PD-0016](pending-decisions.md#pd-0016)：写任务锁粒度：会话、标签页、Profile、身份、能力还是目标对象。
- [PD-0017](pending-decisions.md#pd-0017)：每个动作风险类别的最小证据要求。
- [PD-0018](pending-decisions.md#pd-0018)：人工接管、验证码和登录恢复如何映射到准入或终态结果。
