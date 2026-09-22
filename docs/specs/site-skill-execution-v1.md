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

## 3. 执行前准入门、执行后结果门与状态

只有前五个 **执行前准入门** 都通过，Core 才能把 task 从 admission 推进到 Runtime
派发；第六个 **Business gate** 发生在派发之后，不能反过来成为执行前提。这样既保留
业务成功的独立判定，也允许知识包按 #508 完成资产生命周期操作。

### 3.1 执行前准入门

1. **Package gate**：Lode manifest、`package_ref`、`revision_ref`、package digest、
   compatibility、task、schema、pre/post-check 和 repair refs 完整且相互一致。没有
   task declaration 的完整包在此返回 `knowledge_only`；该状态阻止 task dispatch，
   不阻止获准的 install、enable 或 read。
2. **Code gate**：指定 script source/version/hash 已通过 WebEnvoy 的受管可信代码准入，
   且准入记录绑定同一 package revision 和 script digest。没有准入时只能管理或读取
   资产，不能进入 script dispatch。
3. **Lifecycle gate**：Core 按 #508 对完整 revision 执行显式 install/enable/read，
   保持 disabled-by-default、CAS、来源和摘要校验。`enable` 只表示资产可被读取和
   选择，不等于 code admission；安装和启用不运行 script、不自动登录、启动浏览器或
   取得 ControlLease。
4. **Runtime gate**：Core 计算 `Profile ceiling ∩ Principal Grant ∩ task scope ∩
   declared capabilities ∩ current Runtime safety`，Harbor 证明 Instance/Page/
   document/ControlLease/identity/target 当前可用。Lode 的 action、origin、账号或
   target 声明只是上界和匹配条件，不是授权。
5. **Egress gate**：脚本输入、页面材料、normalized output、evidence 和模型/网络/
   文件 receiver 分别经过既有敏感性、Grant、origin、Network、file 或 Model Usage
   合同。默认不把页面或脚本输出送往外部 receiver；未声明或未获准的范围在派发前
   局部阻断。

知识-only 包可通过第 1、3 门进入 `skill.enable`/`skill.read` 的资产路径；它不会
通过第 2、4、5 门，也不会出现在可执行 task admission 中。`skill.inspect` 的静态
任务摘要将运行时授权标为 `not_evaluated`；真正的 Runtime/Grant/Harbor 判断只在
下面固定的 `/tasks` admission 中发生。

### 3.2 执行后结果门

6. **Business gate**：Core 已记录 Run 并派发 Runtime 后，Lode post-check 对当前
   target、normalized output 和 required evidence 验证目标和输出完整，再将结果映射到
   既有 Result Envelope。Runtime `completed`、HTTP 2xx、DOM 文本、schema 通过或
   process exit code 不能替代业务验证；失败、partial 或 unknown 必须保留各自结果。

这些门的结果投影到既有 operation/Run/failure/ExternalOutcome。不要建立一个与
`ConnectionState`、`InstanceState`、`ControlState`、`RunState` 或 `ExternalOutcome`
平行的 site-task 状态机。

## 4. 发现、安装与任务调用

### 4.1 发现

任务发现必须显示 Lode 的 `package_ref`、固定 `revision_ref`、`version`、
`task_ref`、action、required capabilities、input/output schema、known branches、
verification requirements、data-handling 限制和门状态（未评估的 Runtime 门必须标为
`not_evaluated`）。它必须区分
`knowledge_only` 与已声明 task；管理投影不能把未在该上下文评估的
`package_invalid`、`code_not_admitted`、`not_installed`、`disabled`、
`runtime_unavailable`、`not_authorized` 报成 `executable_ready`。这些动态状态由现有
Core `/tasks` admission 的 `FailureRecord`/Run 事实返回。

发现只读元数据，不启动 Runtime、不建立 Connection、不派发浏览器动作、不读取
未授权正文或 live evidence。没有任务声明的包不能作为正式 task 出现在可执行列表。

这会形成一个新的、受授权上下文过滤的 site-task metadata projection，因此
`DO-PLUGIN-EXPOSURE` 已触发。正式入口已经固定为现有
`webenvoy_skills` 的 `skill.inspect` operation；其 `result.skill.site_tasks` 可选字段
使用 `webenvoy.site-task-summary/v1`，不增加新的 MCP tool、输入字段、registry 或
Provider endpoint。`skill.inspect` 只返回通过现有 `skill_scope`、task scope、批准
source/revision 和包完整性校验的任务摘要；未授权或无效任务被过滤或沿既有
`managed_*`/source-corrupt 错误返回，不披露名称、路径、正文或摘要。

这个摘要只报告包/生命周期事实，运行时授权状态为 `not_evaluated`；它不冒充 task
执行许可，也不由 `webenvoy_describe` 扩展。任务提交固定沿现有 Core `POST /tasks`
和 `webenvoy.task-intent.v0`，其请求、Run 归属、错误和 Result Envelope 见 §4.3。
S1 只拥有 CLI/client 投影和信任，不改变这里的 task 语义或字段。

### 4.2 现有 managed lifecycle

安装路径固定如下：

