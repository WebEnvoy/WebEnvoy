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

## 有效分析吸收明细

| draft | 仍有效分析 | 已吸收位置 | rejected / deferred |
| --- | --- | --- | --- |
| `architecture.md` | Core 是 API Server、Core Runtime、任务执行和公共合同仓；App 是人类入口；Lode 拥有站点知识和能力资产；Harbor 拥有浏览器身份、Runtime Session 和 Evidence；所有入口应复用 API Server/Core Runtime，不绕开 Core。 | [跨仓架构](../architecture/cross-repo-architecture.md) 固化四仓 truth source、依赖方向和禁止跨界；[ADR 0002](../adr/0002-run-task-capability-model.md) 固化 Core 任务路径、能力准入和资源匹配。 | `packages/` 模块目录只是未实现草图，deferred 到真实代码/包结构 Work Item；Core 直接管理 browser/Profile/Cookie、App Shell、Lode asset body 被 rejected。 |
| `capability-admission.md` | 稳定执行只接受已准入能力；能力生命周期不能把 `proposed`/`experimental` 当 stable；准入失败必须 fail closed；Lode 声明 capability/schema/resource/fixture/version，Harbor 只提供 runtime facts；provider/private/business fields 不进入 Core-facing admission surface。 | [ADR 0002](../adr/0002-run-task-capability-model.md) 吸收 capability/resource ownership；[ADR 0004](../adr/0004-admission-and-action-risk.md) 吸收 admission/resource/action risk gate；[contracts](../contracts/README.md) 提供实现引用入口。 | `PublicOperationAdmissionEntry` 字段名、失败码全集、lifecycle runtime delivery 字段 deferred 到后续 schema/API spec；provider selector、routing、marketplace、credential/session material、raw payload、business workflow decision 被 rejected。 |
| `core-runtime.md` | Core 运行主链路必须先 normalize/admit/resource-match/bind runtime，再 accepted/running/terminal；外部请求要投影成最小上下文；Run Record 是 durable truth；失败要结构化；写侧必须区分 intent/approval/idempotency/unknown outcome/reconciliation；Evidence 默认 refs/no-leakage；Core 不成为 browser agent loop、provider router 或业务策略系统。 | [ADR 0002](../adr/0002-run-task-capability-model.md) 吸收任务路径和资源匹配；[ADR 0003](../adr/0003-result-envelope-and-run-record.md) 吸收 Result/Run/ref/failure；[ADR 0004](../adr/0004-admission-and-action-risk.md) 吸收 admission/action risk/write-side；[ADR 0005](../adr/0005-task-intent-and-run-lifecycle-v0.md)、[ADR 0006](../adr/0006-common-task-entry-v0.md)、[ADR 0007](../adr/0007-reference-version-ownership-v0.md) 吸收入口、生命周期和引用版本。 | 具体 package/module layout、runner internals、state recognition implementation、exact schema/API/fixture/generated artifacts deferred；通用 browser agent loop、Harbor process manager、Lode package store、provider marketplace/ranking、account risk scoring、business strategy engine 被 rejected。 |
| `result-envelope.md` | Core 只做公共结果封装和校验，不拥有站点 normalized schema；raw payload、截图、network、runtime material 必须通过 refs；结果需区分 success/failure/empty/partial/unknown/manual recovery；collection/comment/dataset projection 都是 public carrier，不是平台 raw shape。 | [ADR 0003](../adr/0003-result-envelope-and-run-record.md) 吸收 Result Envelope、Run Record、failure envelope、dataset projection 边界；[ADR 0007](../adr/0007-reference-version-ownership-v0.md) 吸收 ref ownership、expiry/redaction/access failure。 | 具体 envelope 字段、collection item schema、dataset record schema deferred 到 final JSON Schema/API spec；Core 直接返回 raw payload/DOM/HAR/screenshot、硬编码站点业务映射、变成 ETL/data warehouse/content lifecycle 被 rejected。 |
| `roadmap.md` | 早期顺序判断仍有效：先仓库和边界，再最小能力闭环，再复用/调试，再生态同步。 | 根 [ROADMAP.md](../../ROADMAP.md) 已把粗粒度 P0-P3 吸收到阶段一到阶段十，并明确 Core 仓库级职责、milestone 创建检查和不进入 Core 的范围。 | 旧 P0-P3 作为独立路线图 removed；“提供最小 API Server/SDK/CLI/MCP 调用骨架”不是本 docs-only PR 范围，deferred 到实现 Work Item；App/Harbor/Lode 交付不在 Core draft 中维护。 |
| `run-record.md` | Run Record 是 durable truth，不是日志/UI cache；accepted 后状态单调；记录 request/capability/resource/runtime/result/failure/evidence/raw/source/resource/write/reconciliation refs；failure signal/run event/metric sample 分工；attempt 不污染最终公共结果；资源 trace 帮助归因。 | [ADR 0003](../adr/0003-result-envelope-and-run-record.md) 吸收 Run Record 最小事实、failure/run event/evidence boundary；[ADR 0005](../adr/0005-task-intent-and-run-lifecycle-v0.md) 吸收 lifecycle/create rules；[ADR 0007](../adr/0007-reference-version-ownership-v0.md) 吸收 refs/version/failure mapping。 | 最终字段名、metric persistence、step-level history granularity、dataset persistence deferred 到 pending decisions / schema specs；Run Record 变成日志堆、截图/DOM 目录、业务数据库、Harbor Evidence Store 或 Lode asset copy 被 rejected。 |
| `runtime-contract.md` | 任务请求、能力准入、资源需求、runtime facts、Run Record、Result Envelope、Write Operation Ref、Unknown Outcome、Reconciliation 是跨组件边界词；Core 不直接启动 browser、不保存 Cookie/Token/raw response、不让 Harbor 判断业务成功；待稳定内容应转成 schema/API/spec work。 | [contracts](../contracts/README.md) 索引实现者应引用的 ADR；[ADR 0002](../adr/0002-run-task-capability-model.md) 吸收 task/admission/resource ownership；[ADR 0003](../adr/0003-result-envelope-and-run-record.md) 吸收 run/result/ref/failure；[ADR 0004](../adr/0004-admission-and-action-risk.md) 吸收 write/unknown/reconciliation early boundary。 | Task Request / Admission / Resource Requirement / Runtime Facts / Evidence / Write Operation schema, public/internal API, Harbor acquire/release API, status codes deferred 到后续 specs；Core 直接管理 Harbor internals or treat Harbor facts as opaque risk score 被 rejected。 |
| `write-safety.md` | 真实写入必须有 execution intent；`dry_run`/`validate_only` 不触达外部系统；真实写入需要 approval 或策略允许、idempotency boundary、write_operation_ref、post-check、unknown outcome 和 reconciliation；public result 只暴露 refs，不 inline payload/credentials/provider route/local path。 | [ADR 0004](../adr/0004-admission-and-action-risk.md) 吸收 action risk、execution intent、write-side gate、unknown outcome、reconciliation；[ADR 0003](../adr/0003-result-envelope-and-run-record.md) 吸收 result/run failure refs；[ADR 0007](../adr/0007-reference-version-ownership-v0.md) 吸收 write/evidence/source/resource refs。 | 最终 write-side schema、approval evidence shape、idempotency trace format、status/cancel enum deferred to PD-0013 / later specs；无 intent 写入、未验证宣称成功、unknown outcome 转 success、Agent 临场绕过 approval/idempotency/reconciliation 被 rejected。 |
