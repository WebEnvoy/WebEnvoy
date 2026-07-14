# 0008. Core 技术架构基线

## 状态

已接受，docs-only，2026-07-01。

> 2026-07-14 correction: [ADR 0009](0009-unified-authorization-policy.md)
> supersedes action-risk/approval vocabulary in this baseline. Technical stack, owner,
> schema and storage boundaries remain valid; implementation uses unified authorization.

## 背景

Milestone #8 要在代码骨架前冻结 Core 服务、Schema、运行记录、统一入口和跨仓合同的技术边界。本 ADR 覆盖 FR #79、#84，以及 Work Items #80、#81、#82、#83、#85、#86、#87、#88。

本 ADR 只写技术架构基线。不创建 `package.json`、目录骨架、依赖、OpenAPI、完整 JSON Schema、fixture 文件、runner、runtime、数据库或 API endpoint。

## 决策

Core 默认技术栈是 TypeScript / Node.js / pnpm。后续代码骨架必须从一个 Node.js LTS 版本、一个 pnpm workspace 和一套 TypeScript 配置开始；不得因为单个入口提前引入第二语言 runtime。CLI、MCP、SDK、API Server 和 App-facing API 都复用同一 Core 合同，不各自维护 task/run/result/failure 类型。

JSON Schema 是跨仓合同主载体。Zod 可以作为 TypeScript 代码内的输入构造、开发体验和局部解析工具；Ajv 可以作为 JSON Schema 运行时校验工具。Zod schema、Ajv compiled validator、生成类型或手写类型都不是第二 truth，必须能追溯到对应 JSON Schema、ADR 或 contract locator。

API Server 是一等入口。API、CLI、MCP、SDK 和 App 的提交请求先由 API Server 归一化、鉴权、脱敏并拒绝 private fields，再进入 Core Runtime。入口可以有不同 transport 和展示格式，但不能改变 Task Intent、Run lifecycle、Result Envelope、Failure 或 Evidence 语义。

Core Runtime 负责 admission、resource matching、unified authorization、run lifecycle 和执行控制。它只消费 Lode capability/package/schema/resource/post-check refs 与 Harbor runtime/profile/session/evidence facts，不直接拥有站点知识、浏览器现场、Profile、Viewer、provider driver 或 App UI state。

Run Record 是 Core durable truth。它保存 task/run/result/failure/admission/action/evidence 的 refs、summary、state 和 failure taxonomy；不保存 raw browser material、完整 DOM、HAR、截图、视频、Cookie、Token、CDP/VNC endpoint、Lode package body、fixtures、validator code、App UI state 或用户草稿。

本地持久化只服务 Run Record 和必要索引。具体存储实现、数据库、ORM、迁移工具和多后端抽象全部 deferred；首次实现应选择最小可验证持久化路径，并先证明 Run Record schema、查询面和 evidence refs 边界成立。

## Accepted Baseline

| 主题 | 接受结论 | 后续实现入口 |
| --- | --- | --- |
| TypeScript / Node.js / pnpm | Core 默认使用 TypeScript on Node.js，由 pnpm 管理 workspace、脚本和锁文件。 | 首个代码骨架 PR 才创建 package/package manager 文件，并同步 CI、README 和 docs。 |
| 单 runtime | 不因单个 CLI、MCP、SDK 或测试工具引入 Python/Rust/Go 等第二 runtime。 | 只有真实运行约束、性能或生态需求被 Work Item 记录后才评估。 |
| 依赖管理 | 新 runtime dependency 必须说明用途、替代方案、许可证、调用边界、移除条件和对应测试。 | 写入 PR body、ADR/contract 或 implementation plan；优先使用 Node/TypeScript 标准能力和已有依赖。 |
| Schema truth | JSON Schema 是跨仓合同主载体。 | `packages/schemas` 或等价目录只能在后续 schema Work Item 中创建。 |
| Zod | 只作为 TypeScript 实现层 helper，不 author 跨仓 truth。 | Zod 定义必须从 JSON Schema/ADR 派生或回链。 |
| Ajv | 只作为 JSON Schema runtime validation 工具。 | Ajv validator 不得成为独立字段、枚举或失败语义来源。 |
| API Server | 归一化入口请求、鉴权、脱敏、拒绝 private fields、生成 Task Intent Envelope。 | 后续 API skeleton 可引用 ADR 0005/0006/0008。 |
| Core Runtime | 做 admission、resource matching、unified authorization、run lifecycle、failure taxonomy 和执行控制。 | 不直接调用 Harbor private internals 或 Lode package body。 |
| Run Record | 保存 durable run truth、refs、summaries、terminal outcome 和 failure state。 | persistence/store 只在 schema 和 query contract 稳定后实现。 |
| Cross-entry conformance | 后续至少规划 read-only submit、invalid input、admission failure、result/query 四类 fixture。 | 本 PR 不创建 fixture 文件；新增入口代码时必须把 docs-only N/A 升级为真实 fixture/test suite。 |

