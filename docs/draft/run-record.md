# Run Record

本文档描述 WebEnvoy Core 中 Run Record 的初步方向，不代表最终稳定契约。

Run Record 是一次网站任务运行的 durable truth。它不是普通日志，也不是 UI 展示缓存，而是 WebEnvoy 判断任务状态、失败原因、证据引用、资源使用和后续恢复入口的事实载体。

## 目标

Run Record 要让用户和上游系统回答以下问题：

- 这次任务请求了什么能力和哪个版本；
- 输入、目标和资源需求是什么；
- 任务是否通过能力准入；
- 使用了哪个 Harbor Runtime Session、Profile 和 Execution Identity；
- 任务经过哪些状态；
- 发生过哪些 attempt、retry、timeout 或并发拒绝；
- 最终 result envelope 是什么；
- 失败原因和失败阶段是什么；
- evidence_ref、raw_payload_ref、source_trace 和 resource trace 在哪里；
- 是否存在 unknown outcome、manual recovery 或 reconciliation 入口。

## 生命周期

Run Record 的最小生命周期建议为：

```text
accepted → running → succeeded / failed / unknown_outcome / manual_recovery_required
```

关键约束：

- accepted 之前的失败可以返回 pre-accepted failure，不一定创建 Run Record；
- accepted 后应能查询到任务事实；
- running 表示真实执行已经开始或准备进入执行上下文；
- terminal 状态应单调，不应被随意覆盖；
- 终态写入失败应形成结构化 observability failure，不应伪装成业务成功。

## 最小字段

Run Record 候选字段：

```text
run_id
status
created_at
updated_at
entrypoint
request_snapshot
capability_ref
capability_version
lode_package_ref
resource_requirement
resource_match_result
runtime_session_ref
profile_ref
execution_identity_ref
attempts
result_envelope
failure_signal_refs
run_event_refs
metric_sample_refs
evidence_refs
raw_payload_refs
source_trace_refs
resource_trace_refs
write_operation_refs
reconciliation_refs
```

字段应以公共引用和脱敏事实为主，不应 inline Cookie、Token、完整 DOM、完整请求响应、完整截图、用户业务参数或未脱敏执行现场。

## Failure Signal / Run Event / Metric Sample

Run Record 不应只有一段错误文本。建议把运行时观测拆成三类：

| Carrier | 职责 | 不承担的职责 |
|---|---|---|
| `FailureSignal` | 失败事实的 canonical projection | 不新增第二套错误分类 |
| `RunEvent` | task-bound 结构化事件 | 不用日志级别表达失败分类 |
| `RunMetricSample` | 本地计数和执行指标事实 | 不绑定具体指标后端 |

`error_category` 和 `error_code` 应来自 result / failure envelope。`failure_phase` 表达失败发生阶段，例如 admission、resource_matching、runtime_binding、execution、timeout、verification、persistence 或 observability。

## Attempt 与执行控制

一次 Run 可以包含多个 attempt，但 attempt 不应污染最终公共结果。

建议记录：

- attempt_started；
- attempt_finished；
- retry_scheduled；
- timeout_triggered；
- admission_concurrency_rejected；
- retry_concurrency_rejected；
- task_succeeded；
- task_failed；
- observability_write_failed。

每个 attempt 可以持有局部 terminal envelope、duration、runtime result refs 和 evidence refs。最终 Run Record 再聚合为唯一终态。

## Resource Trace 绑定

Run Record 应能关联 Harbor 或 Core 记录的资源事实：

```text
resource_bundle_ref
resource_lease_ref
resource_trace_refs
profile_ref
execution_identity_ref
runtime_session_ref
```

这样任务失败后，可以判断问题来自能力失效、网站变化、账号状态、Profile 状态、代理不可用、Runtime Session 异常还是业务输入错误。

## Result Envelope 绑定

终态 Run Record 应保存 public result envelope，而不是保存 Harbor 的完整执行现场。

成功结果可以包含：

- normalized result；
- collection items；
- dataset record refs；
- write operation refs；
- evidence refs；
- raw payload refs；
- source trace。

失败结果应包含：

- error category；
- error code；
- failure phase；
- evidence refs；
- resource trace refs；
- recovery / reconciliation hint。

## 不应做的事

Run Record 不应成为：

- 普通日志文件；
- 截图和 DOM 堆积目录；
- 业务数据库；
- 用户私有任务参数仓库；
- Harbor Evidence Store 的复制品；
- Lode 能力资产的复制品。

Run Record 的价值，是把一次任务运行的关键事实收敛为可查询、可审计、可恢复、可归因的 durable truth。
