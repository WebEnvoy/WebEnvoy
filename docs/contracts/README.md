# Core contracts

本目录是合同索引，不重写已接受 ADR 的正文，也不把 draft 候选字段升级成 spec。

## Stage 2 合同索引

| 合同 | 权威位置 | 接受范围 |
| --- | --- | --- |
| 运行、任务与能力模型 | [ADR 0002](../adr/0002-run-task-capability-model.md) | ADR 内标为 `accepted` 的 Core 公共任务路径、能力准入、资源匹配、Lode/Harbor/App 边界；最终 Schema/API 仍按 pending decisions 后续收敛。 |
| 结果封装与运行记录 | [ADR 0003](../adr/0003-result-envelope-and-run-record.md) | ADR 内标为 `accepted` 的 Result Envelope、Run Record、引用边界、失败分类；候选字段名不是最终 Schema。 |
| 准入与旧动作风险基线 | [ADR 0004](../adr/0004-admission-and-action-risk.md) | Admission、resource matching、target binding、idempotency、unknown outcome 与对账边界继续有效；旧 action risk enum 和 approval-first 模型由 ADR 0009 supersede。 |
| 统一任务授权策略 | [ADR 0009](../adr/0009-unified-authorization-policy.md) | 动作类别、全局默认、任务覆盖、单次授权、入口一致性和跨仓职责；supersede approval-request-first 产品模型。 |
| 任务意图与运行生命周期 v0 | [ADR 0005](../adr/0005-task-intent-and-run-lifecycle-v0.md) | Task Intent Envelope、Run lifecycle、Run Record 创建规则。 |
| 共用任务入口 v0 | [ADR 0006](../adr/0006-common-task-entry-v0.md) | API、CLI、MCP、SDK 和 App 的共同入口投影。 |
| 引用和版本归属合同 v0 | [ADR 0007](../adr/0007-reference-version-ownership-v0.md) | Lode/Harbor/App/Core 引用、版本、失效和 failure mapping。 |
| Core 技术架构基线 | [ADR 0008](../adr/0008-core-technical-architecture-baseline.md) | TypeScript / Node.js / pnpm 默认、JSON Schema / Zod / Ajv 边界、API Server / Core Runtime / Run Record 代码边界、跨入口 fixture 规划和跨仓 no-copy 约束。 |

## 使用规则

- 实现、测试和跨仓消费优先引用本索引中的权威 ADR。
- 若合同需要最终 JSON Schema、OpenAPI、fixture 或生成类型，新建专门规格文件，并从本索引链接。
- ADR 0002-0004 仍是拟议 ADR；只有其中已经标注 `accepted` 的 Stage 1/Stage 2 facts 进入本索引。
- 后续 API Server、Core Runtime、Run Record、Schema、CLI、MCP、SDK 和 App-facing API 骨架必须先读 [ADR 0008](../adr/0008-core-technical-architecture-baseline.md)，再创建代码、schema、fixture、依赖或生成类型。
- 不把 `docs/draft/` 当作实现依据。

## 后续骨架入口

| 后续实现主题 | 必读合同 | 当前 deferred 内容 |
| --- | --- | --- |
| API Server / API routes | [ADR 0005](../adr/0005-task-intent-and-run-lifecycle-v0.md), [ADR 0006](../adr/0006-common-task-entry-v0.md), [ADR 0008](../adr/0008-core-technical-architecture-baseline.md) | HTTP framework、OpenAPI、auth middleware、route implementation。 |
| Core Runtime | [ADR 0002](../adr/0002-run-task-capability-model.md), [ADR 0004](../adr/0004-admission-and-action-risk.md), [ADR 0008](../adr/0008-core-technical-architecture-baseline.md), [ADR 0009](../adr/0009-unified-authorization-policy.md) | Runtime executor、queue、resource lock、true-write execution。 |
| Run Record / persistence | [ADR 0003](../adr/0003-result-envelope-and-run-record.md), [ADR 0005](../adr/0005-task-intent-and-run-lifecycle-v0.md), [ADR 0007](../adr/0007-reference-version-ownership-v0.md), [ADR 0008](../adr/0008-core-technical-architecture-baseline.md) | Database/storage choice、migration tooling、query implementation。 |
| Schema / generated types | [ADR 0007](../adr/0007-reference-version-ownership-v0.md), [ADR 0008](../adr/0008-core-technical-architecture-baseline.md) | JSON Schema files、Zod helpers、Ajv validators、type generation. |
| Cross-entry conformance | [ADR 0006](../adr/0006-common-task-entry-v0.md), [ADR 0008](../adr/0008-core-technical-architecture-baseline.md) | read-only submit、invalid input、admission failure、result/query fixture files and runner. |
| Cross-repo consumption | [ADR 0007](../adr/0007-reference-version-ownership-v0.md), [ADR 0008](../adr/0008-core-technical-architecture-baseline.md) | Harbor/Lode/App final field names, schemas, generated consumers. |

