# 0007. Page scene reference facts v0

## 状态

Accepted for Stage 2 docs-only contract, 2026-06-30.

## 背景

Stage 2 issue #44 要冻结 `snapshot_ref`、`refmap_ref` 和 `source_trace`。Issue #48 要冻结 `evidence_ref`。Issue #53 要冻结 Viewer 与 Handoff facts。#45/#46/#47/#49/#50/#51/#52 是这些 FR 的 Work Items。

本 ADR 只定义 docs-only 合同，不实现 runtime/provider/browser/viewer 代码、API schema、storage schema、真实浏览器 smoke、真实 evidence capture 或 App UI。

## Page scene refs

| 字段或状态 | Harbor owner | Consumer | 有效性 / source binding | 失败分类 | 非目标 |
|---|---|---|---|---|---|
| `snapshot_ref` | Harbor Snapshot Capture | Core、App、Lode authoring | 不透明 ref，绑定 `runtime_session_ref`、`profile_ref`、可选 `execution_identity_ref`、page/frame、navigation generation、capture method、captured_at、redaction state 和 `source_trace`；导航、frame detach、session loss、policy revoke 或 retention 删除后只能作为历史证据。 | `snapshot_missing`、`snapshot_stale`、`capture_denied`、`source_unavailable` | 不保存或暴露完整 DOM、完整页面截图、cookies、tokens、storage、业务结果或 Lode schema。 |
| `refmap_ref` | Harbor RefMap Capture | Core action context、Lode authoring、App debug | 绑定同一 `snapshot_ref`、page/frame、navigation generation、locator fallback set 和 expiry rule；只在绑定 session/page/generation 未变且 element resolution 仍可验证时有效。 | `refmap_missing`、`refmap_stale`、`selector_unstable`、`source_unavailable` | 不保证跨站点版本稳定，不作为业务 locator，不替代 Playwright/DOM/provider native id 的公共 schema。 |
| `source_trace` | Harbor Evidence / Diagnostics | Core Run Record refs、App evidence view、debug/closeout | 记录 observation id、provider/profile/session/page/frame refs、capture method、capture time、policy/ref producer、redaction status 和 upstream source locators；任何 ref 缺失时仍应能说明缺失源。 | `source_missing`、`source_stale`、`source_unavailable`、`capture_denied` | 不包含 raw payload、secret、raw CDP/VNC URL、provider stack trace 或未脱敏日志。 |
| `evidence_ref` | Harbor Evidence Store | Core Run Record、App evidence display、debug/closeout | 绑定 evidence type、`source_trace`、runtime/session/page/frame refs、captured_at、redaction state、retention policy、storage scope、access policy 和 expires_at；过期、policy revoke 或 redaction failure 后不可解引用。 | `evidence_missing`、`evidence_expired`、`evidence_redacted`、`capture_denied`、`source_unavailable` | Core 不复制完整 Harbor evidence store；App 不获得 raw sensitive material；Lode 不把 evidence 当业务 result。 |

## Capture source choice

| Source | v0 判断 | 进入 Harbor 的事实 | 不进入 v0 / deferred |
|---|---|---|---|
| AX tree | 默认首选 | 用于低噪音 snapshot、可交互元素候选、ref labels、role/name/state 和 token-efficient context。 | 不保证覆盖所有 hidden、canvas、shadow DOM 或 custom widget 语义。 |
| DOM / simplified HTML | 裁剪复用 | 作为 AX 不足时的 locator fallback、frame/shadow DOM/context hints 和 debug source；只以 ref 或 redacted artifact 表达。 | 不默认持久保存完整 DOM，不把 DOM schema 给 Core/Lode 当业务合同。 |
| Semantic text | 派生事实 | 从 AX/DOM/provider output 派生的可读摘要，必须绑定 `source_trace` 和 source method。 | 不作为唯一 truth；不能覆盖原始 source binding。 |
| Provider-native snapshot metadata | 只参考 / adapter-local | 可记录 provider source id、capability、limits 和 validation evidence ref。 | 不把 provider-native payload、node id、launch flag 或 private endpoint 变成 Harbor 公共 schema。 |
| Screenshot / vision | policy-enabled optional | 只在 evidence policy 允许时生成 `evidence_ref`，带 redaction/retention/source binding。 | 不作为 v0 默认 snapshot source，不默认保存完整截图。 |

## Failure classification

