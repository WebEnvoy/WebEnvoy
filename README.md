# WebEnvoy Core

`WebEnvoy/WebEnvoy` 是 WebEnvoy Core 仓库。

WebEnvoy 是完整产品体系；WebEnvoy Core 负责 API Server、Core Runtime、任务执行契约、Run Record、结果归一和失败归因。统一人类用户入口由 `WebEnvoy/App` 承载，浏览器身份和运行现场由 Harbor 提供，站点知识、能力包和任务模板由 Lode 维护。

WebEnvoy Core 让 Agent 的网页操作任务进入统一、可准入、可执行、可记录、可验证、可归因、可对账的核心任务路径。

## WebEnvoy Core 解决什么问题

WebEnvoy Core 关注的是“执行网页操作任务”能不能稳定完成，而不是 Agent 能不能打开一个网页。

它要解决的问题包括：

- API、CLI、MCP、SDK 和 App 容易形成多套执行路径；
- Agent 每次都要重新理解页面、入口、按钮、表单和状态；
- 网站页面、接口字段或流程变化后，脚本和提示词容易失效；
- 能力是否可以稳定执行缺少准入边界；
- 当前账号、浏览器环境或资源条件不满足任务要求时，系统应该能明确指出原因，而不是继续硬跑；
- 真实写入动作缺少前置检查，例如账号状态、页面状态、目标对象和内容完整性；
- 上传、发布、修改、提交后缺少结果验证，不知道是否真的成功；
- 登录失效、验证码、访问受限、风控提示等状态经常被当成普通失败；
- 失败后只剩截图、DOM 和日志，很难判断是网站变了、能力失效、账号异常、资源不足，还是业务输入错误。

## WebEnvoy Core 适合什么场景

WebEnvoy Core 适合那些“不能只靠一次性脚本稳定完成”的网页操作任务：

- 需要登录账号才能完成的任务，例如读取后台数据、管理内容、查看账号状态；
- 需要真实写入的任务，例如上传文件、保存草稿、发布内容、修改资料、提交表单；
- 需要确认结果的任务，例如发布后回收链接、提交后检查状态、修改后验证页面是否生效；
- 经常变化的网站流程，例如按钮位置、接口字段、页面结构或入口路径会变化；
- 容易出现登录失效、验证码、访问受限或风控提示的网站；
- 需要让 API、CLI、MCP、SDK 和 App 复用同一套任务执行契约的场景。

## 用户和上游系统能用它做什么

长期目标下，用户和上游系统可以通过 WebEnvoy Core：

- 通过统一 API 调用已经沉淀好的网站能力，而不是让 Agent 每次临场探索；
- 把多个网站动作组合成自己的任务流程，例如“检查账号状态后发布内容并回收链接”；
- 在执行前完成能力准入、输入校验和资源需求匹配；
- 在真实读写前做必要检查，在执行后验证结果；
- 获取结构化结果、失败原因、账号状态、页面状态、风控状态、运行证据和 Run Record；
- 在 unknown outcome 或 manual recovery 状态下继续对账、恢复或人工接管；
- 让 Agent、自动化程序、CLI、MCP、SDK 和 WebEnvoy App 复用同一套核心任务路径。

## WebEnvoy Core 不是什么

WebEnvoy Core 不是完整 WebEnvoy 产品入口，也不是 App Shell。

它不是通用 Browser Agent、普通爬虫框架、账号矩阵工具、内容排期系统或简单的 Playwright / Puppeteer 脚本集合。WebEnvoy Core 不替用户决定业务策略，也不负责运营账号。它关注的是：当用户或上游系统已经知道要完成什么网页操作任务时，如何让 Agent 更稳定、更可复用、更可验证、更可归因地完成它。

## 本仓库包含什么

本仓库承载 WebEnvoy Core 的主要任务运行能力。这里的模块说明是实现视角，用来帮助开发者理解代码边界：

