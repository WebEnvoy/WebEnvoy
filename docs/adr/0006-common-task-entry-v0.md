# 0006. API、CLI、MCP、SDK 共用任务入口 v0

## 状态

Accepted for Stage 2 docs-only contract, 2026-06-30.

## 背景

阶段二已经用 [0005](0005-task-intent-and-run-lifecycle-v0.md) 接受 Task Intent Envelope v0、Run 生命周期 v0 和 Run Record 创建规则。Core #56 后续需要让 API、CLI、MCP、SDK 和 App 共享同一个任务提交语义，但本轮只冻结 docs-only 合同，不定义最终 JSON Schema、OpenAPI、SDK 类型、CLI 命令、MCP tool 注册或 runtime 实现。

本 ADR 覆盖 GitHub issues WebEnvoy/WebEnvoy#56、#57、#58、#59 和 #60。

## 决策

所有入口只投影同一个 Task Intent Envelope，不各自定义 task、run、result、failure 或 retry 语义。入口可以有不同的传输、展示和诊断格式，但进入 Core admission 前必须归一为 ADR 0005 的字段族、状态词表和 Run Record 创建规则。

v0 最小 read-only task intent 必须表达：

| 字段或状态 | owner | consumer | 有效性/过期规则 | 失败分类 | 非目标 |
|---|---|---|---|---|---|
| `entrypoint` | API Server 归一化；调用入口声明来源。 | Core admission、Run Record、API/CLI/MCP/SDK/App diagnostics。 | 只能取 `api`、`cli`、`mcp`、`sdk`、`app`；同一个任务语义不得因入口不同而改变。 | `caller_invalid`。 | 不记录 App 组件树、SDK 本地路径、MCP client 私有对象或 shell 环境。 |
| `correlation_id` | 调用方可提供，API Server 校验或生成。 | 调用方、Run Record、诊断和后续查询。 | 只用于追踪请求；不提供幂等、权限或身份保证。 | `request_identity_invalid`。 | 不替代 user id、runtime identity 或 idempotency key。 |
| `user_intent` | 调用方提供，API Server 脱敏。 | Core admission、Lode capability matching、Run Record 摘要。 | 必须是用户可解释的只读目标；不得包含凭据、Cookie、完整 DOM、完整 prompt 或低层 action script。 | `intent_invalid` / `private_field_rejected`。 | 不承载聊天全文、UI draft、DevTools command 或任意 JS。 |
| `capability_ref` / `capability_version` | 调用方引用，Core 消费 Lode 声明。 | Core admission、Result Envelope、Run Record、App attribution。 | 必须指向已知、稳定、可运行的 Lode capability/package version。 | `capability_unknown` / `capability_not_stable` / `capability_version_invalid`。 | 不复制 Lode package body、fixtures、site knowledge 或 adapter 源码。 |
| `input_summary` / public input refs | API Server 从公共输入生成。 | Core admission、Run Record、Result projection。 | 只保存 JSON-safe 摘要和公共引用；大 payload、文件、raw response 和隐私材料必须走引用。 | `input_contract_invalid` / `input_ref_unavailable`。 | 不内联文件路径、Token、账号材料、raw payload 或 provider private object。 |
| `scope` | 调用方声明，Core 校验。 | Core admission、App 展示、CLI/MCP/SDK diagnostics。 | 至少表达目标站点/对象/账号环境边界；不得宽于 capability 和 Harbor runtime facts。 | `scope_invalid` / `target_type_invalid`。 | 不成为 provider route、账号池选择、proxy 选择或业务策略引擎。 |
| `policy` / `constraints` | 调用方或 App 提供公共策略，Core 执行准入。 | Core admission、Run Record、cancel/retry/reconcile 决策。 | read-only v0 至少能表达 risk=`read`、执行有效期、取消边界和 evidence policy。 | `policy_denied` / `timeout_invalid` / `risk_not_allowed`。 | 不开放真实写入、审批 UI 或完整 ACL。 |
| `resource_requirement_refs` | Lode 声明，Core 引用；Harbor 提供 facts。 | Core resource matching、Run Record。 | facts stale、缺失或不满足时准入失败。 | `resource_requirement_missing` / `runtime_facts_stale` / `resource_unavailable`。 | 不保存 Profile、Execution Identity、Runtime Session 或 provider 私有对象本体。 |
| `evidence_policy_ref` | Lode / Core / App 合同输入。 | Core admission、Harbor evidence capture、Run Record。 | 对需要证据的 read task 必须存在；保留和脱敏策略不足时 fail closed。 | `evidence_policy_missing` / `evidence_unavailable`。 | 不把截图、视频、HAR、DOM 或 trace 内联进 intent。 |
| result/run query ref | Core 生成。 | API、CLI、MCP、SDK、App。 | 查询只读取同一个 Run Record 和 Result/Failure Envelope。 | `run_not_found` / `run_ref_invalid`。 | 入口不得维护第二套 run truth 或 result shape。 |

