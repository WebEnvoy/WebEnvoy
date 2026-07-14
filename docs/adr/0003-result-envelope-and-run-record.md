# 0003. 结果封装与运行记录

## 状态

拟议。

> 2026-07-14 correction: [ADR 0009](0009-unified-authorization-policy.md)
> supersedes this draft's `action_risk`, `approval_required` and `request_approval`
> vocabulary. Result/Run Record, failure, unknown outcome and reference boundaries remain;
> task authorization uses Authorization Decision summaries, while non-task environment
> decisions are referenced by Harbor operation records.

## 背景

WebEnvoy Core 需要一个对智能体和程序有用、但不暴露原始浏览器现场的结果合同。它也需要一个持久记录，用来回答运行了什么、为什么允许运行、用了哪些资源、发生了什么、失败在哪里，以及如何恢复或对账。

当前草稿同时使用 `Task Record` 和 `Run Record`。本 ADR 选择一个规范名称。

## 决策

使用“运行记录”作为一次已接受 Core 运行的规范持久事实。`Task Record` 视为历史别名，不应发展成第二个公共概念。

Core 拥有两个相互关联但职责不同的合同：

- 结果封装：返回给 API、SDK、CLI、MCP 和 App 调用方的公共响应。
- 运行记录：任务被接受后可查询的持久运行事实。

Lode 拥有能力输出模式和归一化模式。Harbor 拥有原始载荷存储、运行时证据采集和运行时/会话证据引用。Core 根据 Lode 合同校验能力输出，投影公共结果封装，并写入运行记录。

结果封装必须优先使用引用，不内联运行时材料。公共结果可以包含归一化数据、条目封装、游标或续传信息、失败分类、恢复提示、`run_record_ref`、`raw_payload_ref`、`evidence_ref`、`source_trace_ref`、`resource_trace_ref` 和 `write_operation_ref`。公共结果不得内联原始载荷、完整 DOM、完整请求或响应体、截图、视频、HAR 文件、本地路径、凭据、Cookie、Token 或提供方私有对象。

最小运行记录生命周期是：

```text
accepted -> running -> succeeded / failed / unknown_outcome / manual_recovery_required
```

`accepted` 之前的失败可以返回结构化接受前失败，而不创建运行记录。`accepted` 之后，状态推进必须单调，终态不得被后续观察随意覆盖。

运行记录应记录请求快照、调用入口、能力引用、Lode package 引用、资源需求摘要、资源匹配结果、运行时绑定引用、尝试记录、终态结果封装、失败信号、运行事件、指标样本、证据引用、原始载荷引用、来源追踪引用、资源追踪引用、写操作引用和对账引用。

失败分类属于结果封装和运行记录。它至少应包含分类、代码、阶段、证据引用，以及恢复或用户动作提示。自由文本异常只是辅助细节，不是公共合同。

数据集投影是可选公共载体。Core 可以记录数据集引用或归一化公共载荷，但 Core 不变成业务数据仓库或平台专用 ETL 层。

## 第一阶段 Run Record 最小事实范围

本表覆盖 Core #15 的第一阶段结论。它定义 Run Record 需要承载的最小事实类型和引用边界，不冻结最终字段名。

