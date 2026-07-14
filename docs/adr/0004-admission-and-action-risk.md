# 0004. 准入与动作风险

## 状态

拟议。

动作风险与 approval-request-first 产品模型已由
[ADR 0009](0009-unified-authorization-policy.md) supersede，2026-07-14。
能力/资源准入、target binding、idempotency、unknown outcome 和 reconciliation
边界继续有效。

## 背景

WebEnvoy Core 必须在真实浏览器执行前拦住不安全或规格不足的工作。对于上传、发布、编辑、删除、提交、取消，以及任何可能触达外部系统的动作，这一点尤其重要。

研究和草稿已经收敛到同一条边界：Harbor 提供运行时事实，Lode 声明能力需求，Core 应用任务策略。三者不能合并成一个 Browser Profile 或提供方分数。

## 决策

Core 准入在执行前包含三道门：

1. 能力准入：请求的能力已知、稳定、已版本化，并有合同支撑。
2. 资源准入：Lode 资源需求与 Harbor 运行时事实和调用方策略匹配。
3. 动作风险准入：请求的执行意图和风险级别被允许，在必要时已批准，并有证据支撑。

Core 拥有门禁结果和失败分类。Harbor 拥有客观运行时事实和证据采集。Lode 拥有能力声明的需求、前置检查、后置验证和风险声明。App 拥有面向用户的审批、恢复和接管体验。

最小动作风险类别是：

- `read`：观察或抽取，不意图产生外部变更。
- `write`：改变草稿、本地、账号或页面状态，但不是外部最终提交。
- `submit`：发送、发布、上传、保存，或可能创建外部可见状态。
- `destructive`：删除、撤销、取消、覆盖，或执行难以逆转的状态变更。

最小写侧执行意图是：

- `dry_run`
- `validate_only`
- `execute_after_approval`
- `reconcile_status`
- `request_cancel`

对于 `submit` 和 `destructive` 工作，Core 必须要求显式策略允许或 `approval_evidence_ref`；在可能重复提交时必须要求幂等边界；当外部提交可能已经发生时，必须保留 `write_operation_ref` 或等价恢复引用。

运行时目标绑定是准入的一部分。Core 应把运行绑定到公共 Harbor 引用和事实，例如运行时会话、Profile、执行身份、目标页面或域名、证据策略和当前健康状态。Core 不定义 Harbor Profile 或运行时会话内部细节。

`unknown_outcome` 是终态结果，不是可恢复成功标记。如果写入可能已经到达外部系统，但 WebEnvoy 无法确认结果，Core 应记录带证据和对账引用的 `unknown_outcome`，而不是把运行标记为 `succeeded`。

对账和取消是围绕既有 `write_operation_ref` 的独立执行意图，不应被隐藏成原提交运行的重试。

## 写侧早期边界

本节覆盖 Core #22、#23 和 #24 的早期声明，不设计完整写侧。

| 写侧概念 | 早期允许范围 | 禁止范围 | 进入真实写入条件 | 依据 | 状态 |
|---|---|---|---|---|---|
| `validate_only` | 校验输入、能力合同、资源需求、风险和可用证据；可返回结构化失败。 | 不点击提交、不保存、不发布、不上传，不把验证通过当成已执行。 | 后续必须有 approval、idempotency、post-check、unknown outcome 和 reconciliation 语义。 | 本 ADR、`docs/draft/write-safety.md`、research `task-execution-and-admission`。 | accepted |
| `draft` | 生成或更新本地/产品内草稿、计划或待确认 payload。 | 不触达外部最终状态，不绕过 App 审批体验。 | 草稿进入真实写入前必须绑定目标、payload、身份、审批和幂等边界。 | WebEnvoy/App `ROADMAP.md`、Lode `ROADMAP.md`。 | accepted |
| `preview` | 返回预期变更、风险、证据引用和用户可理解的确认材料。 | 不把 preview 表述为提交结果，不保存外部系统状态。 | preview 后执行真实写入必须重新通过当前 runtime facts、approval 和 post-check 要求。 | 本 ADR、`docs/draft/write-safety.md`。 | accepted |
| 真实写入 | 本阶段不进入实现或完整规格。 | 不默认开放 `submit` / `destructive`，不依赖提示词约束敏感操作。 | 显式 approval、idempotency key/boundary、post-check、`unknown_outcome`、`write_operation_ref` 和 reconciliation entry 全部成立。 | Syvert write-side evidence、旧 WebEnvoy risk gate、research `result-normalization-and-reconciliation`。 | deferred |

