# Form State and Target Actionability V1

状态：Accepted（实施规格已接受；功能实现与验收仍由 #555 另行交付）；版本：1.0。owner：Harbor（目标状态、引用与动作前检查）、共享 Provider execution（真实元素与状态采集）、Core（operation 定义、授权与结果）、Plugin（正式 projection）。归口：[Work Item #555](https://github.com/WebEnvoy/WebEnvoy/issues/555)，parent [#497](https://github.com/WebEnvoy/WebEnvoy/issues/497)，消费 [#474](https://github.com/WebEnvoy/WebEnvoy/issues/474)。

依据：[Observation Completeness and Target Identity V1](observation-targets-v1.md)、[Capability Discovery and Operation Guidance V1](capability-discovery-v1.md)、[Plugin Runtime Exposure V1](plugin-runtime-exposure-v1.md)、[Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md)、[Page/Document 合同](page-navigation-runtime-contract-v1.md)、[Grant Wire Contract V1](grant-wire-contract-v1.md) 与当前已接受的 canonical v1.6（已合并 [.github#27](https://github.com/WebEnvoy/.github/pull/27) 与 [#571](https://github.com/WebEnvoy/WebEnvoy/pull/571)）。

本文件只表示规格接受；#555 的实现、schema/fixture、Chrome/Camoufox、正式 installed Plugin 与真实第三方 Agent 验收仍未完成。

本文件是 Observation／Plugin 对 #555 的专门补充：在 #540 已有可信 target 上增加**目标当前状态**和**目标级动作适用性**，并冻结状态变化时的动作前检查。它不建立第二套 Page/RefMap、operation registry、权限系统或 Agent planner；未被本文件改变的 Observation、Plugin、Grant、Page、Run、ControlLease 和 unknown/no-replay 语义继续沿现有合同。

---

## 1. 用户结果

用户把一张已经填写了一部分的普通表单交给 Agent，并要求“只修改指定内容”。Agent 应能够：

1. 看清目标字段当前已经是什么状态，而不是只知道“这里有一个 textbox／button”；
2. 区分“已经正确”“为空”“只读／禁用”“无法可靠读取”“因敏感性不能暴露”；
3. 知道这个具体 target 当前适合使用哪些**已经正式存在**的浏览器 operation，而不是靠试错选择工具；
4. 页面或该目标相关状态在观察后改变时，不拿旧状态继续覆盖或反向切换；
5. 真正执行仍经过现有 Provider support、Plugin exposure、Grant、ControlLease、Page/document、target freshness 和 Run/dispatch 检查。

本规格降低的是 Agent 因“看不清已有状态／猜错操作”产生的无效步骤。它不保证模型业务判断永远正确，也不把页面状态当作业务成功证明。

## 2. 范围与非目标

### 2.1 首批范围

复用 #540 的 `main_document_light_dom` 观察范围和真实 `target_ref`。首批只补普通表单目标的状态与当前已存在交互 operation：

- 普通安全文本输入、textarea、基础 contenteditable 的可见当前文本状态；
- checkbox/radio/switch 等的 checked 状态；
- 原生 select／可可靠投影的 option 当前选择状态；
- 有明确 ARIA 状态的 expanded；
- 普通编辑目标的 readonly；
- `instance.click`、`instance.input`、`instance.press` 的 target-local 适用性。

`instance.wait` 继续由 operation 自身的 `wait_for` 合同说明，不作为“对目标做什么”的推荐动作；`instance.scroll` 是 Page 级动作，不进入 target actionability。Files 继续由 Managed Browser Files 合同承接，本规格不改变 `file.upload`／`file.download` target 语义。

### 2.2 明确非目标

本规格不新增：

- `select` operation、drag/drop、复杂富文本编辑、任意键盘 widget；
- child frame、shadow root、虚拟列表发现；
- selector、坐标、Provider handle、任意 JS／CDP；
- Jev／TypeSafe 或 WebEnvoy 内置 planner；
- 新 Grant 维度、新 Provider、浏览器／驱动补丁；
- Account／BusinessTarget／SKILL 的业务判断；
- “目标可操作”到“当前 Agent 已获授权执行”的合并。

能观察 select/textarea/contenteditable 不等于本规格新增对应编辑能力；目标动作列表只能包含当前正式定义并由 installed Plugin 暴露的 operation。

## 3. Snapshot 公共投影

### 3.1 兼容标识

沿用 `harbor-observation-targets/v1` 外层 schema version，不为本项重命名整个 Observation 合同。支持本规格的 snapshot 必须新增：

```json
{
  "target_semantics_revision": "webenvoy.form-state-actionability/v1"
}
```

`harbor-observation-targets/v1` 仍是外层 schema 标识，但本项新增的 top-level、control 和 `coverage` 字段属于配对的 projection contract，不能按 JSON additive 字段约定交给严格旧 reader。旧 Plugin/reader 若仍按现有 schema（包括 `additionalProperties:false`）解析新 projection，必须在读取／解析边界沿用既有 `observation_format_unavailable` 组件版本错误语义，并提示升级配对的 Plugin/Runtime；不能继续把该 snapshot 当旧格式执行。需要 #555 能力的消费者必须检查该 revision，缺失或版本不匹配时不得假定状态或动作列表存在。Capability discovery 应把缺失／版本不匹配准确表达为当前 observation enhancement 未提供，而不是把基础 `instance.snapshot` 误报为整体 unsupported；版本不匹配不回填默认、不自动 downgrade/replay，也不建立新的协商或旧格式兼容层。

### 3.2 每个 control 的新增结构

每个已返回 control 在现有 `target_ref/role/name/enabled/name_source/description/context/hints/disambiguation` 基础上增加：

```json
{
  "state": {
    "value": {"status": "present", "text": "现有标题"},
    "checked": {"status": "not_applicable"},
    "selected": {"status": "not_applicable", "labels": []},
    "expanded": {"status": "not_applicable"},
    "readonly": {"status": "known", "value": false}
  },
  "target_actions": {
    "operations": ["instance.click", "instance.input", "instance.press"],
    "blockers": []
  }
}
```

这只是形状示例；实际字段必须满足下述状态、大小和跨字段规则。

## 4. 当前状态语义

### 4.1 通用规则

`state` 固定包含五个槽位：`value / checked / selected / expanded / readonly`。不存在的事实不能通过缺字段、空字符串或 false 猜测。

每个槽位必须显式使用状态：

- `known`：布尔／集合事实可靠取得；
- `present`：文本值非空且允许公开；
- `empty`：文本值可靠为空；
- `not_applicable`：该事实对这个 target 不适用；
- `unavailable`：适用，但当前无法可靠取得；
- `redacted`：存在或可能存在敏感值，本合同明确禁止公开。

具体槽位只允许其适用状态：

| 槽位 | 允许状态 | 值 |
| --- | --- | --- |
| `value` | `present / empty / not_applicable / unavailable / redacted` | `present` 时 `text` 必须存在；其他状态不得携带 `text` |
| `checked` | `known / not_applicable / unavailable` | `known` 时 `value=true/false/"mixed"` |
| `selected` | `known / not_applicable / unavailable` | `known` 时 `labels` 为当前可见选择标签数组，可为空 |
| `expanded` | `known / not_applicable / unavailable` | `known` 时 `value=true/false` |
| `readonly` | `known / not_applicable / unavailable` | `known` 时 `value=true/false` |

Agent 可以用这些状态判断“是否还需要修改”，但它们只是 `captured_at` 时的页面事实，不是授权或业务结果。

### 4.2 文本值

- `value.text` 最多 512 个 Unicode 字符；超出时只返回前缀，并由 control 的 `truncated_fields` 增加 `state.value.text`。
- `password`、file input 路径、hidden value 不返回正文；password/file 使用 `redacted`，hidden input 继续不进入普通 controls。
- `autocomplete=current-password/new-password/one-time-code` 或供应方明确等价的敏感字段必须 `redacted`，不能因页面可见就自动公开。
- 普通 email/tel/url/text/search/number 等是否允许返回，继续受现有 Page/operation 授权、脱敏和任务数据边界控制；本规格不单独扩大 origin、Profile 或正文读取权限。
- textarea/contenteditable 只返回当前可公开的有界文本；这不新增多行／富文本编辑能力。

### 4.3 checked / selected / expanded / readonly

- `checked` 优先使用真实标准 property／明确 ARIA state，三态控件可返回 `"mixed"`；无法把字符串安全归一时 `unavailable`，不得猜 false。
- `selected.labels` 返回用户可见的当前选择标签，最多 16 项，每项最多 256 字符；更多时只保留前 16 项并在 `truncated_fields` 加入 `state.selected.labels`。本规格不公开 raw option value 作为业务身份。
- `expanded` 仅在真实 `aria-expanded`／供应方等价公共语义存在时 `known`，没有此概念的控件为 `not_applicable`。
- `readonly` 对普通 editable controls 使用 DOM/ARIA 等价语义；对按钮、链接等无此概念的目标为 `not_applicable`。未知不能默认 false。

### 4.4 完整性

Snapshot `coverage` 增加：

```json
{
  "state": {
    "complete": true,
    "reason_codes": []
  }
}
```

固定 reason codes：

- `state_unavailable`：至少一个适用状态无法可靠取得；
- `state_truncated`：至少一个公共状态达到本规格的有界输出限制；
- `state_redacted` 不视为采集失败，不进入 reason_codes；redacted 是正确的数据边界。

`coverage.state.complete=false` 不使整个 observation 或其他可靠 controls 失效。具体 target 的每个状态槽位仍必须准确表达自己的 status。

## 5. Target actionability

### 5.1 它回答什么

`target_actions` 只回答：**在这个 observation 中，这个具体 target 从自身可见／可编辑／可区分语义看，哪些当前 installed Plugin 已正式暴露的 target-scoped operation 可以作为合法候选。**

它不回答：

- 当前 Principal 是否获得 Grant；
- Provider 当前是否 verified／limited；
- ControlLease 当前由谁持有；
- Instance/Page 是否在查询后发生变化；
- 这一步是否符合用户业务目标；
- 执行是否一定成功。

这些事实继续由 #539 和真正派发路径的现有 owner 判定。`target_actions` 不是授权凭证或成功保证。

### 5.2 当前 operation 映射

首批只允许列出以下既有 operation：

| operation | target-local 适用条件 |
| --- | --- |
| `instance.click` | 当前 target 是可交互、非 file target，`enabled=true`，`disambiguation!=ambiguous`；点击仍由 Provider actionability 在派发时复核 |
| `instance.input` | `hints.editable=true`，`state.readonly` 明确为 `known:false`，`enabled=true`，`disambiguation!=ambiguous` |
| `instance.press` | 当前 target 是可交互、非 file target，`enabled=true`，`disambiguation!=ambiguous`；具体 key 仍必须满足 operation 自身枚举与派发检查 |

不符合条件的 operation 不进入 `target_actions.operations`。不能因为历史某次 Provider 尝试成功，就把未满足公共条件的 operation 加入列表。

### 5.3 blocker

`target_actions.blockers` 是有界枚举，只解释为什么当前 target-local action set 被收窄：

- `disabled`
- `readonly`
- `ambiguous`
- `state_unavailable`

Blocker 可以并存。`blockers=[]` 也不表示已授权、Provider 支持或业务上应该执行。

`state_unavailable` 只在某个本可影响当前动作选择的 target state 无法可靠取得时使用；不能因为无关状态不适用就阻止所有动作。

### 5.4 单一事实来源

- operation 是否正式定义／Plugin 是否暴露，来自 #539 使用的同一 canonical operation definition；Plugin 不复制第二份白名单。
- target role/hints/state/disambiguation 来自同一 Harbor observation；不得在 Plugin 根据文本重新猜控件类型。
- Provider support、Grant、ControlLease、Page/Instance availability 继续由现有动态 owner 提供；不得塞进 `target_actions` 形成第二份真相。

## 6. 状态新鲜度与动作前检查

### 6.1 状态不是 target identity

#540 的 target identity 规则保持：输入值、checked/selected 等正常变化不进入“这还是不是原 DOM 对象”的 identity fingerprint。否则用户正常编辑会把目标本身无意义地判成替换。

本规格新增独立的 **target state freshness**：只有当即将执行的 operation 的意图会被该 target 自身状态变化反转或覆盖时，动作前检查比较相关状态。

### 6.2 固定检查规则

- `instance.input`：重新核对该 target 的 `value`、`readonly` 和 editable 事实。自 observation 后已改变且会造成覆盖旧现场时，未派发并返回 `target_state_changed`，要求 fresh snapshot。
- `instance.click`：对 checkbox/radio/switch/option 以及带明确 expanded state 的 disclosure target，重新核对 checked/selected/expanded；如果状态已改变，未派发并返回 `target_state_changed`。普通按钮/链接不因无关字段值改变而失效。
- `instance.press`：按 key 固定比较与动作相关的 target state，而不是由实现者自行判断：
  - editable textbox/searchbox/spinbutton/combobox/contenteditable 上的 `Backspace`、`Delete`、`Space`、`Enter`：核对 `value` 与 `readonly`；
  - checkbox/radio/switch 上的 `Space`、`Enter`：核对 `checked`；
  - select/option 上的 `ArrowDown`、`ArrowUp`、`Home`、`End`、`Space`、`Enter`：核对 `selected`；
  - 带明确 expanded state 的 disclosure target 上的 `Space`、`Enter`：核对 `expanded`；
  - `Tab`、`Escape`，以及没有上述相关状态的其他合法 key，只做 #540 的 target identity/semantics 与 Provider actionability 检查，不因为无关 state 变化拒绝。
- enabled/visible/actionability 仍由现有 Provider SDK/共享执行路径在派发时复核；disabled→enabled 的有界 wait 继续可成立，不把 enabled 本身并入固定状态 fingerprint。

不得因为另一个无关字段变化、正文时钟变化、广告刷新或页面其他目标状态改变，让当前 target 全局失效。

### 6.3 新失败类与错误优先级

新增：

| failure_class | dispatch_state | 含义与下一步 |
| --- | --- | --- |
| `target_state_changed` | `not_dispatched` | 原 target 仍是同一可信对象，但与本次 operation 相关的当前状态已不同；重新 snapshot，让 Agent 基于新状态重新决定，不自动重放 |
| `target_operation_not_applicable` | `not_dispatched` | 当前 operation 与 target 的公共适用条件不匹配；改用 snapshot 返回的候选 operation，或在缺能力时准确报告限制 |

既有授权、Profile/Page 可见性、origin、document/control generation、ControlLease 与 `target_stale/target_semantics_changed/target_ambiguous` 的检查和失败优先级保持；调用方无权访问目标或目标本身已失效时，不得为了返回 actionability 错误而泄漏目标存在、状态或适用操作。只有在现有访问和新鲜度边界通过后，才使用 `target_operation_not_applicable`／`target_state_changed` 解释 target-local 拒绝。

只有能在 Provider 派发前证明时才能返回以上错误。一旦已经调用可能产生网页效果，超时／断连／响应丢失仍必须保留真实 `dispatched/unknown_outcome`，不能倒写为未派发。

## 7. Plugin 与 capability discovery

- 不新增 MCP tool；继续使用 `webenvoy_operation` / `instance.snapshot` 和既有执行 operation。
- Installed Plugin 必须透传并验证 `target_semantics_revision`、`state`、`target_actions` 和 `coverage.state` 的形状；不能在缺字段时补默认值制造“已支持”。
- `webenvoy_describe` 继续是 operation 级说明，不访问 DOM、不生成 snapshot、不把某个 target 的实时状态缓存进去。
- 当调用方已经有一个 fresh target，并询问／执行具体 operation 时，静态参数定义、Provider support、Plugin exposure、authorization、Runtime availability 继续来自 #539；target-local 适用性只来自 snapshot。
- Capability discovery 可说明“当前安装支持 `webenvoy.form-state-actionability/v1`”或准确 limited/unavailable，但不能把 target actionability 当作 Grant。

## 8. 兼容、schema 与数据边界

### 8.1 Wire 兼容

- `harbor-observation-targets/v1` 保持；#555 通过 `target_semantics_revision` 声明增强语义。
- 实现 PR 必须同步更新当前 Harbor/Core/Plugin response schema、positive/negative fixtures、TypeScript/Python reader 与 packaged schema；spec PR 不虚构尚不存在的新 fixture 路径或验收证据。
- 旧 Runtime 缺少 revision 时，支持兼容读取的新版 Plugin/consumer 仍可读取 #540 基础 snapshot，但必须准确显示 #555 enhancement 未提供，不把缺失 `state` 当空状态，也不把缺失 `target_actions` 当“没有可执行操作”。
- 新 Runtime/Harbor 返回含新增字段的 projection 对仍按旧 `harbor-observation-targets/v1` 结构严格解析的旧 Plugin/consumer 不是无条件兼容：top-level、control 或 `coverage` 的严格 `additionalProperties:false` reader 必须沿用 `observation_format_unavailable` 读取错误并提示配对升级。不得静默忽略、回填默认、降级到旧格式或重放原 operation。
- 读取／解析失败与浏览器 operation 的 dispatch state 分开：`observation_format_unavailable` 不新增 failure_class，也不把底层已派发的 operation 改写为 `not_dispatched`；已派发／`unknown_outcome` 仍按原 Run 查询与 no-replay 合同处理。

### 8.2 数据与权限

- 本规格不新增 Grant wire dimension；snapshot 权限、origin、Profile、Page、task scope 和 Connection/Principal 规则全部保持。
- 结构化字段仍是页面内容，不因变成 `state.value` 就从不可信输入升级为指令、授权或业务事实。
- 敏感值先按本规格和现有 owner 规则过滤／redact，再计算公共响应大小；不得先保留敏感原文到普通 Agent projection 后再靠 UI 隐藏。
- Run/evidence 的持久化继续遵守现有 retention；本规格不要求把每次完整表单值长期保存为 evidence。

## 9. 验收

规格接受不表示功能已实现。#555 实现至少覆盖：

### S1 — 只改指定字段

固定页面包含多个已有正确值，任务只修改一个普通字段。Agent 能看见已有状态，只修改目标字段，不为了确认页面而重填其他字段。

### S2 — 状态区分

同页包含 empty/present/readOnly/disabled、checked true/false、single select 当前选择、expanded true/false，以及 password/OTP 等 redacted 目标。各状态不混淆，敏感正文不泄漏。

### S3 — 动作候选

普通 button、editable textbox、readOnly textbox、ambiguous 同名 target、file input 并存。`target_actions` 只列当前允许的三类 target-scoped operation；未交付 select、Files 或其他能力不被冒充。

### S4 — 错误组合

先在当前生产实现建立至少一个 operation/target 不适配反例；修复后，能在派发前证明的不适配组合返回 `target_operation_not_applicable/not_dispatched`，而不是依赖 Provider 异常试错。未复现的假设不得写成修复成功。

### S5 — 状态变化

观察后修改同一 textbox value、checkbox checked 或 disclosure expanded，但保持原 DOM 对象和名称。旧动作返回 `target_state_changed/not_dispatched`；fresh snapshot 后得到新状态。普通按钮不因页面其他字段值变化而被全局失效。

### S6 — #540 不回归

节点替换、role/name/form/action 变化、同名歧义、continuation、Page/document/control generation 与人工接管仍按 #540/#554 准确拒绝／续读；本规格不把 state freshness 混成 target identity。

### S7 — 双 Provider 与正式安装

Chrome、Camoufox 分别验证声明范围；共享实现不等于自动继承支持结论。Installed Plugin 验证真实 projection/revision/schema；真实第三方 Agent 完成一条“看清已有状态 → 只改指定字段 → 查询原 Run/结果”的短任务。

### S8 — 对比指标

同一固定任务记录增强前后的无效 operation 调用、不必要重复填写/点击、工具调用数、observation 输出体积、任务耗时与 fresh snapshot 次数。指标用于判断用户收益，不设未经证据支持的 SLA，也不能以减少必要观察／权限检查制造好看数据。

### S9 — 版本配对与读取边界

固定旧 `harbor-observation-targets/v1` 严格 reader 消费含新增 top-level、control、`coverage` 字段的新 projection：在读取／解析边界返回既有 `observation_format_unavailable` 并提示升级配对的 Plugin/Runtime，不回填默认、不自动 downgrade/replay；该读取错误不新增 failure_class，也不改变底层 operation 的 dispatch state。固定新版 Plugin/consumer 消费缺少 `target_semantics_revision` 的旧 Runtime 基础 snapshot：基础 #540 snapshot 仍可用，但 #555 enhancement 必须标记为未提供，不臆造 `state` 或 `target_actions`，并可继续查询原 Run。

## 10. Design Obligations

- `DO-PLUGIN-EXPOSURE = triggered`：本文件作为 #555 对 Plugin Runtime Exposure 的专门补充，冻结新增 observation projection、revision、兼容和错误语义；其余 Plugin tool/exposure/availability 继续沿 `plugin-runtime-exposure-v1.md`。
- Observation/Page = triggered：本文件只增加 target state/actionability 和相关 freshness，不重写 #540 的完整性、target identity 与 continuation。
- `DO-GRANT-WIRE = not-triggered`：未新增授权维度，复用现有 Profile/origin/operation/task scope/ControlLease。
- Network/Console = not-triggered：不改变其公共 payload 或权限。
- `DO-PROVIDER-PRIVATE-SCHEMA = not-triggered`：不新增 Provider 私有持久配置；只读取当前页面公开状态。
- `DO-APP-IA = not-triggered`：不新增完整 App surface。

## 11. 实施顺序与暂停条件

实现按以下顺序推进，不把产品选择留给执行者：

1. 在当前 main 建立 S2/S3/S4/S5 最小反例与期望；
2. 扩展共享 observation 采集与 actionability 计算，保持原 ElementHandle；
3. 增加 target state freshness 和 `target_operation_not_applicable` 派发前检查；
4. 同步 Harbor→Core→Plugin schema/projection、capability revision 说明；
5. 跑 #540 关键回归、两种 Provider 正式安装，再做一条真实 Agent 薄闭环；
6. 记录 S8 指标，不将 #556 性能调查自动并入本项完成门。

出现以下任一情况时暂停受影响部分并回到产品／规格判断，不自行扩大范围：

- 必须新增 select／复杂编辑等浏览器能力才能完成普通状态观察；
- 必须读取密码、凭据、Cookie、raw Profile 或扩大正文权限；
- 必须建立第二套 operation registry、权限表或 Agent planner；
- 必须修改供应方浏览器／驱动；
- 无法在 Provider 派发前判断结果，却需要把 dispatched/unknown 改写为 not_dispatched 才能满足验收。
