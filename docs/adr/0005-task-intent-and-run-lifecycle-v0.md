# 0005. 任务意图与运行生命周期 v0

## 状态

已接受。

## 背景

阶段二需要把 App、API、CLI、MCP 和 SDK 的任务请求压成同一套 Core 语义。第一阶段 ADR 已经固定 Core 拥有任务路径、准入、Run Record 和 Result Envelope；本 ADR 只冻结 v0 公共合同，不定义最终 JSON Schema、HTTP 路由、SDK 类型或 runtime 实现。

本 ADR 覆盖 GitHub issues WebEnvoy/WebEnvoy#37、#38、#39 和 #40。

## 决策

所有入口必须通过 WebEnvoy API Server 归一化为同一个 Task Intent Envelope，再进入 Core admission。App、CLI、MCP 和 SDK 不直接调用 Harbor runtime、CDP、Lode package body 或站点私有 adapter。

Core v0 使用以下公共运行状态：

```text
pending -> admitted -> running -> succeeded / failed / cancelled / expired
```

`pending` 是 durable Run Record 已创建、但尚未通过全部准入的状态。`admitted` 是能力、资源、运行时和风险准入已通过、允许启动执行的状态。第一阶段文档中的 `accepted` 在本 v0 合同中视为 `admitted` 的历史别名，不再作为新公共状态扩展。

Run Record 从 `pending` 开始创建。不能形成可信 Task Intent Envelope 的请求不创建 durable Run Record，只返回结构化请求失败。已经形成可信 Task Intent Envelope 的准入失败必须进入 Run Record，并以 `failed` 终态记录失败阶段和安全展示信息。

## Task Intent Envelope v0

字段名表达公共语义，不冻结最终 Schema 名称。

| 字段或状态 | owner | consumer | 有效性/过期规则 | 失败分类 | 非目标 |
|---|---|---|---|---|---|
| `intent_id` / `correlation_id` | API Server 生成或校验；调用方可提供 correlation id。 | API、CLI、MCP、SDK、App、Run Record。 | 每次请求必须稳定；重复请求只能靠明确 idempotency 语义去重。 | `request_identity_invalid`。 | 不作为用户身份、会话身份或幂等 key 的替代品。 |
| `caller` / `entrypoint` | API Server。 | Core admission、Run Record、App viewer、CLI/MCP/SDK diagnostics。 | 只能取公共入口枚举，例如 `app`、`api`、`cli`、`mcp`、`sdk`。 | `caller_invalid`。 | 不保存 App 组件树、MCP client 私有对象或 SDK 本地路径。 |
| `user_intent` | 调用方提交，API Server 脱敏归一。 | Core admission、Lode capability matching、Run Record 摘要。 | 必须是用户可解释的目标摘要；不得包含凭据、Cookie、完整 DOM、完整 prompt 或页面私有对象。 | `intent_invalid` / `private_field_rejected`。 | 不承载 UI draft、聊天全文或任意浏览器 action script。 |
| `capability_ref` / `capability_version` | 调用方引用，Core 消费 Lode 声明。 | Core admission、Result Envelope、Run Record、App capability attribution。 | 必须指向已知且可运行的 Lode capability/package version。 | `capability_unknown` / `capability_not_stable` / `capability_version_invalid`。 | 不复制 Lode package body、fixtures、site knowledge 或 adapter 源码。 |
| `input_summary` / public input refs | API Server 从公共输入生成。 | Core admission、Run Record、Result Projection。 | 只保存 JSON-safe 摘要和引用；大 payload、文件、raw response 和隐私材料必须走引用。 | `input_contract_invalid` / `input_ref_unavailable`。 | 不内联用户私密任务参数、文件路径、raw payload、Token 或账号材料。 |
| `scope` | 调用方声明，Core 校验。 | Core admission、App 展示、CLI/MCP/SDK diagnostics。 | 至少表达目标站点/对象/账号环境边界；不得比 Lode capability 和 Harbor facts 更宽。 | `scope_invalid` / `target_type_invalid`。 | 不成为 provider route、账号池选择、proxy 选择或业务策略引擎。 |
| `policy` / `constraints` | 调用方和 App 提供公共策略；Core 执行准入。 | Core admission、Run Record、后续 cancellation / reconciliation。 | 必须能映射到风险类别、执行意图、超时、取消和证据策略。 | `policy_denied` / `timeout_invalid` / `approval_required`。 | 不承载 App UI 开关、完整 ACL 系统或低层 browser command policy。 |
| `resource_requirement_refs` | Lode 声明，Core 引用；Harbor 提供 runtime facts。 | Core resource matching、Run Record。 | 只能引用公共资源需求和 Harbor facts；facts 过期时准入失败。 | `resource_requirement_missing` / `runtime_facts_stale` / `resource_unavailable`。 | 不保存 Profile、Execution Identity、Runtime Session 或 provider 私有对象本体。 |
| `evidence_policy_ref` | Lode / Core / App 合同输入。 | Core admission、Harbor evidence capture、Run Record。 | 对需要证据的任务必须存在；证据保留和脱敏策略不足时 fail closed。 | `evidence_policy_missing` / `evidence_unavailable`。 | 不把截图、视频、HAR、DOM 或 trace 内联进 intent。 |
| `action_risk` / `execution_intent` | Core 解释调用方意图并消费 Lode risk declaration。 | Core admission、App approval、CLI/MCP/SDK warnings、Run Record。 | v0 可使用 `read`、`write`、`submit`、`destructive` 和 `dry_run`、`validate_only`、`execute_after_approval`、`reconcile_status`、`request_cancel`。 | `risk_not_allowed` / `approval_evidence_missing`。 | 本 ADR 不开放真实写入实现，不定义审批 UI。 |
| UI/runtime/private fields | 不允许进入 Core。 | 不适用。 | API Server 必须拒绝或剥离；若字段影响执行语义则请求失败且不创建 Run Record。 | `private_field_rejected`。 | App UI state、Harbor runtime internals、CDP URL、Cookie、Token、本地路径、provider private object 不进入 Task Intent。 |

