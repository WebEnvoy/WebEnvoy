# Result Envelope 与公共投影

本文档描述 WebEnvoy Core 对站点能力执行结果的公共封装方向，不代表最终稳定契约。

WebEnvoy Core 不定义每个站点的 normalized schema。normalized schema 属于 Lode 能力资产；Harbor 提供执行现场、raw_payload_ref、evidence_ref 和 source_trace；Core 负责在运行时消费这些信息，生成上游系统可以稳定理解的 public result envelope。

## 目标

Result Envelope 要保证：

- 上游系统不需要理解平台 raw payload；
- API、SDK、CLI、MCP 和 WebEnvoy App 看到同一类结果结构；
- raw payload、截图、network 摘要和执行现场通过引用出现，而不是 inline 到公共结果；
- 成功、失败、空结果、部分结果、未知结果和需要人工恢复的状态可以被稳定区分；
- Run Record 可以持久保存结果、失败原因、资源引用和证据引用。

## 职责边界

```text
Lode
  定义 output schema、normalized schema、collection / comment / dataset schema 和 fixture

WebEnvoy Core
  校验能力输出，生成 public result envelope，记录 Run Record

Harbor
  提供 Runtime Session、raw_payload_ref、evidence_ref、source_trace 和执行现场证据
```

Core 的职责是校验和封装，不是把自己变成通用 ETL、爬虫数据清洗平台或业务数据仓库。

## 公共结果形态

不同能力可以有不同输出类型，但进入 Core 后都应收敛为公共 envelope。

常见类型包括：

- detail result；
- collection result；
- comment collection result；
- creator / account / profile result；
- media asset result；
- write result；
- dataset record projection。

公共 envelope 至少应包含：

```text
status
operation
capability_id
capability_version
result_kind
normalized / items / projection
raw_payload_ref
evidence_ref
source_trace
failure_classification
cursor / continuation
run_record_ref
```

具体字段应由 Lode 输出契约和 Core Runtime Contract 共同约束。

## 运行时校验

Core 在能力执行成功后应执行以下校验：

1. 确认能力版本和 Lode output schema 匹配；
2. 校验 normalized result 是 JSON-safe public payload；
3. 校验 raw payload 只以 `raw_payload_ref` 出现；
4. 校验 evidence 只以 `evidence_ref`、`snapshot_ref`、`network_summary_ref` 等引用出现；
5. 校验 source trace 不包含 provider route、本地路径、storage URL、账号池、代理池或凭据标记；
6. 校验 collection / comment 的 dedup_key、cursor、continuation 和层级关系；
7. 将校验后的结果写入 Run Record。

校验失败应返回结构化 failure envelope，而不是把不可信结果继续暴露给上游系统。

## 读侧集合与评论结果

集合类结果不应把平台 item shape 直接返回给 Core 调用方。每个 item 应进入公共 item envelope：

```text
dedup_key
source_ref
normalized
raw_payload_ref
evidence_ref
source_trace
```

评论结果在集合语义上增加可见性和层级关系。评论层级应围绕公共 `canonical_ref` 建立，而不是围绕平台私有 thread id 建立。

## Dataset Projection

Core 可以把稳定读侧结果投影为 dataset record，但 dataset record 仍然是公共 carrier，不是业务数据库行。

Dataset projection 应只保存：

```text
dataset_record_id
dataset_id
source_operation
adapter_key
target_ref
raw_payload_ref
normalized_payload
evidence_ref
source_trace
dedup_key
recorded_at
```

`normalized_payload` 必须是 JSON-safe public payload。`raw_payload_ref` 只能是引用或 null。

## 不应做的事

Core 不应：

- 直接返回完整 raw payload；
- 直接返回完整 DOM、完整请求响应或完整截图；
- 在 Core 内硬编码某个站点的业务字段映射；
- 把 Harbor 的 evidence store 当成业务数据源；
- 把 result envelope 扩张成通用数据清洗、数据仓库或内容库生命周期。

Result Envelope 的目标，是让网站能力执行结果可校验、可记录、可解释和可复用。
