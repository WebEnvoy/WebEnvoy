# 0005. Runtime Session lifecycle v0

## 状态

Accepted for Stage 2 docs-only contract, 2026-06-30.

## 背景

Stage 2 FR #36 要把受控浏览器 Runtime Session 的引用、生命周期、可用性和恢复边界冻结为 Core/App 可消费的最小合同。#37 覆盖 `runtime_session_ref` 与 lifecycle，#38 覆盖 status/error/lease，#39 覆盖 continuity 与 unavailable 分类。

本 ADR 只定义事实合同，不实现 runtime provider、API schema、浏览器骨架或 hosted runtime。

## v0 合同

| 字段或状态 | Harbor owner | Consumer | 有效性 / 过期规则 | 失败分类 | 非目标 |
|---|---|---|---|---|---|
| `runtime_session_ref` | Harbor Session Manager | Core、App、Agent/CLI | 不透明、不可猜测、只引用 Harbor 持有的 session record；必须绑定 provider/profile/identity refs、created_at、last_seen_at 和 current status；不能包含 CDP URL、viewer URL、cookie、token、profile path 或 provider secret。 | `session_not_found`、`expired`、`provider_unavailable` | 不作为 Core Run ID、任务结果 ID 或 provider native session id 的公开替代。 |
| `session_owner` | Harbor | Core、App | 记录 `harbor`, `user`, `provider` 或 `handoff`；owner 改变必须生成 session event。 | `owner_unknown`、`locked` | 不决定业务权限；用户授权和任务准入由 App/Core 处理。 |
| `lifecycle_state` | Harbor | Core、App | v0 枚举：`starting`、`active`、`idle`、`locked`、`disconnected`、`expired`、`failed`、`closed`。`closed` 为终态；`failed` 只有新 session 或 recovery 成功后才能离开。 | `launch_failed`、`disconnected`、`expired`、`locked`、`unsupported` | 不表达任务步骤、业务成功、业务失败或 Lode capability 状态。 |
| `lease_ref` | Harbor | Core | 表达 runtime 资源占用，绑定 holder、purpose、expires_at、renewed_at 和 release reason；过期后 Core 必须重新 acquire 或按 policy 停止。 | `lease_expired`、`lease_conflict`、`lease_release_failed` | 不保存租约持有方的私有 token；不替代 OS/process lock。 |
| `current_error` | Harbor | Core、App | 只保留当前 blocking error 和可选 last_error ref；分类稳定，详情走 diagnostic/evidence refs。 | 见“错误与 unavailable 分类”。 | 不把 provider stack trace、raw logs 或敏感 payload 作为公共字段。 |
| `continuity_key` | Harbor | Core | 同一 run 内判断 continuity 的最小事实：同一 `runtime_session_ref`、同一 `profile_ref`、同一 `identity_ref`、未发生 `closed`/`failed` 终态且 lease 未被其他 owner 接管。 | `continuity_lost`、`owner_changed`、`profile_changed` | 不保证页面业务状态未变；页面状态仍由 Snapshot/RefMap/Evidence refs 证明。 |
| viewer/CDP/evidence availability | Harbor | Core、App | 只暴露 capability/ref availability：`available`、`unavailable`、`policy_denied`、`unsupported`；raw endpoints 仍受 Harbor 控制。 | `viewer_unavailable`、`cdp_unavailable`、`evidence_policy_denied` | 不把 raw CDP/VNC URL 当公共 API；不默认采集高敏 evidence。 |

## 状态与 lease 规则

| 状态 | 进入条件 | 可离开到 | Core/App 处理边界 |
|---|---|---|---|
| `starting` | provider launch/connect 已被 Harbor 接受但健康检查未完成。 | `active`、`failed`、`closed` | Core 不应执行 mutating action；App 可显示启动中。 |
| `active` | provider、Profile、automation channel 至少一个可用，lease 有效。 | `idle`、`locked`、`disconnected`、`expired`、`failed`、`closed` | Core 可按 admission/policy 使用；Harbor 仍只提供 runtime facts。 |
| `idle` | session 可复用但当前无 active holder 或 automation activity。 | `active`、`expired`、`closed` | Core 需要 acquire/renew lease 后再使用。 |
| `locked` | 用户接管、handoff、provider lock 或互斥 lease 阻止自动化。 | `active`、`idle`、`closed` | App/Core 可请求 takeover/release；Harbor 不自动抢回用户控制。 |
| `disconnected` | CDP/viewer/provider transport 断开，但 Harbor 仍可能恢复同一 session。 | `active`、`failed`、`expired`、`closed` | Core 应暂停 action；可按 retry policy 等待 recovery。 |
| `expired` | lease/TTL 到期或 provider 回收 session。 | `closed`、新 `starting` | Core 必须重新 acquire；不得继续复用旧 ref 执行动作。 |
| `failed` | launch、health、provider、profile 或 unsupported error 阻断 session。 | `closed`、新 `starting` | Core 记录 runtime unavailable，不写成业务失败。 |
| `closed` | Harbor 或 provider 完成 release/stop，或终态 closeout。 | 无 | 旧 ref 只可用于证据和审计引用，不可再执行。 |

