# 0010. Core–Harbor 运行事实与 capability 所有权迁移合同 v0

## 状态

Accepted for WebEnvoy/WebEnvoy#341 docs-only contract, 2026-08-03。

本 ADR 只冻结 owner、消费边界、失败归因和迁移控制面，不改变 runtime、字段或 API。最终跨仓 wire schema/API 仍由 [PD-0019](pending-decisions.md#pd-0019) 与后续规格 Work Item 收敛。

## 决策

Core、Harbor、Lode 和 App 继续独立进程、独立 owner API。Core 是任务和结果的唯一业务真相源；Harbor 是站点无关 runtime facts/ref 的真相源；Lode 是 capability/package/schema/normalizer 声明的真相源；App 只呈现事实并发送用户意图。

本合同中的“Core 拥有”表示 Core 负责解析、校验、决策、持久化引用和归因；不表示 Core 复制上游私有载荷。`v0` 的公共字段/API 名称不在本 Work Item 中改名或新增。

## Owner mapping

| 事实或引用 | 唯一 owner | Core 消费与持久化边界 | Harbor/Lode 不拥有的内容 | 状态 |
| --- | --- | --- | --- | --- |
| capability/package `ref`、版本、`lock_ref`/hash pin、生命周期和失效标记 | Lode 声明；Core 解析并锁定本次 run 使用的 ref | Core 在 admission 前解析 Lode package contract，记录 ref、版本、lock/source ref 和必要摘要；不复制 package body、schema、fixture 或 normalizer code | Harbor 不决定 Lode pin；Lode 不选择 Runtime Session | v0 frozen |
| resource requirements、required Harbor fact vocabulary、operation mode、failure mapping、post-check requirements | Lode 声明；Core admission 执行 | Core 做 one-of/resource matching、风险交叉校验、admission decision 和 failure attribution；只保存匹配摘要与 refs | Harbor 不决定 capability 是否可执行；Lode 不产出 live match 或任务结果 | v0 frozen |
| `harbor-local-identity-environment/v0` 与 `harbor-core-runtime-facts/v0`：`runtime_session_ref`、`identity_environment_ref`、`execution_identity_ref`、`profile_ref`、`provider_ref`、`provider_mode`、`lifecycle_state` | Harbor | Core 只消费公共 ref/status，绑定 accepted run 并保留历史引用；不保存 session/profile 内部状态 | Harbor 不拥有 run、task outcome 或 Lode package | v0 frozen |
| runtime availability、viewer/control/handoff facts、`fact_refs`（属于 `harbor-core-runtime-facts/v0`） | Harbor | Core 只消费 `availability`、`viewer_ref`、control owner/lock/handoff/takeover 状态和 session/viewer refs，用于 admission、pause、handoff 或 recovery decision | Harbor 不把 viewer/control 状态解释为业务成功 | v0 frozen |
| site/runtime resource facts (`harbor-site-resource-facts/v0`；Core resource projection 为 `harbor-core-resource-facts/v0`) | Harbor | Core 只按 Lode 声明的 fact key 做 resource matching；`site_id`/`task_kind` 仅是上下文选择器，不是业务 schema | Harbor 不声明 capability、归一化业务字段或成功条件 | v0 frozen |
| page scene refs (`harbor-page-scene-refs/v0`)：`snapshot_ref`、`refmap_ref`、`evidence_refs`、`source_trace_ref`、`captured_at` 与有界 page summary | Harbor | Core 记录 refs、redaction/availability 状态和安全摘要；结果只通过 refs 追溯现场 | Harbor 不输出 normalized result；Core 不内联 DOM/HAR/screenshot/video/network body | v0 frozen |
| normalized business output、public Result Envelope、Run Record、terminal outcome、`unknown_outcome` 和 reconciliation | Core；output schema/normalizer 由 Lode 声明 | Core 校验 Lode output，生成/持久化结果 envelope、failure、post-check 与 refs；Harbor 只提供 source/evidence/runtime refs | Harbor 不拥有业务结果；Lode 不拥有 run outcome | v0 frozen |
| Lode license/version identity | Lode（MIT assets）；Core 记录本次消费的 version/hash pin | Core 只保留可审计 ref、版本和 hash 摘要 | Harbor 不承载 Lode pin 或 package license truth | v0 frozen |

### Core 可消费的输入 facts/refs

实现可以继续使用现有 `HarborAdmissionInput` 形态及其等价只读投影：

- Harbor identity facts（`harbor-local-identity-environment/v0`）：身份环境、登录/恢复状态、provider/profile refs 和 `consumer_boundary`；
- Harbor runtime facts：session、provider/profile refs、lifecycle、availability、viewer/control 和 `fact_refs`；
- Harbor resource facts（`harbor-site-resource-facts/v0` 或 `harbor-core-resource-facts/v0`）：`resource_facts[]` 中已发布 fact key/state，以及 refs-only public boundary；
- Harbor scene/write-precheck refs（`harbor-page-scene-refs/v0`、`harbor-write-precheck-facts/v0`）：snapshot/refmap/source/evidence refs；write-precheck 只表示 validate-only/no-submit guard；
- Lode package contract：package/capability/version/lock/source refs、resource requirements、operation mode、output/post-check/failure declarations。

上述输入必须可追溯到对应 owner，且每次 accepted run 固定当时的 ref/version 快照。未知、过期、不匹配或违反 boundary 的输入 fail closed；不得用站点推测、provider claim 或旧结果补全。

### 双重 truth 禁线

- Core 不保存 credential、cookie、token、password、verification code、profile storage、local path、raw DOM、完整 HAR、screenshot/video body、network body、provider private endpoint/object 或 Harbor raw evidence；也不复制 Lode package body、fixture、validator/normalizer code。
- Harbor 不拥有 Lode pin、site policy、capability admission、normalized business output、task success、Run Record 或 reconciliation outcome。
- Lode 不保存 Runtime Session、Profile、真实账号状态、provider routing、live evidence 或 Core run outcome。
- `public_summary`、`lode_pin` 等旧 Harbor read-operation 输出在兼容窗口内只能作为 legacy adapter 事实；它们不是新路径的 owner truth。

## Failure mapping

失败归因由 Core 写入统一 Failure/Run Record；来源 owner 负责修复其事实，不能由另一仓库代写成功结论。

| 触发条件（现有词汇） | 来源 owner | Core 归因/阶段 | 状态与停止条件 |
| --- | --- | --- | --- |
| 请求或私有字段非法：`input_invalid`、`private_field_rejected:*`、`forbidden_field:*` | Core 输入边界 | `request_invalid` / `pre_admission` 或 `capability_contract` / `admission`；attribution=`input` | blocked；不创建 Run Record；修复输入后重试 |
| Lode ref/lock/package/lifecycle 不可用：`package_ref_required`、`package_contract_required`、`package_lock_mismatch`、`capability_version_incompatible`、`invalid_contract`、`capability_invalidated` | Lode 声明，Core admission | `capability_contract` / `admission` 或 `resource_matching`；attribution=`capability` | blocked/failed；Core 不猜测替代 package；修复或重新 pin 后重试 |
| Harbor identity/provider/runtime 不可用或不匹配：`identity_environment_*`、`browser_provider_unavailable`、`runtime_ref_missing`、`runtime_session_unavailable`、`runtime_ref_expired`、`runtime_session_unreachable`、`runtime_session_busy`、`identity_runtime_mismatch` | Harbor facts | `resource_admission` / `runtime_binding`；attribution=`runtime` | blocked；暂停新执行，连接/修复/交接 runtime；accepted run 不伪装成功 |
| Harbor resource fact 不满足：`resource_requirement_unmatched`、`resource_fact_missing:<fact_key>` | Harbor facts + Lode requirements；Core matching | `resource_admission` / `resource_matching`；attribution=`runtime` | blocked；停止 admission，刷新 facts 或修复 runtime/package |
| Snapshot/RefMap/source/evidence ref 缺失或失效：`snapshot_missing`、`evidence_missing`、`refmap_stale`、`source_unavailable`、`capture_denied`、`evidence_expired` | Harbor evidence/ref owner | `evidence_reference` / `evidence`；attribution=`evidence` | 结果存在时保留业务终态但标记证据不可用；需要证据才能判定时停止并要求重采集 |
| Lode output/normalizer/post-check 不一致：`site_changed`、`page_changed`、`field_missing`、`output_invalid`、`post_check_failed`、`mapping_incomplete` | Lode output contract；Core projection | `result_projection` / `projection`；attribution=`capability` 或 `site` | failed；不得发布部分/未归一化业务结果；修复 package 或选择已知版本 |
| 运行中控制丢失、人工接管或外部结果无法确认 | Harbor 提供事实；Core 拥有 outcome | `runtime_execution` / `execution` 或 `reconciliation`；attribution=`runtime`/`unknown` | `manual_recovery_required` 或 `unknown_outcome`；不得改写为 success，等待用户交接/对账 |
| owner、字段、敏感边界或兼容性冲突 | Core/Harbor/Lode 联合决策，不由单仓猜测 | `invalid_contract`（迁移控制面，不新增公共 code） | migration blocked；冻结新合同，保留旧/新适配，直到 owner 明确修复 |

`ReadOperationFailureClass` 中的 `operation_not_allowlisted`、`allowlist_pin_invalid`、`public_summary_missing` 等只在 legacy Harbor operation adapter 内归因；新 Core path 将其映射为对应的 capability/resource/result/evidence 类别，不把 Harbor adapter 的业务结果升级为 Harbor truth。

## Compatibility window、cutover 与 rollback

本窗口是有界迁移控制面，不是永久双写。窗口从本 ADR 接受起开始，至下列任一条件先发生时结束：

1. 所有 in-scope consumer 已声明并通过 `Core-owned Lode pin/admission/projection` 的 current-head read-only contract check，且旧路径仍可回退；
2. 发布下一版不兼容 contract/version；
3. 发现 owner、字段、failure attribution 或 sensitive boundary 冲突。此时停止 cutover，不延长窗口。

| 阶段 | 新路径 owner/行为 | 旧路径处理 | 进入/停止条件 |
| --- | --- | --- | --- |
| `compatibility`（当前） | Core 文档冻结 owner；实现继续按现有 API/字段运行 | Harbor 的 `LODE_*_PIN`、allowlisted read operation 和 `public_summary` 可继续服务既有 caller，仅作为 legacy adapter | 进入：本 ADR accepted。任何字段/API/sensitive conflict 立即 stop |
| `cutover-ready` | Core 已能独立消费 Lode pin + Harbor facts/refs，并拥有 admission、normalization、failure attribution | 保留旧路径和回退映射；不删除、不改写历史 Run Record | 需要所有 caller 的 owner/readback 证据、refs-only boundary 和 rollback target；任一缺口停止 |
| `cutover` | 新建 run 默认走 Core-owned path；Core 写 Result/Run truth | in-flight/history 继续按原绑定；compatibility window 内仅作为 bounded fallback | 仅在 `cutover-ready` 全部通过后进入；新 path 发现 mismatch 立即 rollback |
| `retired`（不在 #341） | 由后续 Work Item 明确旧路径移除及版本策略 | 只有所有 caller 完成迁移且无历史依赖后才可退役 | 需要独立 issue/spec/review；本 ADR 不授权删除旧字段/API |

### Cutover stop conditions

- Lode pin、Harbor facts/ref、Core normalized output 或 failure owner 出现双重 truth；
- Harbor 输出 credential/profile storage/raw DOM/HAR/screenshot/video/network body/provider-private endpoint；
- required fact/ref、post-check、evidence state 无法在当前 version/lock 下验证；
- 旧 caller、in-flight run 或历史查询无法在兼容窗口内保留原语义；
- 发现字段/API 变化需要另一个仓库同步实现。此时记录差异并回到跨仓规格，不在 #341 猜字段。

### Rollback contract

任何 stop condition 触发时，Core 将新 admissions 切回已存在的 legacy owner API/适配路径；保留新合同草案、差异和失败 refs，不删除旧路径，不改写已 accepted/terminal Run Record，也不把 Harbor `public_summary` 当成新业务结果 owner。Rollback 只改变后续 admission 路由，不能撤销已经发生的外部动作；真实 write outcome 仍按 Core 的 `unknown_outcome`/reconciliation 规则处理。

## 非目标与后续

- 不修改 Core、Harbor、Lode 或 App 的 runtime、schema、API、字段、lockfile、测试或 CI。
- 不创建新的 contracts/sdk/skills 仓，不迁移 `LODE_*_PIN` 或 `public_summary` 实现；这些由后续 implementation Work Item 消费本 ADR。
- Harbor/Lode/App 的 exact wire field、version/hash pin 传输形式和 hosted/live evidence 仍由 [PD-0019](pending-decisions.md#pd-0019) 及跨仓规格决定。