## Rejected Baseline

| 事项 | 结论 | 理由 |
| --- | --- | --- |
| 现在创建代码骨架 | 拒绝 | 本批目标是 docs-only 基线，代码结构会提前固化未完成的 schema/API/runtime 决策。 |
| 现在创建 `package.json` 或安装依赖 | 拒绝 | 没有可运行代码；依赖会制造维护面和锁文件 churn。 |
| 完整 OpenAPI / JSON Schema | 拒绝 | 本 milestone 冻结边界和策略，不生成最终字段合同。 |
| Zod 作为跨仓 truth | 拒绝 | Zod 是实现工具，不能被 Harbor、Lode、App 当作唯一合同来源。 |
| CLI/MCP/SDK/App 直连 Core/Harbor/Lode 私有实现 | 拒绝 | 会形成多套执行路径和多套状态/失败语义。 |
| CDP、eval、debugger 或通用 browser tool 面作为正式任务入口 | 拒绝 | 这些工具适合探索和 authoring，不包含 capability version、admission、Run Record 和 result envelope。 |
| Core 复制 Harbor/Lode/App truth | 拒绝 | 会让浏览器身份、站点资产或 UI 状态在多个仓库漂移。 |
| 默认保存 raw evidence | 拒绝 | DOM、HAR、截图、视频、network body、prompt、agent history 和本地路径可能含敏感数据。 |

## Deferred

| 事项 | 激活条件 | 当前边界 |
| --- | --- | --- |
| Node.js 具体版本 pin | 首个 package/CI skeleton PR | 选择一个 Node.js LTS，写入 engines/CI/docs。 |
| HTTP framework | API Server skeleton PR | 不在 docs-only 基线中选择 Express/Fastify/Hono 等框架。 |
| JSON Schema 文件和生成类型 | Schema Work Item | 先从 ADR 0005/0006/0007/0008 派生最小 schema。 |
| OpenAPI | API contract Work Item | 只有 API route 和 schema 稳定后生成。 |
| Conformance fixture 文件和 runner | 任一入口实现 PR | 从本 ADR 的 fixture 规划落地真实 JSON fixtures 和验证命令。 |
| Local persistence implementation | Run Record schema/query Work Item | 不预设数据库、ORM、多后端或迁移工具。 |
| True-write runtime | 写侧 Work Item | 必须先满足 effective authorization、idempotency、post-check、unknown outcome 和 reconciliation。 |
| 公共合同拆仓 | 许可证/SDK 决策 | 继续跟踪 PD-0001。 |

## API Server / Core Runtime / Run Record 边界

| 模块 | 拥有 | 只消费 | 不拥有 |
| --- | --- | --- | --- |
| API Server | authentication boundary、entrypoint normalization、Task Intent Envelope、private field rejection、safe request failure。 | App/API/CLI/MCP/SDK 提交的公共 intent、policy、refs。 | App UI state、SDK 本地路径、MCP client private object、Harbor CDP/VNC endpoint、Lode package body。 |
| Core Runtime | admission、resource matching、unified authorization、run lifecycle、execution orchestration、failure taxonomy。 | Lode package/schema/resource/post-check refs，Harbor runtime facts/evidence refs，App authorization/intent refs。 | Browser process、Profile storage、provider driver、site adapter implementation、business strategy。 |
| Run Record | durable run truth、result/failure envelope refs、admission summary、runtime binding refs、evidence/ref states、terminal outcome。 | Harbor evidence/source/resource refs，Lode capability/package/version refs，App entrypoint/intent refs。 | raw browser material、full logs/history、package body、fixtures、validator code、App UI cache。 |
| Local persistence | Run Record and query indexes needed by Core. | Storage health and migration evidence when implementation exists. | Evidence store, Lode registry, Harbor profile/session store, App cache. |