## Stage 2 Admission / Resource / Action Risk 合同 v0

本节覆盖 Core #51/#52/#53/#54/#55。它只冻结 Core 对 Lode resource requirements、Harbor runtime facts、caller policy 和 action request 的消费语义，不创建 schema、API、runtime、storage、evidence store、viewer、App UI 或真实写入实现。

### Lode resource requirements consumption

| 字段或状态 | owner | Core 消费规则 | 失败分类 | 非目标 |
|---|---|---|---|---|
| `resource_requirement_profiles[]` | Lode。 | Core 按 one-of 匹配：任一 profile 与当前 Harbor facts、caller policy、action intent 同时满足即可通过；profile 顺序不是 fallback priority。 | `resource_unavailable`、`invalid_contract`。 | Core 不选择 provider、不拉起账号池、不推断 profile。 |
| required Harbor facts vocabulary | Harbor owns vocabulary；Lode 引用公共词表。 | Core 只接受已发布公共 fact 名称和版本；未知、拼错、provider 私有或 secret-bearing 字段使准入 fail closed。 | `invalid_contract`、`unsupported_version`。 | 不把 cookies、tokens、proxy endpoints、local path、provider route 写进 Lode 合同。 |
| operation mode / action risk declared by capability | Lode。 | Core 用它和 caller request intent 交叉校验；capability 声明 `read` 不能被 caller 升级为 true-write。 | `risk_not_allowed`、`intent_incompatible`、`invalid_contract`。 | Lode 不决定用户审批是否有效。 |
| pre-check / post-check / evidence policy refs | Lode。 | admission 只确认 refs 存在、版本兼容、要求可执行；执行和结果映射由 Core 后续阶段记录。 | `pre_check_unavailable`、`post_check_required`、`evidence_policy_missing`。 | 不运行 Lode validator code 或 fixture tests。 |
| validator status / stable eligibility | Lode validator report。 | stable execution 需要 validator `pass` 或明确允许的 preview/experimental policy；error 阻塞准入，warning 可进入受限路径。 | `package_not_stable`、`validator_error`、`invalid_contract`。 | 不实现 registry、validator 或 package install。 |

### Harbor runtime facts consumption

| 字段或状态 | owner | Core 消费规则 | 失败分类 | 非目标 |
|---|---|---|---|---|
| `runtime_session_ref` / session health | Harbor。 | admission 必须绑定当前可用 session 和 health summary；accepted 后历史 Run Record 保留 ref，不能用后续 session facts 改写历史。 | `runtime_ref_missing`、`runtime_session_unavailable`、`runtime_ref_expired`。 | Core 不持有 browser process、CDP/VNC endpoint 或 provider driver。 |
| `profile_ref` / `execution_identity_ref` | Harbor。 | Core 只消费公共引用和脱敏 availability；是否登录、身份授权、profile ownership 由 Harbor facts + policy 表达。 | `profile_unavailable`、`identity_unavailable`、`unauthorized_runtime`。 | 不保存账号、cookie、token、persona、profile data。 |
| `snapshot_ref` / `refmap_ref` / `source_trace` | Harbor ADR 0007。 | read/action context 只能使用同一 session/page/frame/navigation generation 的 fresh refs；stale 或 unstable ref 必须重新采集或进入 handoff。 | `snapshot_missing`、`snapshot_stale`、`refmap_stale`、`selector_unstable`、`source_unavailable`。 | 不把 DOM、AX tree、provider node id 或 locator fallback 当 Core schema。 |
| `evidence_ref` / evidence policy state | Harbor。 | Core 只记录 ref、type、redaction、retention、access state；policy denied 不重试同一 capture。 | `evidence_missing`、`evidence_expired`、`evidence_redacted`、`capture_denied`、`permission_denied`。 | Core 不复制 evidence store 或 raw screenshot/HAR/video。 |
| `viewer_ref` / `viewer_access` / `input_capability` | Harbor + App authorization。 | Core 可在 Run Record 暴露 safe refs 和 handoff availability；interactive control 仍受 policy gate。 | `viewer_unavailable`、`input_disabled`、`policy_denied`。 | 不实现 viewer UI，不裸露 VNC/CDP/ws endpoint。 |
| `control_owner` / `handoff_reason` | Harbor records runtime fact；Core/App request intent。 | owner 不是 outcome；Core 用它决定 pause、manual recovery 或 retry boundary。 | `control_lost`、`handoff_required`、`takeover_denied`。 | 不让 Harbor 判断业务成功。 |

