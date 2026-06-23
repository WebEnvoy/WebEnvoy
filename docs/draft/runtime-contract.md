# Runtime Contract

Runtime Contract 描述 WebEnvoy Core 如何把一次网站任务变成可准入、可执行、可记录、可归因、可对账的运行过程。

它不是 Harbor 的内部实现文档，也不是 Lode 能力包格式文档，而是 WebEnvoy API Server、Core、Harbor、Lode、SDK、CLI、MCP 和 WebEnvoy App 之间需要稳定下来的调用边界。

更完整的 Core 运行时设计见 [Core Runtime](core-runtime.md)。

## 目标

Runtime Contract 要保证：

- 所有入口复用同一条核心任务路径；
- 未准入的网站能力不得进入稳定执行；
- 资源不满足时不得硬跑；
- 真实写入必须有前置检查、结果验证和状态对账；
- 任务结果必须可记录、可查询、可审计；
- 能力结果必须按 Lode 输出契约生成 public result envelope；
- 失败必须返回结构化原因，而不是只返回异常文本；
- Harbor 只提供浏览器身份、Runtime Session、能力事实和运行证据，不替 WebEnvoy 判断具体网站任务；
- Lode 提供站点知识、能力包、任务封装、资源需求声明、输出契约、normalized schema 和 fixture，不管理运行时会话。

## 核心概念

| 概念 | 说明 |
|---|---|
| Task Request | 一次网站任务请求，包含目标能力、输入、资源需求、执行策略和调用上下文 |
| Capability Admission | 判断某个网站能力是否已经定义、测试、版本化，并允许进入稳定执行路径 |
| Resource Requirement | Lode 能力或任务封装声明的资源需求，例如账号、稳定身份、完整浏览器上下文、写入验证、人工接管等 |
| Runtime Capability Facts | Harbor 返回的 provider、Profile、Runtime Session 的客观能力事实，不是任务适配判断 |
| Profile | 浏览器身份容器，包含 user_data_dir、Cookie、扩展、代理和浏览器配置 |
| Execution Identity | 站点绑定的执行身份，包含账号、登录态、历史状态、风险事件、资源约束和可用通道 |
| Runtime Session | 一次运行中的浏览器会话，包含 session_id、profile_id、identity_id、driver、cdp_url、viewer_url 和状态 |
| Capability Execution Context | Core 执行网站能力时从 Harbor 获取的上下文，包括 session、能力事实、证据策略和可用通道 |
| Task Record / Run Record | 一次任务运行的 durable truth，记录请求快照、生命周期状态、结果、失败原因、证据引用和运行事件 |
| Result Envelope | Core 对能力执行结果的公共封装，消费 Lode 输出契约并暴露 normalized result、引用和状态 |
| Public Projection | 将能力执行结果、raw_payload_ref、source_trace 和 evidence_ref 投影为上游可消费的公共结果 |
| Raw Payload Ref | 原始载荷引用，只用于审计、调试和能力修复，不把 raw payload inline 到公共结果 |
| Evidence | 执行证据，包括截图、Snapshot、关键 DOM 摘要、网络摘要、console 错误、执行步骤和验证结果 |
| Write Operation Ref | 真实写入动作提交后产生的可对账引用，用于状态查询、取消请求、未知结果恢复和后续验证 |
| Unknown Outcome | 写入动作已经可能触达外部系统，但结果无法确认时的状态，不能伪装成成功 |
| Reconciliation | 围绕既有写入操作进行状态对账、取消请求、人工恢复或后续验证的流程 |

## 核心任务生命周期

所有入口最终应进入同一条 Core Runtime 路径：

```text
API / SDK / CLI / MCP / WebEnvoy App
  → WebEnvoy API Server
  → Core Runtime
  → Capability Admission
  → Resource Requirement Matching
  → Harbor Runtime Session / Capability Facts
  → Task Record accepted
  → Task Record running
  → Capability Execution
  → Evidence / Result / Failure Reason
  → Task Record terminal
  → Structured Result
```

任务生命周期至少应包含：

| 阶段 | 目标 | 失败时应如何处理 |
|---|---|---|
| Request Normalization | 将外部输入收敛为统一任务请求 | 返回无记录或 pre-accepted failure，不进入执行 |
| Capability Admission | 判断能力是否可稳定执行 | 返回能力未准入、版本失效或契约不满足 |
| Resource Requirement Matching | 用 Lode 声明和 Harbor 能力事实判断资源是否满足 | 返回资源不满足，不继续硬跑 |
| Runtime Context Binding | 绑定 Profile、Execution Identity、Runtime Session 和证据策略 | 返回无法获取运行上下文或资源不可用 |
| Task Record Accepted | 记录任务已被接受 | 若记录失败，应 fail closed，不调用执行侧 |
| Task Record Running | 记录任务进入执行 | 若状态推进失败，应 fail closed |
| Capability Execution | 执行读写动作、状态识别、验证和证据采集 | 返回结构化失败原因、证据引用和恢复线索 |
| Result Projection | 按 Lode output schema 校验 normalized result、cursor、source trace 和引用边界 | 校验失败时返回结构化 failure envelope，不暴露不可信结果 |
| Terminal Result | 写入成功、失败、未知结果或需要人工恢复 | 记录终态并返回结构化结果 |

## Result Envelope 与公共投影

Core 不应直接把平台 raw payload、完整 DOM、完整请求响应或完整截图返回给上游系统。