## Cross-Repo No-Copy Contract

| 上游 truth | Owner | Core 允许记录 | Core 禁止记录 |
| --- | --- | --- | --- |
| Runtime Session / Profile / Execution Identity | Harbor | `runtime_session_ref`、`profile_ref`、`execution_identity_ref`、health/fact summary、availability/ref state。 | browser process、CDP/VNC/ws endpoint、Cookie、Token、profile data、provider private object、raw evidence。 |
| Snapshot / RefMap / Evidence | Harbor | `snapshot_ref`、`refmap_ref`、`source_trace_ref`、`evidence_ref`、redaction/retention/access state。 | full DOM、HAR、screenshot/video body、network body、local file path by default。 |
| Capability / Package / Schema / Post-check | Lode | `capability_ref`、`package_ref`、version/lock summary、schema refs、resource requirement refs、post-check refs。 | package body、site knowledge、fixtures、normalizer/validator code、registry store。 |
| App Work / Library / Browser UI | App | `entrypoint_ref`、caller category、user intent summary、authorization/recovery/cancel/reconcile intent refs。 | UI component state、draft editor content、local display cache、Settings secrets。 |

## Conformance Fixture Plan

| fixture | 目的 | 后续要求 |
| --- | --- | --- |
| read-only submit | 证明 API、CLI、MCP、SDK 和 App 把同一只读任务投影为同一 Task Intent Envelope。 | 新增入口代码时创建 fixture，并断言 normalized intent、risk=`read`、resource refs 和 evidence policy 一致。 |
| invalid input | 证明入口层失败不创建 Run Record。 | 覆盖缺字段、类型错误和 private fields；所有入口返回同类 failure code。 |
| admission failure | 证明可信 envelope 后的 capability/resource/runtime/risk/evidence 失败进入同一 Run Record 查询面。 | 覆盖 unknown capability、stale runtime facts、risk denied、evidence policy missing。 |
| result/query | 证明查询只读取 Core Run Record / Result Envelope truth。 | 覆盖 terminal result、failure envelope、evidence ref state 和 not_found/expired/redacted/access_denied。 |

Docs-only N/A 必须升级为真实 suite 的条件：新增 `package.json`、schemas、OpenAPI、API route、CLI/MCP/SDK/App入口代码、runtime executor、Run Record store、fixture 文件、generated types、Harbor/Lode/App 消费代码，或任何会改变 task/run/result/failure/evidence 语义的 PR。

## AGENTS 技术约束

后续 agent 必须从本 ADR 和 [contracts index](../contracts/README.md) 进入实现，不从 issue 讨论、研究草稿或 `docs/draft/` 推断字段。`AGENTS.md` 只保留可执行约束；长解释留在本 ADR。

## 研究吸收边界