### Admission decision and failure semantics

| decision | 语义 | Run Record | caller result | recovery hint |
|---|---|---|---|---|
| `accepted` | 能力、资源、runtime facts、risk 和 caller policy 在当前 snapshot 下可运行。 | 创建 Run Record，进入 `accepted`。 | 返回 run/result refs 或同步执行入口。 | not_applicable |
| `accepted_with_warnings` | 可运行但存在非阻塞 warning，例如 validator warning、证据策略较弱、preview path。 | 创建 Run Record 并记录 warnings。 | 返回 warning refs，不降低为 success proof。 | `review_warnings` |
| `blocked_pre_admission` | 进入 runtime 前已 fail closed。 | 不创建 Run Record；可返回 pre-admission failure envelope。 | taxonomy + code + safe refs。 | `fix_input` / `connect_runtime` / `repair_package` |
| `requires_user_action` | 登录、captcha、审批、profile 选择或用户确认缺失。 | 未 accepted 时不创建 Run Record；accepted 后可终态 `requires_user_action` 或 `manual_recovery_required`。 | 返回 action request 或 handoff refs。 | `login_or_select_profile` / `request_approval` / `manual_handoff` |
| `deferred_true_write` | 请求进入真实写入，但 Stage 2 只允许 validate/draft/preview 合同。 | 不创建真实写入 Run Record。 | 返回 `risk_not_allowed` 或 `true_write_deferred`。 | `use_validate_or_preview` |

### Action request v0

| 字段族 | owner | v0 规则 | 失败分类 | deferred |
|---|---|---|---|---|
| `action_request_ref` / `requested_intent` | Core receives caller request；App may render approval UI。 | v0 intent：`read`、`validate_only`、`draft`、`preview`、`execute_after_approval`、`reconcile_status`、`request_cancel`。Stage 2 只允许前四个进入 docs-only contract；后三个只保留语义。 | `intent_unsupported`、`intent_incompatible`。 | execute/reconcile/cancel implementation。 |
| `risk_level` | Core derives from Lode declaration + caller request + policy。 | v0 level：`read`、`write`、`submit`、`destructive`；`submit`/`destructive` 默认需要 approval/policy allow，并且本阶段不执行。 | `risk_not_allowed`、`approval_required`。 | site-specific risk policy。 |
| `target_ref` / `payload_ref` | Core records safe refs；Lode defines input/payload contract；Harbor supplies runtime refs. | target/payload 必须可脱敏记录；payload 可为 draft/preview ref，不得 inline secrets、files、provider routes。 | `target_unavailable`、`payload_invalid`。 | payload store / file upload implementation。 |
| `approval_request_ref` / `approval_evidence_ref` | App owns user approval experience；Core validates refs. | Approval must bind operation, target, payload, identity, risk, idempotency boundary and expiry. | `approval_required`、`approval_expired`、`approval_mismatch`。 | approval UI and persistence. |
| `idempotency_key` / `write_operation_ref` | Core write-side contract。 | Required before true-write; v0 only records deferred requirement. | `idempotency_required`、`duplicate_rejected`、`write_ref_missing`。 | true-write store/reconciliation. |
| `preview_ref` / `draft_ref` | App/Core depending on surface；Core records public refs. | Preview/draft are not external submission proof and must expire or be revalidated before true-write. | `preview_expired`、`draft_unavailable`。 | product draft editor. |