Lode 负责定义站点能力的 output schema、normalized result schema、collection item schema、comment item schema 和 dataset record schema。Harbor 负责提供 Runtime Session、raw_payload_ref、evidence_ref、source_trace 和执行现场证据。Core 负责消费这些信息，进行运行时校验、公共投影、failure classification 和 result envelope 封装。

公共结果应优先暴露 normalized result、状态、失败分类、cursor / continuation、raw_payload_ref、evidence_ref、source_trace 和 Run Record 引用。raw payload 和执行现场只以引用形式进入公共结果。

更完整的结果封装方向见 [Result Envelope 与公共投影](result-envelope.md)。

## Capability Admission

WebEnvoy 不应让任意网页动作直接进入稳定执行路径。

一个网站能力进入稳定运行前，应至少具备：

- 清晰的能力名称；
- 输入和输出边界；
- 目标站点或站点范围；
- 资源需求声明；
- 前置检查；
- 结果验证；
- 失败原因分类；
- 证据策略；
- 版本和失效标记；
- 测试样例或回归证据。

能力可以处于不同生命周期：

| 生命周期 | 含义 |
|---|---|
| proposed | 候选能力，只能用于探索或设计讨论 |
| experimental | 可在受控场景试用，但不能作为稳定生产路径 |
| stable | 已经具备稳定契约、验证方式和失效处理 |
| deprecated | 保留历史语义，但不应继续进入新的稳定任务 |

## Resource Requirement Matching

资源需求匹配不是 Harbor 的黑盒判断，也不是 Agent 临场选择。

Lode 能力或任务封装声明任务需要什么资源；Harbor 返回 provider、Profile 和 Runtime Session 的能力事实；WebEnvoy Core 或用户策略根据二者判断是否满足任务要求。

典型资源需求包括：

- 不需要账号；
- 需要账号登录态；
- 需要稳定浏览器身份；
- 需要完整浏览器上下文；
- 需要代理或固定网络环境；
- 需要人工接管能力；
- 需要写入前检查和写入后验证；
- 需要特定 provider-native 指纹控制或反检测能力；
- 需要特定证据策略。

如果当前账号、Profile、Runtime Session 或 provider 能力事实不满足任务要求，Core 应返回明确原因，而不是继续硬跑。

## Task Record / Run Record

WebEnvoy 的任务记录不应只是日志。它应成为一次执行的 durable truth。

Task Record 至少应记录：

- task_id / run_id；
- 调用入口；
- 能力名称和版本；
- 输入摘要；
- 资源需求摘要；
- Harbor Runtime Session 引用；
- 生命周期状态；
- 关键执行步骤；
- 写入前检查结果；
- 写入后验证结果；
- 失败原因；
- Evidence 引用；
- 终态结果。

推荐状态机：

```text
accepted → running → succeeded / failed / unknown_outcome / manual_recovery_required
```

状态推进应单调，不应被后续写入随意覆盖。终态记录应可查询、可复现、可引用。

## Write-side Safety

真实写入不是读侧能力的简单扩展。

上传、发布、修改、删除、提交等动作需要更严格的写侧安全模型。写侧任务至少应区分：

| 意图 | 含义 |
|---|---|
| dry_run | 不执行外部写入，只检查任务是否可执行 |
| validate_only | 验证输入、账号状态、页面状态、资源状态和目标对象 |
| execute_after_approval | 在明确授权后执行外部写入 |
| reconcile_status | 对已有写入操作查询状态或验证结果 |
| request_cancel | 对已有写入操作发起取消或撤回请求 |

写侧执行应具备：

- 写入前检查；
- 必要时的用户确认或审批证据；
- 幂等 key，避免重复提交；
- write_operation_ref，支持后续对账；
- unknown outcome 状态，避免把无法确认的写入伪装成成功；
- manual recovery 状态，允许人工接管恢复；
- 写入后验证和证据引用。

## Unknown Outcome 与 Reconciliation

真实网站写入可能出现不确定结果。例如：页面提交后断开、Provider 超时、页面进入验证码、网络返回不完整、状态页暂时不可见。

这类情况不能简单标记为成功，也不能丢失现场。WebEnvoy 应返回 unknown outcome，并保留：

- write_operation_ref 或可恢复引用；
- 已知执行步骤；
- 可能已触达外部系统的证据；
- 后续状态对账入口；
- 是否需要人工恢复。

Reconciliation 用于围绕已有写入操作继续处理：

- 查询发布状态；
- 回收发布链接；
- 验证修改是否生效；
- 取消或撤回写入；
- 处理人工恢复后的继续执行。

## Harbor 协作边界

Core 不应：

- 直接启动或杀死浏览器进程；
- 直接操作 user_data_dir；
- 直接保存 Cookie、Token 或完整请求响应；
- 在不了解资源约束的情况下绕过 Harbor 使用外部通道；
- 把 Harbor provider 能力事实解释成黑盒风险分或绝对适配结论。

Harbor 不应：

- 理解具体站点业务语义；
- 决定业务策略；
- 判断某个网站任务是否应该执行；
- 替 Core 执行站点能力流程；
- 默认上传用户敏感状态。

## 待稳定内容

- Task Request Schema；
- Capability Admission Schema；
- Resource Requirement Schema；
- Runtime Capability Facts Schema；
- Runtime Session Schema；
- Execution Identity Schema；
- Task Record / Run Record Schema；
- Evidence Schema；
- Write Operation Ref Schema；
- Unknown Outcome / Reconciliation Schema；
- WebEnvoy Public / Internal API；
- Harbor acquire / release session API；
- CDP / Viewer / VNC 暴露策略；
- 错误类型和状态码；
- 写入前检查与写入后验证的证据格式。