| locator | 判断 | 吸收 / 裁剪 / 拒绝 |
| --- | --- | --- |
| `/Volumes/2T/dev/WebEnvoy/.github/ROADMAP.md` | 吸收 | 阶段二目标是最小统一协议；入口矩阵、真实写入、marketplace、hosted runtime 不进入本批实现。 |
| `ROADMAP.md` | 吸收 | Core 服务组织级阶段二，先冻结 task/run/result/evidence/action request 基线。 |
| `AGENTS.md` | 吸收 | API Server 一等入口、TypeScript/Node、JSON Schema、Loom 和许可证边界进入本 ADR/AGENTS 更新。 |
| `docs/adr/0002-run-task-capability-model.md` | 吸收 | 复用 Core 任务路径、capability admission、resource matching 和 no-copy 边界。 |
| `docs/adr/0003-result-envelope-and-run-record.md` | 吸收 | 复用 Result Envelope、Run Record、refs-only、failure taxonomy 和 raw evidence 禁线。 |
| `docs/adr/0004-admission-and-action-risk.md` | 吸收 | 复用三道 admission gate、risk class、validate/draft/preview/true-write deferred 边界。 |
| `docs/adr/0005-task-intent-and-run-lifecycle-v0.md` | 吸收 | 复用 Task Intent Envelope、Run lifecycle 和 Run Record 创建规则。 |
| `docs/adr/0006-common-task-entry-v0.md` | 吸收 | 复用 API/CLI/MCP/SDK/App 共用入口和四类 fixture 规划。 |
| `docs/adr/0007-reference-version-ownership-v0.md` | 吸收 | 复用 ref owner、version owner、missing/expired/redacted/access_denied 语义。 |
| `/Volumes/2T/dev/WebEnvoy/Harbor/docs/contracts/README.md` | 吸收 | Core 只消费 runtime/session/profile/evidence/page scene refs；不复制 Harbor truth。 |
| `/Volumes/2T/dev/WebEnvoy/Lode/docs/contracts/README.md` | 吸收 | Core 只消费 package/schema/resource/post-check refs；不复制 Lode package body、fixtures 或 validator。 |
| `/Volumes/2T/dev/WebEnvoy/App/docs/contracts/README.md` | 吸收 | Core 只消费 App intent/authorization/recovery refs；App 不生成 Run Record truth。 |
| `/Volumes/2T/dev/WebEnvoy/research/synthesis.md` | 吸收 | 采纳 runtime facts 与 task policy 拆分、Run Record/evidence 公共边界、capability/workflow schema 化方向。 |
| `/Volumes/2T/dev/WebEnvoy/research/absorability/themes/task-execution-and-admission.md` | 裁剪复用 | 采纳 public operation admission、resource matching、write-side fail-closed、action risk；拒绝整体 agent loop、完整 crawler/account pool 和旧 XHS gate。 |
| `/Volumes/2T/dev/WebEnvoy/research/absorability/themes/api-cli-mcp-and-agent-interface.md` | 裁剪复用 | 采纳多入口共享 envelope、reference-over-value、typed diagnostics；拒绝 CDP/eval/debugger/全量 DevTools 作为正式任务 API。 |
| `/Volumes/2T/dev/WebEnvoy/research/absorability/themes/evidence-and-observability.md` | 裁剪复用 | 采纳 Run Record/evidence refs/retention/redaction；拒绝默认保存 raw runtime logs、DOM、HAR、截图、视频、prompt、agent history。 |
| `/Volumes/2T/dev/WebEnvoy/research/absorability/themes/workflow-and-task-package.md` | 裁剪复用 | 采纳 capability/workflow package 需要 schema、fixtures、post-check；拒绝在 Core 本批实现 workflow DSL、runner 或 builder。 |
| `/Volumes/2T/dev/WebEnvoy/research/absorability/themes/result-normalization-and-reconciliation.md` | 裁剪复用 | 采纳 typed error、hint、large result by ref、normalizer 在能力层；拒绝 adapter 自定义 JSON、render columns 或 database tables 作为稳定 schema。 |

## 后果

后续代码骨架可以小而清楚：先围绕 TypeScript/Node/pnpm、JSON Schema-derived contracts、API Server normalization、Core Runtime admission 和 Run Record refs 做第一批实现。任何入口或依赖的新增都必须证明没有创建第二套 task/run/result/failure truth。

本 ADR 会让真实 runtime、fixture runner、OpenAPI、SDK generation 和 persistence 落地变慢一点，但能避免在代码骨架阶段把边界写错。

## 后续决策

- [PD-0001](pending-decisions.md#pd-0001)：公共合同模式定义是否拆到宽松许可证仓库。
- [PD-0003](pending-decisions.md#pd-0003)：任务请求、能力准入、资源需求和运行时 facts 的最终 JSON Schema。
- [PD-0005](pending-decisions.md#pd-0005)：CLI、MCP 和 SDK 生成所需的最小 API 面。
- [PD-0007](pending-decisions.md#pd-0007)：Result Envelope 和 Run Record 的最终 JSON Schema。
- [PD-0019](pending-decisions.md#pd-0019)：跨仓 Harbor / Lode / App 字段、状态和有效性规则。
