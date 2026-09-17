# Plugin Runtime Exposure V1

状态：Accepted；版本：v1.2（实施基线与 checkpoint 语义修订，不改变既有 MCP operation/wire 枚举）；owner：Core（授权、Run 与结果）、Harbor（Runtime 能力与现场）、Desktop Agent entry（MCP 投影）。产品归口：[Runtime Work Item #498](https://github.com/WebEnvoy/WebEnvoy/issues/498)、[#474](https://github.com/WebEnvoy/WebEnvoy/issues/474)、[#508](https://github.com/WebEnvoy/WebEnvoy/issues/508)、受管浏览器文件 [#523](https://github.com/WebEnvoy/WebEnvoy/issues/523)。依据：[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md)、[Managed SKILL Library Lifecycle V1](skill-library-lifecycle-v1.md)、[Managed Browser Files V1](browser-files-v1.md)。

本规格冻结首宿主的固定 MCP 投影、授权边界、版本兼容和失败语义。工具可见、Runtime capability 存在、当前 Grant 允许调用以及 Provider 当前可执行性是四个独立事实。

> **2026-09-14 Provider 事实**：本轮 [#519](https://github.com/WebEnvoy/WebEnvoy/issues/519)／[PR #522](https://github.com/WebEnvoy/WebEnvoy/pull/522) 已完成其声明的原任务页协作与私有补丁退役范围；官方固定 Camoufox／Playwright 路径仍按 `limited` 暴露：只接受 owner 核验的 `0.5.6`／`152.0.4-beta.30`／`1.60.0` 组合，popup 首请求无法在派发前建立可信 Page 归属时局部返回 `page_relation_unavailable`，不先发请求、不猜测、不重放。受管浏览器文件的标准单文件 Plugin slice 由 [#523](https://github.com/WebEnvoy/WebEnvoy/issues/523)／[PR #524](https://github.com/WebEnvoy/WebEnvoy/pull/524) 单独归档；工具可见、能力存在、Grant 授权和当前可执行性仍是独立事实，不能把局部 `plugin_verified` 证据扩写成完整 V1。旧 Camoufox 私有 launch binding、patched/native artifact 和对应 live 记录仅作历史／恢复事实，Plugin 不 fallback 或隐藏拒绝原因。

## #539 能力发现与调用说明（v1.3 已接受兼容修订）

[Capability Discovery and Operation Guidance V1](capability-discovery-v1.md) 冻结本次实施所需的单 operation 查询、参数说明、Profile 可见性、五维状态、只读快照、版本兼容和验收。该兼容修订已接受；本段不表示 `webenvoy_describe` 已部署，#539 仍须实现和验收。

固定新增一个 MCP 只读工具 `webenvoy_describe`，经 Agent credential 与已有 Connection 调用 Core `POST /managed-browser/capabilities/describe`；Core 仅在资源可见性通过后取得 Harbor 已有管理事实。静态帮助不要求有执行该 operation 的权限，具体 Profile 说明复用已有 `profile.read`/`profile.list` 可见性，不增加 Grant 维度。Core–Harbor 窄只读投影使用 supervisor-only `POST /runtime/capabilities/describe`。

查询在 `ensureRuntime` 前分流，不自动启动服务、Profile、浏览器，不建立或刷新 Connection，不派发 Provider 命令、不读取网页内容、不获取租约、不创建 Run/receipt/新目标。结果不是执行许可：可以说明 `no_known_blocker`，但无法只读证明的页面/文件新鲜度仍在执行时校验。缺少帮助或旧 Runtime 不提供查询，不得阻断原有合法操作。

静态参数定义、Core形状校验、MCP条件schema和帮助示例采用同一归口；Provider支持、授权和现场仍各由现有owner提供，不在Plugin复制动态矩阵。#540观察续读、权限扩围、Chrome资格和全生命周期网络隔离不在本补充范围。本补充为 exposure v1.3；既有工具、Grant与operation结果合同保持，未知discovery版本准确拒绝而不fallback。

#540 的 snapshot projection 以已接受的 [Observation Completeness and Target Identity V1](observation-targets-v1.md) 为优先边界；`observe` 只提供页面事实，不产生 target。

## 可选模型辅助的后续投影边界（Proposed，#558）

[Model Usage V1](model-usage-v1.md) 定义首个有界网页辅助用途；[ADR 0013](../adr/0013-optional-model-assisted-browser-tasks.md) 定义采用与 owner 边界。正式接受以组织级 canonical 对应修订为前提。本段不新增当前 MCP 工具、operation、参数、schema 或安装支持声明，也不改变 #539/#540 与 #555/#557 的独立范围。

未来正式 Plugin 消费须能委托一段明确任务、查询原进度／动作／结果、停止和准确交接；不要求 Host Agent 逐步批准或每次 DONE 再调用大模型。Plugin 仅投影同一 Core/Harbor 事实，不保存密钥、复制授权表或另起浏览器／Run 状态机。

开始须具备网页权限、获准模型用途与外发／费用范围；工具可见或连接测试成功均不替代这些决定。DONE 只结束模型循环，业务结果按实际证据核验；BLOCKED 可交回实际宿主，无宿主则待处理。新鲜度、ControlLease、迟到回复拒绝、停止及 unknown 不重放沿原 owner 执行，不能借 SDK resume 或交回宿主重复写入。

正式投影形成前必须触发并完成 `DO-PLUGIN-EXPOSURE`，冻结真实入口、版本、过滤、错误和兼容；新增可委托权限或持久跨进程授权字段时同时触发 `DO-GRANT-WIRE`。这些实现合同实际形成后再链接，不在本 docs PR 预建空 schema。旧安装不能消费辅助能力时局部报告，继续保留原有浏览器与管理路径。

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

## 十二类基线与 Plugin checkpoint

Plugin 以 [Browser Runtime Capabilities V1 §4](browser-runtime-capabilities-v1.md#4-v1-十二类能力最低结果矩阵) 作为十二类能力的语义与来源索引；一次早期、有界的真实消费者只证明其任务实际需要的能力、入口、资产和授权边界，不把未消费的类别或 Provider 能力升级为完成。这份十二类索引本身不新增工具、Grant 维度或第二状态机；#539 的单一只读帮助投影由上节及其专门规格承接，执行仍沿用既有 Runtime/Grant/ControlLease/Run 真相。

完整 Plugin checkpoint 仍要求已安装且来源可核验的 Plugin 被真实第三方 Agent 消费，并对目标能力记录成功、明确拒绝和可恢复路径；还要回读 Provider 状态、暴露原因、Grant/ControlLease 边界以及重启后的持久事实。工具可见、capability 存在、当前授权和 Provider availability 是独立事实；[#474](https://github.com/WebEnvoy/WebEnvoy/issues/474)／[#482](https://github.com/WebEnvoy/WebEnvoy/issues/482) 的完整汇合证据不能由单个文件或站点闭环替代，但简单任务不必等待整个 checkpoint 才可做提前有界验证。

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
已成功或已获得 Page 归属；installed/live/plugin 验收状态必须按对应的脱敏
evidence record 逐项记录，#523 的受管文件 slice 不扩写为完整 Runtime 验收。

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

### #541 shared execution disposition

#541 不修改 MCP operation、wire、Grant、文件结果或 Page/document schema；它把本节既有的精确 Page binding、单次 file scope、逐跳 guard 和 `not_dispatched`/`unknown_outcome` 语义落实到 Camoufox 的 shared Playwright execution path。shared module 只承载公共 Page、文件、诊断与生命周期行为，Camoufox adapter 只承载其已核验的 source/version/properties、persistent Context 和环境材料。Chrome adapter、generic launcher、availability/environment/support projection 以及 Chrome 复现证据不在本交付，不能由 shared code 的存在推导支持。

### #528 Chrome shared execution disposition

#528 在显式 `agent_operations_v2` Grant/Profile policy、严格 `webenvoy.chrome-official/v1` 安装配对及实际 Provider 资格同时成立时，将现有 `webenvoy_operation` 的普通 Page、文件、诊断、控制和查询投影给官方 Chrome；工具名、参数和结果不另建一套。Chrome adapter 受管启动 binding 指定的确切 executable/user-data-dir，并通过 Playwright Python 公开 `connect_over_cdp` 把 default Context交给同一 shared execution。调试地址、程序路径和后端选择不进入 Agent 输入；连接失败不发布 ready Instance，断连不表示 stop，正常 stop 必须关闭 owner 管理的确切进程。

该投影不适用于缺省的 `legacy_request_guard_v1`、缺失/混装安装材料、未验证版本或普通 Chrome binding；这些情况保持精确 unavailable/restricted，不自动转 v2、不切换旧 CDP/站点路径、不创建替代 Profile。Chrome 的现有窄范围能力不因本投影消失。`origin` 仍是需要网站目标的每个 operation 的顶层必填输入，`task_scope.origins` 不能代替它；MCP schema、工具说明与 Core 的条件集合必须同步，缺失时在派发前拒绝。

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

`webenvoy_operation` 的 Page 输入为 `idempotency_key`、`grant_id`、对应 `operation`、既有 browser `task_scope`、`profile_ref`、`runtime_session_ref`，并按 operation 接受精确 `origin`、受管 `page_id`/`page_ref`、`document_generation` 或同源 URL。兼容的 `instance.navigate`、`instance.read`、`instance.observe` 也消费这组显式 Page binding：多 Page Instance 必须携带 `page_id` 或 `page_ref`，成功结果分别在 `session.current_page` 或 `observation.page` 回显 Harbor 当前绑定；stale、origin 不符或 selector 冲突不得回退到 active/创建顺序的另一张 Page。`page.list` 与诊断是 observation-only，不获取或续租 ControlLease；其余 Page 操作走既有 Run/receipt 和 ControlLease。Plugin 添加当前 `connection_id`；未知输入字段拒绝。页面输入不接受 selector、脚本、header、body 或 raw endpoint 参数。仅当受管 Page 的归属、document、权限或必要输入落点无法可信确认时，Harbor 才返回结构化 `page_relation_unavailable`（或精确 Provider unavailable），仅局部拒绝受影响 Page 的该次网页派发并保留现场；可选的原生焦点/`selected` 未知本身不阻断已可信的任务 Page。已派发的 click 保持 `dispatched`，popup 子请求的拒绝与业务未完成分别记录；不得猜测、重放、reload/reopen/rebuild、隐式接管用户控制；原任务页的 fresh read/input、已可信 Page、其他 Page、Profile、Grant、查询和 SKILL 管理不因该局部拒绝而暂停。

`webenvoy_operation` 的诊断输入仍为 `idempotency_key`、`grant_id`、`operation=instance.diagnostics`、既有 browser `task_scope`、`profile_ref`、`runtime_session_ref` 和精确 `origin`，可选同一 Instance 的 `page_ref`、不透明 `cursor`、`limit`（整数 1–64）。Plugin 添加当前 `connection_id`；未知输入字段拒绝。诊断不接受页面动作、selector、脚本、header、body 或 raw endpoint 参数，结果仍是有界脱敏 metadata。

`environment.read` / `environment.update` 复用既有 `webenvoy_operation`。update 额外要求非空 `configuration`，只接受 timezone/language/viewport（各 1–128 字符）；不接受 Instance/Page/cursor、脚本、Provider/proxy/seed 参数。返回 `harbor-profile-environment/v1` 的 configured/effective/pending/observed/drift/provider/support/last_verified_at；保存不热改活动 Instance，不隐式重启。更新响应丢失后 query 原 key，只查询 mutation receipt 和当前环境事实，不再次提交更新；首次 readback/跨 restart 与未验证项必须区分，unknown 不等于 verified。

Provider preference 三项 operation 使用 browser task scope，但 `profile_refs`、`origins` 必须为空；set 必须且仅带一个受支持 `provider_id`，read/clear 不带 Provider。动态创建模板 `provider_id=null` 时，`profile.create` 可选带一次性 `provider_id`；省略时由 Harbor 使用用户新建默认，二者都没有则返回 `provider_selection_required`。旧固定模板仍只使用模板 Provider，任何请求级字段即冲突。Plugin 不直接调用 Harbor，set/clear 响应丢失后 `webenvoy_query` 只读原 receipt。

MCP 工具固定可见；可见不意味着 Provider 支持或主体获授权。本版本不按站点或 SKILL 动态隐藏既有工具，也不发明诊断能力。未实现能力返回 unavailable，不能以空事件冒充成功；单 Profile 拒绝不改变其他 Profile 授权。没有网站 SKILL 不影响通用诊断、环境或浏览器能力。#519 的静态 source/version/hash 事实可以在 status/diagnostics 中回读，现场等级仍以对应 evidence record 为准；#523 的受管文件 slice 已有独立的安装／真实 Agent 证据，但不能冒称其他类别或完整 V1 已 `plugin_verified`。

恢复投影只允许 `recovery.inspect`、`recovery.request`、`recovery.status`。inspect 返回安全摘要；request 创建待 owner 决定的 plan/operation，不自动 stop、覆盖或确认；status 只查询原 operation/receipt。Plugin 永远不能调用 owner-only 的 backup/plan/apply，不能携带 owner token。plan 的 Profile、当前材料指纹、backup ref、范围与有效期由 Core 持久化；目标/材料/归属变化或活动 Instance 会使后续确认失效。

环境与恢复 operation 复用既有 Grant 数组、持久化与交集模型；环境扩展不新增 Grant wire 维度，恢复值与单计划确认的持久安全语义见 [Grant Wire Contract V1](grant-wire-contract-v1.md)。

## Grant、task scope 与浏览器边界

Core 只接受一个当前有效的 Principal/Connection/Grant。对浏览器 Page、navigation、interaction 和 diagnostics，effective origins 是 `Grant.allowed_origins ∩ ProfilePolicy.allowed_origins ∩ task_scope.origins`；请求的精确 `origin` 必须属于该交集。Core 不合并多个 Grant、多个 Profile 的 scope 或 Agent 自带 allowlist。对 SKILL 另取 `skill_scope={skill_refs,source_refs}`、task scope、批准清单和 compatibility 的交集。旧 Grant 缺少 `skill_scope` 时没有 SKILL 权限；不得以网页 Profile、origin、账号绑定或通用浏览器 Grant 推导 SKILL 权限，也不得以 SKILL 权限推导网页操作权。版本升级、旧 Grant 读取和旧严格 reader 的拒绝边界见 [Grant Wire Contract V1](grant-wire-contract-v1.md)。

浏览器 Grant 与 Profile policy 另以 owner 固定的 `scope_semantics` 配对：缺省为 `legacy_request_guard_v1`，首次显式 `agent_operations_v2` 只通过现有 owner 授权面的一次查看与确认生成。确认页展示 Profile、Agent、网站、操作和文件范围，并说明它控制 Agent 操作、不提供全浏览器网络隔离；只允许已停止 Profile，范围不得扩大，原 Grant 不改义。普通 Agent MCP schema 不包含该字段或确认入口，旧/新语义不匹配时在浏览器派发前拒绝；原 Grant 已有的 Profile list/read 和 recovery inspect/status 仍可只读查询，不启动或改变浏览器。

### Owner v2 lifecycle 与 Plugin 授权刷新

续发、撤销后重新签发、有效单 Profile 原子替换和 Profile policy 调整属于 owner control plane，不是 Plugin capability。owner 通过 `POST /agent-access/v2/grants`、`POST /agent-access/v2/profile-policies` 或本机 `access grant-v2`、`access policy-v2`（均须显式 `--confirm`）提交完整字段；Plugin 不调用这些路径、不接受 `source_grant_id`、`replaces_grant_id` 或 policy digest 作为 Agent 输入，也不能从文件路径自行构造 file scope。

owner list 投影的 `grant_digest`/`policy_digest` 只是当前完整对象的确认摘要，不是额外持久权限。摘要冲突以可刷新的 409 失败返回；owner 应重新读取列表、核对 Principal/Profile/origin/operation/file/expiry，再确认提交。成功后 Agent 重新 `webenvoy_connect` 获取最新有效 Grant；过期或撤销 Grant 只阻止后续调用，不恢复历史 Run/receipt。普通 Grant 签发、续发和有效单 Profile replacement 不要求停止 Profile，只有 v2 policy 调整使用 Harbor 可信 stopped 保护；同 key 的 reservation 必须等所有持有者释放。

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

### Runtime continuity and lifecycle projection

官方 async Driver 的 JSONL 生命周期仍属于同一 Plugin Runtime projection：普通
Provider 操作在单一 owning event loop 上串行，输入队列有界；owner `close` 有独立
入口，不排在普通 wait 或文件传输之后。EOF 先关闭 public Context，再等待已派发
操作的真实结果。等待声明条件超时是 `unavailable` + `dispatched`，不能当作成功或
重放；owner close、handoff intent、Page/ControlLease generation 变化也同样保持
明确的 dispatched/unknown 事实。下载 deadline 或配额超限先走公开 Download cancel，
未收敛时保留 task-owned 临时空间和清理屏障，并拒绝 Driver 复用，直到 cleanup
完成。该段实现与确定性验证见 [Runtime Continuity V1 verification](../verification/runtime-continuity-v1.md)；
它是公共 lifecycle/结果边界，不增加 MCP operation、Grant 维度或 Provider 私有
协议，也不把确定性 fake 证据扩写成 installed/live/plugin checkpoint。

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