| 分类 | 含义 | Core/App 处理边界 |
|---|---|---|
| `stale` / `snapshot_stale` / `refmap_stale` | session/page/frame/navigation generation 或 capture source 已变，旧 ref 不再适合执行。 | Core 重新请求 snapshot/refmap；不得继续用旧 ref 执行动作。 |
| `missing` / `snapshot_missing` / `refmap_missing` / `evidence_missing` | Harbor 没有对应 ref 或 ref 从未成功生成。 | Core/App 展示缺失并请求捕获；不推断业务失败。 |
| `capture_denied` | evidence policy、user authorization、profile ownership 或 privacy rule 拒绝捕获。 | 需要用户/策略调整；不重试同一 capture。 |
| `source_unavailable` / `source_missing` | provider/session/page/frame/source_trace 不可读或未绑定。 | Core 暂停消费；Harbor 先修 runtime/source binding。 |
| `selector_unstable` | locator fallback 无法稳定解析或同一 ref 指向多个候选。 | Core 重新 snapshot 或降级为人工/authoring path；不得静默点击。 |
| `redacted` / `evidence_redacted` | evidence 存在但敏感部分已脱敏或不可显示。 | App 可展示 redaction 状态；Core 只保存 ref。 |
| `expired` / `evidence_expired` | retention/TTL 已删除或 ref 不再可解引用。 | 只能保留历史 locator；不能要求 Harbor 还原 raw evidence。 |

## Evidence refs v0

| Evidence type | v0 默认 | Redaction | Retention | Source binding |
|---|---|---|---|---|
| `snapshot` | 默认允许 ref | 去除 secret、token、credential、full storage、raw DOM body；保留 redaction status。 | 绑定 session/run policy；过期后只留 locator metadata。 | 必须绑定 `snapshot_ref` 和 `source_trace`。 |
| `refmap` | 默认允许 ref | 不暴露 raw backend node id 作为公共字段；fallback locator 可脱敏。 | 与 `snapshot_ref` 同步过期。 | 必须绑定 `refmap_ref`、page/frame/generation。 |
| `source_trace` | 默认允许 metadata | 不含 raw endpoint、secret、stack trace、full logs。 | 可长期保留为 audit metadata。 | 绑定 provider/profile/session/page/frame/capture method。 |
| `screenshot` | policy-enabled optional | 默认脱敏或本地-only；完整截图需要显式 policy。 | 短期或 policy-defined；export 需要显式允许。 | 绑定 page/frame/captured_at 和 source_trace。 |
| `console_summary` / `network_summary` | policy-enabled optional | header/body/token/cookie 默认移除或摘要化。 | 短期或 policy-defined。 | 绑定 request/log source 和 source_trace。 |
| `diagnostic` | policy-enabled optional | 本地路径、proxy、secret、raw logs 必须脱敏。 | 按 diagnostic policy。 | 绑定 runtime error/source_trace。 |
| `trace` / `HAR` / `video` / `raw_payload` | 默认拒绝进入 MVP | 只有显式 high-sensitivity policy 才能生成 ref。 | 明确 TTL、local-only/export policy 和 deletion rule。 | 需要独立 evidence policy；不由本 v0 默认开启。 |

## Viewer and handoff facts v0

| 字段或状态 | Harbor owner | Consumer | 有效性 / source binding | 失败分类 | 非目标 |
|---|---|---|---|---|---|
| `viewer_ref` | Harbor Runtime Session / Viewer adapter | App Browser/Viewer、Core refs | 不透明 ref，绑定 `runtime_session_ref`、transport、access boundary、created_at、expires_at、provider limits 和 current availability；raw VNC/CDP/ws endpoint 不进入公共合同。 | `viewer_unavailable`、`permission_denied`、`expired`、`unsupported` | 不实现 viewer UI，不保证完整 remote browser product，不裸露内部 endpoint。 |
| `viewer_access` | Harbor + App authorization | App、Core | v0 状态：`available`、`read_only`、`interactive`、`input_disabled`、`permission_denied`、`expired`、`unsupported`；状态变化必须可追溯到 session/source_trace。 | `permission_denied`、`viewer_unavailable`、`policy_denied` | 不决定用户产品权限；App 承接授权 UI。 |
| `input_capability` | Harbor Viewer adapter | App、Core policy | v0 枚举：`none`、`keyboard_mouse`、`clipboard`、`file_upload`、`download_view`，每项独立 policy gated。 | `input_disabled`、`capability_missing`、`policy_denied` | 不默认允许剪贴板、文件选择或下载访问。 |
| `control_owner` | Harbor Runtime Session | Core、App | v0 枚举：`agent`、`user`、`app`、`provider`、`none`、`unknown`；owner 变化必须记录 reason、time 和 previous owner。 | `control_owner_unknown`、`control_lost`、`locked` | 不让 Harbor 判断任务 outcome；Core/App 决定 pause/resume/reconcile。 |
| `handoff_reason` / `takeover_reason` | Core/App request, Harbor records runtime fact | Core、App、用户 | v0 reason：`login_required`、`captcha_required`、`policy_requires_user`、`user_requested`、`automation_blocked`、`viewer_only`、`control_lost`、`provider_limit`、`unknown_outcome_risk`。 | `handoff_required`、`takeover_denied`、`control_lost` | 不定义完整 handoff state machine；PD-0010 仍承接 pause/lock 细节。 |

## Ownership and consumption boundary

