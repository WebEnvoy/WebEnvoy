# WebEnvoy Core Vision

`WebEnvoy/WebEnvoy` 是 WebEnvoy Core 仓库。

WebEnvoy Core 的长期愿景，是让 Agent 的网页操作任务进入一条统一、可准入、可执行、可记录、可验证、可归因、可对账的核心任务路径。

WebEnvoy 是完整产品体系；WebEnvoy Core 只是其中的任务运行核心。统一人类用户入口由 `WebEnvoy/App` 承载，浏览器身份和运行现场由 Harbor 提供，站点知识、能力包和任务模板由 Lode 维护。

## 一句话愿景

让 Agent 的网页操作任务从临场摸索，变成可准入、可记录、可验证、可归因、可对账的稳定执行。

## Core 要解决的问题

很多网页操作任务看起来只是“打开网页点几下”，但真正交给 Agent 后会变得不稳定。

Core 要解决的不是“Agent 能不能控制浏览器”，而是一次任务能否在统一契约下被可靠运行：

- 任务入口分散，API、CLI、MCP、SDK 和 App 容易形成多套执行路径；
- 能力是否可稳定执行没有准入边界，Agent 容易临场摸索；
- 输入、目标、资源需求和执行策略没有统一任务请求模型；
- 当前账号、浏览器环境或 provider 能力事实不满足任务要求时，系统容易继续硬跑；
- 真实写入缺少写入前检查、幂等控制、写入后验证和状态对账；
- 登录失效、验证码、访问受限、页面变化和资源不足经常被当成普通失败；
- 失败后只剩截图、日志或中间推理，很难判断是能力失效、网站变化、账号异常、资源不足还是业务输入错误；
- 任务记录不是 durable truth，难以查询、审计、恢复和复盘。

## Core 给用户和上游系统带来的变化

使用 WebEnvoy Core 后，上游系统和 WebEnvoy App 应该能够：

- 通过统一 API 提交网页操作任务；
- 让 API、CLI、MCP、SDK 和 App 复用同一条执行路径；
- 在执行前完成能力准入、输入校验和资源需求匹配；
- 在资源不满足时返回明确原因，而不是继续执行；
- 在真实写入前检查账号、页面、目标对象和内容是否满足条件；
- 在写入后返回明确结果、状态对账或 unknown outcome；
- 在失败时返回结构化原因、证据引用和恢复线索；
- 查询 Run Record，理解一次任务做了什么、用过什么资源、在哪一步失败、证据在哪里。

WebEnvoy Core 的产品价值不是提供一个手动操作后台，而是让 Agent 和上游系统可靠复用网站能力，并让任务结果具备可解释的运行事实。

## 核心产品价值

### 统一核心任务路径

Core 应保证所有入口进入同一条任务路径：

```text
API / SDK / CLI / MCP / WebEnvoy App
  → API Server
  → Core Runtime
  → Capability Admission
  → Resource Requirement Matching
  → Harbor Runtime Session / Capability Facts
  → Run Record
  → Result Envelope / Evidence
```

不同入口可以有不同体验，但不能各自实现任务执行逻辑。

### 能力准入

Core 不应让任意网页动作直接进入稳定执行路径。

一个能力进入稳定执行前，应具备清晰的输入输出、资源需求、执行边界、前置检查、后置验证、失败分类、证据策略、版本和失效标记。

未准入能力可以用于探索和草稿，但不应成为默认稳定任务路径。

### 资源需求匹配

Lode 声明任务需要什么资源；Harbor 返回 provider、Profile 和 Runtime Session 的客观能力事实；Core 根据二者和用户策略判断资源是否满足。

Core 不输出黑盒风险分，也不把 Harbor 的能力事实解释成绝对适配结论。它应返回可解释的匹配事实和失败原因。

### Run Record

Run Record 是任务运行的 durable truth，不是普通日志。

它应记录任务请求摘要、能力版本、资源需求、资源匹配结果、Runtime Session 引用、状态变化、执行步骤、写入前检查、写入后验证、失败原因和 Evidence 引用。

推荐状态机：

```text
accepted → running → succeeded / failed / unknown_outcome / manual_recovery_required
```

