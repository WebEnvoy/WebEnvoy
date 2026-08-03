# WebEnvoy App Vision

WebEnvoy App 的长期愿景，是让人类业务用户通过一个桌面入口运行确定性网页任务、观测 WebEnvoy 全局运行事实，并管理站点技能、账号身份和浏览器执行现场。

App 面向市场、运营、产品经理等非技术用户。Agent 不在 App 内运行；Agent 使用 WebEnvoy 的方式是 API、CLI、MCP、SDK 或 skills。App 的职责是把 Lode 的站点技能、Harbor 的账号身份、Core 的任务运行结果，以及非 App 调用方产生的 WebEnvoy 运行事实，组织成用户能理解和操作的产品表面。

## 一句话愿景

一个桌面 App，让用户管理账号与浏览器环境、执行站点技能、查看全局任务和业务结果，并在需要时进入来源、现场和诊断。

## 产品原则

WebEnvoy App 应坚持：

- App 是人类用户入口，不是 Agent 容器；
- App 的自动任务执行入口只选择 Lode 提供的站点能力入口；当前先消费 capability package metadata，workflow package 是后续扩展；
- Agent、API、CLI、MCP、SDK、skills 或其他上层应用不受 App 自动执行入口限制；
- Agent 等非 App 调用方产生的 task、run、result、evidence 和 browser session 也应能在 App 中呈现；
- 用户浅层界面使用业务语言，不暴露 API、endpoint、schema 或 runtime 细节；
- 任务执行通过 WebEnvoy API Server 和 Core Runtime；
- 站点技能、capability package metadata、能力包、测试样例和版本事实来自 Lode；workflow package 是后续扩展；
- 账号身份、浏览器环境、Identity Runtime Session、Viewer 和执行现场来自 Harbor；
- App 不保存 task、run、result、evidence、capability 或 profile 的真相源；
- App 可以保存 UI 设置、最近视图和带来源/时间/stale 标记的非敏感展示缓存；
- 结果必须能追溯到结果依据，失败必须能说明失败阶段和下一步动作；
- 没有合适站点技能时，用户、Agent、API、CLI 或 MCP 可以通过账号身份启动受控浏览器实例，但这不是自动任务执行；
- Work、Browser、Library 是三个可管理、可观测的业务域；Task Thread 仅是待用户确认 Story 与高保真原型验证的 Work 候选组织方式；
- 真实写入、批量 crawler、marketplace 和通用 browser agent loop 不属于首个桌面闭环。

## 核心对象

```text
站点技能 + 账号身份 + 业务输入 = Task
Task 的一次执行尝试 = Run
```

- 站点技能：App 对 Lode 站点能力入口的产品名；当前先消费 capability package metadata，workflow package 是后续扩展。App 自动执行入口必须从这里选择。
- 账号身份：账号状态和浏览器环境的组合。无需登录的任务也使用账号身份，例如“本机 Chrome”。
- 业务输入：用户提供的 URL、素材、字段或操作参数。
- Task：围绕同一站点技能、账号身份和业务输入形成的任务线程。
- Run：同一个 Task 下的一次执行记录，可以成功、失败、被接管、重试或产生 unknown outcome。

站点技能、账号身份或主要业务输入变化时，通常应创建新 Task；重试、重新登录、接管后继续、runtime 重启或验证重跑应成为同一 Task 下的新 Run。

## 用户能用它做什么

长期目标下，用户可以通过 WebEnvoy App：

- 创建账号身份，或使用本机 Chrome 作为默认运行环境；
- 从站点技能中选择一个确定性站点能力入口；
- 填写 URL、素材或其他业务输入并发起任务；
- 查看 Agent、API、CLI、MCP 或其他调用方产生的运行记录；
- 查看同一 Task 下的多次 Run；
- 在任务完成后阅读任务结束报告；
- 展开执行过程，查看每次 Run 的阶段、失败和重试；
- 查看结构化结果、结果依据、字段来源和页面记录；
- 打开执行现场，观察浏览器环境或按 owner 允许的方式接管；
- 看到账号身份、站点技能和诊断上下文；
- 在失败时根据提示修改输入、重新执行、打开现场或等待恢复；
- 在深层页面管理账号身份、站点技能、连接状态和开发者配置。
- 在没有合适站点技能时，选择账号身份并启动受控浏览器实例进行手动浏览、登录、观察或准备环境。direct Identity Runtime Session 属于 Browser/Harbor session 管理路径，不创建 Core Task/Run/Result，也不展示 Task Thread result/evidence/failure。

## 桌面信息架构方向

权威方向是 [ADR 0009](docs/adr/0009-human-workbench-information-architecture.md)。
Work、Browser、Library 是三个业务域；旧 Task Thread first checkpoint、固定三栏、
右侧 refs/evidence tabs 和 approval-request-first 交互只作历史输入，不再是实现约束。

Settings 只承载偏好、
全局授权默认值、连接和诊断。Work 默认展示业务结果、失败原因和下一步；来源摘要
次之；运行详情和 refs/trace 诊断由用户主动展开。Browser 负责账号身份以及 provider
检测、安装、更新、修复、启动验证和实例生命周期。App、CLI、MCP、API、SDK 和
Agent 产生的任务共用 Core 任务与授权语义。

## 与 WebEnvoy / Harbor / Lode 的关系

```text
WebEnvoy App
  -> WebEnvoy API Server / Core Runtime：task、run、result、failure、action request
  -> Lode：站点技能、capability package metadata、package、schema、fixture、version、post-check
  -> Harbor：账号身份、browser environment、identity runtime session、snapshot/refmap/evidence refs、viewer/takeover
```

App 负责把这些事实组合成人类可操作的桌面体验，也负责展示非 App 调用方产生的运行事实。Core、Lode 和 Harbor 仍分别拥有自己的真相源；App 不绕过 owner API。

## 不是什么

WebEnvoy App 不是：

- Agent 聊天应用；
- 普通浏览器或指纹浏览器替代品；但它可以作为账号身份/浏览器环境的受控启动台；
- 任意网页读写任务启动器；
- Core Runtime、Harbor Runtime 或 Lode Registry；
- 业务策略系统、账号运营系统或内容排期系统；
- raw evidence、cookie、token、browser profile storage 或 Run Record 的存储真相源。

App 的价值是让非技术用户安全、清楚地运行确定性网页任务，观测 WebEnvoy 全局运行事实，并能理解结果从哪里来、失败在哪里、下一步能做什么。
