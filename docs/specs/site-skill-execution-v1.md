# Site SKILL Execution V1

状态：经独立审查并合入 main 后成为 Accepted 实施基线，不表示执行器或真实站点已验收；版本：v1；产品归口：`#563`（parent `#475`）；owner：Core（准入、授权、Run、结果与恢复）、Harbor（受管浏览器现场、Page/target、ControlLease）及第 5 节定义的 Agent-side worker host。Plugin、CLI、API 共同投影 Core 语义。

包定义由配套 [Site SKILL Package V1](https://github.com/WebEnvoy/Lode/blob/608ebfa425fbdeb4e651cb438d1e97c2618f2bc8/docs/contracts/site-skill-package-v1.md)
拥有；该链接固定合同内容，引用本身不表示包合同已经接受或进入 `main`。

本文件定义一个已安装、已固定版本、已获运行授权的 site SKILL task 如何进入现有
WebEnvoy Runtime 并得到结果。它不拥有 Lode 的包身份、version、source/hash、任务
声明或 schema；这些由 [Lode Site SKILL Package V1](https://github.com/WebEnvoy/Lode/blob/608ebfa425fbdeb4e651cb438d1e97c2618f2bc8/docs/contracts/site-skill-package-v1.md)
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
   资产，不能进入 script dispatch。仅引用已有正式 capability、没有 script 的 task
   不加载包代码；此时校验该 capability 的固定来源和正式执行映射，不要求不存在的
   worker。若 pre/post-check 或 normalizer 实际执行包内代码，同样适用 script 准入，
   不能以检查或规范化的名称豁免。
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
下面固定的 `webenvoy_task` managed-task admission 中发生。该入口内部调用 Core task
service，不把 owner `/tasks` 路由暴露给普通 Agent。

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

任务发现必须显示 Lode 的 `package_ref`、固定 `revision_ref`、唯一 package-level
`package_digest`、`version`、
`task_ref`、entrypoint 的 script identity/ABI（若有）、required capabilities、input
schema/carrier/size、output schema、known branches、
verification requirements、data-handling 限制和门状态（未评估的 Runtime 门必须标为
`not_evaluated`）。它必须区分
`knowledge_only` 与已声明 task；管理投影不能把未在该上下文评估的
`package_invalid`、`code_not_admitted`、`not_installed`、`disabled`、
`runtime_unavailable`、`not_authorized` 报成 `executable_ready`。这些动态状态由
`webenvoy_task` admission 投影的现有 Core `FailureRecord`/Run 事实返回。

上述字段必须逐项来自 [Managed SKILL Library Lifecycle V1 的 #563 projection](skill-library-lifecycle-v1.md#563-site-task-metadata-projection)：
`required_capabilities` 是完整的 Lode `entrypoint.capability_refs` 解析集合，也可以在
script-only task 中为空；不能由单个 `capability_ref` 缩减，也不能从 `script_ref` 猜出
能力。script-backed task 同时投影 `script_ref`、source/version/hash、固定 ABI/broker；
`known_branches`、`verification` 和 `data_handling` 只在 Lode 声明并通过静态校验后投影。
`result.skill.skill_ref` 与摘要的稳定 `package_ref` 采用同一
包身份，摘要的 `revision_ref` 才带 `@version#source-commit`；Plugin 不重新解释这些
字段，也不增加 Runtime preflight。

合法 script-only task 仍是 `task_support=declared` 的可发现任务，不降级为
`knowledge_only`。但当前既有 `webenvoy.task-intent.v0` 要求 `capability.ref`/version，
`webenvoy_task.task.submit` 没有 script-only 的正式 Task Intent 映射；它沿既有
`request_invalid`/`capability_ref_required` 边界在创建 Run 前拒绝。它不从 script 生成
能力、不声称可执行，也不新增 runner、registry、tool 或 Runtime preflight；§5 的受管
script ABI/broker 只作为未来兼容映射必须复用的有界执行宿主。

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
执行许可，也不由 `webenvoy_describe` 扩展。普通 Agent 的任务提交固定沿 §4.3 的
`webenvoy_task`/`POST /managed-tasks/operations`，由该 projection 内部映射同一
`webenvoy.task-intent.v0`、Run 归属、错误和 Result Envelope。S1 只拥有 CLI/client
投影和 trust channel，不改变这里的 task 语义或字段。

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

Lode package 的稳定 `package_ref` 与版本化 `revision_ref`/hash 是身份真相；Core 只保留
verified projection 和历史引用。manifest、package digest 或 compatibility 不一致必须
fail closed，不能用 `latest`、当前工作树、另一个 package 或旧 script 代替。对同一
`package_ref` 的升级保持既有 `skill_ref` 不变，只重新选择获准的完整 `revision_ref`；
不同 `package_ref` 不得借旧的 skill scope 伪装为同包升级。

### 4.3 普通 Agent 的 managed task projection

当前 `/tasks` 和 `/runs` 是 owner/supervisor bearer gate；它们不是普通 Agent 的入口。
Plugin 现有 `skill.inspect` 只读元数据，也不承担 task dispatch。#563 固定一个新的、
版本化的普通 Agent projection：MCP 工具 `webenvoy_task` 的 `task.submit`、
`task.query`、`task.stop`，以及同一语义的 managed-access API：

~~~text
POST /managed-tasks/operations
~~~

机器校验分别使用 [请求 Schema](../../packages/schemas/schemas/managed-task-operation-request.schema.json)
和 [响应 Schema](../../packages/schemas/schemas/managed-task-operation-result.schema.json)。

三个 operation 共用 `webenvoy.managed-task-operation/v1` 请求和
`webenvoy.managed-task-operation-result/v1` 响应；`task.query`/`task.stop` 也使用
这个 POST action envelope，避免把 Grant 或 task scope 放进 URL、隐式 header 或 owner
代理。实现必须把该 path 纳入现有 Agent credential route，并保留现有
`/tasks`、`/runs` 的 owner gate；未知 method、path、schema version 或字段明确拒绝。
CLI 是 S1 既有 `webenvoy agent` command root 下的 site-task 专门扩展，固定为：

~~~text
webenvoy agent task submit --request-file <path> --client-file <path>
webenvoy agent task query  --request-file <path> --client-file <path>
webenvoy agent task stop   --request-file <path> --client-file <path>
~~~

`--request-file` 携带对应 managed-task 参数，`--client-file` 复用 S1 已定义的 client
credential 文件及连接规则；两者都不能改变 Grant、task scope 或 Core task 语义。该扩展不修改既有
`webenvoy agent operation` 的 managed-browser envelope。S1 只拥有 CLI 参数解析和
trust channel，不能改写下面的 Core task 语义。

MCP tool arguments 与 CLI request-file 不接受 `connection_id`；Connector 从当前
`webenvoy_connect` context 取得连接，在发送到 `POST /managed-tasks/operations` 的
HTTP JSON body 中加入必填的字符串字段 `connection_id`。直接 API 消费者先用当前
Agent credential 调用既有 `POST /agent-connections`，再在每次 HTTP JSON body 的同一
字段提交返回的 connection ID；不引入额外 header 或隐式元数据。Core 从 bearer
credential 识别 Principal，核对所带 connection 是否属于该 Principal、仍有效且未撤销，
再取与其匹配的单一 Grant；缺失或无法确定 connection 时返回既有 connection error，不能
在多个活动 connection 中猜选。`connection_id` 是本次认证上下文，不是后续 query/stop
的永久 owner key；重连后由同一 Principal 的新有效 connection 重新通过当前 Grant/scope
检查即可。调用者不能选择 owner credential，也不能把 `/tasks` 或 `/runs` 作为 fallback。
以下三个 operation 的 JSON 示例均为 MCP/CLI 参数；对应 HTTP body 的完整 allowlist
就是各自参数字段加必填 `connection_id`。Connector 必须拒绝工具参数/request-file 中
试图注入该字段的请求；Core 独立校验 HTTP 字段，不因其来自 Connector 而信任。
Core 仍按既有 Principal/Connection/Grant 关系记录和审计。

#### submit 请求

`task.submit` 的 MCP/CLI 参数只允许下列字段；HTTP body 另须携带上述 `connection_id`：

~~~json
{
  "schema_version": "webenvoy.managed-task-operation/v1",
  "operation": "task.submit",
  "idempotency_key": "agent-task-001",
  "grant_id": "grant:example",
  "task_scope": {
    "operations": ["task.submit"],
    "skill_refs": ["lode://site-skill/example/catalog"],
    "source_refs": ["lode://site-skill/example/catalog@1.0.0#<source-commit>"],
    "profile_refs": ["profile:example"],
    "origins": ["https://example.com"]
  },
  "package": {
    "package_ref": "lode://site-skill/example/catalog",
    "revision_ref": "lode://site-skill/example/catalog@1.0.0#<source-commit>",
    "package_digest": "sha256:<64-lowercase-hex>",
    "task_ref": "catalog-read"
  },
  "target": {
    "target_type": "catalog_page",
    "target_ref": "target:catalog-page-001"
  },
  "input": {
    "schema_ref": "lode://schema/example/catalog-read-input@1.0.0",
    "carrier": "webenvoy.managed-task-inline/v1",
    "value": {"page": 1, "limit": 20, "query": "featured"}
  },
  "intent": {
    "summary": "读取当前目录摘要",
    "policy": {
      "risk": "read",
      "execution_intent": "read",
      "timeout_ms": 30000
    }
  }
}
~~~

`task_scope` 恰好包含五组唯一数组：`operations`、`skill_refs`、`source_refs`、
`profile_refs`、`origins`。每组只能收窄当前 Grant、Lode task
applicability 和当前现场；不接受 `file_refs`、路径、URL selector、脚本、Cookie、
Token、credential、Provider handle、owner 字段或 Agent 自带 allowlist。`operations` 在一次
请求中恰好是 `task.submit`；实际 Lode capability operation 仍由 Core 按其既有
`allowed_operations`、Profile ceiling、ControlLease 和 Runtime contract 重新检查。
没有浏览器目标的 task 必须提交空的 `profile_refs`/`origins`，而不是借 task scope
扩大网页范围。

`package.package_ref`、完整 `revision_ref`、唯一 package-level `package_digest` 和
`task_ref` 必须来自当前获准的 `skill.inspect` 摘要；`package_ref` 必须等于摘要中
`result.skill.skill_ref` 的稳定包身份，不能带 `@version`。`task_scope.skill_refs` 使用
同一个稳定 `skill_ref`，而 `task_scope.source_refs` 必须覆盖本次选中的完整
`revision_ref`/approved source；它们不是两个可由调用者自行拼接的包身份。digest 不是
Agent 自行计算或替换的第二身份。Core/Lode resolver 必须逐项核对该摘要与已安装、enabled、Lode manifest
完整性、source、task declaration、revision 和 `integrity.package_digest` 完全相等；
任何不一致均在 dispatch 前拒绝。客户端不能把另一个 revision、latest、工作树路径或
capability ref 冒充该 task。
`target_ref` 必须是当前 Harbor/Core 已登记的不透明 target ref；不能以网页 URL、selector
或最后一次页面状态替代。`intent.summary` 是最多 256 个 UTF-8 字符的非敏感摘要；
`intent.policy` 只接受现有 Task Intent 的公开 risk、execution_intent 和 timeout 字段。

Core 在 managed projection 内部生成唯一 `run_id`/`intent_id`，并将请求映射为同一
`webenvoy.task-intent.v0`：

- `entrypoint` 记录 Core 实际接收的认证入口；本 HTTP projection 为 `api`。
  现行 connection 不携带可验证的 CLI/MCP 来源，Core 不猜测客户端类型；CLI/MCP
  消费身份由对应安装验证记录。`user_intent.summary` 来自 `intent.summary`；
- capability-backed task 的 `capability.ref/version/source_ref/lock_ref`、resource refs
  和 evidence policy 来自 pinned Lode task declaration，不由 Agent 任意补充；完整
  `required_capabilities` 仍由同一 declaration 在 admission 中校验；
- script-only task 不生成伪造的 `capability.ref`。由于既有 Task Intent v0 的 capability
  字段必填，当前 managed projection 在映射前沿 `capability_ref_required` request-invalid
  返回，不创建 Run；其 `script_ref`/ABI/hash 只保留在 inspect 的静态摘要；
- `scope` 来自 `target`，`policy` 来自已校验的 `intent.policy`；
- `input.summary` 固定为不含正文的受管摘要，`input.refs` 只保留能力本身已有且经
  既有合同校验的 file/material refs；managed-task inline value 不进入 v0 envelope，
  不会把结构化 JSON 塞进 summary；
- Core 内部调用现有 task submission、Run、result、ExternalOutcome 和 recovery
  service，不向普通 Agent 发 HTTP owner `/tasks` 请求，也不建立 site-task Run。

#### structured input carrier

`input.schema_ref` 必须与 pinned Lode task declaration 完全相等，并由 package revision
和 `integrity.package_digest` 钉住 schema bytes。v1 只有两种 carrier，carrier 必须与
Lode 声明完全相等：

- `carrier=none` 的 task 必须省略 `value`，worker 得到通过 schema 校验的空输入；
- `carrier=webenvoy.managed-task-inline/v1` 的 task 必须携带一个 `value` JSON 值。
  Core 以 managed-task v1 的紧凑 UTF-8 JSON 字节数核对 Lode 声明的 `max_bytes`（inline
  v1 为 1--65536），按 pinned Lode JSON Schema 严格校验后才 dispatch。请求不接受 URL、
  本地路径、Cookie、Token、credential、脚本、任意 socket/endpoint、base64 包装或
  未声明的额外字段；schema 不匹配、超限或敏感内容在 dispatch 前返回
  `managed_task_invalid_input`/`not_dispatched`。

Agent 直接提交受界定的普通参数；Core 只在这次 managed admission 与 worker 调用期间
保存/传递已校验的 `value`，不登记为 owner material，也不创建第二输入资产系统。Worker
通过 `webenvoy.site-skill-broker/v1` 的 `input.read` 取得当前调用的 ephemeral value；
Core/Harbor 不向 script 传本地路径或隐式文件挂载。既有 v0 Task Intent 只收到能力本身
已有且按既有合同校验的 `input.refs`，其 `input.summary` 不承载 JSON。Run/receipt 继续
只归属现有 `task_intent_ref`、package/capability/scope、幂等和 result/evidence/
dispatch/failure facts；不持久化解码后的 JSON、原始 bytes、Cookie、Token 或本地路径。
managed route、worker、Core/Harbor 日志和 Plugin 响应同样只能记录 schema/carrier、
`value_present` 等有界事实，不能记录原始 value。
若声明的 capability 需要现有 file/material ref，`runtime.invoke` 沿该 capability 已有的
file/Grant 合同传递不透明 ref；managed-task carrier 不新增 `file_refs` 或 material
权限字段。
查询只可返回 `schema_ref`、carrier 和 `value_present` 等有界元数据，不能返回输入正文。

#### query 与 stop 请求

`task.query` 和 `task.stop` 仍 POST 到同一路径：

~~~json
{
  "schema_version": "webenvoy.managed-task-operation/v1",
  "operation": "task.query",
  "grant_id": "grant:example",
  "task_scope": {
    "operations": ["task.query"],
    "skill_refs": ["lode://site-skill/example/catalog"],
    "source_refs": ["lode://site-skill/example/catalog@1.0.0#<source-commit>"],
    "profile_refs": ["profile:example"],
    "origins": ["https://example.com"]
  },
  "selector": {
    "original_idempotency_key": "agent-task-001"
  }
}
~~~

`task.query` 的 `selector` 必须恰好二选一：`{"run_id":"<opaque-run-ref>"}` 或
`{"original_idempotency_key":"<the-submit-key>"}`，不能同时出现、缺失或携带其它
字段。`run_id` 是 submit response 或先前 query 返回的原 Run ref；
`original_idempotency_key` 只能是原 `task.submit` 使用过的 key，不是一次新的 submit，
也不能触发 task 创建、重派发或新的 Run。Core 按当前 bearer Principal、context-bound
connection、当前有效 Grant 和 `task_scope` 查询该 selector 绑定的原 operation；当前
scope 必须覆盖原 submit 的 package/revision、目标范围和 Principal。Core 从原 Run 的
pinned package/revision/target facts 检查覆盖关系，query 不要求客户端重复提交 digest
或 target。重连后的新 connection 仍可通过同一 Principal/scope 检查。

若 submit response 丢失，调用者必须先用原 `original_idempotency_key` 做只读 query，取得
Core 已生成的 `run_id`/receipt，再以该 `run_id` 发 `task.stop`；不能重发 submit 代替
query。`task.stop` 使用相同字段，把 operation 改为 `task.stop`，只接受已经取得的
`run_id`，并额外要求一个新的、仅用于停止请求本身的 `idempotency_key`。
Core 仍重新检查当前 Grant 是否含 `task.query`/`task.stop`。重连后的新 connection
可以通过该检查，不要求等于原 submit connection。跨 Principal、scope 不足、未知
`run_id` 或未知/不属于当前 Principal 的原始 key 统一返回不可枚举的
`managed_task_operation_unavailable`。`task.query` 只读原 Run/result/receipt，`task.stop`
调用现有 cancellation/request-cancel service，只停止后续步骤，不回滚外部效果，不生成
第二 Run。响应丢失后必须 query 原 operation；`unknown_outcome`、`dispatched` 和
late result 沿既有 Core 事实保留，不能换 key 重放。

三种 operation 的成功响应都只投影现有事实：

~~~json
{
  "ok": true,
  "schema_version": "webenvoy.managed-task-operation-result/v1",
  "operation": "task.submit",
  "operation_ref": "run:core/example-001",
  "run": {
    "run_id": "run:core/example-001",
    "task_intent_ref": "intent:example-001",
    "package_ref": "lode://site-skill/example/catalog",
    "status": "admitted",
    "dispatch_state": "not_dispatched"
  },
  "input": {
    "schema_ref": "lode://schema/example/catalog-read-input@1.0.0",
    "carrier": "webenvoy.managed-task-inline/v1",
    "value_present": true
  },
  "result": null,
  "failure": null
}
~~~

`run` 是现有 Run 的有界投影，`result`（完成后）必须是既有
`webenvoy.result-envelope.v0`，`failure` 必须是既有 `FailureRecord`；本 envelope
不创建另一种 site-task 状态。未派发失败保留 `dispatch_state: "not_dispatched"`；
已派发但结果无法证明仍是原 Run 的 `dispatched`/`unknown_outcome`。

访问和输入错误固定如下：schema/version/未知字段、carrier 或 selector 形状为 HTTP 400
`managed_task_invalid_input`/`managed_task_version_unsupported`；credential 或
Connection 沿现有 `managed_access_authentication_required`、
`managed_access_connection_unavailable`；Grant、scope、Principal、package/carrier 或
operation 不满足沿现有 `managed_access_denied`/`managed_access_scope_conflict`；
跨主体或未知 run 使用统一 `managed_task_operation_unavailable`/404；同 key 或
scope 绑定冲突使用既有 idempotency/scope conflict/409；Lode、Harbor、Runtime 和
业务失败只返回现有 `FailureRecord`/HTTP mapping。Plugin、CLI 和 API 必须保留这些
code、Run/receipt 归属和兼容拒绝，不能改写成成功或 owner `/runs` 查询。

这组 projection 的入口、版本、输入 carrier、过滤、错误和兼容规则由本文件、
[Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md#563-site-task-execution-projection)
和 [Grant Wire Contract V1](grant-wire-contract-v1.md#site-task-agent-projection-and-inline-input-contract-v15)
共同冻结；Lode 只提供 package/task/schema/script/broker capability 声明。S1 不拥有
task 的授权或 Run 语义，只提供 Agent/owner OS identity 前提和 CLI/client trust
channel。

## 5. 受管执行位置、脚本 ABI 与 OS 权限

本节适用于执行包内代码的 task。仅使用正式 capability 和由 Core 解释的既有声明式
检查的 task 不创建 worker，也不依赖 worker identity/ACL；仍须通过 package、
lifecycle、Grant/现场、egress 和 business gate。声明式检查不能成为任意表达式、
脚本或新 workflow DSL 的入口。

Lode `scripts/` 中的第三方或站点代码不得被 import、eval 或直接执行在 Core/Harbor
进程内。本 v1 选定的实际执行方式是 Agent supervisor 启动的 **Agent-side managed
worker** 子进程：worker 使用 S1 已分配的 Agent OS identity，Core/Harbor 只通过既有
Agent channel 和下述 broker 交付受管调用。owner control socket 由 owner identity
持有，宿主 ACL 排除 Agent identity。S2 不新建 runner、Agent/owner 身份或第二授权系统。

这是一项 **已准入 trusted code host**，不是面向任意不可信代码的通用 sandbox。OS 层
只冻结可被实际证明的边界：Agent 与 owner 是不同的受管 OS identity，owner secret/
control socket 的 ACL 不允许 Agent 读取或连接，worker 由 Agent supervisor 启停并清理。
S1/宿主可以给 Agent identity 既有的本机文件或网络权限；S2 不把每个 task 的任意
filesystem、DNS、socket 或出站逐项拒绝承诺给 S1，也不把 bearer、路由、环境变量、
同 UID 约定路径或 API `grant_id` 当作 OS 隔离。包声明和 Grant 不能扩大 worker 的
实际权限。若 identity、owner socket ACL 或 worker supervisor 边界无法在宿主证明，
Core 在 Runtime gate 返回 `worker_identity_unavailable`/`owner_socket_acl_unavailable`
并保持 `not_dispatched`；这是 fail-closed 的执行前结果，不是另建一个沙箱方案。

### 5.1 代码准入与固定 ABI

WebEnvoy 的 code admission 只接受精确的 `package_ref`、`revision_ref`、`script_ref`、
source/version/hash 和 `webenvoy.site-skill-script-abi/v1`。准入记录绑定同一 Lode
package digest；安装、enable、SKILL 文本、Grant 或 API authentication 都不自动准入。
准入检查拒绝动态下载、依赖安装、未声明 import、任意 shell/child process、动态
JavaScript/eval、CDP/Juggler、Provider-private endpoint、Cookie/storage/credential
读取和 raw Network；这些是可信代码的审查/运行时 ABI 规则，不是 OS sandbox 保证。

`webenvoy.site-skill-script-abi/v1` 只向固定入口提供：

~~~text
run(input, broker, context) -> output
~~~

`input` 是通过 schema 校验的值或无输入标记；`context` 只有 pinned code/package/
revision、当前 Run、timeout/cancel、Principal/Grant/task scope 的不透明摘要，以及
Harbor 当前 observation/target refs。script 不获得本地路径、环境中的 owner secret、
浏览器 session、Provider handle 或未声明参数。若 script 使用 broker 的 `input.read`，
它返回与 `run` 的 `input` 参数相同的本次 ephemeral value（无输入则返回同一无输入标记），
不得存在第二个输入来源或重新读取材料。所有输出必须经过 `output.write`，
由 Core 按 Lode output schema、post-check 和既有 result/evidence contract 处理。

### 5.2 受管 broker API

`webenvoy.site-skill-broker/v1` 是唯一 script capability surface；它不是第二
Runner、DSL 或 Run 状态机。v1 只接受下列有界调用，调用者不能自定义 method 或透传
Provider payload：

| call | 固定语义 |
| --- | --- |
| `input.read` | 读取与 ABI `run` 参数相同、已经按 pinned Lode schema 校验的本次 ephemeral inline value；不返回路径、material metadata、Cookie 或 Token。 |
| `runtime.observe` | 请求当前 Harbor 的受管 observation/target ref；不接受 selector、URL、CDP/Juggler 或 provider handle，旧 generation/ref 失效后必须重新观察。 |
| `runtime.invoke` | 只调用 Lode task 声明且 Core 已接受的 capability/action；Core 重新检查 Grant、Profile/origin、ControlLease、Runtime freshness 和 egress，返回既有 bounded capability result/evidence ref。 |
| `output.write` | 提交 output schema 约束的数据或既有 result/evidence ref；不接受 raw DOM/HAR、Cookie、Token、截图、路径或外部 receiver。 |

worker host 以固定 ABI 不提供 `fs`、`net`、`dns`、`child_process`、shell、dynamic
module、raw HTTP 或浏览器原生 API；需要文件、网页或网络能力时只能走 Core/Harbor
既有 broker/Grant/Network 合同。这个约束属于已准入代码可观察接口；worker 的 OS
ambient permission 仍由 S1/宿主实际决定，不能把 ABI 描述成“任意不可信代码安全沙箱”。

脚本每次执行同时绑定 Lode `package_ref`、`revision_ref`、`script_ref`、source/hash、
ABI/broker version、当前 Instance/Page/Frame/document/observation/target、Core Run、
operation/idempotency、Principal/Grant/task scope、ControlLease 要求和结果/evidence
关联。超时、取消、worker stop 或 context generation 变化只停止后续步骤；已经派发的
外部效果仍按 Core `dispatched`/`unknown_outcome` 保留，不由 script 回滚或重放。

## 6. Script 与 Runtime capability

Lode `runtime_kind`/entrypoint 必须能由已实现的 `webenvoy.site-skill-script-abi/v1`
识别；其 source/version/hash、input/output schema、timeout/cancel、effect/action class
必须和 Core admission 记录及 `webenvoy.site-skill-broker/v1` 版本精确相等。每次派发
继续绑定 `package_ref`、`revision_ref`、`script_ref`、当前 Instance/Page/Frame/document
generation、observation/target ref、已接受的 capability refs、Principal/Grant/task
scope、ControlLease、Core Run、operation/idempotency 和结果/evidence 关联。broker 是
唯一脚本 capability surface，不增加独立授权或 Run。

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
  通过 `webenvoy_task.task.query` 查询、对账，或用同一原 Run 的 `task.stop` 停止后续
  动作和人工接管；不得换 key、重新加载页面、换 script version、重做 write 或用当前
  页面状态覆盖历史 unknown。
- cancel/stop/revoke 只停止后续步骤，不自动回滚已经发生的外部效果。late output 不能
  覆盖 Core 已记录的结果；用户接管后需要 fresh observe，并以新控制世代重新授权。
- 包 update/rollback/disable 不能改变进行中 Run 的 pinned revision；新 Run 在新的
  lifecycle/admission 门上重新判断。local modified 按 #508 失败，不能被静默覆盖。

## 9. 最小场景与固定结果

| 触发场景 | 固定行为 |
| --- | --- |
| 只导入知识 | 返回或记录 `knowledge_only`；可以读取获准 references，但没有正式 task entrypoint，不能 dispatch。 |
| 合法 script-only task | `skill.inspect` 返回 `task_support=declared` 及 script identity/ABI/hash 等静态事实；当前 `webenvoy_task` 因 Task Intent v0 缺少 capability 映射沿 `capability_ref_required` request-invalid 拒绝，不创建 Run，也不改称 `knowledge_only`。 |
| 页面节点被替换 | 旧 target ref 失效；fresh observe 取得新 ref 后才可继续。旧 ref 不得静默重绑。 |
| 写入 response 丢失 | 原 Run 保持 `dispatched`/`unknown_outcome`；只 query/reconcile 原 operation，不创建新 script/version/key。 |
| 包在任务中更新 | admission 时固定旧 revision；更新只影响未来 Run。local modified 不被覆盖。 |
| output schema 通过但分页遗漏 | `completeness=partial` 或 `unknown`，post-check 不通过；不能报告业务成功。 |
| Lode digest 与受管 material 不一致 | Core 返回既有 managed asset integrity/local-modified failure；不执行 script，不回退到另一个包。 |
| API Grant 有效但 Agent/owner OS identity 或 owner socket ACL 不成立 | 在 Runtime/worker gate 局部返回 `worker_identity_unavailable`/`owner_socket_acl_unavailable` 并保持 `not_dispatched`；API 授权不能制造 OS 权限。 |

## 10. Design Obligation disposition

| Obligation | 本候选判断 | 依据和实施前门槛 |
| --- | --- | --- |
| `DO-PLUGIN-EXPOSURE` | `triggered` | 元数据仍由 `webenvoy_skills.skill.inspect` 的可选 `webenvoy.site-task-summary/v1` 承载；普通 Agent 的正式执行、查询、停止由 `webenvoy_task` 与 `POST /managed-tasks/operations` 的 `webenvoy.managed-task-operation/v1` 承载，内部映射同一 `webenvoy.task-intent.v0`、Core Run、`FailureRecord` 和 `webenvoy.result-envelope.v0`。入口、版本、过滤、输入 carrier、错误和兼容规则由本文件与 Plugin Runtime Exposure 窄增量共同冻结。 |
| `DO-GRANT-WIRE` | `triggered` | v1.5 Grant 新增 `task.submit`/`task.query`/`task.stop`；site-task 使用五组 task scope，inline input carrier 的 schema/大小/敏感边界由本文件与 Lode package 合同约束。Grant 唯一 owner 是 [Grant Wire Contract V1](grant-wire-contract-v1.md#site-task-agent-projection-and-inline-input-contract-v15)。 |
| `DO-NETWORK-CONTRACT` | `conditional` | v1 默认拒绝 script raw network，不新增公共 request/response payload；使用主动 Network、body、interception 或 modification 前必须由 S4 提供并接受 Network Runtime 合同。 |
| `DO-CONSOLE-CONTRACT` | `not-triggered` | script 不新增 console/page-error public payload；只消费既有有界诊断或 failure。 |
| `DO-PROVIDER-PRIVATE-SCHEMA` | `not-triggered` | 不持久化 Provider launch/context/handle/private environment bundle；worker 用既有 Harbor/runtime 边界。 |
| `DO-APP-IA` | `not-triggered` | 不新增完整 App Library、Activity、任务工作台或导航；沿用现有 owner/Agent/handback 入口。 |

## 11. 非目标、supersession 与集成顺序

本文件不实现通用 runner、sandbox、registry、Marketplace、站点转换、账号登录、Provider
适配、网络/视觉能力、任意脚本、通用 DSL、后台任务队列、第二 Run/receipt 状态机、
S3 的探索/导入/OpenCLI/验证修复实现或真实站点验收。它也不把文档、fixture、fake
Provider、源码客户端或 Plugin 可见性当作 installed/live/plugin_verified 证据。

本文件在 #563 接受后，仅 supersede #508 中“SKILL 脚本执行尚未定义”的本轮非目标，
并为已接受的 #508 asset lifecycle 增加 task execution consumer。它不覆盖 #508 的
安装/选择/CAS/receipt/unknown 语义，不覆盖 Grant、Browser Runtime、Network、Console、
Provider 或 App IA 的 owner。site-task managed operation、input carrier、script ABI、
broker 和 v1.5 Grant extension 已在本候选中显式触发并链接其 owner 合同；后续实现若
要新增跨进程字段，仍须先更新对应 owner 合同，不能在实现 PR 中悄悄扩 wire。

包合同可以先于本执行合同接受；正式消费者必须等待两份合同各自接受，并与
[S1 命令及信任合同](https://github.com/WebEnvoy/WebEnvoy/blob/4fd5ca525eecd3fa124bae31ceb4943d28c6a1ec/docs/specs/cli-integration-v1.md)
对齐。实现 Work Item 再提供准确的 Lode manifest、code-admission 记录、第 5 节的
worker 实际权限及 owner 隔离、Grant/Run schema、installed Agent 和 live site 证据。
接受本规格不授予安装、运行、外发、合并或发布授权。

后续真实站点验收至少绑定同一候选 SHA、Lode package `revision_ref`/source commit/
package digest、WebEnvoy/Harbor/Provider 版本、正式安装身份、Principal/Grant/Profile/
Instance/Page、worker 的实际权限、owner 隔离与清理证据，并由真实第三方 Agent 经过
Plugin 完成 install/enable、task discovery、正常执行、fresh target、分页完整性、
post-check 和 query/reconcile。响应丢失的 write 必须证明原 Run/operation 对账而无重放；
知识-only、未准入、local modified、不可用和 unknown 必须保留各自状态。fixture、mock、
源码客户端、文档接受或零模型声明不能替代这些证据；正常固定路径若声称零模型，须由
实际调用记录证明，而不是由 package metadata 推断。