## Run 生命周期与状态词表 v0

| 字段或状态 | owner | consumer | 有效性/过期规则 | 失败分类 | 非目标 |
|---|---|---|---|---|---|
| `pending` | Core。 | API、CLI、MCP、SDK、App、Run Record 查询。 | Run Record 已创建；正在做 capability、resource、runtime facts 和 risk admission。可转 `admitted`、`failed`、`cancelled` 或 `expired`。 | `admission_failed` / `cancelled_before_admission` / `expired_before_admission`。 | 不表示已开始浏览器执行。 |
| `admitted` | Core。 | Core execution、Harbor binding、Run Record 查询。 | 所有准入通过；允许启动执行。可转 `running`、`cancelled`、`expired` 或 `failed`。 | `runtime_start_failed` / `cancelled_before_start` / `expired_before_start`。 | 不保证结果成功，也不表示外部状态已变化。 |
| `running` | Core。 | API、CLI、MCP、SDK、App viewer、Run Record 查询。 | 执行已开始或已绑定执行上下文。可转任一终态。 | `execution_failed` / `verification_failed` / `persistence_failed`。 | 不暴露低层 step/action 状态机为公共 v0 状态。 |
| `succeeded` | Core。 | 所有调用入口、App、后续对账。 | 终态；Result Envelope 已按 Lode output contract 投影并写入 Run Record。 | 不适用。 | 不代表 raw runtime material 可公开。 |
| `failed` | Core。 | 所有调用入口、App、审计、恢复判断。 | 终态；必须记录 failure category、code、phase、safe hint 和 refs。 | admission、resource_matching、runtime_binding、execution、verification、result_projection、persistence、observability。 | 不用自由文本异常替代结构化失败。 |
| `cancelled` | Core。 | 调用方、App、后续对账。 | 终态；只表示 WebEnvoy 已按取消语义停止或拒绝继续。 | `cancelled_by_user` / `cancelled_by_policy`。 | 不保证外部系统已撤销已提交写入；真实写入仍需 reconciliation。 |
| `expired` | Core。 | 调用方、App、自动化脚本。 | 终态；由队列等待、admission、start 或 execution 超过有效期触发。 | `request_expired` / `run_expired`。 | 不等同于业务失败；调用方可按新 intent 重试。 |

状态推进必须单调。终态不得被后续观察覆盖；需要继续处理时创建新的 run 或使用后续 reconciliation intent。

## Run Record 创建规则 v0

| 场景 | 创建 Run Record | 返回/记录 | App/API/CLI/MCP/SDK 共享语义 |
|---|---|---|---|
| transport 失败、认证失败、权限失败、rate limit 在 API trust boundary 前触发 | 否 | HTTP / CLI / MCP / SDK 层结构化请求失败，可带 correlation id。 | 入口层失败，不显示为 run history。 |
| 请求无法解析为 Task Intent Envelope、必填公共字段缺失、字段类型错误 | 否 | `request_invalid`，指出字段族，不回显敏感输入。 | 调用方修正请求；App 显示提交失败。 |
| 请求包含会改变执行语义的 UI/runtime/private fields | 否 | `private_field_rejected`。 | 所有入口都必须改走公共 refs / facts；不允许绕过 Core。 |
| Task Intent Envelope 有效，但 capability unknown、not stable、version invalid 或 output contract missing | 是，初始 `pending` 后转 `failed` | Run Record 记录 `admission` phase 和 Lode ref 解析失败。 | App/API/CLI/MCP/SDK 都能查询失败 run；不启动 Harbor runtime。 |
| resource requirements 缺失、Harbor runtime facts stale/unavailable、evidence policy missing | 是，初始 `pending` 后转 `failed` | Run Record 记录 `resource_matching` 或 `runtime_binding` phase。 | 失败可被 App 展示为资源/运行现场问题；不硬跑。 |
| action risk 不允许、approval evidence missing、scope/target 不匹配 | 是，初始 `pending` 后转 `failed` | Run Record 记录 `admission` phase、risk class 和 safe hint。 | 入口共享同一拒绝语义；App 可引导审批或改 scope。 |
| 准入通过但执行启动前取消或过期 | 是，`pending` 或 `admitted` 转 `cancelled` / `expired` | Run Record 记录取消/过期来源和时间。 | 不把取消/过期伪装成业务失败。 |
| 准入通过并启动执行 | 是，`admitted` 转 `running` 后进入终态 | Run Record 记录 runtime binding refs、attempt summary、result envelope 或 failure envelope。 | 所有入口查询同一 run truth。 |
| 终态写入失败或 observability 写入失败 | 是 | 若终态无法持久化，必须返回结构化 `persistence_failed` / `observability_failed`，不得伪装成功。 | 调用方把它当 Core 记录层失败处理。 |

