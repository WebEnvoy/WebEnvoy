# Network Runtime Contract V1

状态：Accepted；版本：1.2；owner：Harbor / Provider Driver（观察）、Core（授权与 Run）。产品归口：[Work Item #498](https://github.com/WebEnvoy/WebEnvoy/issues/498)，后续能力由 [FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497)、受管浏览器文件 [#523](https://github.com/WebEnvoy/WebEnvoy/issues/523) 与授权语义 [#544](https://github.com/WebEnvoy/WebEnvoy/issues/544) 承载。产品依据：[canonical 产品规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)；架构依据：[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md)、[Managed Browser Files V1](browser-files-v1.md)。

> **S4 Proposed 后续**：[主动 Network Spec #565](https://github.com/WebEnvoy/WebEnvoy/issues/565) 将定义有界 response body、request modification、脱敏、授权、结果与恢复。它尚未接受，不改变本合同当前只读、有界 metadata 和既有文件归属 wire；不得据规划提前暴露正文或拦截修改。

> **2026-09-14 Provider 事实**：本合同保持 Provider-neutral 的 Network observation 语义；#519／PR #522 的官方固定 Camoufox 路径只按 `limited` 使用。若 popup 首请求到达时尚不能在派发前可信关联已登记 Page，Driver 必须在 `fetch`/`continue`/外部请求前局部拒绝，并以 `page_relation_unavailable`/`not_dispatched` 保留请求归属未知事实；不能以 URL/title/时间邻近/active/新 Page 猜测或重放。触发它的 click 若已派发，click 的 `dispatched` 事实与 popup 子请求的拒绝、业务未完成分别记录；不得将 click 改写成 `not_dispatched`。原任务页的 fresh read/input、已可信 Page 和其他 Profile 不因该局部拒绝而暂停。#523 文件 slice 的安装/真实消费者证据不扩写为完整 Network 验收；旧私有 launch binding、patched/native artifact 仅作历史/恢复事实。

## Boundary

`instance.diagnostics` is a read-only, bounded observation operation. It is
available only after the existing Profile, Grant, origin, and Instance checks.
It does not acquire, renew, release, or transfer the Instance ControlLease and
does not replay an earlier operation when its response is lost.

The public path is Driver → Harbor `POST
/runtime/sessions/{runtime_session_ref}/diagnostics` → Core managed-browser
operation → Agent projection. The operation is bound to the authorized
`profile_ref`, `runtime_session_ref`, selected `page_ref`, and document
generation. Core supplies the intersection of one current Grant, the target
Profile policy, and task scope origins; the Agent cannot submit an origin
allowlist or combine multiple Grants. A stale Page, cursor, closed/lost
Instance, provider failure, origin mismatch, or unproven Page relation returns
an explicit unavailable result.

## Pre-dispatch relation guard

The fixed upstream Driver installs its public Playwright route before the
managed context performs navigation. If `request.frame.page` cannot be
resolved to an already registered Page, the route is aborted before
`continue()` or `fetch()`; the target server therefore receives no first
popup request. The later `page` event may register the actual popup and its
opener only when the Provider supplies that relation, but it never authorizes
or replays the rejected request. The public failure is the accurate
`page_relation_unavailable` boundary, not a fabricated `page_id` or `opener`.

The `page.list` projection may expose an optional `rejected_unattributed`
value with `{count, failure_class: "page_relation_unavailable",
dispatch_state: "not_dispatched"}`. This is a bounded aggregate for the
Instance, not a Network event or a Page identity; it contains no URL,
Page/opener reference, request identity or Provider handle, and is omitted
when its count is zero. It remains additive to `harbor-page-list/v2`; it does
not alter the diagnostics envelope, and a click that already dispatched
retains its independent `dispatched` receipt.

The request guard is local to the affected Page/Instance. A click that caused
the popup remains a separately dispatched interaction, while the popup
navigation is rejected and the dependent business result remains incomplete.
The original task Page can be freshly observed and used again; diagnostics
and other trusted Pages/Profiles remain available. This is a supported
limited boundary, not a claim that all popup forms are disabled.

Every redirect destination is checked again against the Core-provided exact
origin intersection before that hop is sent. Same-origin and explicitly
authorized cross-origin redirects may continue; an unauthorized destination
is blocked at that hop and cannot be inferred from a later response. No URL,
title, timing, active-page or multi-Grant heuristic broadens this set.

For `agent_operations_v2`, the Core pre-check remains mandatory for an
explicit `page.open`/`page.navigate`/`instance.navigate` target. After that
dispatch boundary, the shared Driver does not use the global route handler as
the authorization boundary for ordinary resources, CDN requests, or redirect
hops; the browser follows those requests normally within the fixed Instance.
A natural cross-origin navigation caused by an admitted click is likewise
allowed and remains `dispatched`. The resulting Page facts are checked at the
Core boundary: later observe/read/input cannot expose an unauthorized path,
query, title, text, or snapshot and may return only the sanitized origin and
opaque Page ref. `legacy_request_guard_v1` keeps the existing per-request and
per-redirect route guard unchanged.

## Managed browser file download boundary

`file.download` always reuses the Page relation contract. Core must provide
the exact authorized operation-origin intersection and a fresh Page/target
binding; Harbor/Driver listens for the native download before one click and
accepts only a real `Download.page` equal to that registered Page and a
HTTP(S) `Download.url`. Legacy checks every redirect hop before it is sent;
v2 permits ordinary redirect/CDN delivery without granting page access to the
delivery host. An unknown Page relation, unsupported target, competing
download, or missing causal event is a structured
`download_relation_unavailable`/`download_target_unsupported` failure, not a
file claim and not a reason to scan the host download directory.

The download event is only a transport fact. The file is bounded to the Core
approved size and MIME subset, copied out of the browser temporary directory,
validated for declared/identified type and SHA-256, and atomically committed by
Harbor before a `webenvoy.browser-file-result/v1` output `file_ref` is exposed.
Provider temporary paths, response bodies, headers and arbitrary Network
payloads never cross the Core/Plugin boundary. A failed or lost response keeps
the original `dispatched`/`unknown` receipt; `webenvoy_query` may reconcile it
but cannot repeat the click or download.

## Public result

The completed result is `harbor-runtime-diagnostics/v1` and contains a bounded
cursor window of Network metadata and a separate Console window. Each event
has an opaque event reference, UTC timestamp, Page reference, and document
generation. Network events expose only request/response/failure kind, method,
sanitized URL and origin, resource kind, optional status/duration, and a small
failure class (`aborted`, `blocked`, `connection`, `dns`, `timeout`, or
`unknown`). Redirects are represented by subsequent sanitized events; no
redirect chain is inferred by the consumer. Authorized same-origin and
cross-origin redirects are allowed after each destination is checked against
the Core-provided origin set; an unauthorized destination is blocked before
its request is sent and appears only as a bounded `blocked` fact.

The normative completed envelope has these fields; arbitrary Provider fields
are not forwarded:

| Field | Wire type and meaning |
| --- | --- |
| `status`, `schema_version` | Exactly `completed`, `harbor-runtime-diagnostics/v1` |
| `runtime_session_ref`, `profile_ref` | Opaque strings bound by Harbor to the selected Instance/Profile |
| `page_ref`, `document_generation` | Opaque selected Page string and positive integer document generation; shared with the selected controlled-page snapshot |
| `page` | `{current_url: string\|null, title: string\|null, status: loading\|ready\|failed\|closed\|unavailable\|unknown}`; sanitized URL and bounded title |
| `cursor`, `next_cursor` | Opaque window checkpoints; never selectors, endpoint IDs or authority |
| `observed_at` | UTC ISO timestamp of the read, distinct from each event's timestamp |
| `truncated` | Boolean indicating the bounded window did not represent all available/history events |
| `network`, `console` | Arrays sharing a total read limit of 64; console items follow [Console V1](console-runtime-contract-v1.md) |

Each Network item contains `event_ref`, `kind` (`request`, `response`,
`failure`), `observed_at`, `page_ref`, `document_generation`, `method` (at
most 16 characters), sanitized `url` and `origin`, and `resource_kind`
(`document`, `script`, `stylesheet`, `image`, `font`, `xhr`, `fetch`,
`websocket`, `other`). Optional fields are `request_ref` (correlates a
response/failure with its started request), `status` (integer 100–599),
`duration_ms` (integer 0–86400000), `redirected` (true only when the
Provider observed a redirected request), and `failure_class` (the enum
above). Missing timing/redirect linkage means unknown, not zero/no redirect.

`request` records dispatch observed by the Provider; `response` records
response headers/status availability, including non-2xx; `failure` records
transport failure. Duration measures the bounded elapsed time from request
start to the observed response/failure, not response body completion. A 503
is a response, not a transport failure. Navigation and controlled-input
redirects are checked against the Core-provided origin set; an unauthorized
destination is blocked before its request is sent. Diagnostics cannot enable
redirects or broaden that set. A popup request rejected before the route can
continue has no server dispatch; if a separate click already ran, its
`dispatched` receipt is not erased by that child-navigation rejection.

`cursor` is the starting checkpoint; `next_cursor` is the last returned
event, not the newest unreturned event. Reads capture a high-water mark and
paginate only current Page/generation, same-origin events up to that mark.
The cursor binds the Instance, Page, generation and ring position. The
provider may report `cursor_stale` when
the bounded ring has evicted the requested position. `truncated` means the
returned window reached its limit or the provider evicted older events.

## Privacy and limits

- URLs contain origin and bounded pathname only; query, fragment, credentials,
  headers, cookies, authorization material, and request/response bodies never
  cross the boundary.
- The event window is bounded to 64 events per read and the provider ring is
  bounded. Console and page-error text is normalized, truncated to 512
  characters, and replaced with `[redacted]` when it resembles a secret.
- Source locations contain only a sanitized URL and non-negative line/column
  numbers. Stack traces, exception objects, DOM, HAR, and raw provider handles
  are private.
- Diagnostics do not grant Network interception, request modification,
  storage, or controlled evaluation.

## Lifecycle and failure

`wrong_page`, `stale_page`, `stale_document`, `cursor_stale`, and
`page_relation_unavailable` are non-success results and must be surfaced
without guessing. Driver loss invalidates the selected Page binding and
returns `provider_unavailable`; a Page list that cannot prove its relation
returns `page_relation_unavailable` and pauses dependent web dispatch.
Subsequent calls cannot revive the old Instance or guess a replacement Page.
Closing or revoking the authorized session prevents further reads.

The observation exists only during the selected Page's lifetime, starting when
the Driver attaches native listeners. Navigation rotates that Page's document
generation and cursor; Instance stop/Driver exit destroys all in-memory
windows.
There is no independent durable observation session or background recorder.
Each Page ring retains at most 128 sanitized events and the Instance applies
an additional total cap. Per-request correlation
state retains at most 256 requests and is released at request completion or
failure. If correlation was evicted, a later response/failure is omitted,
never assigned fabricated timing or request linkage. Document navigation
commits rotate the Page binding; the committing navigation's retained
request/response are associated with that new document. A failed navigation
that leaves the old document intact does not rotate its binding. Other old
document events and late responses remain private, not relabeled as current.
Events are facts at their `observed_at`, not a promise
that the page is still healthy. Historical Core Run summaries remain subject
to existing Run retention/query semantics and do not revive an observation.

The unavailable wire result is `{status: "unavailable", failure_class,
message, retryable}`. `failure_class` is one of `invalid_request` (malformed
or unsupported input), `session_missing` (no such Instance),
`session_not_ready` (stopped/failed/not active), `page_selection_required`
(multiple visible Pages without an explicit selection), `wrong_page` (origin
does not match), `stale_page` (Page binding replaced), `stale_document`
(document generation replaced), `cursor_stale` (window replaced, expired or
invalid), `page_relation_unavailable` (Provider cannot prove the Page
relation), or `provider_unavailable` (missing capability/Driver). Message is a
bounded safe summary. `retryable` never authorizes replay of a page action.
Core preserves the failure class in its existing failure result;
authentication/Grant/Profile/task refusals occur at the Core boundary first.

For an unknown Page relation at the first popup navigation, the failure class
is `page_relation_unavailable` and the request dispatch state is
`not_dispatched`; this means the target request was prevented, not that the
triggering click was undone. Once a real Page relation is observed, later
operations use the normal Page/origin checks. No late relation event can turn
the original rejected request into a successful navigation.

The trusted internal Harbor route accepts `{origin, authorized_origins?,
page_ref?, document_generation?, cursor?, limit?}` (`origin` and every
authorized origin must be exact HTTP(S), limit integer 1–64). The optional
`authorized_origins` is a Core-derived internal field and is never accepted
from the ordinary Agent projection. Harbor verifies the Core-provided authorized origin set and the
selected Page binding; it requires the existing Core/owner authorization;
ordinary Agents use the
[Installed Plugin projection](plugin-runtime-exposure-v1.md). Inputs cannot
request headers, bodies, interception, mutation, storage or arbitrary script.
This additive v1 payload requires a matching Runtime/Plugin build; unknown,
malformed, or incompatible versions must be rejected as unavailable and must
not be reinterpreted as a raw Provider result or silently downgraded. No data
migration is needed because the event ring is ephemeral.

## #594 限定的程序侧匿名公共读取（v1.3 候选）

本节仅在对应合同、实现和检查完成并合入 `main` 后生效；此前 v1.2 的
`instance.diagnostics` 仍只返回 metadata，不提供响应正文。该能力只供已准入、
固定版本的公共只读站点任务在受管 worker 内经 Core broker 调用，不新增普通 Agent 的
任意 HTTP 工具。它是**程序侧匿名 HTTPS**，不使用受管浏览器的 Page、Context、
Cookie、代理、指纹或登录态，也不能报告为浏览器原生请求。需要登录态、页面请求或
主动写入的任务不适用。

调用者只提交一个本次请求的 URL，以及 `GET` 和包内已固定的 `Accept`、
`User-Agent`（若声明）。Core 从当前已安装且启用的 package revision、code admission
和 task declaration 取得唯一请求策略：精确 HTTPS origin、允许的 pathname（可声明
至多一个有界后缀段）、允许的 query key、允许的固定 header 值、响应 MIME、
请求/跳转次数、时间和解压后正文字节上限。策略不能由 Agent 输入、脚本的临时
参数或另一个 Grant 扩大；同一 task 的 URL 仍须由获准的原参数处理代码构造。
首版每个 Run 至多一次逻辑 GET，最多两次同策略内跳转；URL 总长至多 2048 bytes，
可变的单个 pathname 后缀段至多 512 bytes，每个 query key/value 至多 512 bytes；
URL 规范化后必须仍位于声明的精确路径或其唯一后缀段内。重复 key、片段、userinfo、非标准端口、
非 HTTPS、IP literal 和未知 header 均在派发前拒绝。包可把具体参数值限制得更窄，
不能用通用长度上限代替原 adapter 的参数校验。

每次请求和跳转都重新校验完整 URL、origin/path/query/header 和当前
Principal/Grant/task scope/Profile ceiling、package revision/digest、script hash、
Code admission、取消/停止状态。程序侧在连接前解析 DNS，只连接本次已检查的地址；
私有、回环、链路本地、组播、未指定、文档保留及云元数据地址均拒绝，不能在校验后
让 HTTP 栈重新解析到另一地址。重定向到未获准 origin/path/query 或非公网地址，
在发送下一跳前以 `not_dispatched` 拒绝该跳，并保留此前已经派发的请求事实；
不能静默改用浏览器、Provider、代理或账号。没有环境代理、浏览器 Cookie jar、
Authorization/Cookie/Proxy-Authorization header 或从 Profile/owner/进程环境继承
的凭据；收到的 Set-Cookie 不保存、不转发，也不提供给 worker 或 Agent。

响应仅在有界媒体类型和 UTF-8 解码成功时，把**实际 HTTP 正文**临时交给该 Run
的受管 worker；允许的 gzip/deflate/br 必须对压缩后及解压后字节分别限额，超限
立即取消读取。Core 持久化的只是 opaque response/evidence ref、实际程序侧路径、
最终允许的 URL 的脱敏摘要、状态码、媒体类型、body SHA-256/字节数、跳转数、
dispatch state 和失败类，不持久化正文、headers、Cookie 或完整请求。worker
可在内存中按 `.text()` 或 `.json()` 消费同一正文；HTTP 2xx、解析成功或脚本退出
都不等于业务成功，仍须通过 pinned output schema、完整性和 post-check。

授权拒绝、DNS/目标不可证明、重定向越界、响应类型/体积超限和取消不得伪装成
空集合或成功。首次派发前失败为 `not_dispatched`；已经送出请求而响应丢失时保留
`dispatched`/`unknown_outcome`，只查询原 Run，不由 worker、Plugin 或新 key 自动
重发。停止只阻止后续请求/读取，不宣称撤销已送出的外部效果。本节只扩展
`#594` 所需公共匿名读取；#565 的浏览器上下文主动请求、身份请求、写入、拦截与
修改仍待其自身合同和验收。
