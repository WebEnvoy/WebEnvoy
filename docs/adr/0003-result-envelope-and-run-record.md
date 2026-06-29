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