Lease v0 只需要表达“谁持有、为何持有、何时过期、是否可续租、为何释放”。并发、公平排队、跨机器锁和长期租约调度保留到 implementation/schema 阶段。

## 错误与 unavailable 分类

| 分类 | 含义 | 边界 |
|---|---|---|
| `launch_failed` | provider 启动或连接失败。 | 可 retry；如果 provider 不支持所需 mode，改报 `unsupported`。 |
| `disconnected` | transport 断开或 heartbeat 丢失。 | 可 recovery；恢复后 continuity 只有在 continuity_key 未变时成立。 |
| `expired` | lease、TTL 或 provider session 已过期。 | 不 retry 旧 ref；必须重新 acquire。 |
| `locked` | 当前 owner 或 handoff 状态阻止自动化。 | App/Core 可 request takeover；Harbor 不绕过用户控制。 |
| `unsupported` | provider 不支持所需 capability、mode、viewer、CDP 或 evidence。 | 不 retry 同一配置；需要换 provider/mode 或降低 requirement。 |
| `policy_denied` | evidence、viewer、user-owned profile 或 sensitive state 被 policy 拒绝。 | 不等同 provider failure；需要用户/策略调整。 |
| `recovery_required` | session 可恢复但需要 Harbor 执行 reconnect/resume/health check。 | Core 暂停动作；恢复失败后转 `failed` 或 `expired`。 |

## Continuity、retry、takeover、recovery

- Continuity 成立：同一 `runtime_session_ref` 仍存在，`profile_ref`/`identity_ref` 未变，lease 未被其他 owner 替换，状态未进入 `closed` 或不可恢复 `failed`。
- Retry 适用：`launch_failed`、`disconnected`、`recovery_required` 且 requirement 未被 `unsupported` 否定。
- Takeover 适用：`locked`、`owner_changed`、handoff 或用户控制场景；必须记录 owner transition，不能静默恢复自动化。
- Recovery 适用：transport/provider 可重连且 session record 未过期；恢复后必须刷新 `last_seen_at` 和 availability facts。
- Unavailable 不等于业务失败。Harbor 只说明 runtime 不可用、可重试、需接管或不可支持；Core 决定 run outcome。

## 研究吸收 / 复用判断

| locator | 判断 | 理由 | 落点 |
|---|---|---|---|
| `Harbor/ROADMAP.md` | 吸收 | Stage 2 明确要求最小 runtime facts、session refs、viewer/evidence refs；本 ADR 只冻结合同，不提前实现 provider。 | 本 ADR v0 合同与非目标。 |
| `docs/adr/pending-decisions.md` | 裁剪复用 | 已接受 Runtime Session facts 归属；PD-0003/0004/0010/0011 仍保留 schema、health、handoff、remote TTL 细节，不阻塞本 v0 docs-only 合同。 | 本 ADR 表格；待决策继续留在 pending index。 |
| `research/synthesis.md` | 吸收 | 已接受 runtime facts 与 task policy 拆开、Run Record/evidence 为跨仓边界；本 ADR 将 unavailable 分类限制为 Harbor runtime facts。 | `current_error`、unavailable 与 Core outcome 边界。 |
| `research/absorability/README.md` | 只参考 | 该文件定义 research 分层，不提供字段语义；本 PR 遵循其“不替代产品规格”的边界。 | 研究吸收表。 |
| `research/absorability/Harbor/runtime-provider-profile-viewer.md` | 吸收 | 已收敛 Runtime Session 最小字段、viewer/CDP refs、Profile Runtime 不应只依赖内存 RunningProfile。 | `runtime_session_ref`、availability、continuity_key。 |
| `research/absorability/themes/browser-identity-and-runtime.md` | 裁剪复用 | 吸收 Profile/Runtime Session/provider mode 分层和 TTL/profile lock 参考；拒绝把外部 Profile Browser 或 agent session 直接作为 WebEnvoy Runtime Session。 | lifecycle、lease、unsupported/policy 边界。 |
| `research/subjects/CloakHQ/CloakBrowser/wiki/index.md` | 只参考 | 该 locator 证明 CloakBrowser wiki 已完整捕获；本 PR 不做 provider adoption、源码复用、binary/license 或 runtime smoke。 | 非目标；provider 细节留给后续 evaluation。 |

## 非目标

- 不新增 runtime/provider 代码、API schema、OpenAPI、database schema、browser skeleton 或 hosted runtime。
- 不定义 Core Run Record、business outcome、Lode capability schema 或 App UI state。
- 不关闭 #36/#37/#38/#39，不把 PR merge-ready 或 issue closeout 伪装成 docs 合同完成。
