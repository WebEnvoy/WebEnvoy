# Core Runtime

Core Runtime 描述 WebEnvoy 如何把一次网站工作从外部调用变成可准入、可控制、可记录、可验证、可对账的运行过程。

它承接过往已验证的任务运行、资源治理、任务记录、写侧安全和生态边界原则，但使用 WebEnvoy 当前的产品语言和仓库边界重新表达。

## 目标

Core Runtime 的目标不是“把步骤串起来”，而是保证一次网站任务具备以下性质：

- 可准入：只有已定义、已验证、已版本化的能力进入稳定执行路径；
- 可投影：外部请求会收敛为 Core 可理解的任务请求，再投影到能力执行所需的最小上下文；
- 可控制：超时、重试、人工接管、资源使用和写侧意图都有明确边界；
- 可记录：任务从 accepted 到 terminal 的状态变化有 durable truth；
- 可归因：失败原因结构化，不靠翻日志猜测；
- 可对账：真实写入不以“点完了”为成功，而以状态验证、write operation ref 和证据为依据；
- 可治理：敏感数据、provider 细节和私有执行现场不应泄漏到公共结果。

## 同一核心任务路径

WebEnvoy 的所有入口都应复用同一条 Core Runtime 路径。

```text
Agent / 上游系统 / SDK / CLI / MCP / WebEnvoy App
  → WebEnvoy API Server
  → Core Runtime
  → Lode Capability / Task Package
  → Harbor Runtime Session
  → Run Record / Evidence / Result Envelope
```

入口之间可以有不同体验：

- API 面向 Agent、程序和上游系统；
- SDK 封装 API；
- CLI 面向本地调试和脚本；
- MCP 把能力暴露给 Agent 工具环境；
- WebEnvoy App 面向人类配置、观察、调试和异常处理。

但它们不应各自实现执行逻辑。CLI、MCP、SDK 和 WebEnvoy App 应通过 API Server 进入 Core Runtime，而不是绕开 Core 直接调用 Harbor 或 Lode。

## 运行主链路

Core Runtime 的主链路如下：

```text
外部调用
  → 请求归一化
  → 能力准入
  → 输入和目标校验
  → 资源需求匹配
  → Harbor Runtime Session 绑定
  → 创建 Run Record: accepted
  → 推进 Run Record: running
  → 执行能力或任务封装
  → 写入前检查 / 状态识别 / 动作执行 / 写入后验证
  → 接收 raw_payload_ref / source_trace / execution evidence
  → 按 Lode output schema 校验 normalized result
  → 生成 public result envelope
  → 记录 Evidence 和失败事实
  → 推进 Run Record: terminal
  → 返回结构化结果
```

其中最重要的边界是：**准入、资源匹配和记录创建发生在执行前**。如果能力未准入、输入非法、资源不满足或运行上下文不可用，Core 应返回结构化失败，不应进入真实执行。

执行后同样需要边界：Core 应消费 Lode 声明的 output schema，对 normalized result、collection item、comment item、dataset record、cursor、continuation 和 source trace 进行校验。raw payload、完整截图、network 摘要和执行现场只能通过引用进入公共结果，不应 inline 到 public result envelope。

## 请求模型

外部入口可以有不同 payload，但进入 Core Runtime 后应收敛为统一任务请求。

任务请求至少应表达：

- 调用入口；
- 调用方上下文；
- 目标站点；
- 能力或任务封装；
- 输入参数；
- 资源需求；
- 执行策略约束；
- 证据策略；
- 是否允许真实写入；
- 是否允许人工接管。

Core 不应把完整原始请求直接传给能力执行层。能力执行层应只接收经过校验、裁剪和投影后的上下文。

## 能力准入

WebEnvoy 的稳定执行面不应接受任意字符串能力。

能力准入需要回答：

- 这个能力是否已经定义；
- 输入和输出是否有明确 schema；
- 资源需求是否声明；
- 前置检查和后置验证是否存在；
- 失败原因是否可归类；
- 证据策略是否明确；
- 能力版本是否可用；
- 依赖的站点知识是否已经失效。

推荐能力生命周期：

| 生命周期 | 说明 |
|---|---|
| proposed | 候选能力，只用于探索、讨论或草稿生成 |
| experimental | 受控试用能力，不进入默认稳定生产路径 |
| stable | 已具备测试、证据、版本和失效处理的稳定能力 |
| deprecated | 保留历史语义，但不再作为新任务默认选择 |

未准入能力应 fail closed，不应由 Agent 临场绕过。

## 资源需求匹配

资源需求匹配连接 Lode 和 Harbor。

Lode 能力声明任务需要什么资源，例如：

- 是否需要账号；
- 是否需要稳定浏览器身份；
- 是否需要完整浏览器上下文；
- 是否需要代理或固定环境；
- 是否需要人工接管；
- 是否需要写入验证；
- 是否需要特定 provider-native 能力；
- 是否需要特定证据策略。

Harbor 返回客观能力事实，例如：

- provider 类型；
- Profile 是否长期持久；
- Cookie / storage 是否可复用；
- 代理、语言、时区、viewport 是否可配置；
- CDP、Viewer、VNC 是否可用；
- Snapshot / RefMap 是否可用；
- 是否支持人工接管；
- provider 是否提供原生指纹控制或反检测能力；
- 当前 Runtime Session 是否健康。

