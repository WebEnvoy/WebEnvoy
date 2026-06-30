# Core contracts

本目录是合同索引，不重写已接受 ADR 的正文，也不把 draft 候选字段升级成 spec。

## Stage 2 合同索引

| 合同 | 权威位置 | 接受范围 |
| --- | --- | --- |
| 运行、任务与能力模型 | [ADR 0002](../adr/0002-run-task-capability-model.md) | ADR 内标为 `accepted` 的 Core 公共任务路径、能力准入、资源匹配、Lode/Harbor/App 边界；最终 Schema/API 仍按 pending decisions 后续收敛。 |
| 结果封装与运行记录 | [ADR 0003](../adr/0003-result-envelope-and-run-record.md) | ADR 内标为 `accepted` 的 Result Envelope、Run Record、引用边界、失败分类；候选字段名不是最终 Schema。 |
| 准入与动作风险 | [ADR 0004](../adr/0004-admission-and-action-risk.md) | ADR 内标为 `accepted` 的 Admission、resource matching、action risk、写侧早期边界；最终写侧字段仍待规格化。 |
| 任务意图与运行生命周期 v0 | [ADR 0005](../adr/0005-task-intent-and-run-lifecycle-v0.md) | Task Intent Envelope、Run lifecycle、Run Record 创建规则。 |
| 共用任务入口 v0 | [ADR 0006](../adr/0006-common-task-entry-v0.md) | API、CLI、MCP、SDK 和 App 的共同入口投影。 |
| 引用和版本归属合同 v0 | [ADR 0007](../adr/0007-reference-version-ownership-v0.md) | Lode/Harbor/App/Core 引用、版本、失效和 failure mapping。 |

## 使用规则

- 实现、测试和跨仓消费优先引用本索引中的权威 ADR。
- 若合同需要最终 JSON Schema、OpenAPI、fixture 或生成类型，新建专门规格文件，并从本索引链接。
- ADR 0002-0004 仍是拟议 ADR；只有其中已经标注 `accepted` 的 Stage 1/Stage 2 facts 进入本索引。
- 不把 `docs/draft/` 当作实现依据。
