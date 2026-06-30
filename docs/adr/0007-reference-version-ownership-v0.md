# 0007. 引用和版本归属合同 v0

## 状态

Accepted for Stage 2 docs-only contract, 2026-06-30.

## 背景

Core 的 Run Record 需要说明一次运行引用了哪个 Lode 能力版本、哪个 Harbor 运行现场、哪些证据和来源追踪，但不能复制上游私有事实。Stage 2 的目标是把引用、版本和失效语义压成公共合同，让 App、API、CLI、MCP 和 SDK 查询同一种运行事实。

本 ADR 覆盖 Core #41、#42 和 #43。它只定义 v0 合同和失败映射，不创建 JSON Schema、API、存储或 runtime 实现。

## 引用绑定合同

| 引用/字段族 | owner | Core 记录内容 | 有效性/过期规则 | 失败分类 | 非目标 |
|---|---|---|---|---|---|
| `capability_ref` | Lode | 能力 id、能力版本、包引用、生命周期摘要和 output/input/resource 合同版本。 | 必须在 admission 时解析为 Lode stable 或允许的 preview；若版本缺失、失效或和请求不兼容，接受前失败。 | `capability_not_found`、`capability_version_incompatible`、`capability_invalidated`、`invalid_contract`。 | Core 不复制 package body、站点知识、fixture 或 authoring draft。 |
| `package_ref` / `package_version_ref` | Lode | 包 id、版本、lock 摘要和引用到的 schema/resource/post-check 版本。 | Run Record 保留运行时使用的版本快照引用；后续 Lode 更新不得改写历史 run。 | `package_not_found`、`package_version_unavailable`、`package_lock_mismatch`。 | 不实现 registry、installer、marketplace 或 package storage。 |
| `runtime_session_ref` | Harbor | session id/ref、provider family、健康摘要、绑定时间和可安全展示的状态。 | admission 只能消费 Harbor 当前 runtime facts；accepted 后历史 Run Record 保留绑定引用，不复制 session 内部状态。 | `runtime_ref_missing`、`runtime_session_unavailable`、`runtime_ref_expired`。 | Core 不拥有 browser process、CDP/VNC URL、profile storage、cookie/token 或 provider driver。 |
| `profile_ref` / `execution_identity_ref` | Harbor | profile / execution identity 的稳定公共引用和脱敏摘要。 | 只表达“本 run 绑定了哪个公开引用”；身份可用性仍由 Harbor runtime facts 判定。 | `identity_unavailable`、`profile_unavailable`、`unauthorized_runtime`。 | Core 不保存真实账号、cookie、token、persona 或 profile data。 |
| `evidence_ref` | Harbor 或证据生产方；Core 只记录引用。 | evidence id/ref、type、producer、redaction 状态、retention hint 和 source binding。 | evidence 可过期、脱敏或不可访问；Run Record 必须区分 missing、expired、access denied 和 redacted。 | `evidence_missing`、`evidence_expired`、`evidence_access_denied`、`evidence_redacted`。 | Core 不内联截图、视频、HAR、DOM、network body、本地路径或未脱敏页面现场。 |
| `source_trace_ref` / `resource_trace_ref` | Harbor / Lode / Core 运行事件按来源分工。 | 来源追踪引用、资源匹配摘要和失败定位引用。 | trace 只用于复盘和能力修复；不能作为成功结果的唯一依据。 | `source_trace_unavailable`、`resource_trace_unavailable`、`resource_mismatch`。 | 不默认保存完整 browser/agent history、prompt、LLM response 或逐步截图序列。 |
| `entrypoint_ref` / `caller_ref` | Core/API Server。 | 调用入口、调用方类别、请求摘要和权限/策略摘要。 | 接受前必须可脱敏记录；不能把 App UI 草稿或本地缓存当作 Core truth。 | `caller_unauthorized`、`entrypoint_unsupported`、`request_snapshot_invalid`。 | 不保存 App UI 状态、用户草稿或本地-only 设置。 |
| `run_record_ref` / `result_ref` | Core。 | Core durable run id、result envelope ref、终态和查询引用。 | `accepted` 后单调推进；终态不因后续观察被随意覆盖。 | `run_not_found`、`result_unavailable`、`result_expired`。 | Core 不成为业务数据仓库或证据存储。 |

## 引用失败映射

