# 0002. 运行、任务与能力模型

## 状态

拟议。

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
- [research/synthesis.md](../../../research/synthesis.md) 记录了能力、工作流和任务资产需要模式化，以及运行时事实必须与任务策略拆开。
- [research/absorability/themes/task-execution-and-admission.md](../../../research/absorability/themes/task-execution-and-admission.md) 支撑公共操作准入、资源匹配和写侧失败即关闭路径门禁。
- [research/absorability/themes/api-cli-mcp-and-agent-interface.md](../../../research/absorability/themes/api-cli-mcp-and-agent-interface.md) 支撑共享任务接口，并警示不要把低层浏览器工具暴露成稳定站点任务 API。

## 未决问题

- 任务请求、能力准入、资源需求和运行时能力事实的最终 JSON Schema 名称与字段名。
- `experimental` 能力是否可以通过单独标记的探索模式运行。
- 哪些公共合同产物留在这个 AGPL 仓库，哪些后续拆到宽松许可证合同仓库或 SDK 仓库。
- CLI、MCP 和 SDK 生成所需的第一版最小 API 面。
- 同一运行时身份下任务执行的锁或并发粒度。