## 共享入口边界

| 入口 | 允许职责 | 禁止职责 |
|---|---|---|
| App | 收集用户意图、显示准入/运行/失败/取消/过期状态、提供审批和恢复体验。 | 不直接写 Harbor runtime internals，不生成第二套 run truth。 |
| API Server | 认证、归一化、脱敏、拒绝 private fields、生成 Task Intent Envelope。 | 不把原始 UI state、CDP URL、Cookie、Token 或 provider object 透传给 Core。 |
| CLI | 提交同一 Task Intent Envelope，输出同一 Result/Failure Envelope 和 exit diagnostics。 | 不维护独立 task runner 或独立状态词表。 |
| MCP | 暴露最小 task submit/query/cancel 语义并消费同一 envelope。 | 不把低层 browser tools、eval、debugger 或全量 DevTools 面当作正式任务接口。 |
| SDK | 类型化封装 API Server 的 Task/Run/Result 合同。 | 不绕过 API Server 直接调用 Core、Harbor 或 Lode。 |
| Core | 准入、状态推进、Run Record、Result/Failure Envelope 和 refs 边界。 | 不拥有 App UI、Harbor runtime、Lode package body 或 provider routing。 |

## 研究吸收与复用判断

本表记录 2026-06-30 执行线程读取的 issue locator 及落点。

| locator | 判断 | 理由 | 落点 |
|---|---|---|---|
| `WebEnvoy/ROADMAP.md` | 吸收 | 阶段二明确要求最小统一协议，且 Core 只拥有 task/run/result/evidence/action request 公共骨架。 | 本 ADR 的统一入口、Task Intent 和 Run lifecycle v0。 |
| `docs/adr/0002-run-task-capability-model.md` | 吸收 | 已固定 Core 任务路径、能力准入、资源匹配和跨仓 refs 边界。 | Task Intent Envelope 的 `capability_ref`、`resource_requirement_refs`、共享入口边界。 |
| `docs/adr/0003-result-envelope-and-run-record.md` | 裁剪复用 | 已有 Run Record / Result Envelope 边界，但历史 `accepted` 状态过粗；本 ADR 裁剪为 `pending` / `admitted`。 | Run 状态词表和 Run Record 创建规则。 |
| `research/synthesis.md` | 吸收 | 综合结论已把 runtime facts 与 task policy 拆开，并把 Run Record / evidence 作为跨主题公共边界。 | Core/Harbor/Lode/App ownership 与 refs-only 规则。 |
| `research/absorability/README.md` | 只参考 | 该文件定义研究目录分层，不提供具体合同字段。 | 研究证据引用方式，不进入运行合同字段。 |
| `research/absorability/themes/task-execution-and-admission.md` | 裁剪复用 | 吸收 Syvert public operation admission、resource match、fail-closed 和旧 WebEnvoy risk gate 机制；裁剪 BrowserUse/Skyvern 全量 loop/status 体系；拒绝把 Skill 文案或通用 agent loop 当安全边界。 | Task Intent 字段族、准入失败分类、Run 状态最小集。 |
| `research/absorability/themes/api-cli-mcp-and-agent-interface.md` | 裁剪复用 | 吸收 Syvert CLI/HTTP 共用路径、旧 WebEnvoy CLI envelope、BrowserSkill/BrowserMCP 的轻量协议参考；拒绝 CDP/Profile API、全量 DevTools/MCP、execute JS/debugger 作为正式任务入口。 | App/API/CLI/MCP/SDK 共享语义边界。 |

## 后果

App、API、CLI、MCP 和 SDK 可以共享同一套任务请求、运行状态和失败语义。准入失败不再散落在入口层，只要请求已形成可信 Task Intent，就会进入 Run Record 供展示、审计和恢复判断。

早期实现仍可以很小：只需实现 envelope validation、Run Record 状态推进和结构化失败；完整 Schema、OpenAPI、SDK 生成、runtime adapter、队列、重试、真实写入和 evidence retention 仍是后续工作。

## 非目标

- 不新增代码骨架、API route、runtime executor、SDK、MCP server 或 CLI 实现。
- 不定义最终 JSON Schema、OpenAPI、数据库表或状态迁移代码。
- 不开放真实写入、完整审批 UI、完整 evidence policy 或跨仓 Harbor/Lode/App 字段清单。
- 不把低层浏览器工具、CDP、Profile API、execute JavaScript 或 debugger 暴露成正式任务入口。