## 入口投影边界

| 入口 | 允许投影 | 禁止语义 | v0 操作面 |
|---|---|---|---|
| API | HTTP request/response、认证边界、归一化、脱敏、结构化 request failure。 | 不把 UI/runtime/private fields 透传给 Core；不定义独立任务状态。 | `submit`、`query`、`cancel`、`retry`。 |
| CLI | flags/stdin/env 到同一 envelope 的映射；人类可读输出和机器 JSON 输出。 | 不维护独立 runner、独立 exit failure taxonomy 或 XHS 历史命令语义。 | `submit`、`query`、`cancel`、`retry`。 |
| MCP | 最小 tools 映射到同一 envelope；返回同一 result/failure/run refs。 | 不暴露 CDP、eval、debugger、全量 DevTools 或低层 browser tools 作为正式任务入口。 | `submit`、`query`、`cancel`、`retry`。 |
| SDK | 类型化封装 API Server；保留 correlation 和 typed diagnostics。 | 不绕过 API Server 直连 Core、Harbor 或 Lode；不生成私有 task/run/result 类型。 | `submit`、`query`、`cancel`、`retry`。 |
| App | 用户意图收集、审批/恢复 UI、run viewer 和 shared fixture 消费。 | 不生成第二套 run truth；不把 UI draft 作为 Core intent。 | 用户入口至少消费同一个 read-only fixture。 |

`retry` 在 v0 中只表示用新的 Task Intent Envelope 发起新 run，并引用前一 run；不得重写旧 run 终态。`cancel` 只推进 Core 取消语义；对于后续写侧任务不承诺外部系统撤销。

## 最小契约 fixture 与兼容性检查

本 ADR 只定义 fixture 目的和形状，不新增实际 fixture 文件。后续实现应添加一个 read-only task submission fixture，并保持 API、CLI、MCP、SDK 和 App 的消费一致。

| fixture 或检查 | 目的 | 文件/字段形状 | 消费方 | 后续 conformance 预期 |
|---|---|---|---|---|
| read-only submit fixture | 证明一个只读 task intent 能从机器入口和用户入口进入同一 Core 语义。 | JSON object；包含 `schema_version`、`case_id`、`intent.entrypoint`、`intent.correlation_id`、`intent.user_intent`、`intent.capability_ref`、`intent.capability_version`、`intent.input_summary`、`intent.scope`、`intent.policy.risk=read`、`intent.resource_requirement_refs`、`intent.evidence_policy_ref`、`expected.normalized_intent`、`expected.run_lifecycle`。 | API、CLI、MCP、SDK、App、Core admission tests。 | 每个入口把本地输入投影为同一个 normalized intent；字段缺失或 private fields 产生同一 failure code。 |
| invalid input fixture | 固定入口层失败，不创建 Run Record。 | JSON object；包含缺失必填字段或 private field，`expected.failure=request_invalid/private_field_rejected`，`expected.run_record_created=false`。 | API、CLI、MCP、SDK、App submit UI。 | 所有入口返回同类结构化失败，不创建 durable Run Record。 |
| admission failure fixture | 固定可信 envelope 后的失败路径。 | JSON object；包含未知 capability、stale runtime facts、risk denied 或 evidence policy missing；`expected.run_record_created=true`，终态 `failed`，phase 为 admission/resource_matching/runtime_binding。 | Core、API、CLI、MCP、SDK、App run viewer。 | 已形成可信 Task Intent 的失败进入同一 Run Record 查询面。 |
| result/query fixture | 固定查询边界。 | JSON object；包含 `run_ref`、`expected.status`、`expected.result_or_failure_envelope`、`expected.evidence_refs`。 | API、CLI、MCP、SDK、App。 | 查询不重放任务，不读取入口私有状态，只返回 Core truth。 |

## 共享入口 conformance checklist