状态推进应单调，终态结果不应被随意覆盖。

### 写侧安全与状态对账

真实写入不是读侧能力的简单扩展。

上传、发布、修改、删除、提交等任务应区分：

- dry_run；
- validate_only；
- execute_after_approval；
- reconcile_status；
- request_cancel。

写侧任务应支持幂等 key、write operation ref、写入后验证、unknown outcome、manual recovery 和后续状态对账。

无法确认结果的写入不能伪装成成功，也不能丢失现场。

### 失败归因

Core 的失败模型应返回结构化事实，而不是只返回异常文本。

至少应区分：

- invalid_request；
- capability_not_admitted；
- resource_unavailable；
- runtime_unavailable；
- site_state_blocked；
- execution_failed；
- verification_failed；
- unknown_outcome；
- manual_recovery_required；
- evidence_unavailable。

这些失败原因应能被 WebEnvoy App、Agent、SDK、CLI、MCP 和上游系统一致消费。

### Evidence 与 no-leakage

Core 需要足够证据解释任务，但不能默认泄漏用户敏感状态。

Core 可以组织截图、Snapshot、关键 DOM 摘要、网络摘要、执行步骤、验证结果和脱敏变化摘要；不应默认上传账号、Cookie、token、完整 DOM、完整请求响应、用户业务输入或未脱敏执行现场。

## 与 App / Harbor / Lode 的关系

WebEnvoy Core 不是完整 WebEnvoy 产品，而是产品体系中的任务运行核心。

- WebEnvoy App 负责统一人类用户入口，承载 Work、Library 和 Browser 三个产品域；
- Lode 负责站点知识、能力包、原子动作、任务封装、模板、测试样例、版本和失效标记；
- Harbor 负责浏览器身份、Profile、Runtime Session、Viewer、人工接管、provider 能力事实和运行证据；
- WebEnvoy Core 负责 API Server、Core Runtime、能力准入、资源匹配、任务执行、Run Record、结果归一、失败归因和对账。

```text
WebEnvoy App
  ↓
WebEnvoy API Server
  ↓
WebEnvoy Core Runtime
  ↓                 ↓
Lode                Harbor Runtime API
```

## Core 不是什么

WebEnvoy Core 不是完整产品入口，不承载 App Shell，也不是 Harbor Runtime 或 Lode 资产仓库。

它不是通用 Browser Agent、普通爬虫框架、账号矩阵工具、内容排期系统、CRM、运营看板或广告投放系统。Core 不替用户决定业务策略，不运营账号，不判断应该发什么内容或联系谁。

Core 关注的是：当用户或上游系统已经知道要完成什么网页操作任务时，如何让该任务更稳定、更可复用、更可验证、更可归因地完成。

## 长期坚持的原则

WebEnvoy Core 的长期设计应坚持：

- 所有入口复用同一核心任务路径；
- 未准入能力不进入稳定执行；
- 资源不满足不硬跑；
- 真实写入必须可检查、可验证、可对账；
- 默认返回事实、状态和失败原因，不输出无法解释的黑盒评分；
- Run Record 是 durable truth，不是临时日志；
- 执行方式可以很多，但不应让 Agent 为了效率随意绕开账号身份和浏览器上下文；
- 用户敏感状态不应默认上传或外传。

## 成功状态

当 WebEnvoy Core 成功时，用户和上游系统应该可以自然地说：

- 这个任务通过统一 API 进入了同一条核心执行路径；
- 这个能力是否被准入、使用哪个版本、需要什么资源，我能看到明确事实；
- 如果资源不满足，系统会停止并说明原因，而不是继续硬跑；
- 这次读取、上传、发布、修改或提交是否成功，我能看到明确结果；
- 如果结果未知，我能看到 unknown outcome、证据和后续对账入口；
- 如果失败，我知道是网站变了、能力失效、账号异常、资源不足、风控出现，还是输入不对；
- Run Record 和 Evidence 足够支撑调试、恢复、审计和能力修复。

这就是 WebEnvoy Core 的长期产品价值：让 Agent 的网页操作任务具备稳定、可验证、可归因、可对账的核心执行路径。