WebEnvoy Core 根据 Lode 资源需求、Harbor 能力事实和用户策略做匹配。Harbor 不输出“是否适合任务”的黑盒判断，Core 也不输出不可解释的风险分。

资源不满足时，应返回明确原因，例如：

- 需要账号，但没有可用登录态；
- 需要稳定身份，但当前 Profile 是临时会话；
- 需要人工接管，但当前 Runtime Session 没有 Viewer；
- 需要写入验证，但能力包没有定义验证规则；
- 需要特定 provider-native 能力，但当前 provider 不提供对应能力事实。

## Run Record

Run Record 是一次任务运行的 durable truth，而不是普通日志。

推荐状态机：

```text
accepted
  → running
  → succeeded / failed / unknown_outcome / manual_recovery_required
```

Run Record 至少应记录：

- run_id / task_id；
- 调用入口；
- 能力或任务封装版本；
- 输入摘要；
- 资源需求摘要；
- 资源匹配结果；
- Harbor Runtime Session 引用；
- 状态变化；
- 执行步骤摘要；
- 写入前检查结果；
- 写入后验证结果；
- 失败原因；
- Evidence 引用；
- 终态结果。

状态推进应单调，终态结果不应被随意覆盖。查询接口应读取 Run Record，而不是重新执行任务或读取临时内存。

## Failure Model

WebEnvoy 的失败不应只有“异常”。

至少应区分：

| 失败类型 | 示例 |
|---|---|
| invalid_request | 输入缺失、目标不合法、参数不符合 schema |
| capability_not_admitted | 能力未稳定、版本失效、依赖站点知识失效 |
| resource_unavailable | 账号、Profile、Runtime Session 或 provider 能力事实不满足任务需求 |
| runtime_unavailable | Harbor 会话不可用、连接失败、浏览器崩溃 |
| site_state_blocked | 登录失效、验证码、访问受限、页面状态不符合前置条件 |
| execution_failed | 能力执行过程中失败，可归因到具体步骤 |
| verification_failed | 写入后验证未通过 |
| unknown_outcome | 写入可能已触达外部系统，但结果不可确认 |
| manual_recovery_required | 需要人类观察、接管或恢复 |
| evidence_unavailable | 证据写入失败或证据策略不满足 |

失败原因应返回结构化事实，而不是黑盒分数。

## Write-side Safety

真实写入任务必须经过写侧安全边界。

写侧任务包括：

- 上传文件；
- 保存草稿；
- 发布内容；
- 修改资料；
- 删除内容；
- 提交表单；
- 取消或撤回既有操作。

写侧执行至少应支持这些意图：

| 意图 | 说明 |
|---|---|
| dry_run | 不触达外部写入，只检查任务形状和资源是否可能满足 |
| validate_only | 检查账号、页面、目标对象、内容和资源是否满足执行条件 |
| execute_after_approval | 在明确授权或策略允许后执行外部写入 |
| reconcile_status | 查询既有写入操作的状态 |
| request_cancel | 对既有写入操作发起取消或撤回 |

写侧执行必须关注：

- 前置检查；
- 用户确认或策略授权；
- 幂等 key；
- write_operation_ref；
- 写入后验证；
- unknown outcome；
- manual recovery；
- Evidence。

## Unknown Outcome

Unknown outcome 表示任务可能已经触达外部系统，但 WebEnvoy 无法确认最终状态。

例如：

- 发布请求发出后页面断开；
- 上传返回不完整；
- 点击提交后进入验证码；
- provider 超时但外部系统可能已受理；
- 写入后状态页暂时不可见。

这类情况不能标记为成功，也不能当作普通失败丢弃。Run Record 应保留现场证据、已知步骤、可恢复引用和后续对账入口。

## Reconciliation

Reconciliation 是围绕已有写入操作进行后续处理的能力。

它包括：

- 查询发布状态；
- 回收发布链接；
- 验证修改是否生效；
- 取消或撤回写入；
- 补充证据；
- 从人工恢复后继续执行。

Reconciliation 不应重新发起新的写入，除非用户策略或能力定义明确允许。

## Evidence 与 No-leakage

WebEnvoy 需要足够证据来解释任务，但不能默认泄漏用户敏感状态。

默认可以记录：

- 截图；
- Snapshot；
- 关键 DOM 摘要；
- 网络摘要；
- console 错误；
- 执行步骤；
- 写入前检查结果；
- 写入后验证结果；
- 失败原因；
- 脱敏站点变化摘要。

默认不应上传或外传：

- 账号；
- Cookie；
- token；
- 完整 DOM；
- 完整请求 / 响应；
- 发布内容；
- 用户业务参数；
- 未脱敏执行现场。

Provider、Runtime、Profile 等底层事实可以用于资源匹配和调试，但不应变成公共结果里的私有实现泄漏。

## 不做什么

Core Runtime 不应成为：

- 通用 Browser Agent loop；
- Harbor 的浏览器进程管理器；
- Lode 的能力包仓库；
- provider marketplace；
- provider 排名或路由系统；
- 账号风险评分系统；
- 业务策略系统。

一句话：Core Runtime 负责让网站任务可靠运行、记录和归因，不负责浏览器底座、能力资产维护或业务决策。
