# Observation Completeness and Target Identity V1

状态：Accepted（实施规格已接受）；版本：1.0。owner：Harbor（观察批次、引用与控制）、共享 Provider execution（真实元素、语义采集与动作前检查）、Core（授权与结果）、Plugin（输入/输出投影）。归口：[Work Item #540](https://github.com/WebEnvoy/WebEnvoy/issues/540)，parent [#497](https://github.com/WebEnvoy/WebEnvoy/issues/497)，消费 [#474](https://github.com/WebEnvoy/WebEnvoy/issues/474)。

依据：[Page/Document 合同](page-navigation-runtime-contract-v1.md)、[Plugin Exposure](plugin-runtime-exposure-v1.md)、[能力发现](capability-discovery-v1.md)、[Files](browser-files-v1.md)、[Grant](grant-wire-contract-v1.md)、[Runtime 能力](browser-runtime-capabilities-v1.md)、[共享执行设计](../architecture/provider-execution-reuse-v1.md)。本文件是 Page/Plugin 的专门补充，不建立第二套 Page/RefMap。本文件优先规定 `instance.snapshot` 的新增输入、snapshot 子对象完整性、target 语义与续读；其他 Page/navigation、授权、文件结果、Run 与控制生命周期不改。文档接受不表示功能已实现。

## 1. 用户结果与基线

用户将较长表单交给 Agent：它能发现尚未返回的字段，区分不同模块中的同名按钮；局部更新或人工交还后重新看原页，不拿相似新按钮冒充原目标。输出不是无限 DOM，也不要求全页永远不变化。

基线：`5b8ffce4d7cf2cef8c323054a23e98dcd322a40d`。现有共享 Python snapshot 最多返回 128 项，`truncated` 只跟正文长度关联；名称来自 aria-label/文本/value；保留 ElementHandle，但 `control_handle` 主要检查连接性。以上是源码事实，不代替本项 G0。#528/#541/#547/#539 已交付范围仍有效；#540 中“Chrome 尚未完成”的旧叙述不作为本项前提。两种 Provider 使用当前正式共享路径，分别取得适用证据。

固定产品选择：

- 沿用 `webenvoy_operation` / `instance.snapshot`，不新建观察工具、权限或执行后端。
- 先冻结一批控件，再有界续读；续读不新建 observation，不混拼不同时间的控件清单。
- 完整性只承诺已声明的观察范围，不将主文档成功外推所有 frame/shadow/虚拟列表。
- 名称/上下文用于帮助选择；真正执行仍绑定原元素对象，不按名称/序号重新寻找替代品。
- 已返回且可区分的目标可以直接操作，无须先读完全部控件；真实动作沿现有规则使旧观察失效，再观察即可。
- 检查限于目标相关的显式语义；无关广告、时钟或正文变化不能全局禁用输入。

## 2. 范围与非目标

首批完整扫描范围是获准 Page **主文档 light DOM 中已存在、按公开可见性规则可见的交互候选**；可见不要求位于当前 viewport。覆盖 button、带 href 的 link、普通 input、textarea、select、有效交互 ARIA role，以及非嵌套的基础 contenteditable 编辑宿主。同一个DOM对象只输出一条记录；交互ARIA候选覆盖button/link/textbox/searchbox/checkbox/radio/switch/combobox/listbox/option/tab/menuitem/menuitemcheckbox/menuitemradio/slider/spinbutton/treeitem，其他role不由本项新增操作承诺。disabled 控件也可观察并如实标注。排除 hidden input、显式隐藏/不可访问子树中的候选与纯装饰元素；关联标签计算中被显式引用的隐藏文本依供应方规则处理。

本批能观察 textarea/select/基础编辑宿主，不等于增加多行输入、选择选项或富文本操作。仅执行已正式支持的动作；普通单行 contenteditable 可作为既有 fill 能力的适用样本，不扩展输入长度/换行合同。

不遍历子 frame、open/closed shadow roots，不滚动以触发虚拟列表或展开折叠区，不宣称发现所有 closed root。结果固定声明这些边界；主文档外内容未知不能被写成不存在。既有能力在这些范围有历史证据时保留，不由本项否定，但不计本次完整性。

不新增全页业务理解、账号判别、任意脚本/selector/坐标入口、全局网络隔离、浏览器补丁、OS 前台要求、站点 SKILL 或新的 Provider。用户可人工查看 B 页；交还后的任务目标仍是原 A，按现行 Page 合同处理。

## 3. 请求：原操作的两个分支

统一复用 Core `POST /managed-browser/operations`、原 Harbor interaction route 与共享 Driver。普通 Agent 只能提交公共字段；provider handle、对象签名、控制代次与内部 cursor mapping 不可由 Agent 指定。

`instance.snapshot` 的基础 envelope 保持：`idempotency_key/grant_id/operation/task_scope/profile_ref/runtime_session_ref/origin`，Plugin 注入现有 `connection_id`。`task_scope` 仍为当前 operation，不带 file_refs；采用现行 legacy/v2 语义，不迁移 Grant。

| 分支 | 输入与行为 |
| --- | --- |
| 新观察 | 不带 cursor 和 observation_ref。page_id/page_ref/document_generation 沿既有 Page 选择规则；多页必须明确。新增可选 `limit`，整数 1–128，缺省 128。建立新批次，替换该 Instance 原有当前 interaction snapshot。 |
| 续读 | 带 `cursor`，且必须同时提供同一批的 page_id、page_ref、document_generation、observation_ref；其余 envelope 和当前授权照常检查。`limit` 可选，沿上述范围；省略时用该批首次 limit。读取同一批下一段，不重新生成 observation/已返回的 target。 |

`cursor` 是 1–256 字符的 opaque ref，按现有 ref 字符集合编码。由 Harbor 绑定 Instance/Profile/holder、Page/document、observation、控制代次、有效 origin 范围及下一 offset；不是客户端可编辑的整数、URL或授权凭证。同 cursor 重读不推进隐藏全局指针，不吞掉一段；下一 cursor 由实际返回数量计算。

仅 `instance.snapshot` 增加 limit 1–128。`instance.diagnostics.limit` 仍为 1–64；其他操作不因此接受 cursor/limit。不能简单放宽共享字段后遗漏各 operation 限制。

```json
{
  "operation": "instance.snapshot",
  "idempotency_key": "example-new-read",
  "grant_id": "grant:example",
  "profile_ref": "profile:example",
  "runtime_session_ref": "session:example",
  "origin": "https://example.com",
  "task_scope": {"operations": ["instance.snapshot"], "profile_refs": ["profile:example"], "origins": ["https://example.com"]},
  "page_id": "page:example",
  "page_ref": "page-ref:example",
  "document_generation": 1,
  "observation_ref": "observation:example",
  "cursor": "cursor:example",
  "limit": 128
}
```

所有示例 ref 均是合成占位符，不是可执行的现场。snapshot/续读是一次明确观察调用，沿已有 Run/receipt 查询规则；不能类比 `webenvoy_describe` 宣称它不访问浏览器或不生成 Run。它不输入、不导航、不抢焦点、不获取/续租输入 ControlLease。原有 holder/控制可读性条件保持；本项不新增“必须允许人工持有期间全部读取”的承诺。

## 4. 返回与完整性

不改变外层 Core result / Harbor interaction receipt。`result.snapshot` 增加必需的 `schema_version: "harbor-observation-targets/v1"`、page_id、document_generation、captured_at、coverage、continuation；保留 page_ref、observation_ref、controls、text、truncated。公共页面字段必须由 Harbor 当前 Page binding 投影，不能返回 Provider 私有 ref。

```json
{
  "schema_version": "harbor-observation-targets/v1",
  "page_id": "page:example", "page_ref": "page-ref:example", "document_generation": 1,
  "observation_ref": "observation:example", "captured_at": "2026-09-17T00:00:00.000Z",
  "controls": [], "text": "", "truncated": false,
  "coverage": {
    "scope": "main_document_light_dom",
    "excluded": ["child_frames", "shadow_roots", "virtualized_not_in_dom"],
    "controls": {"enumeration_complete": true, "captured_count": 160, "total": 160, "returned_through": 128, "complete": false, "reason_codes": []},
    "text": {"state": "complete", "returned_bytes": 0},
    "semantics": {"complete": true, "reason_codes": []}
  },
  "continuation": {"offset": 0, "returned_count": 128, "has_more": true, "next_cursor": "cursor:example-next"}
}
```

这是字段形状示例；生产 controls.length 必须等于 returned_count，实际测试 fixture 必须满足全部跨字段约束，不能用示例空数组冒充 128 项。

- `captured_at` 固定为本批完成采集的时间；续读不更新成新观测时间。外层 observed_at 仍可表示本次读取时间。
- `coverage.controls.enumeration_complete`：在第 2 节范围内本批确实扫描到结束；达到扫描/容量预算或采集错误则 false。
- `captured_count`：本批实际保留项数。`total` 仅在 enumeration_complete 时为精确总数，否则 null，禁止把上限当总数。
- `returned_through=offset+returned_count`；`complete=enumeration_complete && returned_through==captured_count`。只表示从本批起点顺序读取至此已覆盖声明控件范围，不代表没有排除域、名称无歧义或正文完整。
- `continuation.has_more` 恰好表示本批缓存还有未返回项；有则必须提供 next_cursor，无则 null。扫描预算导致还有未采集目标时，末段 has_more=false 但 complete=false，并说明原因，不能循环生成无进展 cursor。
- `coverage.text.state=complete|truncated|omitted_on_continuation|unavailable`。首次返回正文前缀；续读不重复正文，text=""、state=omitted_on_continuation、returned_bytes=0。正文内容不续页，本批只续控件。
- 旧 `truncated` **继续只表示该批首次正文是否因长度截断**，续读保持该值；新版消费者必须分别读取 coverage，不能以它判断控件是否完整。正文读取失败返回 unavailable，而非伪装为空正文成功。
- `coverage.semantics.complete`：在已保留候选内，名称/角色/description/hints/区分上下文均已可靠取得且必要区分信息未被裁剪；这是与控件枚举独立的维度。不完整不否定其他有效目标。

固定资源预算：每页最多 128 控件；一次候选遍历最多 20,000 个主文档元素；每批最多 2,048 个候选记录/真实句柄且规范化元数据最多 2 MiB；首次正文最多 64 KiB UTF-8；单次完整公共响应最多 256 KiB UTF-8。limit 是数量上限，字节上限可使本段返回更少项，但必须至少推进一项或明确报 `observation_limit_exceeded`，不得静默丢项。截断按有效 Unicode 边界。160 个短标签样例必须正常得到 128+32，不能用预算提前结束。

预算是有界实现参数，不是浏览器永久容量声明；它们不增加新网络或授权策略。本批不设计任意超大页面的一次完整返回。达到扫描、容量或语义边界时使用固定 reason_codes：`scan_limit_reached/capture_limit_reached/semantic_unavailable/metadata_truncated/text_unavailable`；没有该原因不能无故设置 incomplete。

## 5. 控件语义与同名区分

每项保留 target_ref、role、name、enabled；新增以下字段（无值使用 null/[]，不从 value 猜名称）：

| 字段 | 合同 |
| --- | --- |
| `name_source` | `provider_accessibility/html_label/aria_labelledby/aria_label/content/alt/title/none`。指本次真正使用的来源；不能宣称完整 W3C 实现。 |
| `description` | 关联 aria-describedby 等公开描述，有值最多 256 字符，否则 null；不抓整段祖先正文。 |
| `context` | 最多两项 `{kind,name}`，由外到内；kind为form/group/dialog/region/heading。来自实际所属的最近有名称 form、fieldset/legend、ARIA group/dialog/region，必要时补同一语义容器内关联的标题；每项 name最多128字符。不能借DOM序号/任意前一段文字捏造业务身份。 |
| `hints` | `{placeholder,input_type,multiline,editable}`；字符串null或最多128字符，布尔事实未知用null。placeholder单独显示，不冒称 accessible name。 |
| `disambiguation` | `unique/contextual/ambiguous`，按本批完整候选集的公开role/name/description/context/hints比较，不只比较当前128项；只使用本次实际取得且未被截断或脱敏的字段作为区分依据，distinct target_ref或DOM序号本身不算语义区别。实现应为动作前复核保留本次实际用于区分该目标的字段集合。 |
| `truncated_fields` | 本项被截断的字段路径数组；没有截断为[]。 |

role最多64字符，name最多256字符；保留现有脱敏规则，不回显密码/隐藏值、完整输入value、文件路径、raw HTML、原始URL参数。既有可选value字段不作为name或身份指纹；本批不扩展表单值读取。敏感内容经脱敏后无法区分的目标必须如实 ambiguous，不能以私有原文可区分为由让Agent猜。

### 5.1 语义取得路线

优先使用固定 Playwright 公开可访问性能力（例如 Locator.aria_snapshot/role/label 语义），但不能将公开locator每次重新匹配的节点当成原ElementHandle。用于读取名称的locator必须在读取前后以公开DOM对象相等性确认与保留句柄是同一节点；不相等则丢弃该不一致结果并要求重新观察。不导入Playwright私有injected script，不使用raw协议读取另一棵对象树。

只有公开结果不能表达的标准HTML控件投影（例如file input/基础编辑宿主）可用小型、共享、固定DOM读取补充：aria-labelledby引用顺序与循环保护、aria-label、HTML `labels`关系（外部for与包裹label）、角色允许的元素文本、img/图形按钮alt、title。优先关系按供应方语义，不把placeholder或textbox当前value作为名称；不能读取整份DOM后交给模型推断。复杂嵌套名称超出该补充范围时报告 semantic_unavailable，不伪称所有AccName规则已实现。

具体调用形态先由G0验证；可以在不改变字段含义下整理helper，但不能新建浏览器语义引擎、安装新SDK或以站点selector代替。字段依赖标准label、两种ARIA标签及普通按钮名称属于本批完成门，不可整体标limited后关闭任务。

### 5.2 同名不是一律拒绝

两个“保存”分别属于“收货地址”和“发票信息”时返回上下文，Agent可选择正确target。相同role/name/上下文的两个按钮，若仅由不同且可靠的 `description`（例如各自关联的 `aria-describedby`）或 `hints` 区分，应按该实际区分语义标记为 `contextual` 或 `unique`，让Agent选择正确target；若这些字段相同、缺失、被截断或脱敏后无法区分，则不能凭列表顺序猜第一个，返回 `ambiguous`，拒绝依赖这个歧义目标的 click/input/press/upload/download，沿第7节给出 `target_ambiguous`。其他可区分字段和页面仍可用，不建设“高风险动作”分类器。

完整枚举未完成时，不能武断宣布某个同名目标全页唯一。已知不同上下文或其他可靠区分语义，且可确认作用域内唯一的目标可以 contextual；无法证明该局部区别则 ambiguous。不是要求所有控件都读完才允许操作：批内完整枚举与向Agent分段发送是两件事。

## 6. 批次与目标新鲜度

### 6.1 一批观察，多个传输片段

沿用当前 Instance 的一个 active interaction snapshot槽位和 holder/control generation，不建设多任务快照仓库。Provider保留同批真实句柄/描述，Harbor管理公共批次和cursor映射。新snapshot替换旧批次；普通 metadata observe不冒充新控件观察。

首批元数据与候选集合必须经过一致性核对：采集起止时Page/document与候选对象及相关语义保持；不一致返回 `observation_changed`，不能将两个阶段凑成一批。预算以内可做一次固定采集和末次核对；不无限等待DOM稳定，不要求网络idle。

续读返回冻结的描述，同时用有界只读核对确认候选对象集合/顺序、名称/角色/description/hints、区分上下文及状态没有与该批相矛盾的变化。它可以访问浏览器，但不重新分配target、不刷新captured_at、不悄悄把新控件接到旧列表。发生相关变化、另一次新snapshot、Page导航、控制代次变化、Driver/Runtime重启、scope失配时返回 `observation_cursor_stale`，不返回半份新列表。

纯正文时钟/广告文案变化，未影响任何候选及其关联语义，不使控件续读失效；正文仍是captured_at的前缀。重排候选改变旧offset含义，续读必须失效。只改变另一个字段，会使未完成续读需要重新观察，但不得因此给所有已返回目标的动作加一个全页一致性检查。

普通输入/点击/滚动/wait完成后，继续沿现有interaction snapshot失效规则，需要新snapshot；file操作继续沿既有file观察与控制绑定，并受相同目标身份检查。续读只是同批读取，不能像新动作那样清空前一段句柄或重置observation。一次观察/续读失败只影响该批，不清理其他Profile或历史Run。

### 6.2 每次动作只核对自己的目标

真正派发 click/input/press/upload/download 以及 target-bound wait 前，必须使用保存的**原ElementHandle**，核对：

- 当前Page/document、holder、ControlLease代次和原observation有效，目标来自已经返回的那一段。
- 原节点仍属于原document且仍是同一对象；不存在时不按同role/name/selector重新定位。
- 目标role、input type、可编辑类型、可访问名称，以及本次实际用于区分该目标的 `description`、`hints`、所属容器及其名字保持；未用于区分的可选语义变化不单独使该目标失效。
- 对链接保留并核对原href、target、download等动作相关事实；对提交控件保留所属form对象、有效action/method及控件override；这些私有比较值不公开返回。
- 公开SDK的enabled/visible/editable/actionability检查继续在实际动作上执行。

本次实际用于区分的名称、role、`description`、`hints`、form归属或动作目标改变但节点未替换，返回 `target_semantics_changed`；节点被新节点替换则 `target_stale`。不会因为对象仍isConnected就把它当原目标。比较当前受支持的显式语义，不宣称检测了所有JS事件处理器替换或业务后台变化。

用户输入值、选择状态、光标、尺寸位置、无关正文不进入身份指纹；否则正常填写会无意义地反复失效。disabled→enabled由SDK与wait条件处理，不把“等待启用”变成不可完成；动作所需其他状态变化按现有精确拒绝处理。

若在派发前已经确定目标失效，返回 not_dispatched；一旦调用可能产生网页效果，超时/断连/回执丢失仍保持真实 dispatched/unknown，不能因补充检查失败倒写成未派发。不存在把浏览器完全冻结的原子保证，也不为规避竞态维护浏览器fork。

## 7. 失败、恢复与证据

复用既有失败外壳与failure_class，不添加新权限。新增错误名只用于观察/目标范围：

| failure_class | 含义与下一步 |
| --- | --- |
| `observation_changed` | 新批次采集期间相关现场已变；不发布混合批次，调用方可重新snapshot。 |
| `observation_cursor_stale` | cursor/batch失效或不属于当前上下文；不返回列表，重新snapshot原Page。 |
| `observation_limit_exceeded` | 无法在规定预算内返回至少一个合法片段；准确说明边界，不返回空成功或循环cursor。 |
| `target_stale` | 原元素不再是当前可信对象；未派发，重新snapshot，不匹配相似新目标。 |
| `target_semantics_changed` | 原元素关键显式语义改变；未派发，重新snapshot后由Agent重新决定。 |
| `target_ambiguous` | 观察不足以区分同类目标；未派发，补观察上下文或请用户澄清/人工处理该步骤，不自动点第一个。 |

既有权限拒绝、page_selection_required、stale_document、控制冲突、Driver丢失、origin边界仍沿现行合同，不统一替换成以上错误。未经授权的正文、未知目标归属不得随错误返回。Provider只针对受影响Page拒绝，不停止其他Profile或把整个Provider置永久unsupported。

所有snapshot/续读仍使用当前单Grant与task scope；cursor不授予读取权。相同idempotency key查询原Run/receipt，不刷新现场、复活句柄或产生新target。历史snapshot即使仍在结果记录中，也只是旧事实。只读查询丢响应可查原结果；若批次已失效可显式发起新snapshot。旧写入unknown只能查询原Run/对账/人工处理，不能因新snapshot出现相似目标而重放。

## 8. 公共投影、兼容与安装

实现PR应同步修改当前Core静态定义、parser、MCP schema及describe说明：只对snapshot增加cursor/limit/续读条件；observe只提供页面事实，不产生控件target；获取或恢复target应指向`instance.snapshot`。#539已有错误草稿纠正和next_steps不能回归。describe本身依然只读取管理事实，不执行新的snapshot/续读或验证DOM。

公共snapshot新增上述schema标识；外层interaction/Page/Run协议保持原版本。旧请求不带cursor仍可做首段观察，旧`truncated`不改义；旧消费者忽略新增字段不意味着已具备本项完整性能力。新版Plugin必须验证新snapshot形状与coverage一致性，缺失时显示观察格式/能力未提供，不能默认complete=true。新cursor不得被旧Runtime忽略后偷偷变成新观察；旧入口应明确拒绝未知字段/版本。错误只影响相应操作，不堵住管理、查询或已支持的独立能力。

Core/Harbor/共享Python的内部snapshot字段、cursor映射与严格reader在同一安装候选更新并由manifest核验；不得依赖未登记工作树文件或新TS+旧Python静默混装。新增schema和正反fixture在实现PR实际存在后再从本文件/索引链接，不在本docs PR虚构已存在的文件。

本文件按文首声明形成Page/Plugin正式补充，索引须双向可发现；Page/Plugin的短引用已在本PR加入，真实schema/fixture由实现PR补入，不在本docs PR虚构。实现PR只在旧的snapshot参数列表、截断/目标说明处添加必要引用/修订，不复制整篇规格；旧#519/#541历史状态及未涉及的导航语义不重写。

Design Obligations：`DO-PLUGIN-EXPOSURE=triggered`（snapshot/describe投影及版本）；Page/Observation合同由本文件冻结；`DO-GRANT-WIRE=not-triggered`（无新增授权维度）；Network/Console=not-triggered（不改payload/政策）；Provider-private-schema=not-triggered（无新增环境持久结构；内部消息与安装配对仍必须同步）；App IA=not-triggered（沿用最小owner入口）。

## 9. 实施方案与最早反例

先冻结最小合成页面和预期，再在当前两个官方Provider组合做G0：

- G0-Enumeration：160个短标签控件、短正文，验证首段128/续段32的路径可实现，原版基线是否暴露了该缺口。
- G0-Semantics：label for、包裹label、aria-labelledby、aria-label、两个同名同容器但仅由 aria-describedby 区分的“保存”及基础编辑宿主；公开语义结果必须对应同一真实对象，不能凭可访问树数组位置匹配Handle。
- G0-Identity：替换原节点、原节点改名称/role/form、交换仅用于区分的 aria-describedby 描述、无关时钟变化；先证明完整现行链是否已拒绝，再只补缺口。

不先写一个通用DOM框架再验证公开API。相同SDK和共享实现、两种Provider分别取证；来源、启动和环境不变。现有来源材料缺失可作为局部准备问题，不借本项升级浏览器、改变接入或恢复#530。

实现顺序：共享有限采集/原句柄 → Harbor当前批次及有界cursor → Core/MCP/schema/describe一致投影 → 最薄安装用户任务。复用现有interaction_snapshot/receipts/ControlLease和拥有事件循环；不得新建服务、持久快照库、RefMap框架、第二套operation registry或按品牌复制实现。失效时释放批次句柄/元数据；正常停止/替换批次须清理，历史Run不因清理被删除。

## 10. 完成门（O1—O10）

| 编号 | 必须证明的用户结果/反例 |
| --- | --- |
| O1 | 160短标签控件+短正文：128+32，同一observation，各target不重复/不遗漏；正文与控件完整性独立。长正文+少控件测试相反组合；空页不伪造控件。 |
| O2 | limit1/128、response字节上限、扫描/捕获上限、重复cursor、末段、错误cursor；总数未知与枚举未完整不伪报完成；反例fixture不得全部从同一实现自动生成后只自证。 |
| O3 | 标准label/ARIA来源正确，冲突标签优先序有独立预期；textbox value不冒充name，密码不泄漏；基础编辑宿主可被识别，但textarea/select读取不外推新增动作。 |
| O4 | 不同group中的同名保存可选对；同名同容器但仅由可靠 aria-describedby 区分时可选对；真正歧义只拒绝相应目标，其他字段可用；两按钮分跨首段/续段也不能错判唯一；截断/脱敏后歧义不隐藏。 |
| O5 | 替换同名节点/原节点语义变化的旧target拒绝且网站计数不增；交换仅用于区分的 aria-describedby 描述后旧ref同样以 `not_dispatched` 拒绝且网站计数不增；重新snapshot后可操作新目标。未改变目标的时钟/广告变化不阻塞动作。 |
| O6 | 新snapshot、导航、控制变化、候选重排/改名使旧续读失效；不混批。读完续段不使前段target失效；对前段target的合法一次动作仍可完成。 |
| O7 | 原页A人工接管后查看/修改B，交还后旧ref拒绝，新snapshot仍可在A继续；不跟随OS焦点、不新增系统权限，P2不受影响。 |
| O8 | snapshot/续读不输入、导航、抢焦点或续租；授权收窄/撤销后不能读缓存；超时与已派发unknown保留事实。丢一次写响应后只query原Run，网站计数不增加。 |
| O9 | parser/MCP/describe/Harbor/Python规则及新旧版本适用性一致；安装资产完整；文件target的共享身份检查薄回归，无需重新证明整个Files/Chrome资格。 |
| O10 | 同一正式安装的Chrome与Camoufox分别通过长表单、区分和局部更新最薄流程。真实Codex一条短任务：读到后段字段、填指定非敏感字段、选正确模块保存、局部更新后fresh snapshot、查询原Run；不能给模型selector/原件DOM或正确target答案。 |

确定性测试承担边界、并发与拒绝；真实Provider脚本验证供应方API/句柄；安装客户端验证正式传输和双Provider；真实Agent仅一条短闭环。原生UI自动化与真人分别标记；未变owner路径允许有根据地继承，不能假称重跑现场。#539已完成的发现逻辑只补新operation条件回归，不重做一整轮授权专项。

关键回归稳定后冻结运行候选再打包；只文档变化按运行内容等价继承，不称完整tree相同。适用checks与最终exact-head独立review通过，O1—O10有分层证据后才关闭#540；只有spec合并、API存在或主文档截图成功均不足够。#474/#497/#482保持各自未完成范围。

## 11. 资料及证据边界

产品要求来自#540及上述仓内合同；本文件中的分页大小、范围、字段和失败规则是本项待接受的设计决定，不是从供应方材料推导出的现成WebEnvoy能力。

供应方公开参考（用于G0核对固定版本的实际能力，不意味着直接采用最新版本）：

- [Playwright Python Locator API](https://playwright.dev/python/docs/api/class-locator)：可访问名称/标签定位与aria_snapshot。
- [Playwright aria snapshots](https://playwright.dev/python/docs/aria-snapshots)：可访问树摘要，并非稳定元素身份协议。
- [W3C Accessible Name 1.2](https://www.w3.org/TR/accname-1.2/) 与 [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/)：标签、名称来源与角色语义参考；本批不宣称完整标准合规。

本spec未运行浏览器、安装或真实Agent；现有源码审阅不代替O1—O10。实际能力、失败、已接受修订、exact head及安装证据由#540和其实现PR维护。
