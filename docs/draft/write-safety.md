# Write Safety

本文档描述 WebEnvoy Core 对真实写入任务的安全门禁方向，不代表最终稳定契约。

真实写入不是读侧能力的简单扩展。上传、发布、修改、删除、提交等动作可能触达外部系统。WebEnvoy Core 必须区分检查、验证、执行、状态对账和取消请求，不能把“点击完成”当成成功。

## 目标

Write Safety 要保证：

- 真实写入前有明确执行意图；
- 外部可见写入必须经过必要审批或策略允许；
- 相同写入请求具备幂等边界；
- 写入后必须验证或对账；
- 结果未知不能伪装成成功；
- 人工恢复和后续 reconciliation 有稳定入口；
- 请求和结果只暴露公共引用，不泄漏 raw payload、凭据、provider route 或本地路径。

## 执行意图

写侧任务建议使用明确 execution intent：

| Intent | 是否外部写入 | 说明 |
|---|---:|---|
| `dry_run` | 否 | 只检查请求、资源和能力边界 |
| `validate_only` | 否 | 执行前置验证，但不提交外部写入 |
| `execute_after_approval` | 是 | 审批或策略允许后执行真实写入 |
| `reconcile_status` | 否 | 围绕既有 write_operation_ref 查询状态 |
| `request_cancel` | 是 | 围绕既有 write_operation_ref 请求取消或撤回 |

执行意图应进入 Run Record 和 result envelope，避免事后无法判断本次运行是否可能触达外部系统。

## 写侧门禁输入

写侧门禁候选输入：

```text
operation
target_ref
payload_ref
execution_intent
safety_level
idempotency_key
approval_evidence_ref
resource_requirement_ref
runtime_session_ref
audit_context
created_at
```

`payload_ref` 应是公共引用，不应 inline 发布内容、文件路径、storage URL、token、Cookie 或 provider route。

## 幂等与审批

写入请求应有可选或必需的幂等边界：

```text
idempotency_key
idempotency_trace_ref
write_operation_ref
```

幂等轨迹应绑定 operation、target、payload、approval evidence 和 write operation。若相同 key 已经提交，应返回 already_submitted 或现有 write_operation_ref；若同一 key 对应不同请求，应返回 duplicate / conflict，而不是再次执行。

真实外部写入应携带 `approval_evidence_ref` 或满足用户策略。审批证据应绑定 operation、target、payload 和 idempotency key，并有有效期。

## 结果状态

写侧结果应明确区分：

| Outcome | 语义 |
|---|---|
| `not_submitted` | 未触达外部系统 |
| `validated` | 验证通过，但未提交 |
| `submitted` | 已提交，且获得 write_operation_ref |
| `already_submitted` | 幂等轨迹显示此前已提交 |
| `duplicate_rejected` | 重复或冲突请求被拒绝 |
| `unknown_outcome` | 可能已经触达外部系统，但结果无法确认 |
| `manual_recovery_required` | 需要人工处理或恢复 |
| `status_observed` | 已围绕 write_operation_ref 完成状态观察 |
| `status_unknown` | 状态观察无法确认结果 |
| `cancel_requested` | 已请求取消或撤回 |
| `cancel_unknown` | 取消请求结果无法确认 |
| `cancel_failed` | 取消请求失败 |

`unknown_outcome` 必须携带 evidence_ref、idempotency_trace_ref 和 write_operation_ref 或等价恢复引用。它不能被转换成 succeeded。

## 状态对账

写侧能力应把提交和后续对账分开。

```text
content_publish
  → execute_after_approval
  → write_operation_ref

content_publish_status
  → reconcile_status(write_operation_ref)

content_publish_cancel
  → request_cancel(write_operation_ref)
```

这样，发布、状态观察、取消请求和人工恢复可以围绕同一个 write_operation_ref 建立连续事实。

## 与 Lode 的关系

Lode 应为写侧能力声明：

- input schema；
- payload_ref 规则；
- output schema；
- required write intent；
- pre-check；
- post-check；
- verification rule；
- idempotency requirement；
- approval requirement；
- failure classification；
- fixture。

## 与 Harbor 的关系

Harbor 提供执行现场、Runtime Session、人工接管、截图、Snapshot、network 摘要和 evidence_ref。Harbor 不判断写入是否允许，也不把写入结果解释为业务状态。

## 不应做的事

Write Safety 不应允许：

- 没有执行意图的真实写入；
- 未验证结果时宣称成功；
- 把 unknown outcome 伪装成成功；
- 在公共结果中 inline 发布内容、raw payload、Cookie、Token 或本地路径；
- 由 Agent 临场决定是否绕过审批、幂等或对账。

Write Safety 的核心价值，是让真实写入可检查、可批准、可追踪、可恢复、可对账。