### Validate-only, draft, preview, true-write boundary

| mode | 可做 | 禁止 | 必须重新验证的条件 | 结果语义 |
|---|---|---|---|---|
| `validate_only` | 校验 request、Lode contract、resource requirements、Harbor facts、risk、approval need、post-check availability。 | 点击提交、保存、上传、发布、删除、付款或改变外部系统状态。 | capability/package/runtime/profile/snapshot/evidence policy 改变。 | `validated` 或 structured failure；不是执行成功。 |
| `draft` | 生成本地或产品内草稿、payload ref、待确认计划。 | 触达外部最终状态、绕过 App 审批、把草稿当提交结果。 | target/payload/identity/risk/approval 变化。 | `draft_created` / `draft_updated`；需要用户确认。 |
| `preview` | 返回预期变更、risk、evidence/source refs、approval request material。 | 保存外部状态或宣称已提交。 | runtime facts、target binding、approval、post-check requirement 或 evidence policy 变化。 | `preview_ready` / `preview_blocked`；后续 true-write 需重跑准入。 |
| `true_write` | Stage 2 不实现；只保留合同门槛。 | 在本阶段执行 submit/destructive，依赖提示词绕过审批/幂等/对账。 | always before execution。 | 后续必须产生 `write_operation_ref`、post-check、unknown outcome/reconciliation semantics。 |

### Consumed upstream facts

| 上游事实 | Core Admission 消费 | 不复制/不实现 |
|---|---|---|
| Core ADR 0007 / PR #65 | 使用 ref owner、version ownership、missing/expired/redacted/access denied 失败语义。 | 不重开 reference owner 决策。 |
| Harbor PR #58 / ADR 0007 | 消费 `runtime_session_ref`、`profile_ref`、`execution_identity_ref`、`snapshot_ref`、`refmap_ref`、`source_trace`、`evidence_ref`、`viewer_ref`、`viewer_access`、`control_owner`、`handoff_reason`。 | 不复制 runtime facts 全量、raw scene、viewer endpoint、provider private ids、cookies/tokens。 |
| Lode PR #60 / ADR 0003 | 消费 `resource_requirement_profiles[]`、input/output/source refs、post-check requirements、validator report、failure mapping 和 write-like deferred conditions。 | 不保存 fixture、package body、validator code、registry、normalizer implementation。 |

### Stage 2 research absorption boundary

| locator | 判断 | 吸收/裁剪/拒绝理由 | 落点 |
|---|---|---|---|
| `WebEnvoy/ROADMAP.md` | 吸收 | 阶段二要求 Admission、Action Risk、资源匹配和公共入口 v0；真实写入闭环属于后续阶段。 | 本节 v0/deferred 边界。 |
| `docs/adr/0004-admission-and-action-risk.md` | 吸收 | 既有三道门、risk enum 和写侧边界是权威基线；本轮补 Lode/Harbor 消费规则和 action request 字段族。 | 全部 Stage 2 表格。 |
| `docs/adr/0007-reference-version-ownership-v0.md` | 吸收 | 使用 ref/version owner 与 failure mapping，不重复定义 ref owner。 | Consumed upstream facts。 |
| Harbor ADR 0007 / PR #58 | 吸收 | 吸收 snapshot/refmap/source/evidence/viewer/control/handoff facts；拒绝 raw DOM、HAR、screenshot、viewer endpoint、provider private object 进入 Core。 | Harbor runtime facts consumption。 |
| Lode ADR 0003 / PR #60 | 吸收 | 吸收 resource requirements、post-check、validator status、write-like deferred conditions；拒绝 Lode fixture/validator/registry 进入 Core。 | Lode resource requirements consumption。 |
| `research/synthesis.md` | 吸收 | 吸收 runtime facts 与 task policy 拆分、Run Record/evidence 跨仓 owner、敏感动作 fail closed。 | 三道门和 owner boundary。 |
| `research/absorability/README.md` | 只参考 | 只采用 research absorption 记录方法，不从索引文件抽字段。 | 本表。 |
| `research/absorability/themes/task-execution-and-admission.md` | 裁剪复用 | 复用 resource matching、risk gate、post-check、unknown outcome、requires user action；裁剪掉 BrowserUse/Skyvern/workflow executor、crawler queue、旧单站 gate 全量字段。 | resource/action/failure 表。 |
| `research/absorability/themes/api-cli-mcp-and-agent-interface.md` | 裁剪复用 | 复用统一 error envelope、approval request 可机器读、入口一致性；不固化 CLI/MCP 命令或 transport。 | action request 和 decision result。 |
| Syvert write-side evidence、旧 WebEnvoy risk gate | 裁剪复用 | 只保留审批、幂等、write_operation_ref、unknown outcome、reconciliation 机制；拒绝历史平台字段和真实写入实现进入 Stage 2。 | validate/draft/preview/true-write boundary。 |
| 通用 browser agent loop、prompt-only safety、provider dashboard route | 拒绝进入 MVP | 无机器可检查 policy、approval、idempotency、post-check 和 owner boundary。 | 非目标。 |