| 条件 | 发生阶段 | Result / Run 表达 | recovery hint | 用户/系统动作 |
|---|---|---|---|---|
| Lode capability/package ref 找不到 | pre-admission | 不创建 Run Record；返回 `capability_not_found` 或 `package_not_found`。 | 选择已安装能力或刷新 Library。 | App/CLI 可提示重新选择能力；Core 不尝试猜测替代能力。 |
| 能力版本失效、锁不匹配或 schema/resource 合同不兼容 | pre-admission | 不创建 Run Record；返回 `capability_version_incompatible`、`capability_invalidated` 或 `invalid_contract`。 | 固定兼容版本或等待能力修复。 | Lode 修复/发布新版本；Core fail-closed。 |
| Harbor runtime/session/profile/identity ref 缺失 | pre-admission | 不创建 Run Record；返回 `runtime_ref_missing`、`profile_unavailable` 或 `identity_unavailable`。 | 选择可用 runtime/profile 或重新连接。 | App 可引导用户打开 Browser/Settings；Harbor 提供新 facts。 |
| runtime 在 accepted 后丢失或过期 | accepted run | Run Record 进入 `failed` 或 `manual_recovery_required`，失败阶段为 `runtime_binding`。 | 重新绑定 runtime、retry 或 handoff。 | Core 不伪装成功；App 显示恢复入口。 |
| evidence ref 缺失 | accepted run 或 query | Result/Run 保留任务终态，同时 evidence 字段标记 `missing`。 | 重新采集或以无证据状态查看结果。 | App 区分“结果存在但证据缺失”。 |
| evidence ref 过期 | query | Run Record 不改写终态；query 返回 `evidence_expired` 状态。 | 重新运行任务或查看可用摘要。 | Core 不恢复已过期 evidence；Harbor/App 负责提示。 |
| evidence 被脱敏或无权限访问 | query | `redacted` 或 `access_denied`，不得暴露原始材料。 | 请求权限或查看脱敏摘要。 | 不绕过 Harbor/App policy。 |
| source/resource trace 不可用 | accepted run 或 query | 结果可以存在，但修复/复盘字段显示 `source_trace_unavailable` 或 `resource_trace_unavailable`。 | 重新运行并启用更强证据策略。 | 不把 trace 缺失当作业务成功证据。 |
| caller/entrypoint 不支持或无权限 | pre-admission | 不创建 Run Record；返回 `caller_unauthorized` 或 `entrypoint_unsupported`。 | 使用支持入口或调整权限。 | API/CLI/MCP/SDK/App 共享同一失败语义。 |

## 研究吸收边界

| locator | 判断 | 理由 | 落点 |
|---|---|---|---|
| `docs/adr/0002-run-task-capability-model.md` | 吸收 | 已确定 Core 只消费 Lode/Harbor/App 引用和 facts，不复制上游 truth。 | 本 ADR 的引用绑定合同。 |
| `docs/adr/0003-result-envelope-and-run-record.md` | 吸收 | Run Record 和 Result Envelope 已要求 raw/evidence/source/resource 通过 refs 表达。 | 本 ADR 的引用失败映射。 |
| `research/absorability/themes/result-normalization-and-reconciliation.md` | 裁剪复用 | 吸收 typed error、hint、heavy result by reference 和低噪音结构化结果；不复用外部 adapter schema 或 renderer 源码。 | failure code / recovery hint / ref-over-value 规则。 |
| `research/absorability/themes/evidence-and-observability.md` | 裁剪复用 | 吸收 Run Record baseline、evidence ref、trace by reference 和非 proof policy；拒绝默认保存完整截图、HAR、DOM、prompt 或 agent history。 | evidence/source/resource trace 边界。 |
| `Syvert TaskRecord / old WebEnvoy runtime store` | 裁剪复用 | 运行记录和 risk/evidence gate 有价值，但历史字段过多，Stage 2 只取 run id、状态、引用、failure、hint。 | Run Record ref/failure 最小集。 |
| `OpenCLI typed errors` | 吸收机制，重写实现 | machine-readable code + human hint 适合 Core/CLI 共用，但 WebEnvoy 需要补 evidence/ref/outcome 字段。 | failure code 与 recovery hint。 |
| `bb-browser / js-reverse-mcp outputFile` | 只参考 | 证明大对象应引用而非 inline；正式 evidence owner、retention、redaction 不由这些项目决定。 | evidence/ref-over-value 原则。 |
| 通用 browser agent history / live activity registry | 拒绝进入 MVP | 缺少 capability version、admission、Run Record 和安全证据边界。 | 非目标。 |

## 后果

Core 可以把上游事实稳定地写进 Run Record，而不变成 Harbor evidence store、Lode registry 或 App UI state store。查询方能区分“引用不存在”“引用过期”“无权限”“被脱敏”和“上游事实当前不可用”。

后续 JSON Schema/API 实现必须从本 ADR 派生字段和枚举；若字段名变化，仍不得改变 owner、有效性和失败语义。

## 非目标

- 不创建 JSON Schema、OpenAPI、SDK、CLI、MCP 或 API 实现。
- 不实现 registry、storage、runtime、evidence store、viewer、handoff 或 App UI。
- 不默认保存完整 DOM、HAR、截图、视频、network body、prompt、LLM response、agent history、cookie、token、本地路径或 provider 私有对象。
