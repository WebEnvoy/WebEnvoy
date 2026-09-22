# Site SKILL Execution V1

状态：规范候选（`#563`，待本分支评审与合入）；版本：v1；产品归口：`#563`（parent `#475`）；owner：Core（准入、授权、Run、结果与恢复）和 Harbor（受管执行现场、Page/target、ControlLease 及 OS 执行边界）。Plugin、CLI、API 只投影既有 Core operation。

当前候选分支为
[`codex/spec-563-skill`](https://github.com/WebEnvoy/WebEnvoy/tree/codex/spec-563-skill)。包定义在 Lode 候选分支
[`codex/spec-563-package`](https://github.com/WebEnvoy/Lode/tree/codex/spec-563-package)
的 [Site SKILL Package V1](https://github.com/WebEnvoy/Lode/blob/codex/spec-563-package/docs/contracts/site-skill-package-v1.md)。两个链接均是 review candidate；在合入前不能引用为 `main` 已存在的合同。

本文件定义一个已安装、已固定版本、已获运行授权的 site SKILL task 如何进入现有
WebEnvoy Runtime 并得到结果。它不拥有 Lode 的包身份、version、source/hash、任务
声明或 schema；这些由 [Lode Site SKILL Package V1](https://github.com/WebEnvoy/Lode/blob/codex/spec-563-package/docs/contracts/site-skill-package-v1.md)
拥有。本文件建立在 [Managed SKILL Library Lifecycle V1](skill-library-lifecycle-v1.md)、
[Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md)、
[Grant Wire Contract V1](grant-wire-contract-v1.md)、
[Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md)、
[Capability Discovery V1](capability-discovery-v1.md) 及 Core/Harbor 的 Run、
ExternalOutcome、ControlLease 和 recovery 合同之上，不替代它们。

## 1. 用户结果与不变量

在已获准的 Profile 和当前受管 Instance 中，Agent 可以发现一个已安装 site SKILL
声明的正式 task，提交固定版本的 task，得到有界、可校验的结果，并在响应丢失或
页面改变时安全查询、fresh observe 或人工处理。没有 site SKILL 时，既有通用浏览器
能力仍可使用。

以下事实独立决定：

| 阶段 | 允许回答的事实 | 不能推导的事实 |
| --- | --- | --- |
| Lode package validation | manifest、来源、完整性、任务材料、schema/check/fixture 合法 | 已安装、已信任、当前授权、业务成功 |
| trusted-code admission | 指定 `package_ref`/`revision_ref`/`script_ref` 可以作为受管入口 | 安装、网页 Grant、数据外发、成功结果 |
| managed installation | revision 已按 #508 安装、校验、选择或启用 | 任务可以在当前 Page 派发 |
| runtime authorization | 当前 Principal/Grant/task scope/Profile/Runtime safety 允许所声明动作 | script 有 OS sandbox、可任意外发或业务成功 |
| data-egress decision | 本次数据可送往指定、获准的 receiver/capability | 页面操作成功或业务对象已改变 |
| business verification | 当前 target、输出完整性和 post-check 满足任务结果条件 | 浏览器步骤、HTTP 状态、script exit code 自身成功 |

`SKILL.md` 是不受信任的知识和路由文本；包版本、工具可见、API 认证、安装成功或
模型理解文本都不能跳过 Core admission、Harbor 现场检查、OS 权限、ControlLease、
数据处理和业务 post-check。

## 2. owner 与兼容边界

| 事实 | Owner | 本合同的约束 |
| --- | --- | --- |
| `package_ref`、`revision_ref`、version、source/hash、SKILL 文件、task declaration、input/output/verification/repair asset | Lode | WebEnvoy 只校验和固定引用，不重新登记或改写 |
| install/enable/read/update/rollback/disable、选择、历史、asset receipt | Core，沿 [Managed SKILL Lifecycle V1](skill-library-lifecycle-v1.md) | 使用既有 `webenvoy_skills` 八个 operation；不建第二 registry/asset state machine |
| code admission | WebEnvoy 受管 source/admission policy | 以 Lode source/hash 为材料；不因 install/enable 自动信任 |
| Grant、task authorization、Profile ceiling、Principal/Connection、Run、idempotency、ExternalOutcome、unknown | Core | 复用既有 Grant/Run/query/reconcile；本文件不增加第二授权或 Run |
| Instance、Page、Frame、document generation、observation/target freshness、ControlLease、Provider facts、执行 worker | Harbor 与既有 Runtime capability contracts | 只能接受当前可信 observation 和 Core 已允许的 capability |
| Agent-facing operation/tool projection | Plugin/CLI/API 薄投影；Core 语义优先 | 不直接调用 Lode、Harbor 内部接口或 Provider endpoint |
| package 业务输入、normalized output、post-check、repair hint | Lode | Core 负责在当前现场执行并映射到既有 result envelope |

本文件只扩展 #508 之后的 task execution 层。#508 中“本轮不执行 SKILL 附带脚本”
的非目标在 #563 接受后由本文件 supersede；#508 的资产所有权、受管 data root、
CAS、版本选择、receipt、失败隔离、query/no-replay 仍完整有效。现有
`webenvoy-browser-reference` 只是一项 WebEnvoy 管理/浏览器参考资产，不能冒充
Lode site SKILL 或 live 任务证据。

## 3. 六个门与执行状态

一个 task 只有在以下六个门按顺序满足时才可进入 Runtime：

1. **Package gate**：Lode manifest、`package_ref`、`revision_ref`、文件 digest、
   compatibility、task、schema、pre/post-check 和 repair refs 完整且相互一致；
   knowledge-only 包在此门结束。
2. **Code gate**：指定 script source/version/hash 已通过 WebEnvoy 的受管可信代码准入。
   准入记录绑定包 revision 和 script digest；没有准入时只能读资产，不能 dispatch。
3. **Lifecycle gate**：Core 按 #508 对完整 revision 执行显式 install/enable/read，
   保持 disabled-by-default、CAS、来源和摘要校验。安装不运行 script，不自动登录、
   启动浏览器或取得 ControlLease。
4. **Runtime gate**：Core 计算 `Profile ceiling ∩ Principal Grant ∩ task scope ∩
   declared capabilities ∩ current Runtime safety`，Harbor 证明 Instance/Page/
   document/ControlLease/identity/target 当前可用。Lode 的 action、origin、账号或
   target 声明只是上界和匹配条件，不是授权。
5. **Egress gate**：脚本输入、页面材料、normalized output、evidence 和模型/网络/
   文件 receiver 分别经过既有敏感性、Grant、origin、Network、file 或 Model Usage
   合同。默认不把页面或脚本输出送往外部 receiver。
6. **Business gate**：任务的 post-check 证明目标和输出完整；Runtime `completed`、
   HTTP 2xx、DOM 文本、schema 通过或 process exit code 不能替代业务验证。

这些门的结果投影到既有 operation/Run/failure/ExternalOutcome。不要建立一个与
`ConnectionState`、`InstanceState`、`ControlState`、`RunState` 或 `ExternalOutcome`
平行的 site-task 状态机。

## 4. 发现、安装与任务调用

### 4.1 发现

任务发现必须显示 Lode 的 `package_ref`、固定 `revision_ref`、`version`、
`task_ref`、action、required capabilities、input/output schema、known branches、
verification requirements、data-handling 限制和当前可执行门状态。它必须区分
`knowledge_only`、`package_invalid`、`code_not_admitted`、`not_installed`、
`disabled`、`runtime_unavailable`、`not_authorized` 和 `executable_ready`。

发现只读元数据，不启动 Runtime、不建立 Connection、不派发浏览器动作、不读取
未授权正文或 live evidence。没有任务声明的包不能作为正式 task 出现在可执行列表。

这会形成一个新的、受授权上下文过滤的 site-task/capability projection，因此
`DO-PLUGIN-EXPOSURE` 已触发。实现必须把它作为现有 `webenvoy_describe`/capability
catalog 或 `webenvoy_operation` 的受限扩展来落地；本合同不新增 `site_skill_run`、
第二 MCP tool、第二 registry 或动态 Provider endpoint。S1 的命令/信任合同拥有
最终公开字段和兼容规则；在该合同接受前，实现不能自行发明另一套 CLI/MCP 命令。

### 4.2 现有 managed lifecycle

安装路径固定如下：

1. Core 只接受批准 source manifest 中的完整 `revision_ref`，校验 Lode package digest
   和文件摘要，并按 #508 `skill.install` 安装；第一次保持 disabled。
2. Owner/受信管理入口显式 `skill.enable` 选定已安装、兼容、完整且 code-admitted 的
   revision。Agent 不能用网页 Grant、task scope 或文本内容把未准入 revision 变成可执行。
3. `skill.read` 只读取当前 enabled revision，返回既有 receipt；不会将正文写入 Run、
   operation metadata 或持久历史。任务执行只消费已校验的 package bytes/hash。
4. `skill.update`/`skill.rollback` 只接受明确已安装目标和 CAS。新 Run 可以选择新
   revision；已经 admission 的 Run 固定原 revision 和 script digest。local modified
   保留为既有 #508 状态，不被安装、更新或回滚覆盖。
5. `skill.disable` 阻止后续新的 task admission，但保留内容、选择、历史和旧 Run
   事实；它不撤销已产生的 ExternalOutcome，也不远程抹除 Agent 已读上下文。

Lode package 的 `package_ref`/version/hash 是身份真相；Core 只保留 verified projection
和历史引用。manifest、package digest 或 compatibility 不一致必须 fail closed，不能
用 `latest`、当前工作树、另一个 package 或旧 script 代替。

### 4.3 逻辑调用语义（不是新增 wire）

任务运行必须沿 S1 确认的现有 operation envelope，使用一个当前有效的 Principal/
Connection/Grant、原有 `idempotency_key`、`grant_id`、`task_scope`、`profile_ref`、
必要的 `runtime_session_ref`/`page_ref` 和 Core Run。下列是跨仓必须满足的逻辑元组，
不是本文件单独新增的 CLI、MCP 工具或 JSON wire：

```yaml
site_task_request:
  operation: <Lode task.operation_id, already exposed by WebEnvoy>
  skill_ref: <managed lifecycle projection>
  package_ref: <Lode package identity>
  revision_ref: <revision resolved and pinned by Core>
  task_ref: <Lode task identity>
  idempotency_key: <existing Core operation key>
  grant_id: <existing Core Grant>
  task_scope: <existing browser/skill scope; further narrows authority>
  profile_ref: <existing selected Profile>
  page_binding: <current Harbor Page/document/observation binding when required>
  inputs: <Lode input schema validated value>
```

调用方不能自行提交未安装 revision、任意 package path、Provider handle、selector、
Cookie、Token、raw CDP/Juggler text、任意文件路径或未声明 input。Core 必须从受管
选择解析 `revision_ref` 并把它固定到 Run；调用方提供的期望值只用于冲突检查，不是
绕过 install/enable/admission 的选择器。

最小结果继续使用既有 `{ok, run_id, status, result?, failure?}` envelope。下例只是
说明必须可追溯的结果内容，不是第二个 result schema：

```yaml
site_task_result_projection:
  ok: true
  run_id: <existing Core Run>
  status: completed
  result:
    package_ref: <Lode package>
    revision_ref: <pinned revision>
    task_ref: <Lode task>
    data: <Lode normalized output>
    completeness: complete # complete | partial | empty | unknown
    verification: verified # verified | incomplete | failed | unknown
    evidence_refs: [<opaque Core/Harbor refs>]
  failure: null
```

Core/Harbor 的 operation status、`dispatch_state`、`ExternalOutcome`、failure code 和
unknown 仍按既有合同返回。`completeness`/`verification` 是 Lode 结果的投影，不能
覆盖 `unknown_outcome`；具体公共字段必须在 S1/Plugin exposure 的实现合同中注册，
否则只保留既有 envelope 和 Run metadata。

## 5. 受管执行位置与 OS 权限

Lode `scripts/` 中的第三方或站点代码不得被 import、eval 或直接执行在 Core/Harbor
进程内。WebEnvoy 只能把它交给 S1/Harbor 批准的受限 Agent-side OS 进程或等价 worker；
`managed_runtime_worker` 是这里的逻辑执行位置，不是本文件新建的 runner，要求如下：

- **进程边界**：script 在独立于 Core/Harbor 的受限 Agent-side OS 进程或既有等价
  worker 中运行。S1/Harbor 拥有 OS identity、owner/control socket 和 role matrix；
  S2 不新增每个 Agent 的授权系统、第二身份系统或自己的路径隔离规则。
- **文件权限**：包被只读挂载或等价地以不可写已校验 bytes 提供；工作目录是 task
  范围的临时目录。允许读取包内声明文件、当前输入和由 Core/Harbor 发放的不透明
  material ref；允许写入只有正式的临时 material/evidence/result sink。经代码准入的
  script 只有 S1/Harbor worker 已明确允许的本机文件范围和正式 file/material capability，
  不能自行增加路径；OS 权限必须拒绝任意绝对路径、`..`、Lode checkout、Profile/data
  root、用户 HOME、credential store 和未声明文件。
- **网络权限**：未声明的 raw socket、任意 DNS 和任意出站连接默认拒绝；经代码准入的
  script 如需本机网络，只能使用 S1/Harbor worker 已明确允许的范围和已接受的 Network
  capability/Harbor broker。目的 origin、请求类型、数据敏感等级和 Grant 仍由既有合同
  检查。S4 未接受前不能读取或修改 response/request body，也不能把脚本网络权限当作
  账户或网页权限。
- **身份与凭据**：S1/Harbor worker OS identity 只用于进程级最小权限，不代表用户授权。
  Core 在调用边界继续核对 Principal/Grant/Connection；Cookie、Token、local/session
  storage、Profile path、browser credential store 不能以参数、环境变量或挂载进入
  script。
- **输入/输出**：script 只收到版本化、哈希绑定的 code reference、有界 input、当前
  observation/target 的不透明 ref、timeout/cancel 和允许的 capability refs；输出只
  能是有界 schema 数据或既有 evidence/result ref。禁止动态下载、安装依赖、fork
  未声明进程、隐藏 side effect、任意 shell、任意 JavaScript/eval、CDP/Juggler 或
  Provider-private endpoint。

OS 进程、只读包、临时目录和默认网络拒绝是执行合同的安全前提；HTTP/MCP `grant_id`
或“API 已授权”本身不是 sandbox 证据。实现必须在实现 Work Item 的 candidate 和
verification 中记录实际平台技术、worker identity、文件挂载/拒绝、网络 allow/deny
和清理事实。本文件不把上述要求实现成 Lode runner、hosted registry 或第二 sandbox
产品。

同一 OS 用户下的不同 bearer、路由、环境变量或约定路径不构成 Agent/owner 隔离；若
worker 能读取 owner-controlled 文件或 owner control socket，即使 API Grant 有效也必须
拒绝 script。独立 service UID 本身也不足以证明隔离。S1/实现候选必须先证明宿主实际
强制了进程、socket、文件和网络边界；缺少该证据时只能提供包读取或 `knowledge_only`，
不得报告 code-admitted 或 executable-ready。这里的 OS 边界是受限执行前提，不是面向
任意不可信代码的通用 sandbox。

## 6. Script 与 Runtime capability

脚本每次执行必须同时绑定：

- Lode `package_ref`、`revision_ref`、`script_ref`、source/version/hash；
- 明确 `runtime_kind`、entrypoint、execution world、timeout、cancel、effect/action
  class、input/output schema；
- 当前 Instance、Page、Frame、document generation、observation/target ref；
- Core 已接受的 capability refs、Principal/Grant/task scope 和 ControlLease 要求；
- Core Run、operation/idempotency 和结果/evidence 关联。

script 可以请求当前 observation 并基于最新结果取得新的 target。导航、节点替换、
人工接管、ControlLease generation、Runtime 重启或 document generation 改变后，旧
target/observation/cursor 立即失效；script 必须 fresh observe，不能 selector 重找、
按文本猜测或把旧 ref 绑定到新节点。受控 evaluation 复用 [Browser Runtime
Capabilities V1 §13](browser-runtime-capabilities-v1.md#13-controlled-evaluation) 的
stable id/source/version/hash、world、exact args、target、timeout/cancel、effect class
和 bounded result，不向普通 Agent 暴露 Provider 原生 evaluate。

动作类别复用 Lode ADR 0007 的 `read`、`prepare`、`commit`、`destructive`，再由 Core
检查当前 Grant、ControlLease、confirmation、Profile/identity 和 Runtime safety。
`read` 不自动允许数据外发；`commit`/`destructive` 不因 task declaration 存在就获准。
脚本缺 capability、当前现场不匹配、ControlLease 不可用或目标过期时，在派发前局部
拒绝为 `not_dispatched`，不得改投另一个 Provider、Profile、页面或内部 HTTP。

fresh observe 或 target ref 更新本身不强制模型调用或重新认证；只要同一 Principal、
Grant、task scope 和有效期仍满足，固定版本的确定性 task 可以走零模型的正常路径。Core
仍须在每次新派发前重新检查撤销、过期、现场和 capability，不得用旧授权或旧 observation
代替检查。

## 7. 数据外发与结果语义

包、SKILL 文本、页面内容、console 文本、网络材料和脚本输出都是任务数据，不是外部
指令。默认处理如下：

- 只向 Core/Harbor 既有结果/evidence 引用写入最小化、脱敏、schema 约束后的数据；
  不把 raw DOM/HAR、Cookie、Token、Profile storage、完整 request/response、截图或
  用户业务内容写入 Lode 或普通 Run metadata。
- 发给模型、第三方 API、文件、Network receiver 或用户可见 Plugin 的每一份数据都
  经过该 receiver 的既有 owner/Grant/Model Usage/Network/file contract。Lode 的
  `external_egress: none|declared` 只是需求，不能授予外发。
- active Network、response body、request modification、视觉读取或截图存储需要相应
  S4/S5 合同、能力、scope、脱敏和证据；没有这些合同时任务在对应门阻断或选择不含
  外发的路径。缺少可选 viewer/evidence 不得阻断不依赖它的浏览器管理和本地结果。
- 内容截断、分页遗漏、空结果、source/evidence 缺失和 normalization failure 必须
  在既有 result/failure 中明确表达；不能为得到 `ok` 而静默省略数据。

业务成功只在 Lode post-check 对当前可信 target、normalized output 和 required
evidence 验证后成立。浏览器动作 `completed`、HTTP 2xx、页面文本存在、脚本 exit 0、
output schema 通过都只是 Runtime 或数据层事实。

## 8. Run、unknown、停止与恢复

每次 task admission 必须可从现有 Core Run/operation 回溯：Lode package/task/revision
和 script digest、validated input、grant/principal/profile/page binding、capability
和 action、dispatch state、output/verification refs、failure/ExternalOutcome。它们是
现有 Run/receipt 的归因信息，不是新的 site-task persistence schema。

- 派发前失败为 `not_dispatched`；可在修正输入、授权或现场后，由用户明确提交一个
  新任务和新 idempotency key。不能把安装/启用失败伪装为浏览器失败。
- 已派发且响应丢失、Harbor receipt 缺失、Provider 关系无法证明或 worker 被中断时，
  保留既有 `dispatched` + `unknown_outcome`。只允许用原 Run/operation/idempotency key
  查询、对账、停止后续动作或人工接管；不得换 key、重新加载页面、换 script version、
  重做 write 或用当前页面状态覆盖历史 unknown。
- cancel/stop/revoke 只停止后续步骤，不自动回滚已经发生的外部效果。late output 不能
  覆盖 Core 已记录的结果；用户接管后需要 fresh observe，并以新控制世代重新授权。
- 包 update/rollback/disable 不能改变进行中 Run 的 pinned revision；新 Run 在新的
  lifecycle/admission 门上重新判断。local modified 按 #508 失败，不能被静默覆盖。

## 9. 最小场景与固定结果

| 触发场景 | 固定行为 |
| --- | --- |
| 只导入知识 | 返回或记录 `knowledge_only`；可以读取获准 references，但没有正式 task entrypoint，不能 dispatch。 |
| 页面节点被替换 | 旧 target ref 失效；fresh observe 取得新 ref 后才可继续。旧 ref 不得静默重绑。 |
| 写入 response 丢失 | 原 Run 保持 `dispatched`/`unknown_outcome`；只 query/reconcile 原 operation，不创建新 script/version/key。 |
| 包在任务中更新 | admission 时固定旧 revision；更新只影响未来 Run。local modified 不被覆盖。 |
| output schema 通过但分页遗漏 | `completeness=partial` 或 `unknown`，post-check 不通过；不能报告业务成功。 |
| Lode digest 与受管 material 不一致 | Core 返回既有 managed asset integrity/local-modified failure；不执行 script，不回退到另一个包。 |
| API Grant 有效但 worker 无 OS 文件/网络权限 | 在 Runtime/worker gate 局部阻断；API 授权不能制造文件或网络权限。 |

## 10. Design Obligation disposition

| Obligation | 本候选判断 | 依据和实施前门槛 |
| --- | --- | --- |
| `DO-PLUGIN-EXPOSURE` | `triggered` | 安装 task 的动态发现、按当前 Grant/SKILL/host 过滤和 task→existing-operation projection 是新 Agent-facing capability；本文件给 specialist 语义，实施前必须同步 Plugin Runtime Exposure/Capability Discovery 的真实入口、版本、错误、安装和兼容。 |
| `DO-GRANT-WIRE` | `not-triggered` | 运行复用现有 `skill_scope`（管理）与 browser `allowed_operations`、Profile/origin/task scope、ControlLease 和既有 action/identity policy；本候选不新增 site-task、script 或 egress 持久 Grant 字段。若实现引入专属字段、外发 receiver grant 或新的确认 wire，必须先改为 `triggered` 并更新 Grant 合同。 |
| `DO-NETWORK-CONTRACT` | `conditional` | v1 默认拒绝 script raw network，不新增公共 request/response payload；使用主动 Network、body、interception 或 modification 前必须由 S4 提供并接受 Network Runtime 合同。 |
| `DO-CONSOLE-CONTRACT` | `not-triggered` | script 不新增 console/page-error public payload；只消费既有有界诊断或 failure。 |
| `DO-PROVIDER-PRIVATE-SCHEMA` | `not-triggered` | 不持久化 Provider launch/context/handle/private environment bundle；worker 用既有 Harbor/runtime 边界。 |
| `DO-APP-IA` | `not-triggered` | 不新增完整 App Library、Activity、任务工作台或导航；沿用现有 owner/Agent/handback 入口。 |

## 11. 非目标、supersession 与集成顺序

本文件不实现 runner、sandbox、registry、Marketplace、站点转换、账号登录、Provider
适配、网络/视觉能力、任意脚本、通用 DSL、后台任务队列、第二 Run/receipt 状态机、
S3 的探索/导入/OpenCLI/验证修复实现或真实站点验收。它也不把文档、fixture、fake
Provider、源码客户端或 Plugin 可见性当作 installed/live/plugin_verified 证据。

本文件在 #563 接受后，仅 supersede #508 中“SKILL 脚本执行尚未定义”的本轮非目标，
并为已接受的 #508 asset lifecycle 增加 task execution consumer。它不覆盖 #508 的
安装/选择/CAS/receipt/unknown 语义，不覆盖 Grant、Browser Runtime、Network、Console、
Provider 或 App IA 的 owner。若实现要新增跨进程字段，应先由对应 Design Obligation
更新 owner 合同，不能在实现 PR 中悄悄扩 wire。

跨仓集成顺序为：

1. 评审并接受 Lode `codex/spec-563-package` 的精确提交；
2. 以该提交作为本分支 `codex/spec-563-skill` 的 package companion，完成 Core/Harbor
   执行、S1 命令/信任、Plugin exposure 和 Design Obligation 对齐；
3. 两个候选接受后，由集成 owner 更新 WebEnvoy/Lode 共享索引，并把本文件的候选链接
   替换成合入后的稳定 `main` 链接；
4. 实现 Work Item 再提供准确的 Lode manifest、code-admission 记录、OS worker 文件/
   网络权限、Grant/Run schema、installed Agent 和 live site 证据。接受本规格不授予
   安装、运行、外发、合并或发布授权。

后续真实站点验收至少绑定同一候选 SHA、Lode package `revision_ref`/source commit/
package digest、WebEnvoy/Harbor/Provider 版本、正式安装身份、Principal/Grant/Profile/
Instance/Page、OS worker 的实际文件/网络拒绝与清理证据，并由真实第三方 Agent 经过
Plugin 完成 install/enable、task discovery、正常执行、fresh target、分页完整性、
post-check 和 query/reconcile。响应丢失的 write 必须证明原 Run/operation 对账而无重放；
知识-only、未准入、local modified、不可用和 unknown 必须保留各自状态。fixture、mock、
源码客户端、文档接受或零模型声明不能替代这些证据；正常固定路径若声称零模型，须由
实际调用记录证明，而不是由 package metadata 推断。