## 后果

真实写入的准入会变慢，但更容易审计、恢复和对账。

Harbor 保持为运行时提供方，而不是策略判定者。Lode 保持为能力合同来源，而不是运行时拥有者。App 保持为可见审批和恢复入口，而不是第二套执行引擎。

Core 需要为缺少审批、缺少幂等边界、目标不匹配、运行时事实不可用、缺少后置检查和缺少证据策略提供结构化接受前失败。

早期实现可以只支持上述最小风险类别和执行意图。更细的站点专用策略属于 Lode 能力声明和 App/用户策略，不应硬编码进 Core 分支。

## 备选方案

- 依赖 Skill 或提示词文案约束敏感操作：拒绝，因为安全边界必须可机器检查并可记录。
- 只在低层浏览器工具上做允许、拒绝、确认：拒绝，因为稳定任务需要能力级准入和结果对账。
- 完整复制旧单站点写入门禁：拒绝，因为其中有用的是证据思想，但历史和平台专用字段过多。
- 让 Harbor 判断写入是否安全：拒绝，因为 Harbor 只知道运行时事实，不知道站点任务意图。
- 乐观地把写入超时标记为 `failed` 或 `succeeded`：拒绝，因为外部系统可能已经收到操作。

## 研究证据

- [docs/draft/capability-admission.md](../draft/capability-admission.md) 定义了失败即关闭路径的准入，以及不应进入准入面的字段。
- [docs/draft/write-safety.md](../draft/write-safety.md) 定义了写侧执行意图、幂等、审批证据、写操作引用、未知结果和对账。
- [docs/draft/runtime-contract.md](../draft/runtime-contract.md) 定义了资源需求匹配和未知结果处理。
- [研究综合](https://github.com/WebEnvoy/research/blob/main/synthesis.md) 记录了运行时事实与任务策略必须拆开，以及 Core 准入/动作风险仍需产品决策。
- [任务执行与准入主题](https://github.com/WebEnvoy/research/blob/main/absorability/themes/task-execution-and-admission.md) 支撑敏感操作确认、资源匹配、动作策略和写侧失败即关闭路径门禁。
- [证据与可观测性主题](https://github.com/WebEnvoy/research/blob/main/absorability/themes/evidence-and-observability.md) 支撑证据边界、不能作为证明的信号和显式隐私/遥测策略。

## 未决问题

- [PD-0013](pending-decisions.md#pd-0013)：动作风险、执行意图、审批证据和幂等追踪的最终 Schema。
- [PD-0014](pending-decisions.md#pd-0014)：四个最小风险类别是否足够支撑 App 策略和 MCP/CLI 展示。
- [PD-0015](pending-decisions.md#pd-0015)：审批有效期、撤销行为，以及与操作、目标、载荷和身份的绑定方式。
- [PD-0016](pending-decisions.md#pd-0016)：写任务锁粒度：会话、标签页、Profile、身份、能力还是目标对象。
- [PD-0017](pending-decisions.md#pd-0017)：每个动作风险类别的最小证据要求。
- [PD-0018](pending-decisions.md#pd-0018)：人工接管、验证码和登录恢复如何映射到准入或终态结果。
