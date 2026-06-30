# 0003. 结果封装与运行记录

## 状态

拟议。

## 背景

WebEnvoy Core 需要一个对智能体和程序有用、但不暴露原始浏览器现场的结果合同。它也需要一个持久记录，用来回答运行了什么、为什么允许运行、用了哪些资源、发生了什么、失败在哪里，以及如何恢复或对账。

当前草稿同时使用 `Task Record` 和 `Run Record`。本 ADR 选择一个规范名称。

## 决策

使用“运行记录”作为一次已接受 Core 运行的规范持久事实。`Task Record` 视为历史别名，不应发展成第二个公共概念。

Core 拥有两个相互关联但职责不同的合同：

- 结果封装：返回给 API、SDK、CLI、MCP 和 App 调用方的公共响应。
- 运行记录：任务被接受后可查询的持久运行事实。

Lode 拥有能力输出模式和归一化模式。Harbor 拥有原始载荷存储、运行时证据采集和运行时/会话证据引用。Core 根据 Lode 合同校验能力输出，投影公共结果封装，并写入运行记录。

结果封装必须优先使用引用，不内联运行时材料。公共结果可以包含归一化数据、条目封装、游标或续传信息、失败分类、恢复提示、`run_record_ref`、`raw_payload_ref`、`evidence_ref`、`source_trace_ref`、`resource_trace_ref` 和 `write_operation_ref`。公共结果不得内联原始载荷、完整 DOM、完整请求或响应体、截图、视频、HAR 文件、本地路径、凭据、Cookie、Token 或提供方私有对象。

最小运行记录生命周期是：

```text
accepted -> running -> succeeded / failed / unknown_outcome / manual_recovery_required
```

`accepted` 之前的失败可以返回结构化接受前失败，而不创建运行记录。`accepted` 之后，状态推进必须单调，终态不得被后续观察随意覆盖。

运行记录应记录请求快照、调用入口、能力引用、Lode package 引用、资源需求摘要、资源匹配结果、运行时绑定引用、尝试记录、终态结果封装、失败信号、运行事件、指标样本、证据引用、原始载荷引用、来源追踪引用、资源追踪引用、写操作引用和对账引用。

失败分类属于结果封装和运行记录。它至少应包含分类、代码、阶段、证据引用，以及恢复或用户动作提示。自由文本异常只是辅助细节，不是公共合同。

数据集投影是可选公共载体。Core 可以记录数据集引用或归一化公共载荷，但 Core 不变成业务数据仓库或平台专用 ETL 层。

## 第一阶段 Run Record 最小事实范围

本表覆盖 Core #15 的第一阶段结论。它定义 Run Record 需要承载的最小事实类型和引用边界，不冻结最终字段名。