- 同一个 fixture 在 API、CLI、MCP、SDK 和 App 中映射到同一个 Task Intent Envelope 字段族。
- `entrypoint` 只标识来源，不改变 capability、scope、policy、Run lifecycle 或 failure taxonomy。
- request-invalid 和 private-field failure 不创建 Run Record。
- 可信 envelope 的 admission/resource/risk/evidence failure 创建 Run Record 并按 ADR 0005 进入 `failed`。
- `query` 只读取 Core Run Record / Result Envelope，不访问入口本地缓存作为 truth。
- `cancel` 和 `retry` 使用 Core run refs；retry 创建新 run，不改写旧 run 终态。
- evidence/raw/runtime material 只通过 refs 出现，不内联 DOM、HAR、截图、Cookie、Token、本地路径或 provider private object。
- conformance 不要求真实 browser runtime、真实 Lode package、完整 schema、OpenAPI、SDK 发布或 MCP server 实现。

## 研究吸收与复用判断

| locator | 判断 | 理由 | 落点 |
|---|---|---|---|
| `WebEnvoy/ROADMAP.md` | 吸收 | 阶段二明确要求最小统一协议和 API/CLI/MCP/SDK 共用任务入口。 | 本 ADR 的共享入口、fixture 和 checklist。 |
| `docs/adr/0005-task-intent-and-run-lifecycle-v0.md` | 吸收 | 已接受 Task Intent Envelope 和 Run lifecycle，本 ADR 只做入口投影。 | 字段族、状态、Run Record 创建规则。 |
| `research/synthesis.md` | 裁剪复用 | 吸收 runtime facts 与 task policy 分离、Run Record/evidence 公共边界；裁剪 provider/platform/runtime 大面。 | refs-only、入口不得绕过 Core。 |
| `research/absorability/README.md` | 只参考 | 该文件定义研究分层和机制/源码复用分离，不提供入口字段。 | 研究证据写法。 |
| `research/absorability/themes/api-cli-mcp-and-agent-interface.md` | 裁剪复用 | 吸收共享 CLI/HTTP/MCP schema、typed diagnostics、reference-over-value 和薄 tool contract；拒绝 CDP/Profile API、全量 DevTools、eval/debugger 作为正式任务入口。 | 入口投影边界、MCP 禁止语义、conformance checklist。 |
| `research/absorability/themes/task-execution-and-admission.md` | 裁剪复用 | 吸收 public operation admission、resource match、fail-closed、domain/action policy 和 structured failure；裁剪通用 agent loop、完整 workflow status 和写侧复杂门禁。 | read-only submit 语义、failure fixtures。 |
| `research/absorability/themes/workflow-and-task-package.md` | 裁剪复用 | 吸收 capability package 需要 input/output schema、fixture、verification/post-check 的机制；拒绝把录制流、agent-editable helper、benchmark task 或全量 workflow engine 当 Core task contract。 | fixture 目的、Lode capability refs、非目标。 |
| `research/absorability/themes/result-normalization-and-reconciliation.md` | 只参考 | 支撑 result envelope、typed error、hint、heavy result refs；本轮不定义最终 result schema。 | result/query fixture 边界。 |

## 后果

入口实现可以很小：每个入口只需要把本地输入映射到同一个 envelope，并调用同一 API Server/Core 路径。复杂的入口生成、OpenAPI、SDK 发布、MCP server、CLI UX、App UI 和 runtime execution 都可以后续分别实现。

共享 fixture 会成为 App #36/#57 后续消费的核对点，但本 ADR 不创建实际 fixture 文件；新增 fixture 或 conformance runner 时必须重新走代码/fixture validation。

## 非目标

- 不新增 API、CLI、MCP、SDK、App 或 runtime 代码。
- 不新增 schema、OpenAPI、generated types、package scaffold、fixture 文件或 conformance runner。
- 不开放真实写入、完整审批、provider routing、账号池、marketplace、workflow engine 或 visual builder。
- 不把 CDP、execute JavaScript、debugger、DevTools、Profile API 或通用 browser loop 暴露为正式任务入口。

## 后续决策

- [PD-0005](pending-decisions.md#pd-0005)：CLI、MCP 和 SDK 生成所需的第一版最小 API 面。
- [PD-0007](pending-decisions.md#pd-0007)：结果封装和运行记录的最终 JSON Schema。
- [PD-0019](pending-decisions.md#pd-0019)：跨仓 Harbor / Lode / App 字段、状态和有效性规则。