| 字段/事实 | 生产者 | 消费者 | 保留/脱敏规则 | 依据 | 状态 |
|---|---|---|---|---|---|
| run identity / status / timestamps | Core。 | API、CLI、MCP、SDK、App、后续对账。 | 持久保存；只记录公共 id、生命周期状态和时间，不记录运行时内部对象。 | 本 ADR、`docs/draft/run-record.md`、Core #15。 | accepted |
| entrypoint / request snapshot / input summary | Core，从 API Server 归一化请求生成。 | 调用方、App run viewer、审计和失败归因。 | 保存脱敏摘要和必要公共引用；不内联用户业务内容、文件路径、Cookie、Token 或 provider route。 | 本 ADR、`docs/draft/runtime-contract.md`、Core #15。 | accepted |
| capability ref / version / Lode package ref | Core 从 Lode 声明消费后记录引用。 | Core admission、结果校验、App Library 归因、能力修复。 | 只保存稳定引用、版本和必要摘要；不复制 package body、authoring draft、fixtures 或站点知识全文。 | 本 ADR、[0002](0002-run-task-capability-model.md)、Core #15。 | accepted |
| admission decision / resource match / action risk | Core；输入来自 Lode resource requirements、Harbor runtime facts 和调用方策略。 | 调用方、App、后续审计、恢复和对账。 | 保存门禁结果、失败分类和引用；不保存 Harbor 内部事实全集或 App UI 状态。 | [0002](0002-run-task-capability-model.md)、[0004](0004-admission-and-action-risk.md)、Core #15。 | accepted |
| Harbor runtime binding refs | Harbor 生产 Profile / Identity / Runtime Session / Snapshot / Evidence refs，Core 记录引用。 | Core execution、Run Record 查询、App viewer / evidence 展示。 | 只保存 `runtime_session_ref`、`profile_ref`、`execution_identity_ref` 等公共引用和必要摘要；不保存 browser process、CDP URL secret、Cookie、Token、完整 storage 或 provider 私有对象。 | 本 ADR、`docs/architecture/cross-repo-architecture.md`、Core #15/#17。 | accepted（Core 记录边界）；跨仓字段见 [PD-0019](pending-decisions.md#pd-0019) |
| attempts / run events / failure signals | Core；运行时证据引用可来自 Harbor。 | App run viewer、审计、失败归因、恢复流程。 | 保存 task-bound 结构化事件、attempt 摘要和 failure refs；不把普通日志、完整 agent history 或 live activity registry 当作 Run Record 本体。 | 本 ADR、`docs/draft/run-record.md`、research `evidence-and-observability`。 | accepted |
| result envelope | Core。 | API、CLI、MCP、SDK、App、对账流程。 | 保存公共结果封装；成功结果只包含 JSON-safe public payload 和 refs，失败结果包含分类、阶段、code、hint 和 refs。 | 本 ADR、`docs/draft/result-envelope.md`、Core #15。 | accepted |
| evidence / raw payload / source trace / resource trace refs | Harbor 和能力执行侧生产引用，Core 记录引用和摘要。 | App evidence view、能力修复、审计、对账。 | 默认只保存引用和脱敏摘要；不内联完整 DOM、HAR、截图、视频、trace、network body、local path、credentials 或未脱敏页面现场。 | 本 ADR、research `evidence-and-observability` / `result-normalization-and-reconciliation`、Core #15。 | accepted；最小证据分类见 [PD-0008](pending-decisions.md#pd-0008) |
| write operation / reconciliation refs | Core 围绕写侧准入和终态记录；外部运行事实和证据引用来自 Harbor。 | App、调用方、后续状态对账和取消请求。 | 保存 `write_operation_ref` 或等价恢复引用；`unknown_outcome` 不得改写为成功；不保存外部系统私有载荷。 | [0004](0004-admission-and-action-risk.md)、`docs/draft/write-safety.md`、Core #15。 | accepted；最终 Schema 见 [PD-0013](pending-decisions.md#pd-0013) |
| metric sample refs | Core 或观测层生产。 | 运维、调试、后续容量/成本分析。 | 本轮不决定成本、令牌和延迟是否进入持久 Run Record；若进入，必须用摘要或引用。 | 本 ADR、Core #15。 | needs-product-decision，见 [PD-0010](pending-decisions.md#pd-0010) |
| step-level history granularity | Core。 | App run viewer、调试、恢复。 | 本轮不决定默认记录多少步骤；不得默认保存完整 prompt、LLM response、截图序列或原始浏览器轨迹。 | 本 ADR、research `evidence-and-observability`。 | needs-product-decision，见 [PD-0011](pending-decisions.md#pd-0011) |
| dataset projection payload | Core 可选记录公共投影或引用。 | 下游消费者、导出、对账。 | Core 不成为业务数据库；归一化公共载荷是否持久保存留待规格决定。 | 本 ADR、`docs/draft/result-envelope.md`。 | needs-product-decision，见 [PD-0012](pending-decisions.md#pd-0012) |
| raw runtime material as Run Record body | 不生产。 | 不适用。 | 完整 DOM、HAR、截图、视频、request/response body、Cookie、Token、local path 和 provider private object 不进入 Run Record body。 | 本 ADR、Core #15。 | rejected |

## 只读任务结果/失败/证据边界

本节覆盖 Core #21 的第一阶段输出边界。字段名只表达字段族，不冻结最终 Schema。

| 步骤/场景 | 本仓责任 | 输入 | 输出 | 失败/证据 | 状态 |
|---|---|---|---|---|---|
| 接受前失败 | Core 返回结构化失败，不创建 Run Record。 | 归一化请求、capability/runtime refs、策略摘要。 | failure category、code、stage、hint、可安全展示的 refs。 | 适用于 capability unknown、runtime facts missing、证据策略缺失、目标不清或风险不允许。 | accepted |
| 只读成功结果 | Core 返回公共 result envelope，并把运行事实写入 Run Record。 | Lode 输出合同、公共 payload 或 projection ref、Harbor evidence/raw refs。 | public payload/ref、run_record_ref、evidence_refs、source/resource trace refs。 | 不内联完整 DOM、截图、HAR、请求响应、本地路径、Cookie、Token 或 provider 私有对象。 | accepted |
| 只读终态失败 | Core 把失败归因到阶段和可恢复提示，保留引用。 | 运行事件、能力输出校验结果、Harbor evidence refs。 | terminal status `failed` 或 `manual_recovery_required`、failure reason、evidence refs。 | 页面变化、输出不合约、runtime lost、evidence unavailable 和 user action required 分开表达。 | accepted |
| 只读 unknown outcome | 默认不作为只读成功/失败的常规终态；只在外部状态可能已变化的写侧使用。 | 不适用。 | 不适用。 | 只读任务若无法确认抽取结果，应返回结构化失败或 manual recovery，不伪装成 unknown write outcome。 | rejected |
| 证据引用 | Core 只保存 evidence/raw/source/resource refs 和摘要；证据生产、保留和脱敏策略由 Harbor/Lode/App 后续对齐。 | Harbor refs、Lode evidence expectation。 | evidence ref 字段族、脱敏摘要、consumer boundary。 | 最小分类、保留和脱敏策略仍待 [PD-0008](pending-decisions.md#pd-0008)。 | accepted |

## Stage 2 Result / Run / Query 合同 v0

本节覆盖 Core #44/#45/#46/#47/#48/#49/#50。它只冻结 docs-only 公共合同，不创建 JSON Schema、OpenAPI、SDK、CLI、MCP、API、runtime、storage、evidence store、viewer 或 App UI。

### Result Envelope shape

| 字段或状态 | owner | consumer | 有效性/过期规则 | 失败分类 | 非目标 |
|---|---|---|---|---|---|
| `envelope_version` | Core | API、CLI、MCP、SDK、App。 | Stage 2 v0 只保证语义版本；最终字段名留给后续 Schema。 | `unsupported_version`。 | 不生成 schema 或类型。 |
| `ok` / `outcome` / `terminal` | Core | 所有入口和 Run Record。 | `ok=true` 只表示公共投影可消费；终态单调，不因证据过期改写。v0 outcome：`success`、`partial`、`empty`、`failed`、`blocked`、`requires_user_action`、`manual_recovery_required`、`unknown_outcome`。 | `invalid_state_transition`、`projection_failed`。 | 不用浏览器 step 完成状态代表业务成功。 |
| `result_kind` / `capability_ref` / `package_ref` | Lode owns capability/package；Core 记录引用。 | App 展示、CLI/MCP/SDK 分类、后续能力修复。 | 必须绑定运行时消费的 Lode version；后续 Lode 更新不得重写历史 run。 | `capability_not_found`、`capability_version_incompatible`、`package_lock_mismatch`、`invalid_contract`。 | 不复制 package body、fixture、站点知识或 authoring draft。 |
| `data` / `items[]` / `projection_ref` | Lode owns normalized public shape；Core 校验并封装。 | 调用方和 App result view。 | 只允许 JSON-safe public payload；大结果优先引用。数据可被保留或删除，但引用状态必须可查询。 | `output_invalid`、`normalization_failed`、`mapping_incomplete`、`empty_result`。 | 不内联 raw payload、完整 DOM/HAR/screenshot/network body、Cookie、Token、本地路径或 provider private object。 |
| `raw_payload_refs[]` / `source_refs[]` / `evidence_refs[]` / `source_trace_refs[]` / `resource_trace_refs[]` | Harbor/Lode/Core 按来源拥有；Core 记录 refs 和摘要。 | App evidence view、能力修复、审计、对账。 | ref 必须携带 producer、type、redaction、retention/access 状态或可安全摘要；query 时区分 missing、expired、access denied、redacted。 | `source_unavailable`、`evidence_missing`、`evidence_expired`、`evidence_access_denied`、`evidence_redacted`、`resource_trace_unavailable`。 | Core 不成为 evidence store；App 不获得 raw sensitive material。 |
| `run_record_ref` / `result_ref` | Core。 | 查询入口、历史列表、恢复入口。 | `accepted` 后可查询；若 result body 过期，Run Record 仍保留 terminal summary 和 ref state。 | `run_not_found`、`result_unavailable`、`result_expired`。 | 不承诺完整分页/搜索产品。 |
| `write_operation_ref` / `reconciliation_ref` | Core 写侧合同；外部事实仍来自 Harbor evidence。 | 后续写前验证、真实写入和对账入口。 | v0 只预留字段族；真实写入进入 deferred，`unknown_outcome` 不得转成 `success`。 | `unknown_outcome`、`reconciliation_required`、`write_ref_missing`。 | 不执行 submit/destructive，不实现 write store。 |

### Failure reason taxonomy and recovery hint

| 分类 | 典型 code | failure phase | recovery hint 语义 | 用户/系统动作 | 状态 |
|---|---|---|---|---|---|
| `request_invalid` | `input_invalid`、`target_type_invalid`、`request_snapshot_invalid` | `pre_admission` | 修正输入、目标或入口参数。 | App/CLI 显示安全字段级提示；Core 不创建 Run Record。 | v0 |
| `capability_contract` | `capability_not_found`、`operation_not_stable`、`unsupported_version`、`invalid_contract`、`output_contract_missing` | `pre_admission` / `projection` | 选择稳定能力、固定兼容版本或等待 Lode 修复。 | Lode 修复 package；Core fail closed。 | v0 |
| `resource_admission` | `resource_unavailable`、`runtime_ref_missing`、`profile_unavailable`、`identity_unavailable`、`unauthorized_runtime` | `admission` / `resource_matching` / `runtime_binding` | 连接 runtime、选择 profile、登录或调整 policy。 | App 引导设置；Harbor 提供新 facts。 | v0 |
| `action_risk` | `risk_not_allowed`、`approval_required`、`approval_expired`、`idempotency_required`、`policy_denied` | `admission` | 获取审批、降低 intent 或补 idempotency boundary。 | App 承接确认；Core 不绕过策略。 | v0 |
| `runtime_execution` | `runtime_lost`、`timeout`、`source_unavailable`、`selector_unstable`、`handoff_required` | `execution` | 重新绑定、人工接管、重试或走恢复入口。 | Harbor/App 修复现场；Core 记录失败和 refs。 | v0 |
| `result_projection` | `output_invalid`、`normalization_failed`、`mapping_incomplete`、`empty_result`、`post_check_failed` | `verification` / `projection` | 修复能力、重新采集 source，或以 partial/empty 展示。 | Lode 修 normalizer/post-check；App 不把 contract bug 当用户错。 | v0 |
| `evidence_reference` | `evidence_missing`、`evidence_expired`、`evidence_access_denied`、`evidence_redacted`、`capture_denied` | `evidence` / `query` | 重新采集、请求权限或查看脱敏摘要。 | Harbor/App 管 access/redaction；Core 不恢复 raw evidence。 | v0 |
| `persistence_observability` | `run_record_write_failed`、`result_unavailable`、`metric_unavailable` | `persistence` / `observability` | 重试写入事实载体或降级为可审计失败。 | 系统处理；不得伪装业务成功。 | v0 |
| `write_outcome` | `unknown_outcome`、`reconciliation_required`、`cancel_unknown`、`duplicate_rejected` | `write_verification` / `reconciliation` | 围绕 `write_operation_ref` 对账、取消或人工恢复。 | 后续写侧 Work Item 实现；本 ADR 只保留语义。 | deferred implementation |

`recovery_hint` 是机器可读提示族，不是自由文本异常。v0 候选：`fix_input`、`select_capability_version`、`connect_runtime`、`login_or_select_profile`、`request_approval`、`retry_after_refresh`、`rerun_with_evidence`、`manual_handoff`、`repair_package`、`reconcile_write_operation`、`contact_operator`。

### Run Record fields, terminal states, retention, and redaction

| 字段或状态 | owner | consumer | retention/redaction | 失败分类 | 非目标 |
|---|---|---|---|---|---|
| `run_id` / `status` / `created_at` / `updated_at` / `terminal_at` | Core | 所有查询方。 | 持久保存公共 id、状态和时间；不保存 runtime 内部对象。 | `run_not_found`、`invalid_state_transition`。 | 不定义数据库 schema。 |
| `request_snapshot` / `entrypoint_ref` / `caller_ref` | Core/API Server。 | 审计、失败归因、恢复入口。 | 保存脱敏摘要、策略摘要和 refs；用户业务内容、secret、本地路径默认不 inline。 | `caller_unauthorized`、`request_snapshot_invalid`。 | 不保存 App UI 草稿或本地缓存。 |
| `capability_ref` / `package_ref` / `schema_refs` | Lode owns；Core records refs。 | 结果校验、能力修复、App Library 归因。 | 保存运行时消费的稳定版本和 lock 摘要；不复制 package body。 | `capability_invalidated`、`package_lock_mismatch`、`invalid_contract`。 | 不实现 registry。 |
| `resource_requirements_summary` / `resource_match_result` / `admission_decision` / `action_risk` | Core consumes Lode + Harbor + caller policy。 | App setup、审计、恢复。 | 保存匹配摘要、拒绝原因和 refs；不保存 Harbor facts 全量。 | `resource_unavailable`、`risk_not_allowed`、`approval_required`。 | 不硬编码站点策略。 |
| `runtime_binding_refs` | Harbor owns refs；Core records public binding. | 执行、查询、viewer/evidence 展示。 | 保存 `runtime_session_ref`、`profile_ref`、`execution_identity_ref`、可选 page/viewer/source refs；不保存 CDP/VNC URL、Cookie、Token、profile data。 | `runtime_ref_expired`、`identity_unavailable`。 | Core 不管理 browser process。 |
| `attempts[]` / `run_event_refs[]` / `failure_signal_refs[]` | Core；runtime evidence refs 可来自 Harbor。 | 调试、恢复、对账。 | 保存 task-bound 摘要和 refs；完整 agent history、prompt、LLM response、逐步截图默认不进入 Run Record body。 | `timeout`、`runtime_lost`、`handoff_required`。 | 不做通用日志仓库。 |
| `terminal_result_envelope` | Core。 | 所有入口。 | 保存公共 envelope 或 result ref；raw/heavy/sensitive 只以 ref 表达。 | 见 taxonomy。 | 不保存业务数据仓库。 |
| `retention_state` / `redaction_state` | Core records; Harbor/App enforce raw access. | 查询方、审计。 | v0 状态：`active`、`summary_only`、`expired`、`redacted`、`access_denied`、`deleted_by_policy`；状态变化不改写 run terminal outcome。 | `result_expired`、`evidence_redacted`、`permission_denied`。 | 不承诺 raw evidence 恢复。 |

终态 v0：`succeeded`、`failed`、`blocked`、`requires_user_action`、`manual_recovery_required`、`unknown_outcome`、`cancelled`。`cancelled` 只表示 WebEnvoy 停止继续推进；若外部写入可能已发生，必须使用 `unknown_outcome` 或后续 write reconciliation 状态。

### Task / Run / Result query shape

| 查询面 | v0 输入 | v0 返回 | not_found/expired/redaction 语义 | deferred |
|---|---|---|---|---|
| get run summary | `run_id` 或 `run_record_ref`，调用方 policy。 | run status、timestamps、capability/package refs、admission summary、terminal summary、safe refs、available actions。 | `not_found` 表示 Core 没有该 run 或调用方不可见；`permission_denied` 表示存在但调用方无权；`expired` 不应用于 run summary 本体。 | 历史列表、复杂过滤、全文搜索。 |
| get result envelope | `run_id` / `result_ref`，可选 `include=data|summary|refs`。 | terminal result envelope、public data 或 `projection_ref`、failure、refs。 | `result_expired` 表示可查询到 run，但 result body 已按策略移除；必须保留 terminal summary。`redacted` 表示结果可见但字段被脱敏。 | dataset export、streaming large result。 |
| get failure detail | `run_id`，可选 `phase`。 | taxonomy、code、phase、safe message、recovery_hint、evidence/source/resource refs。 | evidence 不可访问不删除 failure detail；用 ref state 表达。 | 完整 debug log 下载。 |
| get evidence/source/resource ref state | ref id、type、caller policy。 | `available`、`missing`、`expired`、`redacted`、`access_denied`、`capture_denied`、safe summary。 | `missing` 是没有或未生成；`expired` 是曾有但 TTL/retention 后不可解引用；`redacted` 是存在但敏感内容不可显示；`access_denied` 是调用方无权。 | raw viewer、evidence export。 |
| get task/request view | `run_id` 或 caller task id。 | request/admission safe summary、entrypoint/caller refs、related run refs。 | 若 request summary 被策略删除，返回 `summary_only` 而不是伪造空请求。 | 完整任务队列和分页产品。 |
| get recovery/reconciliation entry | `run_id`，terminal status。 | allowed next action refs：retry、manual_handoff、reconcile、cancel status、rerun with evidence。 | 不允许的动作返回 `action_not_available`，不是 `not_found`。 | 真正执行 recovery/write。 |

### Consumed upstream facts

| 上游事实 | Core 消费方式 | 不复制/不实现 |
|---|---|---|
| Core ADR 0007 / PR #65 reference/version ownership | 本 ADR 复用 owner、ref validity 和 missing/expired/redacted/access denied 语义；Result/Run/Query 不重新定义 owner。 | 不把 0007 扩成 schema/API/storage。 |
| Harbor PR #58 / ADR 0007 page scene facts | Core Run Record 和 query refs 可记录 `snapshot_ref`、`refmap_ref`、`source_trace`、`evidence_ref`、`viewer_ref`、`control_owner`、`handoff_reason` 的公共摘要和 ref state。 | 不保存完整 DOM、screenshot、HAR、VNC/CDP endpoint、cookies、tokens、provider node ids 或 viewer UI。 |
| Lode PR #60 / ADR 0003 resource requirements / fixtures / post-check / validator | Core 校验 Lode normalized output、resource requirement profiles、post-check result、failure mapping 和 validator status，并把 package/schema refs 写入 Run Record。 | 不保存 Lode fixture、package body、validator implementation、registry 或 normalizer code。 |

### Stage 2 research absorption boundary

| locator | 判断 | 吸收/裁剪/拒绝理由 | 落点 |
|---|---|---|---|
| `WebEnvoy/ROADMAP.md` | 吸收 | 阶段二目标是统一 `task/run/result/evidence/action request` 最小协议；完整入口矩阵、真实写入和产品历史列表后移。 | Result/Run/Query v0 和 deferred 列。 |
| `docs/adr/0003-result-envelope-and-run-record.md` | 吸收 | 既有 owner/ref/raw boundary 是本轮权威基线；本轮补全字段族、query shape 和 taxonomy。 | 本节全部表格。 |
| `docs/adr/0007-reference-version-ownership-v0.md` | 吸收 | 已合并 Core ref/version owner、validity 和 ref failure 语义；本轮只消费，不重开 owner 决策。 | Consumed upstream facts、query ref state。 |
| Harbor ADR 0007 / PR #58 | 吸收 | 吸收 snapshot/refmap/source_trace/evidence/viewer/control/handoff facts 的公共 ref 和状态；拒绝 Harbor raw scene、viewer endpoint、provider private object 进入 Core body。 | Run Record refs、evidence/source query state。 |
| Lode ADR 0003 / PR #60 | 吸收 | 吸收 normalized output、resource requirement profiles、post-check、validator report 和 Lode failure mapping；拒绝 package fixture、registry、validator code 进入 Core。 | Result projection、failure taxonomy、Run Record package refs。 |
| `research/absorability/themes/result-normalization-and-reconciliation.md` | 裁剪复用 | 复用 typed error、hint、low-noise result、large payload by ref、unknown outcome/reconciliation 机制；裁剪掉 adapter-specific JSON、display columns、file export 和 renderer code。 | Result envelope、failure taxonomy、write refs。 |
| `research/absorability/themes/evidence-and-observability.md` | 裁剪复用 | 复用 evidence refs、retention/redaction、Run Record baseline、non-proof policy；拒绝默认保存 screenshot/HAR/video/full DOM/prompt/agent history。 | Run Record retention/redaction、query ref state。 |
| `research/absorability/themes/api-cli-mcp-and-agent-interface.md` | 裁剪复用 | 复用统一 envelope、machine-readable failures 和 entrypoint consistency；不把某个 CLI/MCP transport 或 command surface 固化为 v0 API。 | Query shape、failure hint。 |
| `research/absorability/themes/workflow-and-task-package.md` | 只参考 | 支持任务/工作流包和 verification 思路，但 Core 本轮不定义 workflow DSL 或 package format。 | post-check/result projection rationale。 |
| Syvert TaskRecord、旧 WebEnvoy runtime store / CLI envelope / risk gate | 裁剪复用 | 只取 run id、terminal state、evidence/risk/failure/hint 思路；历史平台字段、store shape 和 UI 流程不进入 MVP。 | Run Record fields、taxonomy。 |
| Browser agent history、live activity registry、raw dashboard transcript | 拒绝进入 MVP | 缺少 capability version、admission、retention/redaction 和 ref owner 边界；会把 Core 变成日志/现场仓库。 | 非目标。 |

## 后果

调用方可以跨 API、SDK、CLI、MCP 和 App 消费同一种结果封装。

操作者可以查看运行记录，而不需要重放任务或读取临时运行时内存。

敏感浏览器产物保留在证据引用和策略之后，降低意外泄露风险。

实现必须在返回成功前完成校验和投影。能力执行正确但输出违反合同，也应在投影阶段失败。

## 备选方案

- 直接返回适配器专用 JSON：拒绝，因为它缺少稳定版本、证据边界和跨入口一致性。
- 把日志、Profile 状态或 live activity 当作运行记录：拒绝，因为它们不包含能力版本、准入、资源匹配和终态结果。
- 整体复制浏览器智能体历史：拒绝，因为智能体轨迹是有用证据，但不是 Core 公共合同。
- 为方便而内联原始载荷或截图：拒绝，因为证据可能包含凭据、业务数据、本地路径和提供方内部信息。
- 让 Core 变成数据集仓库：拒绝，因为归一化模式和业务含义属于 Lode 和下游消费者。

## 研究证据

- [docs/draft/result-envelope.md](../draft/result-envelope.md) 定义了公共投影、归一化结果，以及 raw/evidence 只通过引用出现的边界。
- [docs/draft/run-record.md](../draft/run-record.md) 定义了持久运行记录生命周期和最小字段。
- [docs/draft/runtime-contract.md](../draft/runtime-contract.md) 连接了结果封装、运行记录、证据、未知结果和对账。
- [研究综合](https://github.com/WebEnvoy/research/blob/main/synthesis.md) 把结果封装、未知结果、证据引用和运行记录记录为跨主题公共边界。
- [结果归一化与对账主题](https://github.com/WebEnvoy/research/blob/main/absorability/themes/result-normalization-and-reconciliation.md) 支撑低噪音结构化结果、类型化错误和大结果引用。
- [证据与可观测性主题](https://github.com/WebEnvoy/research/blob/main/absorability/themes/evidence-and-observability.md) 支撑运行记录基线、证据引用，以及运行时状态和任务事实的区别。

## 未决问题

- [PD-0007](pending-decisions.md#pd-0007)：结果封装和运行记录的最终 JSON Schema。
- [PD-0008](pending-decisions.md#pd-0008)：最小证据分类、保留策略和脱敏策略。
- [PD-0009](pending-decisions.md#pd-0009)：CLI 退出码与失败分类的映射。
- [PD-0010](pending-decisions.md#pd-0010)：成本、令牌和延迟指标是否进入持久运行记录，还是进入单独指标流。
- [PD-0011](pending-decisions.md#pd-0011)：步骤级历史默认进入运行记录多少，多少只进入证据产物。
- [PD-0012](pending-decisions.md#pd-0012)：数据集投影在 Core 中保存归一化载荷，还是只保存投影引用。
