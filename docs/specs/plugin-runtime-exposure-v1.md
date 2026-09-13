# Plugin Runtime Exposure V1

状态：Accepted；版本：v1.1；owner：Core（授权、Run 与结果）、Harbor（Runtime 能力与现场）、Desktop Agent entry（MCP 投影）。产品归口：[Runtime Work Item #498](https://github.com/WebEnvoy/WebEnvoy/issues/498)、[#474](https://github.com/WebEnvoy/WebEnvoy/issues/474)、[#508](https://github.com/WebEnvoy/WebEnvoy/issues/508)、受管浏览器文件 [#523](https://github.com/WebEnvoy/WebEnvoy/issues/523)。依据：[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md)、[Managed SKILL Library Lifecycle V1](skill-library-lifecycle-v1.md)、[Managed Browser Files V1](browser-files-v1.md)。

本规格冻结首宿主的固定 MCP 投影、授权边界、版本兼容和失败语义。工具可见、Runtime capability 存在、当前 Grant 允许调用以及 Provider 当前可执行性是四个独立事实。

> **2026-09-12 Provider 事实**：本轮 [#519](https://github.com/WebEnvoy/WebEnvoy/issues/519) 的官方固定 Camoufox／Playwright 路径已接入现有 Plugin operation，但按 `limited` 暴露：只接受 owner 核验的 `0.5.6`／`152.0.4-beta.30`／`1.60.0` 组合；popup 首请求无法在派发前建立可信 Page 归属时局部返回 `page_relation_unavailable`，不先发请求、不猜测、不重放。工具可见、能力存在、Grant 授权和当前可执行性仍是独立事实；正式 installed、人工交还、环境连续性和真实 Agent 消费尚待 #519 完成门，不能写成 `plugin_verified`。旧 Camoufox 私有 launch binding、patched/native artifact 和对应 live 记录仅作历史/恢复事实，Plugin 不 fallback 或隐藏拒绝原因。

## 固定工具与投影

已安装、完整性核验的 Plugin 通过下列固定工具消费 Runtime；Plugin 不建立授权、不直接调用 Harbor/Provider、不把浏览器协议作为回退路径。

| Runtime/管理能力 | MCP 工具与 operation | 授权和结果归口 |
| --- | --- | --- |
| Page list/open/activate/close and navigation | `webenvoy_operation`：`page.list`、`page.open`、`page.activate`、`page.close`、`page.navigate`、`page.reload`、`page.back`、`page.forward` | 同名 `allowed_operations`；同一 Instance 的 Page/document contract 与关系异常暂停由 [Page, Document and Navigation V1](page-navigation-runtime-contract-v1.md) 维护。 |
| bounded Network metadata + Console/Page Error | `webenvoy_operation`：`instance.diagnostics` | 既有 `allowed_operations` 中的 `instance.diagnostics`；详见 [Network V1](network-runtime-contract-v1.md) 与 [Console V1](console-runtime-contract-v1.md)。 |
| Profile environment facts / bounded configuration update | `webenvoy_operation`：`environment.read`、`environment.update` | 既有同名 `allowed_operations`；字段与失败语义由 [Profile Environment V1 §18](profile-environment-v1.md#18-首个正式环境生命周期合同499) 维护。 |
| Provider preference and create selection | `webenvoy_operation`：`provider.preference.read`、`provider.preference.set`、`provider.preference.clear`；动态模板的 `profile.create` 可带 `provider_id` | 每项需同名 `allowed_operations`；固定模板拒绝请求级 Provider；详见 [Provider Selection V1](provider-selection-v1.md)。 |
| Installed Profile recovery diagnosis/request/status | `webenvoy_recovery`：`recovery.inspect`、`recovery.request`、`recovery.status` | 明确授予的同名 operation；Agent 不能 backup/plan/apply，详见 [Grant Wire Contract V1](grant-wire-contract-v1.md)。 |
| 已安装、固定来源的可选 SKILL | `webenvoy_skills`：`skill.list`、`skill.inspect`、`skill.install`、`skill.enable`、`skill.read`、`skill.update`、`skill.rollback`、`skill.disable` | `skill_scope` 与同名 `allowed_operations` 交集；正文与 receipt 由 [SKILL Library Lifecycle V1](skill-library-lifecycle-v1.md) 维护。 |
| 受管浏览器文件 | `webenvoy_operation`：`file.upload`、`file.download`；既有 `webenvoy_query` 查询原 Run/receipt | `file_scope`、task `file_refs`、Profile/Principal/Grant、Page/document、目标新鲜度和 ControlLease 的交集；owner `files import/inspect/export/revoke/delete` 只走受信入口。结果为 `webenvoy.browser-file-result/v1`，正文和路径不投影，详见 [Managed Browser Files V1](browser-files-v1.md)。 |

`webenvoy_skill` 仍只提供必需管理/浏览器引导资产；`webenvoy_skills` 不能替换或覆盖它。工具唯一拼写为 `webenvoy_skills`，不引入 `webevoy_skills` 别名。

对于 #519，Plugin 继续复用上述既有 Page、diagnostics、environment 和
ControlLease projection，不新增 task-page tool 或 Provider-private
operation。固定官方 Driver 的 limited popup 边界必须透传为结构化
`page_relation_unavailable`/`not_dispatched`；若触发 popup 的 click 已经
`dispatched`，不能把 click 改写成未派发。原任务页可在 fresh observe 后
继续 read/input，后续真实 Page 事件不授权或重放原首请求；其他 Page、
Profile、Grant、查询和 SKILL 管理不被该局部拒绝污染。

`page.list` 仍使用 `harbor-page-list/v2`，并可选透传
`rejected_unattributed: {count, failure_class: "page_relation_unavailable", dispatch_state: "not_dispatched"}`。
该值是 Instance 级有界聚合，不是 Page 或 Network event；不含 URL、
`page_id`/`page_ref`、`opener_page_id`、request identity 或 Provider handle，
计数为零时省略，不改变 `pages`/`filtered_page_count`。它不覆盖独立的
click receipt：已派发的 click 仍保持 `dispatch_state: "dispatched"`。旧
Plugin/客户端可按 v2 的可选字段兼容规则忽略它，但不能把它解释成 popup
已成功或已获得 Page 归属；installed/live/plugin 验收状态仍待现场完成。

### Managed Browser Files 输入与结果

`file.upload` 和 `file.download` 复用 `webenvoy_operation` 的既有
`idempotency_key`、`grant_id`、browser task scope、`profile_ref`、
`runtime_session_ref`、精确 `origin` 以及 Page/document binding。上传额外只
接受 owner 已登记的 opaque `file_ref`；下载不接受 `file_ref`、URL、路径、
selector、headers、body 或脚本。task scope 的 `file_refs` 对上传必须是单项
精确匹配，对下载必须为空。Plugin 不携带 owner credential，不能调用 owner
files route。

上传只向当前新鲜观察中的一个可见标准 `input[type=file]` 交付一次；已有
文件、失效 target、Page/lease 变化或 Grant/file scope 不匹配均在派发前拒绝。
下载只对观察到的同页 HTTP(S) link 先监听后单击一次；Provider 必须证明实际
`Download.page`、URL、请求 guard 和 Page binding，再由 Harbor 在有界格式/大小
检查及原子提交后发布新 output ref。下载事件本身不是业务成功。

结果只返回 `webenvoy.browser-file-result/v1` 的 bounded metadata、Page/
operation refs 和 `file_ref`；不返回正文、Provider 临时路径、owner 路径、
headers 或 raw network payload。上传的 `browser_delivery` 与网页
`page_receipt`/`page_processing` 分层；下载的 `download_event` 与 committed
material 分层。Provider error、stale Page、relation loss、撤销、过期、超限和
unknown outcome 原样暴露为结构化失败，`webenvoy_query` 只读原事实，不会重触发
上传/下载。

## SKILL 工具输入

每次 `webenvoy_skills` 调用都要求 `idempotency_key`、`grant_id`、`operation`、`task_scope`；Connector 注入当前 `connection_id`。`task_scope` 必须恰好含 `operations`、`skill_refs`、`source_refs` 三组数组，数组项唯一且 operation 必须包含当前 operation。SKILL 请求不带 Profile、origin、runtime session、page、URL、路径、脚本或浏览器动作字段；未知字段拒绝。

| operation | 输入选择 | 结果边界 |
| --- | --- | --- |
| `skill.list` | 仅 task scope；返回范围内批准资产/修订元数据与本地状态。 | 不返回正文。 |
| `skill.inspect` | `skill_ref`。 | 只返回该资产的批准元数据、选择和状态。 |
| `skill.install` | 明确完整 `revision_ref`，可带精确 `source_ref`。 | 安装后保持 disabled，不自动选择或启用；同一有效请求幂等。 |
| `skill.enable` | `skill_ref`、已安装目标 `target_revision_ref`，以及当前选择的 CAS 预期值。 | 只启用完整且兼容的已安装修订。 |
| `skill.read` | `skill_ref`；读取当前 enabled revision。 | 先校验同一物化 Buffer，再返回真实 content 和 read receipt。 |
| `skill.update` / `skill.rollback` | `skill_ref`、已安装目标 `target_revision_ref`，以及 CAS 预期值。 | 原子切换选择，保持原 enabled 值；不隐式 install/latest/merge。 |
| `skill.disable` | `skill_ref` 以及当前选择的 CAS 预期值。 | 阻止后续新 read，保留内容、选择和历史。 |

`enable`、`update`、`rollback`、`disable` 的 CAS 必须在 Core 锁内再次检查；缺少或不匹配的当前 revision/record version 拒绝并返回稳定 conflict。`skill.update` 与 `skill.rollback` 只接受已安装且 valid 的目标，rollback 还须是仍可用的历史修订。来源身份、大小、UTF-8、hash、路径越界和 symlink 规则见生命周期合同。

## 既有 Runtime 输入与 availability

`webenvoy_operation` 的 Page 输入为 `idempotency_key`、`grant_id`、对应 `operation`、既有 browser `task_scope`、`profile_ref`、`runtime_session_ref`，并按 operation 接受精确 `origin`、受管 `page_id`/`page_ref`、`document_generation` 或同源 URL。兼容的 `instance.navigate`、`instance.read`、`instance.observe` 也消费这组显式 Page binding：多 Page Instance 必须携带 `page_id` 或 `page_ref`，成功结果分别在 `session.current_page` 或 `observation.page` 回显 Harbor 当前绑定；stale、origin 不符或 selector 冲突不得回退到 active/创建顺序的另一张 Page。`page.list` 与诊断是 observation-only，不获取或续租 ControlLease；其余 Page 操作走既有 Run/receipt 和 ControlLease。Plugin 添加当前 `connection_id`；未知输入字段拒绝。页面输入不接受 selector、脚本、header、body 或 raw endpoint 参数。关系异常或原生 selected 页面无法与受管 Page 可靠对应时，Harbor 必须返回结构化 `page_relation_unavailable`（或精确 Provider unavailable），暂停受影响 Instance 的网页派发并保留现场；不得猜测、重放、reload/reopen/rebuild、隐式接管用户控制，或影响其他 Profile。

`webenvoy_operation` 的诊断输入仍为 `idempotency_key`、`grant_id`、`operation=instance.diagnostics`、既有 browser `task_scope`、`profile_ref`、`runtime_session_ref` 和精确 `origin`，可选同一 Instance 的 `page_ref`、不透明 `cursor`、`limit`（整数 1–64）。Plugin 添加当前 `connection_id`；未知输入字段拒绝。诊断不接受页面动作、selector、脚本、header、body 或 raw endpoint 参数，结果仍是有界脱敏 metadata。

`environment.read` / `environment.update` 复用既有 `webenvoy_operation`。update 额外要求非空 `configuration`，只接受 timezone/language/viewport（各 1–128 字符）；不接受 Instance/Page/cursor、脚本、Provider/proxy/seed 参数。返回 `harbor-profile-environment/v1` 的 configured/effective/pending/observed/drift/provider/support/last_verified_at；保存不热改活动 Instance，不隐式重启。更新响应丢失后 query 原 key，只查询 mutation receipt 和当前环境事实，不再次提交更新；首次 readback/跨 restart 与未验证项必须区分，unknown 不等于 verified。

Provider preference 三项 operation 使用 browser task scope，但 `profile_refs`、`origins` 必须为空；set 必须且仅带一个受支持 `provider_id`，read/clear 不带 Provider。动态创建模板 `provider_id=null` 时，`profile.create` 可选带一次性 `provider_id`；省略时由 Harbor 使用用户新建默认，二者都没有则返回 `provider_selection_required`。旧固定模板仍只使用模板 Provider，任何请求级字段即冲突。Plugin 不直接调用 Harbor，set/clear 响应丢失后 `webenvoy_query` 只读原 receipt。

MCP 工具固定可见；可见不意味着 Provider 支持或主体获授权。本版本不按站点或 SKILL 动态隐藏既有工具，也不发明诊断能力。未实现能力返回 unavailable，不能以空事件冒充成功；单 Profile 拒绝不改变其他 Profile 授权。没有网站 SKILL 不影响通用诊断、环境或浏览器能力。#519 的静态 source/version/hash 事实可以在 status/diagnostics 中回读，但在实际安装和真实 Agent 通过前只能记为 validation/fixture evidence，不能冒称 live/plugin verified。

恢复投影只允许 `recovery.inspect`、`recovery.request`、`recovery.status`。inspect 返回安全摘要；request 创建待 owner 决定的 plan/operation，不自动 stop、覆盖或确认；status 只查询原 operation/receipt。Plugin 永远不能调用 owner-only 的 backup/plan/apply，不能携带 owner token。plan 的 Profile、当前材料指纹、backup ref、范围与有效期由 Core 持久化；目标/材料/归属变化或活动 Instance 会使后续确认失效。

环境与恢复 operation 复用既有 Grant 数组、持久化与交集模型；环境扩展不新增 Grant wire 维度，恢复值与单计划确认的持久安全语义见 [Grant Wire Contract V1](grant-wire-contract-v1.md)。

## Grant、task scope 与浏览器边界

Core 只接受一个当前有效的 Principal/Connection/Grant。对浏览器 Page、navigation、interaction 和 diagnostics，effective origins 是 `Grant.allowed_origins ∩ ProfilePolicy.allowed_origins ∩ task_scope.origins`；请求的精确 `origin` 必须属于该交集。Core 不合并多个 Grant、多个 Profile 的 scope 或 Agent 自带 allowlist。对 SKILL 另取 `skill_scope={skill_refs,source_refs}`、task scope、批准清单和 compatibility 的交集。旧 Grant 缺少 `skill_scope` 时没有 SKILL 权限；不得以网页 Profile、origin、账号绑定或通用浏览器 Grant 推导 SKILL 权限，也不得以 SKILL 权限推导网页操作权。版本升级、旧 Grant 读取和旧严格 reader 的拒绝边界见 [Grant Wire Contract V1](grant-wire-contract-v1.md)。

既有 `webenvoy_operation` 的 browser/environment task scope 继续使用 `operations`、`profile_refs`、`origins`，其授权和 Web scope 不因 SKILL 工具改变。SKILL 请求不携带网页范围；同一个连接仍须先通过 `webenvoy_connect`，撤销/过期在每次新管理或 read 前重新检查。

`origin` 是 operation-specific 的顶层输入，不由 `task_scope.origins` 代替。尤其
`instance.start` 必须带一个与该 Profile、Grant 和 task scope 交集精确相等的
顶层 `origin`；`url` 可省略（默认从 origin 启动），如提供则必须是同一 origin
的 HTTP(S) URL。MCP envelope 为兼容不需要网页 origin 的 operation，仍将
`origin` 声明为可选属性；调用方必须遵循上述 operation 合同，缺失时 Core 在
派发前返回 `managed_access_origin_required`/`not_dispatched`。

偏好 read/set/clear 同样要求单一有效 Principal、Connection、Grant 和 task scope 中的同名 operation；旧 Grant、Profile create、browser operation 或模板引用均不能推出偏好修改权。其资源 target 为 `provider_preference`，owner requirement 为 `harbor://browser-provider-preference`。

`webenvoy_status`、bootstrap、合法 `connect`、Profile 管理和无网站 SKILL 的通用浏览器能力不得被可选 SKILL 清单缺失、内容损坏或不兼容阻断。未获授权的资产、修订和来源不能出现在 list、inspect、错误或结果中；错误不得泄露本地 data root、物化路径、凭据或正文。

## 结果、receipt 与恢复

Core 沿用 `{ok, run_id, status, result?, failure?}` 包装。管理操作的成功结果为非内容元数据；`skill.read` 的即时结果额外带通过同一 Buffer 校验的真实 content 与 `webenvoy.skill-read-receipt.v1`。内容不写入 Run Record、持久操作摘要或历史 receipt。

成功诊断的 `result.schema_version` 继续为 `harbor-runtime-diagnostics/v1`；Page list 使用 `harbor-page-list/v2`，Page mutation receipt 使用 `harbor-page-navigation/v1`。拒绝通过既有 admission error 或失败 Run 的 `failure.code` 传递，不能吞掉 unavailable、stale、relation loss 或 revoked。Plugin 不重试 operation；断线后重新 connect，按原 `idempotency_key` 或 `run_id` 查询。纯 diagnostic read 只有在仍获授权时才能用新 key 读取当前窗口；查询原 Run 返回历史事实，不把历史 observation 解释为当前 Page 状态。

`webenvoy_query` 只查询原 Run/receipt/摘要，不重放安装、启用、切换、禁用或 read，也不因旧 receipt 返回新的正文。响应丢失时，Plugin 重新 connect 后按原 idempotency key 或 run 查询；idempotency conflict、CAS conflict、`managed_skill_local_modified`、`managed_skill_missing`、`managed_skill_source_corrupt`、unavailable、revoked 和 incompatible 都保持明确失败，不能降级为空成功。

Page mutation 的响应丢失、Harbor receipt 缺失或 Provider 关系无法确认时，Core/Harbor 保留 `unknown_outcome` 与 `dispatch_state: "dispatched"`，再由原 operation/Run 做只读对账；`not_dispatched` 只表示在 Provider dispatch boundary 之前被拒绝。旧 Plugin、旧 Runtime 或未知 schema/version 不认识 Page operation 时必须明确拒绝，不得改投旧 `instance.navigate`、内部 HTTP、CDP/Juggler 或其他 raw Provider path。兼容拒绝不扩大授权、不重放动作。

SKILL 资产管理不启动浏览器、不申请 ControlLease、不登录网站、不执行 SKILL 附带脚本、不改变 Profile/Account/Provider，不实现动态 tool routing、Marketplace、任意脚本或 Network body/interception/modification。新增 capability→tool projection 使本 Work Item 的 `DO-PLUGIN-EXPOSURE=triggered`；SKILL Grant 维度使 `DO-GRANT-WIRE=triggered`，其余 Network、Console、Provider-private schema、完整 App IA 本轮不触发。

### #519 Design Obligation disposition

| Trigger | disposition | 依据 |
| --- | --- | --- |
| `DO-PLUGIN-EXPOSURE` | `not-triggered` | #519 复用现有 Page/diagnostics/environment operation 和 Plugin projection；只增加 Provider availability/limited facts，不新增 Agent tool、动态发现或第二宿主规则。 |
| `DO-GRANT-WIRE` | `not-triggered` | 复用既有单 Grant、Profile ceiling 和 task scope 交集，不新增 Grant 字段或 scope 维度。 |
| `DO-NETWORK-CONTRACT` | `not-triggered` | popup 首请求拒绝和 redirect 逐跳检查复用 [Network Runtime V1](network-runtime-contract-v1.md)；不新增公共 Network payload。 |
| `DO-CONSOLE-CONTRACT` | `not-triggered` | 可靠 Page 事件仍复用 [Console Runtime V1](console-runtime-contract-v1.md) 的 envelope、过滤和 cursor；不新增公共 Console payload。 |
| `DO-PROVIDER-PRIVATE-SCHEMA` | `triggered` | 固定官方 `launch_options` 与 `context_options` 的完整持久化/精确 replay 形成 Provider-private versioned bundle，见 [Camoufox Environment Continuity V1](camoufox-environment-continuity-v1.md)。 |
| `DO-APP-IA` | `not-triggered` | 只复用既有 owner 授权、接管/交还和安装入口，不新增完整 App 工作台或导航。 |

## 版本与安装边界

安装 bundle、引导 SKILL 和 MCP 兼容系列保持 `0.2.0`；可选参考资产 R1/R2 的真实 version 也均为 `0.2.0`，其来源 commit/blob 与内容 SHA-256 见生命周期合同。旧 Plugin 不会调用 `webenvoy_skills`；旧 Runtime 不认识新 operation 时必须明确拒绝，不回退到内部 HTTP 或浏览器协议。改变既有输入、结果、Grant 字段或交集规则时，必须升级对应合同并提供兼容/迁移规则；没有兼容能力的版本不能静默继续执行。
