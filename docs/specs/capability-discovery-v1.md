# Capability Discovery and Operation Guidance V1

状态：Accepted；版本：1.0。owner：Core（定义、授权与结果组合）、Harbor（Provider 与当前实例事实）、Desktop Agent entry（实际工具投影）。产品归口：[#539](https://github.com/WebEnvoy/WebEnvoy/issues/539)，parent [#474](https://github.com/WebEnvoy/WebEnvoy/issues/474)，关联 [#497](https://github.com/WebEnvoy/WebEnvoy/issues/497)。

依据：[Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md)、[Grant Wire Contract V1](grant-wire-contract-v1.md)、[Page/Document V1](page-navigation-runtime-contract-v1.md)、[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Runtime Capability Plane](../architecture/runtime-capability-plane.md)。本规格是 #539 的实施合同，不表示工具或能力已经发布；实际支持与证据仍由 owning Work Item 维护。

## 1. 用户结果与已固定的决定

Agent 在已安装 Plugin 内问“这个操作在这个环境能否使用、缺什么输入、下一步怎么办”，得到当前事实和一致的调用说明，再用原工具执行并查询原 Run。无需读源码、内部数据库或通过失败的网页操作猜参数。

- 只增加一个只读帮助工具 `webenvoy_describe`，不按浏览器或 operation 拆新工具。它不是每次执行的强制步骤，执行接口不要求 discovery token。
- 一次查询一个 operation；不做全库搜索、自动推荐、批量预检或新的 capability registry。既有 `tools/list` 与 SKILL 仍用于找到操作名称。
- 区分定义、Provider 支持、Plugin 暴露、授权、当前可执行条件五个维度。`limited` 不等于不能用；没有新鲜事实不等于不支持。
- 描述静态调用规则与读取已有管理事实，不派发任何浏览器命令、不启动服务或 Profile、不建立/刷新 Connection、不生成 Run、receipt、observation 或 target。
- 只诊断本次已提交的上下文；不穷举其他 Profile、Grant、文件或账号，不自动补权限、不自动选另一 Provider。
- v2 操作范围与 legacy 兼容沿 #544/#547，不重新引入全生命周期网络隔离。缺网站 SKILL、不知道 OS 焦点、只读帮助不可用均不得成为已有正常操作的新前置。

## 2. 首批范围与非目标

完整覆盖基线 `f37f88c770939bef7e9a5294898f7d6884d10748` 的 `webenvoy_operation` 操作说明：

`profile.create/list/read`；`provider.preference.read/set/clear`；`instance.start/observe/diagnostics/navigate/read/snapshot/click/input/press/scroll/wait/handoff/stop`；`environment.read/update`；`page.list/open/activate/close/navigate/reload/back/forward`；`file.upload/download`。

其中绑定既有 Profile 的操作提供第 4 节的上下文评估。`profile.create`、不指定 Profile 的 `profile.list` 和 `provider.preference.*` 本批提供完整静态调用规则；不增加创建/全局偏好动态预检。给这些操作提供 Profile 上下文返回 `discovery_context_not_supported`，不得谎称原操作不可用。

`account.bind` 是已有公共定义但未暴露给本批 Plugin 的明确样本：返回 `definition.state=defined`、`invocation.exposure=not_exposed`，不提供内部调用地址或替代入口。本批不增加该能力。其他未知 operation 返回 `definition.state=unknown`，不把猜测名称当作未来支持承诺。`webenvoy_recovery`、`webenvoy_skills` 与 owner 管理操作不扩入本批 `webenvoy_describe` 覆盖；其原工具和合同保持可用，返回范围说明而非假报这些工具不存在。#563 的 site task 元数据由既有 `webenvoy_skills.skill.inspect` 的可选 `webenvoy.site-task-summary/v1` 投影承载，执行由独立的 `webenvoy_task` managed projection 承载；本帮助工具不扩展 task submit/query/stop 合同，也不为 site task 发明 discovery token。

不做 #540 的观察续读/名称识别，不新增页面内容、截图、网络正文、执行能力、Provider 资格、Grant 维度或完整 App UI；不修复或调查另案 stop/restart 失败。不要求先完成所有 V1 能力才能交付本工具。

## 3. 正式入口与请求

### 3.1 MCP 与 HTTP

MCP 工具名固定 `webenvoy_describe`。Core 新增只读语义的 `POST /managed-browser/capabilities/describe`，沿现有 Agent credential 认证；POST 仅用于传递结构化上下文，不表示执行动作。Agent entry 的本机代理必须将此路由归入 Agent 路由，不能携带 owner 凭据调用它。

MCP 只注入已经建立的 `connection_id`，不调用 `webenvoy_connect`。调用前可读安装 manifest/完整性，但必须在现有 `ensureRuntime()` 之前分流；不得借帮助请求自动拉起 Runtime。没有 Connection 返回 `connect_first`；Runtime 未运行返回 `runtime_unavailable`。原 status/connect/operation 的既有启动行为不改。

HTTP 请求为 MCP 参数加 `connection_id`；所有顶层及 context/task_scope 对象拒绝未知字段。请求最多 64 KiB UTF-8；响应最多 64 KiB，不静默截断 schema、必填项或 blockers。无法在界限内完整返回时为 `discovery_response_too_large`，不是半份成功说明。

### 3.2 参数合同

```json
{
  "operation": "instance.snapshot",
  "context": {
    "grant_id": "grant:example",
    "profile_ref": "profile:example",
    "task_scope": {
      "operations": ["profile.read", "instance.snapshot"],
      "profile_refs": ["profile:example"],
      "origins": ["https://example.com"]
    }
  },
  "arguments": {
    "runtime_session_ref": "session:example",
    "origin": "https://example.com",
    "page_id": "page:example"
  }
}
```

上例所有 ref 均为示意，不是可以直接执行的现场引用。

| 字段 | 必填/语义 |
| --- | --- |
| `operation` | 必填；1–96 字符，`^[a-z][a-z0-9_.-]*$`。输入 schema 不将其锁为已暴露枚举，才能准确解释未暴露/未知名称。 |
| `context` | 可选；有则三项全部必填，只适用于本批既有 Profile 上下文。没有它时仅返回定义与调用规则，不读取任何资源事实。 |
| `context.grant_id` | 单一 Grant，属于当前 Principal。不会合并其他授权。沿既有引用校验与长度限制。 |
| `context.profile_ref` | 精确选定的一个 Profile。task scope 可以包含更多已授予 ref，但本次只评估这一项、不枚举其他项。 |
| `context.task_scope` | 沿既有 browser task scope：`operations/profile_refs/origins`，文件操作才可带 `file_refs`。用于收窄可见性与目标操作；本次是描述，不是把所有数组项分别执行。 |
| `arguments` | 可选，目标 operation 的部分参数草稿；允许缺必要参数，以便返回缺项。其字段来自第 6 节的同一操作定义，不另造输入集。 |

`arguments` 不得包含 `operation/connection_id/grant_id/task_scope/profile_ref/idempotency_key`，这些取自 envelope 或真正执行时产生；重复字段按 invalid input 返回，不解决“哪个更优先”。目标操作的文本、URL、配置等可以仅做类型/格式校验，不执行、不原样回显、不写日志/历史；不通过描述接口接受原执行接口禁止的路径、脚本、凭据或 raw 端点。未知的 operation-specific 参数返回 `inputs.state=invalid` 和字段路径，不返回参数值。

缺少 `context` 时允许检查参数形状，但不解析 ref 对应资源。未知 operation 或本批范围外操作不读取 arguments 指向的任何对象。

## 4. 查询权限与资源可见性

公开的静态操作说明只需要已注册、未撤销的 Principal 和有效 Connection，不要求先获准执行被描述的操作。contextual 结果先通过现有 Profile 元数据读取权限，再判断目标操作权限：

1. 当前 credential、Principal、Connection 必须有效。context 的 Grant 必须属于同一 Principal、有效且未撤销。
2. 使用同一 Grant 和 task scope 检查精确 Profile 是否具有 `profile.read`，没有时可使用已有 `profile.list` 可见性；相应读取 operation 必须也在 task scope 中。两条均没有则拒绝，不新建 discovery 权限。
3. 此读取检查复用 Core 既有规则和 scope-independent metadata read 兼容；为这一步派生元数据 read 请求时只取原 context 的 Profile/origin/读取 operation 交集，不传文件 operation 专用的 file_refs。目标操作仍用完整原 task scope 单独评估，不能以剥离字段扩大目标权限。不得调用会创建 Run 或访问浏览器的 `managedBrowser.submit(profile.read)` 来实现帮助。
4. 可见性成立后，目标 operation 即使不在 Grant/任务/上限中，也应返回 `authorization.state=denied` 及下一步，而不是使整个说明不可读。授权缺少目标操作与缺少资源可见性必须区分。
5. 不可见、不存在、跨 Principal、跨 Profile 的资源统一返回 `discovery_context_unavailable`，响应不含实际存在性、Provider、权限明细或其他 ref。仅在可见性建立之后读取 Harbor 的目标 Profile 事实。
6. Page/Instance/file refs 如有提供，必须限定于该 Profile；未获准 origin 的页面不返回 URL、标题、正文或诊断。错误只针对提交 ref 说明不可用，不披露真实所属对象。
7. 只使用此一 Grant。到期/撤销不自动刷新或选择新 Grant；返回 `grant_unavailable`，由调用者明确 connect/owner 操作。新授权日常维护继续按 #547。

这不改变目标操作的授权条件，也不要求用户为了执行合法操作额外获得 discovery 权限。仅有执行权限而没有元数据读取权限的 Agent 仍可使用静态说明和原执行接口；帮助工具不可用不能阻断原操作。

## 5. 返回合同：帮助是事实快照，不是执行许可

### 5.1 成功外壳

```json
{
  "ok": true,
  "schema_version": "webenvoy.capability-description/v1",
  "operation": "instance.snapshot",
  "assessed_at": "2026-09-16T00:00:00.000Z",
  "definition_revision": "sha256:example",
  "mode": "contextual",
  "definition": {"state": "defined", "capability": "observation"},
  "invocation": {
    "exposure": "exposed",
    "tool": "webenvoy_operation",
    "input_schema": {},
    "field_guidance": [],
    "example": null,
    "query_tool": "webenvoy_query"
  },
  "provider": {"state": "limited", "provider_id": "chrome_official", "reason_codes": [], "limitations": [], "facts_at": null},
  "authorization": {"state": "allowed", "reason_codes": []},
  "availability": {"state": "no_known_blocker", "reason_codes": [], "facts_at": null},
  "inputs": {"state": "complete", "missing": [], "invalid": []},
  "execution_checks": ["reauthorize", "verify_page_and_target", "acquire_control_if_required"],
  "next_steps": []
}
```

上例展示字段形状，不是完整可执行 fixture：实际 `input_schema/field_guidance` 必须完整生成；revision 为真实摘要，facts_at 为实际已知时间或 null，不能用本次请求时间伪造现场观测时间。实现合同对应的 [Core→Agent request schema](../../packages/schemas/schemas/capability-description-request.schema.json)、[Core→Agent response schema](../../packages/schemas/schemas/capability-description.schema.json)、[Core→Harbor schema](../../packages/schemas/schemas/harbor-capability-description.schema.json)、[请求正例](../../packages/schemas/fixtures/capability-description-request.fixture.json)、[响应正例](../../packages/schemas/fixtures/capability-description.fixture.json)、[请求反例](../../packages/schemas/invalid-fixtures/capability-description-request.invalid.fixture.json) 和 [响应反例](../../packages/schemas/invalid-fixtures/capability-description.invalid.fixture.json) 由 #539 实现 PR 固定并由 schema self-check 验证。

| 字段 | 固定取值与解释 |
| --- | --- |
| `mode` | `definition_only` / `contextual`。没有 context 时后三项动态状态均为 `not_evaluated`，不是 allowed 或 unavailable。 |
| `definition.state` | `defined` / `unknown` / `out_of_scope`。unknown 是当前公共定义中没有；out_of_scope 是已知但本批不提供描述，例如独立 SKILL/recovery 工具。 |
| `invocation.exposure` | `exposed` / `not_exposed`。来自实际安装工具投影，不由授权结果决定。未暴露时 tool/input_schema/query_tool 为 null，不返回内部接口。 |
| `provider.state` | `supported` / `limited` / `unsupported` / `unknown` / `not_applicable` / `not_evaluated`。描述 WebEnvoy 当前适配与资格，不裁决浏览器原生“永远不支持”。 |
| `authorization.state` | `allowed` / `denied` / `unknown` / `not_evaluated`。allowed 只表示已提供范围在本次读取时通过，不代替执行时复查。 |
| `availability.state` | `no_known_blocker` / `blocked` / `unknown` / `not_evaluated`。不使用 guaranteed/verified-success 一类承诺；见 5.2。 |
| `inputs.state` | `not_provided` / `incomplete` / `invalid` / `complete`。只判断真实执行 envelope 的结构/必要参数；不把“字段齐全”说成 DOM 或文件仍有效。 |
| `inputs.missing` / `invalid` | 缺少字段的 JSON Pointer 数组；invalid 项为 `{path,code}`。不输出输入值。 |
| `execution_checks` | 剩余的真实执行检查，可用 `reauthorize/verify_page_and_target/verify_file_material/acquire_control_if_required/check_provider_runtime`；不是新权限。 |
| `next_steps` | 至多 8 项 `{code,actor,operation,fields}`；actor 为 `agent/owner`，operation 为已有公开操作或 null，fields 为字段路径数组。建议不自动执行、不授予权限。 |

所有成功响应均保留上例顶层字段；未有可返回值时，provider_id、facts_at、capability、tool、input_schema、example、query_tool用null，数组用[]。已暴露且已定义操作的input_schema不得为空；field_guidance与其必填/条件规则对应。未知/范围外定义不提供上下文支持判断（动态维度not_evaluated），但context若已提交仍先过可见性门。definition_revision形状为`sha256:`加64位小写十六进制。

next_steps.code固定为`fill_inputs/connect/start_profile/choose_page/observe_page/owner_authorize/owner_review_provider/wait_for_owner_return/retry_description/query_original_run/use_existing_tool/not_exposed`；不返回可自动执行的owner mutation。

`reason_codes` 至多 16 项；`limitations` 至多 16 项，每项 `{code,summary}`，summary 最多 256 字符，只用产品安全摘要。达到上限不能静默省略必要拒绝原因；返回响应超限错误或保留完整的统一归类，不能谎称无阻断。无列表分页、后台缓存同步或事件订阅。

### 5.2 状态组合与原因

`availability=blocked`：已知事实足以阻止目标调用，例如未暴露、当前适配未提供、目标授权拒绝、已知旧 ref、实例不存在或人持有会冲突的输入控制。`unknown`：没有已知 blocker，但必要的管理事实不可取得、资格 tuple 无法确认或 context 信息不足。`no_known_blocker`：本次管理事实未发现阻断；仍不保证真正调用成功，不保证对象未在下一瞬间变化。

inputs 检查的待执行 envelope 由 operation、context 中的 Grant/Profile/task scope 与 arguments 组合；connection_id 由 Plugin 注入，新的 idempotency_key 在真正提交时生成，二者不计入草稿 missing。definition_only 模式不假造 Grant/Profile；未提供 arguments 时为 not_provided，有参数但缺 context 所需执行字段时列出缺项。缺参数单独由 inputs 表达，不把“没有提交 text 草稿”假称为 Provider 不支持。没有 operation 所需的精确 origin 时 authorization 为 unknown，列明缺项；不能按 task_scope 中第一个 origin 猜目标。Provider limited 与授权 allowed 可以同时存在，且在本次条件满足时允许 no_known_blocker。

| 场景 | 必须表达 | 下一步 |
| --- | --- | --- |
| 定义存在但未投影 | not_exposed；不得回退到内部 HTTP | `not_exposed`，无自动替代操作 |
| 当前 Provider adapter 没接该操作 | unsupported + `provider_operation_not_implemented` | 说明是当前适配缺口，不写“浏览器没有此能力” |
| 有能力但当前安装未资格核验 | unknown + `provider_not_qualified`；已证实不匹配则 blocked | `owner_review_provider`，不扫描程序/下载/升级 |
| 静态资格证据 tuple 与已知当前材料身份不同 | unknown/blocked + `provider_evidence_stale` | 同上；不以固定时间 TTL 武断判过期 |
| Grant 缺目标 operation 或范围 | denied + `operation_not_granted` / `scope_denied` | `owner_authorize`，不列出其他 Grant |
| legacy/v2 语义不匹配 | denied + `scope_semantics_mismatch` | `owner_authorize`，不要求重复首次转换 |
| 输入需要实例而已知未启动 | blocked + `instance_not_running` | `start_profile`，只有用户明确操作才调用 start |
| 调用本来就是 instance.start | 不能因为实例尚未启动而 blocked | 按启动自身的资格、权限和锁事实判断 |
| 人持有控制 | 仅会改变现场的冲突操作 blocked + `human_control` | `wait_for_owner_return`；普通获准只读不自动拒绝 |
| 当前 control_owner=none | 普通合法获租条件满足则无已知 blocker | 真正执行时再取得租约；查询不获取 |
| 已有注册事实证明 ref/generation 失效 | blocked + `stale_reference` | `observe_page`；unknown 旧动作仍 query，不重放 |
| 必须进入浏览器才能判断的新鲜度/actionability | 列入 execution_checks | 不发送探测命令，不假报 stale 或全部通过 |
| 多 Page 却未明确目标 | 已知可见页面数支持此判断才给 `page_selection_required` | `choose_page`；不取 active/OS焦点替代 |
| 必要管理事实不可用/读取间已变 | unknown + `runtime_facts_unavailable` / `facts_changed` | `retry_description`，不启动浏览器来补证 |

未关联本次 operation 的限制不能成为 blocker，例如普通 snapshot 不要求一个全局“所有窗口关系可信”证明。旧失败 Run 不因 describe 成功而改变。

### 5.3 错误与重试

错误形状为 `{ok:false,error:{code}}`，可加无敏感值的 `invalid_fields`。Core HTTP：400 对应请求结构/本批不支持的 context；401 对应 credential/Principal/Connection无效；404 对应统一不可见 context；403 对应有效可见上下文中 Grant 已失效；503 对应 Core 无法服务。已有认证错误码继续沿用。Plugin 的 connect_first、runtime_unavailable、discovery_not_available、discovery_version_mismatch 是调用入口错误，不包装成目标 operation 的 failed Run。

描述成功但 operation 不可执行时仍为 `ok:true`，通过状态/原因解释；不把所有业务状态压成 HTTP 500。帮助请求没有 Run，也没有派发未知写入：丢响应可由调用者再次查询；不自动重试、自动重连或复用旧结果承诺当前可用。超时不得停止 Runtime 或浏览器。

## 6. 正确参数只有一个静态定义来源

不能把现在散落的 Core parser、MCP schema、SKILL 和本工具帮助再复制一份。实现采用一个纯数据的 operation input definition，放在现有 Core 模块归口并随安装资产构建；它只定义静态字段、条件、工具映射和说明，不保存 Provider、权限或现场状态。

Core 正式入口的形状校验与 MCP 条件 schema、describe 的 input_schema/field_guidance，以及面向 Agent 的示例由该定义生成或直接引用。对仍在 Harbor 的语义校验，用同一批正反参数 fixtures 核对一致性，不迁移它的信任边界。既有 Harbor catalog 的 category/resource requirements继续由 Harbor拥有；别把不同 owner 的内容复制为第三张万能表。

必须修正的说明差异限定为当前已存在的正式要求，不借本批偷偷扩大/缩小 operation 的执行权限或能力。遇到规范与代码冲突，列出精确差异并在同 PR 做必要的合同校正；不得用静态帮助追认一个新增的产品限制。

`invocation.input_schema` 是现有 MCP 执行 envelope 的完整、该 operation 专属约束，包括 idempotency_key/grant_id/task_scope、条件必填、禁止字段、枚举、范围、相等/子集等需交由执行校验的规则说明。`field_guidance` 为 `{path,required_when,source,constraints}`；source 使用已有工具/结果字段路径和 owner 入口名称，不返回 raw endpoint/path/token。

必须有可验证例子并覆盖：

| 操作 | 说明必须明确的差异 |
| --- | --- |
| instance.start | 顶层 origin 与 task_scope.origins不同；URL 的实际可选/同源规则；不要求先有 runtime_session_ref。 |
| instance.observe/snapshot | 当前 session 必填；多页时明确 page selector；真正 snapshot/observe才能产生新目标。 |
| instance.input/press/wait | target/observation新鲜度；text/key/timeout与wait_for条件；不能混入下一步的文件参数。 |
| file.upload | 同一次新观察的 Page/document/target、批准的 file_ref与对应 task_scope.file_refs。 |
| file.download | 不带 file_ref，task_scope.file_refs必须为[]；已有可信目标而不是任意下载URL。 |
| 非文件操作 | task_scope.file_refs不得出现，即使同一个用户工作流稍后要上传。 |
| page.open/navigate | URL与页面选择按当前正式入口区分；不把所有page operation套同一required列表。 |
| provider.preference.* | 不带Profile/origin，task范围为空集合；set带Provider，read/clear不带。 |

示例只使用固定合成占位符，明确 `illustrative_only=true`；生产结果不自动填入发现的实际 target、文件或其他 Grant。测试时用fixture替换占位符，并同时经过正式 parser/MCP 校验，不能只断言文档含某个单词。对于当前未暴露的 operation，不生成可以调用内部入口的示例。

## 7. 事实归口与只读实现

- Core：复用 managed-access 的认证、可见性和目标操作判断；抽出可复用的纯评估函数，而不是试 submit、捕获错误并创建失败 Run。文件只读已有材料元数据，不为描述读取正文、hash整份文件或新增证据。
- Harbor：从现有 Profile/binding、Provider catalog/适配能力、Runtime Session、Page Registry、ControlLease 的内存/持久事实构造窄只读快照。不得调用 observe、snapshot、page.list 的浏览器刷新、ping Provider或启动资格探针。
- 固定新增 supervisor-only `POST /runtime/capabilities/describe` 用于 Core→Harbor 的该窄快照。输入只接受 operation、精确 Profile、可选 Session/Page/document/observation/target引用；不接受 Agent 自带 Provider/path/状态。输出固定为 `{schema_version: "harbor-capability-description/v1", operation, profile_ref, provider, availability, execution_checks}`；后三项形状沿第 5 节，事实时间放各自 facts_at。只回显请求中的已核对 Profile，不枚举或新发 Session/Page引用；它不作授权决定，也不生成公共目标引用。Core 在查询前完成可见性检查、查询后过滤并合成最终响应。
- Plugin：只提供实际工具暴露/版本与静态定义投影；Core给出的权限/Harbor现场不能被Plugin改成true。不在Plugin增加品牌分支、授权白名单或状态缓存。
- 每次描述新读 Core/Harbor 事实，不持久化 description、不创建票据、reservation或租约。短读锁和现有时间/版本字段可以复用；不为跨层原子快照建立分布式事务。
- 读取中发现授权/对象版本变动，相关维度unknown且facts_changed；发出响应前重新核对认证与可见性。不能锁住页面阻止人操作来保证描述稳定。
- 执行再次按正式链检查，既不接受 description作为凭证，也不强制先做 description。续发后用新Grant重新描述；旧Connection失效就明确connect_first。
- 没有可读的目标新鲜度材料时，返回execution_checks而不是去读浏览器；本批不新增Driver消息或Page schema，不替#540实现新鲜度机制。

## 8. 版本、安装与兼容

新增响应 schema `webenvoy.capability-description/v1`；静态定义摘要 `definition_revision` 为规范化定义的SHA-256，不能用查询时间充当revision。沿现有版本/manifest识别Plugin与Core使用的定义。tuple不一致时返回 discovery_version_mismatch，不从开发目录加载补丁，也不调用业务操作猜测接口。

旧Plugin与已有执行接口不变。新Plugin连接旧Runtime得到404/未实现时返回discovery_not_available；它只表示帮助入口不可用，原操作仍可按原合同使用，不自动试其他私有路径。未知响应主版本不能解释成可执行；可选附加字段可忽略，未知状态值只能按unknown处理。

本轮 `DO-PLUGIN-EXPOSURE=triggered`。新增HTTP/MCP与Core–Harbor只读payload须在实现PR补真实schema/fixtures/类型/安装资产；已有Grant字段、维度与动作判定不变，`DO-GRANT-WIRE=not-triggered`。Network、Console、Provider-private持久配置、App IA不变，均not-triggered；若实现扩大这些边界，应先拒绝扩围而非默默加做。

## 9. 有限验收矩阵

| 编号 | 必须证明的结果 | 证明方法 |
| --- | --- | --- |
| D1 | 每个首批已暴露operation的帮助与正式parser/MCP一致；unknown与未暴露可区分 | 参数化定义与schema正反fixtures；尤其缺session/origin与错误file_refs。 |
| D2 | 查一个没有执行权限的操作仍能获得准确说明，但无权看Profile时不泄漏存在性 | Core/API正式认证链测试，含跨Principal/task/Grant。 |
| D3 | limited、not_exposed、denied、human_control、stopped、stale、unknown分别解释 | 同一事实owner的参数化测试；模拟数据只标fixture。 |
| D4 | 人持有不妨碍获准静态帮助/适用只读；control_owner=none不制造新限制 | 现有ControlLease分支及正常派发一致性。 |
| D5 | 帮助后撤权、替换Grant、接管、实例停止或引用变化，执行重新拒绝 | 使用真实Core/Harbor判定路径；不信任旧描述。 |
| D6 | describe绝不启动Runtime/Profile，不发浏览器消息，不更新Lease/Run/receipt/Connection/target | 计数断言和存储前后对比；Runtime未运行场景不能被ensureRuntime偷偷拉起。 |
| D7 | 安装独立、版本匹配、旧Runtime明确不支持、重启后重新读事实 | installed确定性客户端；不依赖checkout或缓存。 |
| D8 | 当前已支持的Chrome与Camoufox按各自现行配对返回事实、同一说明可以消费 | 同一安装客户端；复用当前有效测试Profile，必要最薄正常操作，不重做Provider资格。 |
| D9 | 真实Agent只凭安装入口，描述→补齐输入→一次普通操作→查询原Run | 一个短任务，例如instance.input；采用合成非敏感字段，结果回读；无需再跑文件上传下载全矩阵。 |

#539 的实现、正式安装、双 Provider、重启、短真实 Agent 与 D1—D9 证据记录在 [`docs/verification/capability-discovery-539.json`](../verification/capability-discovery-539.json)。该记录引用冻结的运行候选身份；文档收口本身不改变已验证安装内容。

D8对未支持、混装、人工持有等负例主要用确定性测试；不用真实账号、新Provider、Chrome崩溃或全平台实验来凑齐状态。每条观察说明自己的事实来源与缺失，不允许用组件fixture冒称installed或plugin_verified。

实施顺序：先证明既有漏参及只读副作用反例 → 同一静态定义与只读评估 → 参数化一致性 → 运行候选冻结 → 一份正式安装及短Agent闭环 → 最终独立review/checks → 合并并回读#539/#474。改运行代码才重验受影响路径；文档本身不要求浏览器live。

## 10. 合并与范围控制

此docs PR独立审查接受后，修改状态为Accepted并以最终head复核，再合并；它只使实施合同生效，不关闭#539，也不声称部署了discovery。

实现PR可以在已接受范围内补充schema链接和实际证据，不另建通用平台。#540、真实身份/业务现场、stop→restart缺陷分别保留原归口，不成为本项统一前置。未知状态、只读帮助失败、未有全生命周期网络隔离不应阻断已获准的普通执行路径。