1. Core 只接受批准 source manifest 中的完整 `revision_ref`，校验 Lode package digest
   和文件摘要，并按 #508 `skill.install` 安装；第一次保持 disabled。
2. Owner/受信管理入口显式 `skill.enable` 选定已安装、兼容且完整校验的 revision。
   `skill.enable` 不要求 code admission；Agent 不能用网页 Grant、task scope 或文本
   内容把未准入 revision 变成可执行。
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

### 4.3 现有 Core Task Intent 调用语义（不是新增 wire）

任务提交的唯一语义入口是现有 Core `POST /tasks`。API、CLI、MCP、SDK 和 App 的
投影都必须生成同一个 `webenvoy.task-intent.v0`；S1 只负责 CLI/client 投影和信任，
不定义另一套 site-task 命令。`webenvoy_operation` 继续承载浏览器能力，
`webenvoy_skills` 继续承载资产管理，二者都不是 task dispatch 的第二入口。

请求 body 使用现有字段 `run_id`、`package_ref`、`task_intent`，以及需要时现有的
`harbor`（只允许当前 Core API 已接受的公开字段；`public_query` 仅用于已有任务）：

```json
{
  "run_id": "run_example_001",
  "package_ref": "lode://site-skill/example/catalog@1.0.0",
  "task_intent": {
    "schema_version": "webenvoy.task-intent.v0",
    "intent_id": "intent_example_001",
    "entrypoint": "mcp",
    "user_intent": {"summary": "读取当前目录摘要"},
    "capability": {
      "ref": "lode:capability/catalog-read",
      "version": "1.0.0",
      "source_ref": "lode://site-skill/example/catalog@1.0.0",
      "lock_ref": "lode://lock/site-skill/example/catalog@1.0.0"
    },
    "input": {"summary": "当前目录", "refs": []},
    "scope": {"target_type": "catalog_page", "target_ref": "https://example.com/catalog"},
    "policy": {"risk": "read", "execution_intent": "read", "timeout_ms": 30000},
    "resource_requirement_refs": ["lode://resource/example/catalog-read@1.0.0"],
    "evidence_policy_ref": "lode://evidence-policy/example/catalog-read@1.0.0"
  },
  "harbor": {
    "identity_environment_ref": "identity-env:example",
    "url": "https://example.com/catalog"
  }
}
```

Lode 的 `task_ref` 不成为 Task Intent 顶层字段：Lode package manifest 将它解析到
`capability.ref`、version、source 和 lock；`package_ref` 选择包版本，Lode resolver
在 Core admission 前固定唯一 `revision_ref` 和 package digest。Core 不新增
`revision_ref`、`task_ref`、`skill_ref`、`profile_ref`、`page_binding` 或任意脚本字段。
现有 Run 以 `task_intent_ref`、`capability_ref`/version/source/lock、`package_ref`、
scope、admission、runtime binding、result/evidence refs 归属；Lode revision/digest
由 resolver 的 package contract 作为同一 pin 的验证材料，不另建 Run 或 registry。

Core 先按已有 Task Intent 严格拒绝未知字段和私有输入，再校验 Lode package contract、
现有 Principal/Grant/task scope、Profile/Runtime/Harbor 条件；调用方不能提交未安装
revision、任意 package path、Provider handle、selector、Cookie、Token、raw CDP/Juggler
text、任意文件路径或未声明 input。请求已被接受时，现有 `/tasks` 提交响应为 HTTP 202，
body 直接投影现有 Run（下列省略 Run 的其他既有字段）：

```json
{
  "ok": true,
  "task_intent": {"schema_version": "webenvoy.task-intent.v0", "intent_id": "intent_example_001"},
  "run": {
    "run_id": "run_example_001",
    "task_intent_ref": "intent_example_001",
    "capability_ref": "lode:capability/catalog-read",
    "capability_version": "1.0.0",
    "capability_source_ref": "lode://site-skill/example/catalog@1.0.0",
    "capability_lock_ref": "lode://lock/site-skill/example/catalog@1.0.0",
    "package_ref": "lode://site-skill/example/catalog@1.0.0",
    "status": "admitted"
  },
  "evidence_refs": [],
  "runtime_binding_refs": []
}
```

`run.status` 是现有 Run 状态，提交返回时可按执行进度为 `admitted`、`running` 或
已有终态；它不是 site-task 状态。提交失败仍使用现有 `FailureRecord`：结构错误为
HTTP 400（例如 `task_intent_required`、`schema_version_unsupported`、未知字段或
`package_ref_required`），`capability_contract` 为 HTTP 422（例如
`package_contract_required`、`package_ref_mismatch`、`capability_ref_mismatch`、
`capability_version_incompatible`、`package_lock_mismatch`），资源/现场 admission
为 HTTP 503，`run_id_already_exists` 或 action-risk 冲突为 HTTP 409。具体 code 继续
由 Core 的既有 failure mapping 负责；本规范不建立 site 专属错误表。已派发但结果
无法证明时，原 Run/query 使用现有 `unknown_outcome`，不得换 key 重放。

终态查询或结果投影使用现有 `webenvoy.result-envelope.v0`，而不是第二个 site result
schema：