## 已吸收的实现判断

这些判断来自旧 `docs/draft/`，已经由上方 ADR/contract 索引承接。后续实现可以消费这些判断，但不能把这里当成最终字段 Schema。

| 主题 | 可消费判断 | 权威位置 |
| --- | --- | --- |
| 单一任务入口 | API、CLI、MCP、SDK 和 App 都应经 API Server/Core Runtime 进入同一任务路径，不各自直接调用 Harbor 或 Lode。 | [ADR 0002](../adr/0002-run-task-capability-model.md), [ADR 0006](../adr/0006-common-task-entry-v0.md) |
| 能力准入 | stable execution 只接受 Lode 声明了 lifecycle、input/output contract、resource requirements、fixtures/post-check、version/invalidation 和 evidence expectation 的能力；缺失时 fail closed。 | [ADR 0002](../adr/0002-run-task-capability-model.md), [ADR 0004](../adr/0004-admission-and-action-risk.md) |
| 资源匹配 | Lode 声明资源需求，Harbor 提供 runtime/profile/session facts，Core 做匹配和拒绝原因；Harbor 不输出业务适配结论。 | [ADR 0002](../adr/0002-run-task-capability-model.md), [跨仓架构](../architecture/cross-repo-architecture.md) |
| Result Envelope | Core 校验 Lode output 并生成 public envelope；raw payload、DOM、HAR、screenshot、network/runtime material 只能以 refs 进入公共结果。 | [ADR 0003](../adr/0003-result-envelope-and-run-record.md), [ADR 0007](../adr/0007-reference-version-ownership-v0.md) |
| Run Record | `accepted` 后的 run 是 durable truth；状态单调；记录 request/capability/resource/runtime/result/failure/evidence/raw/source/resource/write/reconciliation refs。 | [ADR 0003](../adr/0003-result-envelope-and-run-record.md), [ADR 0005](../adr/0005-task-intent-and-run-lifecycle-v0.md), [ADR 0007](../adr/0007-reference-version-ownership-v0.md) |
| 写侧安全 | 真实写入必须区分 action declaration、effective authorization、idempotency、write operation ref、post-check、unknown outcome、manual recovery 和 reconciliation；unknown outcome 不能转成 success。 | [ADR 0009](../adr/0009-unified-authorization-policy.md), [ADR 0004](../adr/0004-admission-and-action-risk.md), [ADR 0003](../adr/0003-result-envelope-and-run-record.md) |
| no-leakage | Core 不保存 Cookie、Token、完整 DOM、完整请求/响应、未脱敏页面现场、本地路径、provider private object 或业务私有 payload。 | [ADR 0003](../adr/0003-result-envelope-and-run-record.md), [ADR 0007](../adr/0007-reference-version-ownership-v0.md), [跨仓架构](../architecture/cross-repo-architecture.md) |
| 非目标 | Core 不成为通用 browser agent loop、Harbor process manager、Lode asset store、provider router/marketplace、account risk scoring system、business strategy engine、ETL/data warehouse。 | [ADR 0002](../adr/0002-run-task-capability-model.md), [ADR 0003](../adr/0003-result-envelope-and-run-record.md), [ADR 0004](../adr/0004-admission-and-action-risk.md) |
