# WebEnvoy Core draft

`docs/draft/` 只保存短期草稿和迁移指针。这里的内容不能作为实现、测试、Schema、API、runtime 或跨仓消费依据。

## 生命周期规则

每个保留草稿必须写清：

- status: `promoted`、`pointer`、`pending`、`deferred` 或 `removed`。
- owner: 负责推进或清理的人或团队。
- linked issue: 对应 GitHub issue。
- exit condition: 何时迁入 `adr/`、`contracts/`、正式文档，或删除。

状态语义：

| 状态 | 语义 | 允许保留多久 |
| --- | --- | --- |
| `promoted` | 原草稿仍有目录或索引价值，已经改成正式规则或迁移清单。 | 只要它承担当前目录入口职责。 |
| `pointer` | 原长文没有独立 truth 价值；文件只保留到旧引用清理完成。 | 短期保留，后续可删除。 |
| `pending` | 仍需当前 milestone 决策或补充材料。 | 必须绑定 owner、linked issue 和退出条件。 |
| `deferred` | 当前 milestone 不处理，但后续可能重新激活。 | 必须写明重新激活条件。 |
| `removed` | 内容过期、重复或已有正式替代。 | 不保留文件。 |

## Draft 归宿盘点

| 文件 | 当前用途 | 判断理由 | 状态 | 目标位置 | linked issue | 处理动作 |
| --- | --- | --- | --- | --- | --- | --- |
| `docs/draft/README.md` | draft 生命周期入口和本次盘点清单。 | 原 README 只有草稿列表，仍有价值的是目录生命周期和归宿索引；正式目录语义另放 [docs/README.md](../README.md)。 | promoted | 本文件；正式目录语义见 [docs/README.md](../README.md)。 | #70, #71 | 改成生命周期规则和唯一盘点表。 |
| `docs/draft/architecture.md` | Core 架构草稿。 | 独立长文价值已结束：跨仓角色、依赖方向和禁止跨界已由 [跨仓架构](../architecture/cross-repo-architecture.md) 承接；Core 任务路径和边界已由 [ADR 0002](../adr/0002-run-task-capability-model.md) 承接；旧的 `packages/` 模块方向仍是未实现建议，不迁入 contracts。 | pointer | [docs/architecture/cross-repo-architecture.md](../architecture/cross-repo-architecture.md), [ADR 0002](../adr/0002-run-task-capability-model.md) | #71, #72, #73 | 缩成正式位置指针；后续旧引用清完可删除。 |
| `docs/draft/capability-admission.md` | 能力准入候选合同。 | 稳定准入原则、Lode/Harbor 分工、fail-closed 和禁止 provider/private 字段已被 ADR 0002/0004 的 accepted facts 覆盖；候选字段名如 `PublicOperationAdmissionEntry` 未被正式接受，不迁入 contracts。 | pointer | [ADR 0002](../adr/0002-run-task-capability-model.md), [ADR 0004](../adr/0004-admission-and-action-risk.md), [contracts](../contracts/README.md) | #71, #72, #73 | 缩成正式合同指针；不保留候选字段 spec。 |
| `docs/draft/core-runtime.md` | Core Runtime 候选合同合集。 | 它是多个主题的汇总稿：任务路径、准入、Run Record、Result Envelope、写侧、Evidence/no-leakage 已分别进入 ADR 0002-0007；未进入 ADR 的模块目录和运行细节仍属未来实现设计，不应作为 Stage 3 依据。 | pointer | [contracts](../contracts/README.md) and ADR 0002-0007 | #71, #72, #73 | 缩成合同索引指针；不迁移大 spec。 |
| `docs/draft/result-envelope.md` | Result Envelope 候选合同。 | 公共结果、raw/evidence refs、failure envelope 和 dataset projection 边界已由 [ADR 0003](../adr/0003-result-envelope-and-run-record.md) 的 accepted facts 覆盖；具体字段仍待后续 Schema 决策，不保留草稿字段表。 | pointer | [ADR 0003](../adr/0003-result-envelope-and-run-record.md), [contracts](../contracts/README.md) | #71, #72, #73 | 缩成正式合同指针。 |
| `docs/draft/roadmap.md` | 旧路线图草稿。 | 独立价值为零：它是过期 P0-P3 顺序，粒度粗于根 [ROADMAP.md](../../ROADMAP.md)，继续保留会和正式路线图投影冲突。 | removed | [ROADMAP.md](../../ROADMAP.md) | #71, #73 | 删除。 |
| `docs/draft/run-record.md` | Run Record 候选合同。 | durable truth、生命周期、refs-only、failure/run event/metric sample 边界已由 ADR 0003/0005/0007 承接；候选字段列表仍待 Schema 决策，不作为实现依据。 | pointer | [ADR 0003](../adr/0003-result-envelope-and-run-record.md), [ADR 0005](../adr/0005-task-intent-and-run-lifecycle-v0.md), [ADR 0007](../adr/0007-reference-version-ownership-v0.md) | #71, #72, #73 | 缩成正式合同指针。 |
| `docs/draft/runtime-contract.md` | Runtime Contract 总草稿。 | 独立长文价值已结束：概念、生命周期和边界已被 ADR 0002-0004 覆盖；“待稳定内容”对应 pending decisions 和后续规格，不应以草稿形式继续当合同。 | pointer | [contracts](../contracts/README.md), [ADR 0002](../adr/0002-run-task-capability-model.md), [ADR 0003](../adr/0003-result-envelope-and-run-record.md), [ADR 0004](../adr/0004-admission-and-action-risk.md) | #71, #72, #73 | 缩成正式合同指针。 |
| `docs/draft/write-safety.md` | 写侧安全候选合同。 | execution intent、unknown outcome、idempotency、approval、reconciliation 和 no-inline-sensitive-data 已被 [ADR 0004](../adr/0004-admission-and-action-risk.md) 的 accepted facts 覆盖；最终写侧 Schema 仍待 PD-0013，不迁入本轮 contracts。 | pointer | [ADR 0004](../adr/0004-admission-and-action-risk.md), [contracts](../contracts/README.md) | #71, #72, #73 | 缩成正式合同指针。 |

## 保留草稿

当前没有 `pending` 或 `deferred` 草稿。新增或恢复草稿时，必须在上表补 owner、linked issue 和退出条件。