- API Server：Agent、程序、上游系统、WebEnvoy App、CLI、MCP 和 SDK 的统一入口；
- Core Runtime：统一任务路径、能力准入、资源匹配、执行控制、Run Record、结果归一和失败归因；
- App-facing API：为 WebEnvoy App / Console 提供任务、能力、运行记录、证据和异常处理接口；
- CLI / MCP / SDK：不同使用方式下的调用入口；
- Schema / Contract：WebEnvoy Core、Harbor、Lode 和 App 之间共享的基础契约。

API Server 是本仓库的一等入口。SDK、CLI、MCP 和 WebEnvoy App 都应尽量复用同一套 API，避免形成多套执行路径。

## 与 App / Harbor / Lode 的关系

WebEnvoy Core 负责让 Agent 和上游系统调用网站能力，并把执行过程和结果组织清楚。

- WebEnvoy App 负责统一人类用户入口，承载 Work、Library 和 Browser 三个产品域；
- Harbor 负责浏览器账号和运行现场：Profile、登录态、代理、指纹、浏览器会话、人工接管、运行证据，以及 provider、Profile、Runtime Session 的客观能力事实；
- Lode 负责可复用的网站经验：站点知识、能力包、原子动作、任务封装、输出契约、模板、测试样例、版本和失效标记；
- WebEnvoy Core 负责把 Lode 中的能力拿来运行，按 Lode 输出契约校验和封装公共结果，并通过 Harbor 在真实浏览器环境中完成任务。

## 文档

- [愿景](VISION.md)
- [路线图](ROADMAP.md)
- [跨仓架构](docs/architecture/cross-repo-architecture.md)
- [架构决策记录](docs/adr/0001-record-architecture-decisions.md)

## 本地开发

当前代码骨架使用 Node.js 24、pnpm 10 和 TypeScript。先安装依赖：

```bash
pnpm install
```

常用检查：

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Schema 合同载体位于 `packages/schemas`：

```bash
pnpm --filter @webenvoy/schemas test
```

Run Record 最小本地持久化位于 `packages/core`：

```bash
pnpm --filter @webenvoy/core-runtime test
```

Schema fixture 与 Run Record 本地读写的纵向 conformance check：

```bash
pnpm conformance
```

API/CLI smoke 验证首个只读任务 golden run fixture 能通过同一 Core 查询合同被 API Server 和 repo-local CLI smoke 读取：

```bash
pnpm smoke
```

写侧 action request guardrail 通过 Core runtime 和 conformance 自检覆盖；真实写入在当前里程碑只记录为 deferred/failed Run Record，不进入执行器。

启动最小 API Server：

```bash
pnpm --filter @webenvoy/api-server start
```

当前任务入口包括 `POST /tasks`，以及任务线程的 `POST /threads`、`GET /threads`、`GET /threads/:thread_id`、`POST /threads/:thread_id/turns` 和显式终止入口。线程由 capability ref 与 Harbor identity environment ref 稳定绑定；提交回合必须携带 idempotency key、Run ID、结构化输入快照和相同绑定。活动或 `status_unknown` 回合存在时拒绝新回合，不建立隐式队列。长文本、文件和附件仅接受受限命名空间的 owner ref；宿主配置 availability checker 后，检查超时或失效会 fail closed，已保存回合返回精确输入缺口而不读取内容。未配置 checker 时 Core 只验证并保存不透明 ref，不声称已验证其可用性。

查询入口还包括 `GET /health`、`GET /readiness`、`GET /runs/:run_id`、`GET /runs/:run_id/result` 和 `GET /runs/:run_id/evidence-refs`。这些接口只返回 Core Run Record、Task Thread、result envelope 和 evidence ref 的公共投影。设置 `WEBENVOY_RUN_RECORD_DIR` 后 API Server 同时启用默认的线程持久化目录；可用 `WEBENVOY_TASK_THREAD_DIR` 指定独立目录。写侧 guardrail 仍阻止真实外部写入。

## 许可证

本仓库采用 [GNU Affero General Public License v3.0](LICENSE)。
