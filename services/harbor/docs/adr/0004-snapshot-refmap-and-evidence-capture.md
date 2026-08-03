# 0004. Snapshot、RefMap 与证据捕获

## 状态

草案，2026-06-29。

## 背景

WebEnvoy 需要为 Agent 提供低噪音浏览器上下文、为失败恢复提供可引用证据，并为真实账号保留隐私边界。Research 已收敛到 Snapshot/RefMap 风格的页面观察，但现有草稿也提醒 Harbor 不应定义业务结果 schema，默认也不应暴露敏感 runtime material。

这个边界需要让 Harbor 捕获 runtime evidence，同时由 Core 拥有 Run Records，由 Lode 拥有站点能力输出。

## 决策

Harbor 拥有绑定到 Runtime Session 的 runtime capture primitives 和 evidence references。Core 通过 `evidence_policy` 请求 capture，并把 Harbor refs 写入自己的 Run Record。Lode 通过自己的 capability contracts 输出站点业务数据。

Harbor 可以产出这些 refs：

- `snapshot_ref`：页面观察 artifact，例如 DOM、AX tree、semantic text、simplified HTML 或 provider-native snapshot metadata。
- `refmap_ref`：为特定 snapshot/page/frame generation 生成的元素引用，带 locator fallbacks 和 expiry semantics。
- `screenshot_ref`：evidence policy 允许时的截图证据。
- `network_summary_ref`：脱敏 request/response summary，默认不是完整 bodies。
- `console_log_ref`：脱敏 console/error summary。
- `trace_ref`：显式开启时的 browser trace、HAR、video 或 replay artifact。
- `raw_payload_ref`：policy 允许本地保存时的 raw page 或 provider payload reference。
- `source_trace`：连接 observation、provider、session、page/frame、capture method 和 time 的 provenance。
- `diagnostic_ref`：runtime health 或 failure diagnostic evidence。

Snapshot 和 RefMap 是页面观察与操作上下文。它们不是 normalized results、collection item schemas、comment schemas、dataset records 或公共站点业务字段。

RefMap refs 绑定到 session、page/frame、snapshot generation 和 navigation state。Harbor 可以在 ref 仍有效时解析它，也可以返回 stale-ref error，或要求重新 snapshot。RefMap 不保证跨站点版本稳定的业务 locator。

Evidence capture 受 policy 控制。默认应最小化并脱敏：

- 除非显式允许，不持久保存 cookies、tokens、credentials、完整 storage、完整 DOM、完整 request/response bodies、完整 screenshots、video、HAR 或 trace。
- 记录 redaction status、capture time、provider/session/profile refs、local/remote storage location、retention policy 和 provenance。
- 除非明确 policy 允许 export，否则 sensitive evidence 保持本地。

Harbor Resource Trace 应把 acquire、release、invalidate、health 和 failure events 连接到 evidence refs。Core 可以引用这些 refs，但不应复制 Harbor 的完整 evidence store。

## 影响

Harbor 可以支持 Snapshot/RefMap、screenshots、console/network summaries、traces 和 diagnostics，而不接管 Core Run Record 或 Lode result schema。

Evidence 成本和隐私风险通过 `evidence_policy` 保持可见，而不是隐藏在 driver defaults 里。

RefMap 可以服务 action execution 和 authoring，但仍被视为临时 runtime context。

## 备选方案

- 默认保存完整 screenshots、DOM、HAR、trace 和 video：拒绝，因为真实浏览器账号经常暴露隐私数据。
- 把 Snapshot 或 RefMap 当作业务结果：拒绝，因为页面观察不等于 Lode capability output。
- 让每个 Core capability 直接捕获 browser evidence：基于 Harbor 边界拒绝，因为 capture、redaction、storage 和 provider 细节离 runtime session 最近。
- 把短生命周期 ring buffers 当作 Evidence Store：拒绝，因为 debugging buffers 不够 durable、redacted，也不够适合作为 Run Records 的引用。
- 在这里定义 Core result envelope 或 Lode package schema：拒绝，因为本 ADR 只决定 Harbor runtime boundaries。

## 研究证据

- [docs/draft/evidence-store.md](../draft/evidence-store.md) 说明 Harbor 提供 `raw_payload_ref`、`evidence_ref`、`snapshot_ref`、`network_summary_ref`、`screenshot_ref` 和 `source_trace` 等 refs，但不提供 normalized results 或站点业务 schemas。
- [docs/draft/runtime-capability-facts.md](../draft/runtime-capability-facts.md) 将 Snapshot、network summary、logs、screenshot、handoff 和 evidence policy 定义为 session/evidence facts。
- [execution-space-and-context.md](https://github.com/WebEnvoy/research/blob/main/absorability/themes/execution-space-and-context.md) 显示多个项目收敛到 snapshot/ref/index/uid models，用于低噪音页面上下文和元素引用。
- [execution-space-and-context.md](https://github.com/WebEnvoy/research/blob/main/absorability/themes/execution-space-and-context.md) 拒绝把 snapshots、browser primitives 或 Playwright locators 当作稳定业务结果 schemas。
- [evidence-and-observability.md](https://github.com/WebEnvoy/research/blob/main/absorability/themes/evidence-and-observability.md) 认为 screenshot、trace、HAR、video、console 和 network capture 是有价值证据，但警告不要默认持久化敏感 artifacts。
- [synthesis.md](https://github.com/WebEnvoy/research/blob/main/synthesis.md) 接受 Snapshot/RefMap 作为产品方向，同时把精确 contract 留给 Harbor/Core 后续规格。

## 未决问题

- [PD-0013](pending-decisions.md#pd-0013)：第一版 Snapshot/RefMap contract 应是 AX-first、DOM-first、semantic text，还是 provider-native？
- [PD-0014](pending-decisions.md#pd-0014)：第一版 Harbor API 必须包含哪些 evidence refs？
- [PD-0015](pending-decisions.md#pd-0015)：本地 evidence 的默认 retention 和 encryption 规则是什么？
- [PD-0016](pending-decisions.md#pd-0016)：Playwright trace/HAR/video 应在什么情况下开启，由谁请求？
- [PD-0017](pending-decisions.md#pd-0017)：stale RefMap failures 应如何表达，才能让 Core 安全 retry 或 resnapshot？