| 字段/事实 | 生产者 | 消费者 | 保留/脱敏规则 | 依据 | 状态 |
|---|---|---|---|---|---|
| run identity / status / timestamps | Core。 | API、CLI、MCP、SDK、App、后续对账。 | 持久保存；只记录公共 id、生命周期状态和时间，不记录运行时内部对象。 | 本 ADR、`docs/draft/run-record.md`、Core #15。 | accepted |
| entrypoint / request snapshot / input summary | Core，从 API Server 归一化请求生成。 | 调用方、App run viewer、审计和失败归因。 | 保存脱敏摘要和必要公共引用；不内联用户业务内容、文件路径、Cookie、Token 或 provider route。 | 本 ADR、`docs/draft/runtime-contract.md`、Core #15。 | accepted |
| capability ref / version / Lode package ref | Core 从 Lode 声明消费后记录引用。 | Core admission、结果校验、App Library 归因、能力修复。 | 只保存稳定引用、版本和必要摘要；不复制 package body、authoring draft、fixtures 或站点知识全文。 | 本 ADR、[0002](0002-run-task-capability-model.md)、Core #15。 | accepted |
| admission decision / resource match / action risk | Core；输入来自 Lode resource requirements、Harbor runtime facts 和调用方策略。 | 调用方、App、后续审计、恢复和对账。 | 保存门禁结果、失败分类和引用；不保存 Harbor 内部事实全集或 App UI 状态。 | [0002](0002-run-task-capability-model.md)、[0004](0004-admission-and-action-risk.md)、Core #15。 | accepted |
| Harbor runtime binding refs | Harbor 生产 Profile / Identity / Runtime Session / Snapshot / Evidence refs，Core 记录引用。 | Core execution、Run Record 查询、App viewer / evidence 展示。 | 只保存 `runtime_session_ref`、`profile_ref`、`execution_identity_ref` 等公共引用和必要摘要；不保存 browser process、CDP URL secret、Cookie、Token、完整 storage 或 provider 私有对象。 | 本 ADR、`docs/architecture/cross-repo-architecture.md`、Core #15/#17。 | accepted（Core 记录边界）；跨仓字段见 [PD-0019](pending-decisions.md#pd-0019) |
| attempts / run events / failure signals | Core；运行时证据引用可来自 Harbor。 | App run viewer、审计、失败归因、恢复流程。 | 保存 task-bound 结构化事件、attempt 摘要和 failure refs；不把普通日志、完整 agent history 或 live activity registry 当作 Run Record 本体。 | 本 ADR、`docs/draft/run-record.md`、research `evidence-and-observability`。 | accepted |
| result envelope | Core。 | API、CLI、MCP、SDK、App、对账流程。 | 保存公共结果封装；成功结果只包含 JSON-safe public payload 和 refs，失败结果包含分类、阶段、code、hint 和 refs。 | 本 ADR、`docs/draft/result-envelope.md`、Core #15。 | accepted |
| evidence / raw payload / source trace / resource trace refs | Harbor 和能力执行侧生产引用，Core 记录引用和摘要。 | App evidence view、能力修复、审计、对账。 | 默认只保存引用和脱敏摘要；不内联完整 DOM、HAR、截图、视频、trace、network body、local path、credentials 或未脱敏页面现场。 | 本 ADR、research `evidence-and-observability` / `result-normalization-and-reconciliation`、Core #15。 | accepted；最小证据分类见 [PD-0008](pending-decisions.md#pd-0008) |
| write operation / reconciliation refs | Core 围绕写侧准入和终态记录；外部运行事实和证据引用来自 Harbor。 | App、调用方、后续状态对账和取消请求。 | 保存 `write_operation_ref` 或等价恢复引用；`unknown_outcome` 不得改写为成功；不保存外部系统私有载荷。 | [0004](0004-admission-and-action-risk.md)、`docs/draft/write-safety.md`、Core #15。 | accepted；最终 Schema 见 [PD-0013](pending-decisions.md#pd-0013) |
| metric sample refs | Core 或观测层生产。 | 运维、调试、后续容量/成本分析。 | 本轮不决定成本、令牌和延迟是否进入持久 Run Record；若进入，必须用摘要或引用。 | 本 ADR、Core #15。 | needs-product-decision，见 [PD-0010](pending-decisions.md#pd-0010) |
| step-level history granularity | Core。 | App run viewer、调试、恢复。 | 本轮不决定默认记录多少步骤；不得默认保存完整 prompt、LLM response、截图序列或原始浏览器轨迹。 | 本 ADR、research `evidence-and-observability`。 | needs-product-decision，见 [PD-0011](pending-decisions.md#pd-0011) |
| dataset projection payload | Core 可选记录公共投影或引用。 | 下游消费者、导出、对账。 | Core 不成为业务数据库；归一化公共载荷是否持久保存留待规格决定。 | 本 ADR、`docs/draft/result-envelope.md`。 | needs-product-decision，见 [PD-0012](pending-decisions.md#pd-0012) |
| raw runtime material as Run Record body | 不生产。 | 不适用。 | 完整 DOM、HAR、截图、视频、request/response body、Cookie、Token、local path 和 provider private object 不进入 Run Record body。 | 本 ADR、Core #15。 | rejected |

## 只读任务结果/失败/证据边界

本节覆盖 Core #21 的第一阶段输出边界。字段名只表达字段族，不冻结最终 Schema。

| 步骤/场景 | 本仓责任 | 输入 | 输出 | 失败/证据 | 状态 |
|---|---|---|---|---|---|
| 接受前失败 | Core 返回结构化失败，不创建 Run Record。 | 归一化请求、capability/runtime refs、策略摘要。 | failure category、code、stage、hint、可安全展示的 refs。 | 适用于 capability unknown、runtime facts missing、证据策略缺失、目标不清或风险不允许。 | accepted |
| 只读成功结果 | Core 返回公共 result envelope，并把运行事实写入 Run Record。 | Lode 输出合同、公共 payload 或 projection ref、Harbor evidence/raw refs。 | public payload/ref、run_record_ref、evidence_refs、source/resource trace refs。 | 不内联完整 DOM、截图、HAR、请求响应、本地路径、Cookie、Token 或 provider 私有对象。 | accepted |
| 只读终态失败 | Core 把失败归因到阶段和可恢复提示，保留引用。 | 运行事件、能力输出校验结果、Harbor evidence refs。 | terminal status `failed` 或 `manual_recovery_required`、failure reason、evidence refs。 | 页面变化、输出不合约、runtime lost、evidence unavailable 和 user action required 分开表达。 | accepted |
| 只读 unknown outcome | 默认不作为只读成功/失败的常规终态；只在外部状态可能已变化的写侧使用。 | 不适用。 | 不适用。 | 只读任务若无法确认抽取结果，应返回结构化失败或 manual recovery，不伪装成 unknown write outcome。 | rejected |
| 证据引用 | Core 只保存 evidence/raw/source/resource refs 和摘要；证据生产、保留和脱敏策略由 Harbor/Lode/App 后续对齐。 | Harbor refs、Lode evidence expectation。 | evidence ref 字段族、脱敏摘要、consumer boundary。 | 最小分类、保留和脱敏策略仍待 [PD-0008](pending-decisions.md#pd-0008)。 | accepted |

## 后果

调用方可以跨 API、SDK、CLI、MCP 和 App 消费同一种结果封装。

操作者可以查看运行记录，而不需要重放任务或读取临时运行时内存。

敏感浏览器产物保留在证据引用和策略之后，降低意外泄露风险。

实现必须在返回成功前完成校验和投影。能力执行正确但输出违反合同，也应在投影阶段失败。

## 备选方案

- 直接返回适配器专用 JSON：拒绝，因为它缺少稳定版本、证据边界和跨入口一致性。
- 把日志、Profile 状态或 live activity 当作运行记录：拒绝，因为它们不包含能力版本、准入、资源匹配和终态结果。
- 整体复制浏览器智能体历史：拒绝，因为智能体轨迹是有用证据，但不是 Core 公共合同。
- 为方便而内联原始载荷或截图：拒绝，因为证据可能包含凭据、业务数据、本地路径和提供方内部信息。
- 让 Core 变成数据集仓库：拒绝，因为归一化模式和业务含义属于 Lode 和下游消费者。

## 研究证据

- [docs/draft/result-envelope.md](../draft/result-envelope.md) 定义了公共投影、归一化结果，以及 raw/evidence 只通过引用出现的边界。
- [docs/draft/run-record.md](../draft/run-record.md) 定义了持久运行记录生命周期和最小字段。
- [docs/draft/runtime-contract.md](../draft/runtime-contract.md) 连接了结果封装、运行记录、证据、未知结果和对账。
- [研究综合](https://github.com/WebEnvoy/research/blob/main/synthesis.md) 把结果封装、未知结果、证据引用和运行记录记录为跨主题公共边界。
- [结果归一化与对账主题](https://github.com/WebEnvoy/research/blob/main/absorability/themes/result-normalization-and-reconciliation.md) 支撑低噪音结构化结果、类型化错误和大结果引用。
- [证据与可观测性主题](https://github.com/WebEnvoy/research/blob/main/absorability/themes/evidence-and-observability.md) 支撑运行记录基线、证据引用，以及运行时状态和任务事实的区别。

## 未决问题

- [PD-0007](pending-decisions.md#pd-0007)：结果封装和运行记录的最终 JSON Schema。
- [PD-0008](pending-decisions.md#pd-0008)：最小证据分类、保留策略和脱敏策略。
- [PD-0009](pending-decisions.md#pd-0009)：CLI 退出码与失败分类的映射。
- [PD-0010](pending-decisions.md#pd-0010)：成本、令牌和延迟指标是否进入持久运行记录，还是进入单独指标流。
- [PD-0011](pending-decisions.md#pd-0011)：步骤级历史默认进入运行记录多少，多少只进入证据产物。
- [PD-0012](pending-decisions.md#pd-0012)：数据集投影在 Core 中保存归一化载荷，还是只保存投影引用。
