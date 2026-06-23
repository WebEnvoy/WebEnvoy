# Capability Admission

本文档描述 WebEnvoy Core 对网站能力进入稳定执行路径的准入方向，不代表最终稳定契约。

Capability Admission 的目标，是避免任意网页动作、临时脚本或探索草稿直接进入稳定任务执行路径。WebEnvoy 应先确认能力生命周期、输入输出、资源需求、证据和版本边界，再允许 API、SDK、CLI、MCP 或 App 触发真实执行。

## 核心原则

- 稳定执行只接受已准入能力；
- 公共 operation 先进入 admission matrix，再投影为 Core task request；
- proposed / experimental / deprecated 不应被误认为 stable；
- Provider 选择、fallback、priority、marketplace 和站点私有 raw object 不应进入 Core-facing admission surface；
- 准入失败应 fail closed，返回结构化失败原因，不进入 Harbor Runtime Session。

## 生命周期

能力生命周期建议分为四类：

| 生命周期 | 语义 | 是否进入稳定执行 |
|---|---|---|
| `proposed` | 候选能力、命名占位或探索方向 | 否 |
| `experimental` | 可在受控场景试用，但不作为默认稳定路径 | 默认否 |
| `stable` | 已具备稳定契约、测试样例、资源需求和失效处理 | 是 |
| `deprecated` | 保留历史语义，但不再进入新任务 | 否 |

`proposed` 不是弱稳定能力。`experimental` 也不应因为能运行就自动成为 stable。能力是否稳定，应由 Lode 资产版本、Schema、fixture、测试样例、资源需求和失效标记共同决定。

## Public Operation Admission Entry

WebEnvoy 的外部入口不应直接把任意 payload 交给能力执行。建议用公共准入条目描述每个可调用 operation：

```text
PublicOperationAdmissionEntry
  operation_id
  capability_family
  target_type
  input_carrier
  required_fields
  optional_fields
  execution_mode
  collection_mode
  lifecycle
  runtime_delivery
  contract_refs
  evidence_refs
```

这些字段回答：这个 operation 是什么能力族、接受什么目标和输入、是否可稳定执行、依赖哪些契约和证据。

## 稳定准入流程

稳定准入的运行时流程建议如下：

```text
外部调用
  → resolve operation_id
  → 查找 PublicOperationAdmissionEntry
  → 校验 lifecycle == stable
  → 校验 runtime_delivery == true
  → 校验 target_type / collection_mode / execution_mode
  → 校验 required_fields / optional_fields
  → 校验 Lode capability version 和 output contract
  → 投影为 Core Task Request
```

只要任一环节无法证明合法，应返回 pre-accepted failure，不创建真实执行会话。

## 与 Lode 的关系

Lode 负责声明能力生命周期和准入所需资产：

- operation id；
- capability family；
- input schema；
- output schema；
- resource requirement profiles；
- fixture；
- contract refs；
- evidence refs；
- version；
- invalidation marker。

Core 负责消费这些声明并在运行时执行准入判断。

## 与 Harbor 的关系

Harbor 不判断某个能力是否 stable。Harbor 只提供 Runtime Capability Facts，例如当前 Profile、Execution Identity、Runtime Session、CDP、Viewer、Snapshot、proxy、persistent profile 和 evidence policy 是否可用。

Core 使用 Lode 的资源需求和 Harbor 的客观事实判断当前任务能否运行。

## 禁止进入准入面的字段

Capability Admission 不应承载：

- provider selector；
- provider routing；
- fallback priority；
- marketplace；
- SLA；
- credential / session material；
- Cookie / Token；
- raw payload；
- platform private object；
- content library lifecycle；
- business workflow decision。

这些字段会让 Core 从稳定能力准入层退化成 provider router、业务系统或平台私有脚本集合。

## 失败语义

准入失败应保持结构化，至少区分：

- operation_unknown；
- operation_not_stable；
- lifecycle_not_runtime_deliverable；
- input_contract_invalid；
- target_type_invalid；
- capability_version_invalid；
- output_contract_missing；
- resource_requirement_missing；
- evidence_missing；
- capability_deprecated。

Capability Admission 的核心价值，是让 WebEnvoy 在执行前就能判断能力是否具备稳定运行条件，而不是把所有问题都推迟到浏览器执行阶段暴露。
