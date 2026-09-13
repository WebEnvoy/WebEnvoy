# Page, Document and Navigation Runtime Contract V1

状态：Accepted；版本：1.0；owner：Harbor / Provider Driver（现场）、Core（授权与 Run）。产品归口：[Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497)、[Native tab handoff #510](https://github.com/WebEnvoy/WebEnvoy/issues/510)。依据：[Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md)、[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)。

> **2026-09-12 #519 受限路径**：Page/document/navigation 的公共语义、Page Registry、授权、receipt、失联安全暂停和 observation freshness 继续有效。当前仅允许 owner 核验的官方 Camoufox `0.5.6`／browser `152.0.4-beta.30`／Playwright `1.60.0` 组合接入公开 API Driver；其 popup 首请求若在派发前无法建立可信 Page 归属，必须在任何外部请求前局部返回 `page_relation_unavailable`，不以 URL/title/active/最近新页猜测，也不重放。后续 Page 事件只能记录真实 Page，不能倒推或续发原请求；普通任务页、同 Instance 观察与接管仍可按本合同继续。正式 installed、人工交还、环境连续性和真实 Agent 消费仍待 #519 完成门，不能写成 `live_verified`。#510 Camoufox native tab-handoff 及旧私有 launch binding 继续是 Retired 历史 Provider-private 设计，不是当前路线；不通过 fallback 或 replacement Page 恢复。

## 当前 v1.4 任务页与焦点边界

当前任务页协作遵循 [canonical v1.4 产品架构](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#971-%E4%BB%BB%E5%8A%A1%E9%A1%B5%E4%B8%8E%E5%8E%9F%E7%94%9F%E7%84%A6%E7%82%B9%E5%90%88%E5%90%8C)。任务页 A 是用户或 Agent 本次工作的真实 Page 引用；Viewer 选中的帮助或其他页面 B 属于同一 Instance 的独立现场事实，不得把 B 冒充为 A。任何需要目标页的操作都必须绑定当前有效的 `page_id`/`page_ref` 与适用的 `document_generation`；原生 selected tab/window、OS 前台和 focus 只是可选 Provider 事实，不能反向决定任务目标。

- 原生 tab/window selected、OS 前台和其他 focus 是可选观测。可信的 A 只要求供应方可验证的 Page 归属与新鲜度，不要求完整的全局窗口关系或 OS 前台证明；`page.list`、普通 read、snapshot 和 diagnostics 不得为了补齐可选焦点而激活、切页或抢前台。
- 人类接管 A 后可以观看或操作 B；用户明确交还后，Agent 默认以交还前可信的 A 重新观察，不自动跟随 B，也不要求先证明 A 仍是原生选中标签。A 关闭、失联、替换或出现身份歧义时，只停止依赖 A 的动作，不能凭 URL、标题、内容或创建顺序认领另一页。
- 原生焦点未知但 A 的 Page/document 归属和读取授权仍可信时，可以继续对象级读取或诊断；对象级输入还需 target/actionability、授权和 ControlLease，依赖 OS 窗口、屏幕坐标或原生键盘路由的输入才需可靠窗口与画面对应。只暂停需要不可信 relation／明确选择的相关动作或上下文，不把可选焦点缺失扩大为无关资源的全局失败。
- 现有 `harbor-page-list/v2`、Page facts 的 `active`/selected 投影，以及旧 #510 的后台 open、原生焦点和安全邻页规则，均保留为历史／兼容 wire 语义；#519 复用既有 Page/controller 投影，不新增 task-page wire adapter。原生焦点不可得时必须投影未知/省略，不能把任务页 ID、`false` 或其他占位值填入旧原生 `active` 字段；也不能让 selected/focus 事实覆盖明确的任务页引用。

本文冻结受管 Instance 中 Page、Document 和导航的公共语义。Provider 的 page object、CDP/Juggler handle、window id 和地址不得越过 Harbor 边界。Page list 使用 `harbor-page-list/v2`；现有 `harbor-runtime-diagnostics/v1` 与 controlled-page snapshot 继续使用 document-bound `page_ref` 投影。旧投影只能映射到当前 Page 对象和当前 generation，不能把旧 ref 猜测映射到另一个 Page；未提供明确兼容适配的旧 Runtime/客户端必须报告版本错误，不能静默降级。

## 1. 绑定与生命周期

一个 Runtime Session 对应一个受管 Instance。它维护一个进程内 Page Registry。每个稳定 Page 对象和 document binding 包含：

- `page_id` 是 Page 生命周期内稳定、不透明且不可猜测的对象引用；
- `page_ref` 是绑定 `page_id`、Instance 和当前 `document_generation` 的 document-bound ref；导航、控制代次变化、关系失联和 Runtime 重启都可使它失效；
- `page_id` 与 `page_ref` 都在 close、Instance stop、Driver loss 或 Runtime 重启后永久失效，不能复用；
- 不含 Provider endpoint、CDP id、Profile 路径、URL query、fragment 或凭据。

历史兼容的 Page facts v2 至少包含 `requested_url`、`current_url`、`title`、`status`（`loading`、`ready`、`failed`、`closed`、`unavailable`、`unknown`）、`error_reason`、`observed_at`、`page_id`、当前 `page_ref`、`document_generation`、`origin` 和 `active`；`opener_page_id` 在可确认时才出现。旧 v1 facts 删除 `page_id` 后仍指向同一个当前 document-bound `page_ref`。`opener_page_id` 只能指向同一 Instance 中已存在的 Page；无法确认时省略。Agent `page.open` 不抢焦点，Provider 只在真实 popup/new-tab focus 事实发生时改变 active；网页 popup 记录 opener，不能由 Harbor 伪造焦点。当前任务页 A／Viewer 页 B 的语义以上一节为准，不能从这些旧字段推导全局焦点。

Document generation 从 1 开始。一次 committed navigation（包括 reload、history navigation 和 popup 初始 document）只递增对应 Page；失败且保留旧 document 的导航不递增。公开 Page list 只投影仍然 present 的 live Page，不把 closed tombstone 当作可用 Page。

每个 Instance 维护 active Page 和最近明确使用的 Page 顺序。Page list、observe、diagnostics 是 observation-only，不获得或续租 ControlLease；它们仍须通过当前 Session、授权和完整 Page relation 检查，不能在关系不可信时继续读。open、activate、close 与导航改变现场，必须经过既有 Core Run、ControlLease、idempotency 和可查询 receipt。用户持有同一 Instance 的控制权时，这些改变现场的 Agent 操作返回 `control_lock_conflict`，不得隐式接管；观察也不得借机取得或续租该 Lease。

用户交还后，严格处于 `control_owner=none`、`ControlLease.owner=none`、`state=released` 且无 holder 的 Instance 仍可接受 Core 的新 page facts、`instance.observe` 和 `instance.read`；它们保持 observation-only，不取得或续租输入 Lease。需要改变现场时仍须先以新观察为依据，由同一 Core holder 正常取得 Lease；其他 holder 或期间发生控制变化则使观察失效。

Registry 的 Page facts 是唯一公共事实源。Driver 只保存 Harbor 分配的私有 handle 映射和 provider facts；Driver 不创建或返回另一套 public page identity。只有完整、可信的 Provider list 中 `status: "closed"` 才是原生 Page 已被网页或用户关闭的 close proof。Harbor 将它消费为有界的内部 tombstone：不把 tombstone 放进公开 `pages`，但在最多 `MAX_PAGE_TOMBSTONES` 个条目内保留旧身份，防止 Provider 私有 handle 重现时复活旧 `page_id`/`page_ref`；同一 handle 后续重新出现必须分配新的公共 Page identity。Driver loss 或 list 中单纯缺失一个 live Page 不是 close proof；后者使 relation 失联并返回 `page_relation_unavailable`，而不是猜测 closed。显式 `page.open` 才能创建全新的 Page 对象。

## 2. Operations

公共 operation id 为：

| operation | effect | target |
| --- | --- | --- |
| `page.list` | observe | Instance |
| `page.open` | interact | Instance，URL 可选 |
| `page.activate` | interact | 明确 `page_ref` |
| `page.close` | interact | 明确 `page_ref` |
| `page.navigate` | interact | 明确 `page_ref` 与 URL |
| `page.reload` | interact | 明确 `page_ref` |
| `page.back` / `page.forward` | interact | 明确 `page_ref` |

历史兼容的 `page.list` v2 投影返回 `{schema_version: "harbor-page-list/v2", runtime_session_ref, active_page_id, pages, filtered_page_count, observed_at}`；每项同时有 `page_id`、`page_ref` 和 `document_generation`，closed tombstone 不出现在 `pages` 中，`filtered_page_count` 只汇总被授权 origin 过滤的 live Page。v1 客户端投影不是本切片的隐式兼容行为；没有经验证的适配器时必须明确拒绝，而不是猜测 `active_page_ref` 或把旧 Page ref 映射到新对象。`page.open` 返回新 Page facts 和 operation receipt。`activate`、`close` 和导航返回当前 Page facts、`document_generation` 与 bounded failure。所有 mutating input 都有 `idempotency_key`；同 key 不得以不同 request 重放。任务页引用不能由 `active_page_id`、selected tab 或 OS focus 反推；#519 复用现有 wire，不把原生焦点未知改写为 `active: false`。

当该 Instance 有 popup/child request 在派发前因 Page 关系不可确认而被拒绝时，`page.list` 可选附带 `rejected_unattributed`：`{count, failure_class: "page_relation_unavailable", dispatch_state: "not_dispatched"}`。它是有界的 Instance 级聚合，非 Page 或 Network event；不含 URL、`page_id`/`page_ref`、`opener_page_id`、request identity 或 Provider handle，不增加 `pages` 或 `filtered_page_count`，计数为零时省略。该可选字段保持 `harbor-page-list/v2` 兼容；触发 popup 的 click 若已派发，仍由独立的 Page mutation receipt 保留 `dispatch_state: "dispatched"`，不能被聚合结果改写。

每个 Page mutation 的 receipt 使用 `harbor-page-navigation/v1`，并带 `operation_ref` 与 `dispatch_state`。派发前的拒绝是 `not_dispatched`；Provider 调用已经可能发生而响应丢失、Driver 异常或结果无法确认时必须是 `unknown_outcome` + `dispatched`，只能查询原 operation/Run 对账，不能换 key 重放。Supervisor 的 `GET /runtime/managed-pages/{operation_ref}` 是只读查询；找不到 receipt 也返回保守的 `unknown_outcome` + `dispatched`，不证明 Provider 未被触碰。

旧 `instance.start`/`instance.navigate`/`instance.observe`/`instance.read`/`instance.diagnostics` 在只有一个可用 Page 时可以映射到该 Page。`instance.start` 的 admission 仍要求顶层精确 `origin`；`task_scope.origins` 只是收窄授权集合，不能代替该字段。`url` 可省略，提供时必须与 `origin` 同源且为 HTTP(S)。`instance.navigate`、`instance.read` 和 `instance.observe` 可带 `page_id`、`page_ref` 与可选 `document_generation`；其中 `page_id`/`page_ref` 明确选定 Page，`document_generation` 是对当前 document 的新鲜度保护。存在多个可用 Page 且请求没有明确 `page_id`/`page_ref` 时返回 `page_selection_required`，不得按 active 或创建顺序猜测。显式 ref 不存在、与 `page_id` 不匹配、origin 未授权或 generation 过期时必须拒绝，不能回退到另一张 Page。成功的 `instance.navigate`/`instance.read` 在 `session.current_page` 投影 Harbor 选定 Page 的 `page_id`、`page_ref` 和 `document_generation`；成功的 `instance.observe` 在 `observation.page` 投影同一绑定。新 Page 不会因为 Instance 复用而隐式导航旧 Page。

## 2.1 Close and focus rules

> `page.close` 的目标校验、safe-return 失败和最后一页保护仍是公共 close 语义；下列 `active`、Provider focus 和邻页选择的具体投影保留为旧 #510 兼容材料。当前任务页 A／Viewer 页 B 与可选原生焦点不依赖这些旧投影，详见上文。

- 关闭非 active Page 只要求该 `page_id`/`page_ref` 仍新鲜；它不会改变 active Page。
- 关闭 active Page 只有在 Registry 能选出另一张状态为 `ready` 或 `loading`、origin 仍在授权集合、且不是已关闭对象的安全返回 Page 时才执行。优先选择最近一次明确使用的安全 Page，其次选择公开列表中的安全 Page；不按 provider 创建顺序猜测。
- 没有安全返回 Page 时拒绝 `page.close`，返回 `no_safe_return_page`，保留当前 Page。最后一张可用 Page 不能通过 close 结束 Instance；需要显式停止 Instance。
- Page 已被网页/用户原生关闭且 Provider 给出 `status: "closed"` tombstone 时，后续 close/activate/navigate 返回 `page_not_found` 或 `stale_page`；Runtime 不自动 reopen、复用 handle 或改变 active 到一个不可见对象。
- Provider list 只是遗漏一个仍在 Registry 中的 live Page 时，Harbor 返回 `page_relation_unavailable` 并暂停受影响 Instance 的 Page/网页派发；在获得完整关系前不得把遗漏解释成 human close、reload、reopen 或新的 Page。
- Provider 的真实焦点事实优先于请求顺序。Agent `page.open` 不调用 bring-to-front；popup 是否 active 只由 provider 事件和真实焦点决定。

## 2.2 Historical #510 native tab handoff and relation recovery

以下 native swap、完整 relation 和安全暂停条款只保留 #510 的历史 Provider-private 设计与兼容阅读，不构成当前 Camoufox launch/support 承诺；当前任务页交还和可选焦点语义以上述 v1.4 章节为准。

#510 的 native tab handoff 是原生 tab/window location 的变化，不是新的 Page、document 或 navigation。只有在 Provider 给出一个较新的、完整且可双向验证的 relation，并证明仍是同一个客户端 Page、同一个稳定的 target 与同一个 `BrowsingContext` 时，Harbor 才能接受这次 handoff。此时：

- `page_id` 保持不变；只有在 `document_generation`、控制代次和当前 document 都未改变时，当前 `page_ref` 才能继续作为 public document binding 使用；native tab/window 的变化本身不递增 document generation，也不创建 replacement Page。
- 已确认的 document state（包括页面输入/滚动状态、history 和 opener 关系）保持在原 Page 上；不能证明连续性时返回 `page_relation_unavailable`，不得通过 URL/title、关闭后重开、reload 或复制页面来修复。
- 成功 handoff 仍会使旧的 observation、interaction target、diagnostics cursor 和进行中的 relation-bound read 失效。即使 `page_ref` 因 document 未变而保持不变，调用方也必须完成一次新的 `page.list`/`observe` 后再执行交互；不得重用旧 target、selector 快照或 cursor。旧 binding 按既有 `stale_page`、`stale_document` 或 `cursor_stale` 规则拒绝。

在 `SwapDocShells`/`EndSwapDocShells` 尚未形成完整成对 relation，或 relation 为 partial、unknown、过期或不一致时，受影响 Instance 进入安全暂停：Page list、observe、diagnostics 以及依赖该关系的 Page/网页派发返回 `page_relation_unavailable`；已可能触及 Provider 的 mutation 保留 `unknown_outcome` + `dispatched`，不得自动重放。Harbor 保留最后一个可信 relation，但不把它当作当前可执行事实。

恢复只能依赖更新且完整的 native relation，再做一次完整 Page list 与 fresh observation；成功恢复前不能把缺失解释成 close、reload、reopen 或新的 Page。若完整 relation 证明 Page/target/`BrowsingContext` identity 被替换，则当前连接的 relation latch 终止继续使用，必须由 owner 选择匹配的重启/回滚路径；不得猜测映射。

## 3. URL、origin and redirects

URL 只允许 `http` 或 `https`，拒绝 embedded credentials、控制字符和超过 2048 字符的值。Query string 和 fragment 是有效 URL 部分，可以由导航传递；它们不出现在公开日志、Run summary、diagnostics event、error message 或 receipt summary 中。需要展示时只展示 origin 与 bounded pathname。

授权 origin 集同时用于 `page.list` 的过滤：Agent 只看到 origin 已获准的 Page facts；集合外的 popup/redirect 只保留 Harbor 内部 blocked fact，并在列表中汇总为 `filtered_page_count`，不泄漏其 URL、title 或 Provider handle。列表不接受 Agent 自带 allowlist。

Core 根据一个当前有效 Grant、目标 Profile 的 permission ceiling 和 task scope origins 计算授权 origin 集：`Grant.allowed_origins ∩ ProfilePolicy.allowed_origins ∩ task_scope.origins`。Agent 输入不能声明或扩大该集合；同一请求不能合并多个 Grant 或跨 Profile 借用 origin。Harbor/Driver 对初始 URL 和每一个实际 redirect destination 重新检查该集合；允许同一 origin 或集合中的目标，集合外（例如 S3）在发出目标请求前阻断并返回 `navigation_origin_denied`。阻断不得把 S3 facts 伪装成成功或把旧 document 错当成新 document。

导航结果为 `completed`、`blocked`、`failed` 或 `unknown`，并包含 bounded redirect facts（origin、pathname、status；不含 query/fragment）。HTTP status、DOMContentLoaded 或 `goto` 返回都不代表站点业务成功。Guard 覆盖 document request、HTTP Location、meta refresh、script/location、form POST 和 popup request；未经授权的目标必须在发出目标请求前阻断。页面触发 `beforeunload` 或确认 dialog 时不自动接受，超时/拒绝返回 `navigation_beforeunload_blocked` 并保留旧 document。

## 4. Observation and stale refs

Observation、interaction target、network event、console event 和 diagnostics cursor 必须绑定 `page_ref` 与 `document_generation`，并受当前 relation/control generation 保护。Page navigation、close、native handoff reobserve、driver loss、control generation change 或 Runtime restart 让旧绑定失效；返回 `stale_page`/`stale_document`/`cursor_stale`，不能重试去命中相似的 Page 或 selector。关系无法证明时优先返回 `page_relation_unavailable`，不得把关系错误降级成 `page_not_found` 后继续派发。

Diagnostics 为每个 Page 保留独立有界 ring，并受 Instance 总量上限约束：最多 64 个 Page 对象、每 Page 128 条事件、每 Instance 512 条事件、最多 256 个 pending request correlation。cursor 绑定 Instance、Page、document generation 和 ring position。读操作不改变 active Page。网络/console 记录过滤 query、fragment、credentials、headers、bodies、cookies、raw exception 和 Provider handles 后再进入 ring；超出上限返回 bounded unavailable/evicted facts，不静默扩大缓存。

## 5. Unavailable results and support

所有 Page/navigation failure 都使用 `{status: "unavailable", schema_version: "harbor-page-navigation/v1", failure_class, message, retryable, dispatch_state, runtime_session_ref?, page_id?, page_ref?, document_generation?, operation_ref?}`；`message` 最多 256 字符且不含 URL query/fragment、凭据、headers、body 或 Provider handle。`failure_class` 为 `invalid_request`、`session_missing`、`session_not_ready`、`page_selection_required`、`page_not_found`、`stale_page`、`stale_document`、`no_safe_return_page`、`control_lock_conflict`、`navigation_origin_denied`、`navigation_beforeunload_blocked`、`page_capacity_exceeded`、`page_relation_unavailable`、`provider_unavailable` 或 `unknown_outcome`。`retryable` 只表示可以重新观察或由用户处理，不授权重放 mutating operation；`dispatch_state` 为 `not_dispatched` 或 `dispatched`，其含义与上方 receipt 相同。

Popup/new tab、query/fragment、same-origin redirect、authorized cross-origin redirect、blocked cross-origin redirect 和 history navigation 都必须分别有 fixture-verifiable success/failure evidence。只支持一个 Page 的 Provider 应报告 `limited`；不能提供完整可信 Page relation 的 Provider 对受影响操作返回 `page_relation_unavailable`/`provider_unavailable`，并保留同一 Instance 人工接管路径。本文不把 fixture 通过或某次本机运行写成已安装生产构件的 live 证据。

## 6. Design obligations and evidence

Work Items #504 and #510 record the following Design Obligation decisions:

| Trigger | disposition | evidence or transition condition |
| --- | --- | --- |
| `DO-PLUGIN-EXPOSURE` | `triggered` | The fixed MCP operation enum now projects Page list/open/activate/close/navigation; the projection and compatibility rules are maintained in [Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md). |
| `DO-GRANT-WIRE` | `not-triggered` | The Page slice reuses the existing single-Grant `profile_refs`/`allowed_origins`/`allowed_operations` intersection; it adds no persisted Grant dimension, confirmation credential, or security field. |
| `DO-NETWORK-CONTRACT` | `triggered` | Network observations are bound to the selected Page/document and authorized origin set; [Network Runtime V1](network-runtime-contract-v1.md) carries the public result and stale/cursor rules. |
| `DO-CONSOLE-CONTRACT` | `triggered` | Console and page-error observations use the same selected Page/document binding and lifecycle; [Console Runtime V1](console-runtime-contract-v1.md) carries the public result rules. |
| `DO-PROVIDER-PRIVATE-SCHEMA` | `triggered` | The fixed native snapshot, Playwright adapter, test-only Camoufox artifact, and #510 v2 tab-handoff lifecycle/CSS variant are governed by [Camoufox Native Provider Contract V1](camoufox-native-provider-contract-v1.md); these remain historical provider-private designs after the 2026-09-12 retirement, and public Page facts still do not expose provider handles. |
| `DO-APP-IA` | `not-triggered` | Page operations use the existing owner/handback entry; this slice does not add a Library, Activity, multi-instance workspace, or other complete App information architecture. |

The deterministic Harbor evidence is kept in `services/harbor/packages/runtime-api/src/page-navigation.test.ts` and the real listener coverage in `runtime-diagnostics.test.ts`; #510 relation, artifact and CSS integrity evidence is historical and linked from [Camoufox Native Provider Contract V1](camoufox-native-provider-contract-v1.md). The #519 upstream Driver's pre-dispatch unknown-relation and popup-origin checks are separately covered by `services/harbor/packages/runtime-api/src/camoufox-upstream-driver.test.ts`; those tests are fixture/code evidence, not installed/live evidence. Installed live evidence remains a separate acceptance requirement: a fixture pass does not claim that native foreground focus, human close observation, complete handoff cycles, or installed Plugin consumption is verified for a pinned Camoufox build. The old private Camoufox launch binding remains retired; the current official path is limited until the #519 gates are complete.