```json
{
  "schema_version": "webenvoy.result-envelope.v0",
  "run_record_ref": "run_example_001",
  "ok": true,
  "outcome": "success",
  "terminal": true,
  "capability_ref": "lode:capability/catalog-read",
  "capability_version": "1.0.0",
  "package_ref": "lode://site-skill/example/catalog@1.0.0",
  "result_ref": "result:example-001",
  "result_kind": "catalog-read",
  "output_schema_id": "lode://schema/example/catalog-read-output@1.0.0",
  "data": {"items": []},
  "evidence_refs": ["evidence:example-001"],
  "post_check": {
    "schema_version": "webenvoy.post-check-result.v0",
    "status": "passed",
    "summary": "The package post-check passed.",
    "consumer_boundary": "Core stores only the bounded post-check and opaque evidence refs."
  }
}
```

Lode 的 `completeness`、normalization 和 verification 只能作为 `data`/`post_check` 的
既有受约束内容，不能覆盖 Core 的 `outcome`、`unknown_outcome`、`dispatch_state` 或
ExternalOutcome。业务 gate 只在这一步之后成立；Core/Harbor 的 Run、query、reconcile
和 recovery 继续拥有停止与 unknown 语义。

## 5. 受管执行位置与 OS 权限

Lode `scripts/` 中的第三方或站点代码不得被 import、eval 或直接执行在 Core/Harbor
进程内。本 v1 选定的执行位置是 **S1 批准的 Agent-side managed worker 进程**；它是
受管 trusted-code host，不是本文件新建的 runner，也不是面向任意不可信代码的通用
sandbox。S1/Harbor 负责宿主的真实边界，S2 只规定包如何使用它：

- **进程和身份**：worker 独立于 Core/Harbor 进程运行，使用 S1 分配的 Agent OS
  identity；owner control socket 由 owner identity 持有并以宿主 ACL 排除 Agent
  identity。S1/Harbor 还拥有 worker 的监督、停止、清理和 role matrix。S2 不新增第二
  Agent/owner 身份、bearer 隔离或路径约定。
- **代码准入不等于 OS 权限**：WebEnvoy 的 trusted-code admission 只绑定允许加载的
  `package_ref`、`revision_ref`、`script_ref` 和 source digest；准入后代码仍只能使用
  worker identity 已有的宿主权限，SKILL 声明、Grant 或 API credential 都不能扩大它。
- **文件**：包以只读已校验 bytes 提供，临时工作目录归 Agent identity 且按 task 管理。
  worker 可访问的本机文件仅是 S1/Harbor role matrix 已允许的包 root、声明的
  material/file capability 及 result/evidence sink；owner/Profile/credential 数据根和
  其他未声明路径由宿主 ACL 拒绝。S2 不声称一个不存在的“任意文件全拒绝”沙箱。
- **网络**：worker 的直接网络权限由 S1/Harbor role matrix 实际决定；没有获准 Network
  capability 时不得联网，有获准范围时只能使用该范围或 Harbor broker。超出 task
  declaration、Grant、origin 和 task scope 的 DNS/socket/出站由宿主拒绝；S2 不新增
  Network body/interception/modification 合同，也不把网络权限当作账户或网页权限。
- **输入/输出**：script 只收到版本化、哈希绑定的 code reference、有界 input、当前
  observation/target 的不透明 ref、timeout/cancel 和允许的 capability refs；输出只能
  是有界 schema 数据或既有 evidence/result ref。禁止动态下载、安装依赖、fork 未声明
  进程、隐藏 side effect、任意 shell、任意 JavaScript/eval、CDP/Juggler 或
  Provider-private endpoint。Cookie、Token、local/session storage、Profile path、
  browser credential store、用户 HOME 不能以参数、环境变量或隐式挂载进入 script。

同一 OS 用户下的不同 bearer、路由、环境变量或约定路径不构成 Agent/owner 隔离；若
worker 能读取 owner-controlled 文件或 owner control socket，即使 API Grant 有效也必须
拒绝 script。独立 service UID 本身也不足以证明隔离。S1/实现候选必须证明 Agent identity、
owner socket ACL、包/临时目录访问和实际网络 role matrix；缺少这些宿主强制事实时只能
提供包读取或 `knowledge_only`，不得报告 code-admitted 或 executable-ready。实现验证必须
记录上述真实 OS 技术、worker identity、挂载/ACL、网络 allow/deny 和清理事实；HTTP/MCP
`grant_id` 或“API 已授权”本身不是 OS 权限证据。

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
| `DO-PLUGIN-EXPOSURE` | `triggered` | 入口已固定为现有 `webenvoy_skills.skill.inspect` 的可选 `webenvoy.site-task-summary/v1` 元数据投影；投影按现有 `skill_scope`、task scope、批准 source/revision 和完整性过滤。执行入口已固定为 Core `POST /tasks` 的 `webenvoy.task-intent.v0`，错误沿既有 `FailureRecord`/HTTP mapping，结果归属现有 Run 与 `webenvoy.result-envelope.v0`；本文件、Plugin Runtime Exposure 与 Lifecycle 的窄增量必须保持这组字段一致。 |
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