| 进入 Harbor | 不进入 Harbor | Core / App / Lode 消费 |
|---|---|---|
| runtime-bound refs、source_trace、capture method、redaction/retention metadata、viewer/control facts、failure classification。 | Core Run Record、business outcome、Lode capability schema、App UI state、raw credentials、cookies、tokens、full storage、raw CDP/VNC URL、provider private node ids。 | Core 保存 refs 并决定 admission/run outcome；App 展示 refs、viewer、authorization 和 handoff UI；Lode 声明 runtime requirements 和 authoring context，不保存 Harbor private state。 |

## 研究吸收 / 复用判断

| locator | 判断 | 理由 | 落点 |
|---|---|---|---|
| `Harbor/ROADMAP.md` | 吸收 | Stage 2 明确要求最小 runtime facts、snapshot/evidence/viewer refs 和 Core/App 可消费合同。 | 全部 v0 表格和非目标。 |
| `docs/adr/pending-decisions.md` | 裁剪复用 | PD-0013/0014/0015/0016/0017 的 v0 结论在本 ADR 固定；API schema、storage encryption 和 runtime state machine 仍 deferred。 | Capture source、Evidence refs、Failure classification。 |
| ADR 0004 | 吸收 | 已定义 Snapshot/RefMap/Evidence/source_trace 归 Harbor，且默认最小化和脱敏。 | Page scene refs、Evidence refs。 |
| ADR 0005 | 吸收 | `runtime_session_ref`、lease、continuity、viewer/evidence availability 是所有 refs 的 source binding 前提。 | Source binding 和 viewer/control facts。 |
| ADR 0006 | 吸收 | provider/profile/identity facts 不能泄漏 secrets/profile data，provider claim 不能升级为 observed fact。 | source_trace 和 provider-native 边界。 |
| `research/synthesis.md` | 吸收 | 已接受低噪音页面上下文、runtime facts 与 task policy 拆分、Run Record/evidence 跨仓边界。 | Harbor/Core/App/Lode 消费边界。 |
| `research/absorability/README.md` | 只参考 | 该文件定义 research 分层，不提供字段语义；本 ADR 承接为正式 Harbor 合同。 | 研究吸收表。 |
| `research/absorability/themes/execution-space-and-context.md` | 裁剪复用 | 吸收 Snapshot/RefMap/indexed element/locator fallback 机制；拒绝通用 browser tools、eval 或 agent loop 作为正式任务合同。 | Capture source、RefMap 失效、非目标。 |
| `research/absorability/themes/evidence-and-observability.md` | 吸收 | 吸收 evidence refs、redaction、retention、network/console/trace policy；拒绝 ring buffer、raw body、默认 trace/HAR/video。 | Evidence refs v0。 |
| `research/absorability/themes/human-handoff-and-recovery.md` | 吸收 | 吸收 viewer ref、control owner、handoff/takeover reason；拒绝把 live viewer 当完整恢复。 | Viewer and handoff facts。 |
| `research/subjects/CloakHQ/CloakBrowser-Manager/wiki/index.md` | 只参考 | 证明 Manager viewer/runtime wiki 已捕获；本 PR 不迁入 Manager、VNC proxy、frontend UI 或 runtime code。 | Viewer non-goals。 |
| `sources/CloakHQ/CloakBrowser-Manager` | 裁剪复用 | 只吸收 Profile Runtime、viewer/VNC、CDP proxy 和 port/access isolation 机制；不整体迁入 backend/frontend、RunningProfile 或 provider lifecycle。 | viewer_ref/access boundary。 |
| BrowserSkill / ego-lite / Playwright CLI dashboard | 裁剪复用 | 吸收 explicit control ownership、borrow/takeover、dashboard takeover 的状态事实；拒绝自动抢回用户控制或把 dashboard 当 recovery。 | `control_owner`、handoff/takeover reason。 |
| hosted browser / vault / persona / external UI shell | 拒绝进入 MVP | secret、payment、persona、hosted runtime 和外部 shell 范围过宽。 | 非目标和 deferred 边界。 |

## Deferred 决策

- API/OpenAPI/schema、database schema、storage encryption implementation、provider adapter code、browser smoke 和 real runtime evidence 留给后续 Work Items。
- PD-0010 仍承接 handoff 期间 pause/lock automation 的详细状态机。
- PD-0012 仍承接本地窗口、noVNC-style remote viewer 或两者的实现顺序。
- `trace`、`HAR`、`video` 和 `raw_payload` 可以作为显式 high-sensitivity policy 后续扩展，不能由本 v0 默认开启。

## 非目标

- 不新增 runtime/provider/browser/viewer code、API schema、storage schema、browser smoke、真实 evidence capture、hosted runtime、marketplace 或完整入口产品。
- 不关闭 #44/#45/#46/#47/#48/#49/#50/#51/#52/#53，不 merge。
- 不把页面现场引用、Snapshot、RefMap、evidence 或 viewer/handoff facts 写成业务结果、Core Run Record、Lode capability schema 或 App UI truth。
