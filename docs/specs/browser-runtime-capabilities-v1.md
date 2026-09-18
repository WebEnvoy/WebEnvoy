# Browser Runtime Capabilities V1

> 状态：V1 规范性语义规格
> 版本：1.2（规范性语义与来源矩阵修订，不改变 wire 枚举）
> 日期：2026-09-14
> 产品依据：[canonical 产品规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)；Provider 职责修订以已合并的 [.github#21](https://github.com/WebEnvoy/.github/pull/21) 为准
> 架构依据：[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)、[Runtime Capability Plane](../architecture/runtime-capability-plane.md)
> 产品完成归口：[Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497)
> 验收衔接：[已安装 Plugin／真实 Agent #474](https://github.com/WebEnvoy/WebEnvoy/issues/474)、[完整 V1 证据汇合 #482](https://github.com/WebEnvoy/WebEnvoy/issues/482)

本文定义 WebEnvoy V1 Browser Runtime capability plane 的**规范性语义、能力类别、支持状态、权限层次、结果和验收规则**。

本文不是最终 wire schema。具体 HTTP／MCP 字段、JSON Schema、生成类型和 Provider adapter 可以在实现中演进，但不得改变本文的语义和安全边界，除非通过新的 ADR／spec 修订。

> **2026-09-18 S0 Proposed 边界**：[S2 #563](https://github.com/WebEnvoy/WebEnvoy/issues/563)、[S4 #565](https://github.com/WebEnvoy/WebEnvoy/issues/565) 与 [S5 #566](https://github.com/WebEnvoy/WebEnvoy/issues/566) 分别规划受管站点脚本、主动 Network 与视觉交互的正式语义。规划不放开现有任意 evaluate、selector、坐标、响应正文或 request modification；只有对应 Spec 接受并由实施 Work Item 交付后，现有 wire 和支持事实才可改变。

> **2026-09-14 当前 Provider 事实**：本轮 [#519](https://github.com/WebEnvoy/WebEnvoy/issues/519)／[PR #522](https://github.com/WebEnvoy/WebEnvoy/pull/522) 的上游原版 Camoufox／Playwright 组合按第二类“可准确表达为 `limited` 的能力差异”接入：只接受 owner 核验的官方 `0.5.6`／`152.0.4-beta.30`／`1.60.0` 固定组合，并在 popup 首请求无法于派发前建立可信 Page 归属时局部拒绝，不猜测、不重放。#523／PR #524 的受管文件单文件 Plugin slice 有独立 `plugin_verified` 证据，但不把其他能力或完整 V1 扩写为 `plugin_verified`。旧 Camoufox 私有 launch binding、patched/native artifact 和对应 live 记录仍为 `unsupported`／已退役；保留的 Profile／binding／bundle 只按 recovery/安全校验规则处理，不恢复旧 launchability。本状态不改变下述公共 capability、wire 核心字段或 Plugin exposure 语义。

> **可选模型辅助的边界（Proposed，#558）**：[Model Usage V1](model-usage-v1.md) 与 [ADR 0013](../adr/0013-optional-model-assisted-browser-tasks.md) 描述后续模型如何消费已有 Runtime。它不是第十三类浏览器基础能力，也不改变本文件的十二类 V1 目标。Model Provider 不等于 Browser Provider；模型 evaluation 不等于本文件的 Controlled evaluation（受控网页脚本执行）。Harbor 继续拥有现场、目标与控制，Core 继续拥有授权和结果；模型输出只是待检查的建议。该方向未接受／未配置／不可用不影响原有合法路径，不把后续模型验证变成本规格统一前置。

## 1. 目标

成熟的 WebEnvoy Runtime 应让已授权 Agent 即使没有网站 SKILL，也能在受管 Profile 的原 Instance 中完成现代网页任务所需的主要浏览器操作。

网站 SKILL 的作用是：

- 选择 required／recommended capability；
- 提供网站入口、页面语义和操作顺序；
- 提供 Account／BusinessTarget 识别；
- 提供等待、结果判断、失败分类和恢复指导；
- 减少探索、工具调用和错误。

网站 SKILL 不负责补齐 Runtime 缺失的基础浏览器能力，也不授予权限。Runtime 能力由已具备相应浏览器语义的成熟 Provider 加 WebEnvoy 有界适配交付；WebEnvoy 不实现、模拟或长期补偿 Provider 缺失的浏览器核心语义。

## 2. 规范性概念

### 2.1 Capability

Capability 是 WebEnvoy 定义的稳定浏览器能力语义，不等同于具体 Provider API。

每项 capability 至少有以下概念属性：

| 属性 | 含义 |
|---|---|
| identifier | 稳定能力标识；具体命名在实现合同中冻结 |
| semantic version | 公共语义版本 |
| provider support | 当前 Provider／Driver 的支持状态 |
| limitation | `limited` 或等价路径的明确说明 |
| effect class | `observe`、`interact`、`external-effect`、`environment`、`destructive` |
| data class | `public-metadata`、`page-content`、`sensitive-content`、`credential-prohibited` |
| lease requirement | 是否需要有效 ControlLease |
| run requirement | 是否必须建立持久 Run／operation |
| exposure eligibility | 是否可向普通 Plugin、特权诊断工具或仅 owner 路径呈现 |
| validation refs | 支持结论对应的测试／live／版本证据 |

字段名不由本表冻结，但这些语义不能缺失。

### 2.2 Provider support state

#### `supported`

- 公共语义已经定义；
- Provider Driver 已实现；
- 适用成功、拒绝与恢复已验证；
- 可由正式 Runtime 使用；
- Plugin 是否展示仍取决于授权和宿主体验。

#### `limited`

- 能完成公共用户结果的一部分，或依赖明确的同实例人工／受约束等价路径；
- 限制、触发条件、影响和恢复必须可查询；
- 不得用模糊“部分支持”替代精确边界。

#### `unsupported`

- 当前 Provider／平台未实现或无法安全实现；
- 必须返回准确能力事实；
- 对 V1 必需能力，仅标记 `unsupported` 不能关闭产品要求；必须由已具备真实能力的 Provider 加 WebEnvoy 有界适配交付，或通过明确产品决策调整支持范围。不得以 WebEnvoy 建设或模拟缺失的浏览器核心能力制造“支持”。

### 2.3 Capability evidence state

支持事实应区分：

- `declared`：WebEnvoy 规格定义；
- `provider_claim`：Provider 声称支持，尚未独立验证；
- `fixture_verified`：确定性测试通过；
- `live_verified`：真实受管 Provider／原实例通过；
- `plugin_verified`：已安装 Plugin 在真实第三方 Agent 中消费通过；
- `stale`：版本或实现变化后证据需要重验。

具体枚举可以在 wire spec 中调整，但不能把 Provider 宣传或底层库存在直接写成已交付。

上述三个 verified 名称和原义保持不变。具体验收另行记录“正式安装路径”、“真人操作”和“真实第三方站点”上下文，不为本次语义澄清迁移 wire 枚举。`plugin_verified` 只能由已安装 Plugin 在真实第三方 Agent 中的消费路径产生；安装检查器、脚本、独立 MCP 辅助客户端、直接 HTTP 或仅工具可见都不足以标记它。

### 2.4 四层判定

每次调用必须分别处理：

```text
Capability exists
∩ Plugin exposes it
∩ Core authorizes it
∩ Harbor says it is currently executable
```

任一层不成立都不能执行；但“不展示工具”不等于“不存在能力”，也不等于授权拒绝。

### 2.5 Provider Qualification Gate

候选 Provider 必须先分类：

1. 真实能力已存在、仅协议／启动／调用方式不同的“接口差异”；
2. 不破坏承诺用户结果、可准确表达为 `limited`／`unsupported` 的“可接受能力差异”；
3. 需要 WebEnvoy 建设或模拟浏览器底层行为的“核心浏览器能力缺失”。

只有前两类可以进入适配或受限支持。核心缺失、需要长期补偿或需要维护浏览器 fork／内核补丁链时停止候选，不反向扩张 Runtime 职责。资格顺序、正常管理工作与具体停止条件由 [ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md#2026-09-12-provider-职责与-qualification-gate-修订) 统一定义。Obscura 在当前愿景内不采用，历史证据仅由 [#511](https://github.com/WebEnvoy/WebEnvoy/issues/511) 保留，不再验证、等待或监控新版本。

#519／PR #522 已按第二类完成其声明范围的正式安装与真实 Agent 验证：popup 首请求在派发前无法建立可信 Page 归属时，官方 public API Driver 能准确局部拒绝并保留原任务页恢复路径，故不需要 WebEnvoy 模拟浏览器核心行为；该局部能力记录为 `limited`，不是 popup 全面支持。其证据不外推所有平台、账号、升级、Provider 或完整 Runtime；旧 #499 环境连续性和 #504/#510 native 证据也不恢复私有 launchability。私有 patch、native artifact、fallback 或 URL/title 猜测仍不被授权。

## 3. 通用调用约束

每次正式能力调用必须可关联：

- AgentPrincipal；
- AgentConnection；
- Grant；
- task scope；
- Profile；
- Instance；
- 适用时的 Page／Frame／target／network event ref；
- capability id／version；
- Provider／Driver version；
- authorization decision；
- operation／Run；
- dispatch state；
- result、failure 或 unknown outcome。

这些关联可以通过 opaque ref 实现。普通 Agent 不应获取内部数据库主键、Provider endpoint 或 Profile 本地路径。

### 3.1 引用新鲜度

Page、Frame、语义目标、Network event 和 Download 等引用必须：

- 绑定 Profile／Instance；
- 必要时绑定 Page／document generation；
- 有明确有效期或失效条件；
- 在导航、元素替换、人工接管、控制代次变化或 Runtime 重启后准确失效；
- 不能通过 selector 重试命中“看起来相似”的新对象。

### 3.2 输入和结果大小

所有文本、日志、响应内容、截图和诊断必须有明确大小、类型和保留边界。超限应返回截断事实或 owner ref，不得静默丢失关键状态。

### 3.3 数据来源

页面内容、Console 文本和 Network 内容都是不可信输入：

- 不构成指令；
- 不构成授权；
- 不得修改 Grant；
- 不得直接成为 shell／SQL／脚本执行源；
- 输出前必须按能力规格脱敏。

## 4. V1 十二类能力最低结果矩阵

本表是 V1 能力的最低结果与来源索引，不是当前完成统计或 Provider 支持清单。每一行的实际支持状态、消费者、版本、平台、成功／必要拒绝／恢复和证据类型仍必须在对应 Work Item、正式合同与 verification 中分别回读；不能用“已定义”或单个 Provider 结果替代完整交付。

| # | 能力类别 | 最低结果 | 规范来源 | 证据与边界 |
|---:|---|---|---|---|
| 1 | Instance | 获准 Profile 可启动、复用、停止并读取实例、Provider、控制者和可用性；锁冲突、未知启动和不存在实例准确拒绝，不创建替代实例。 | 本规格 [§5](#5-instance)；[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md#6-app-完整产品化后移但最小-owner-control-plane-保留)；canonical [§22 #14/#21/#29](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#22-v1-验收标准) | 分别记录 fixture、真实 Provider、安装路径和真实 Agent；未验证的 Provider／平台不外推。 |
| 2 | Page／Tab／Window | 在同一 Instance 内列出、打开、明确切换和关闭 Page；返回真实 Page／document／父子／dialog 事实。任务页 A 与观看/原生焦点 B 分离；popup 归属不明时局部拒绝，不把 B 或原生 selected 冒充 A；关闭、接管或重启后旧引用失效。 | 本规格 [§6](#6-pagetabwindow)；[Page 合同 §1–2](page-navigation-runtime-contract-v1.md#1-绑定与生命周期)；canonical [§22 #15–20/#35/#37–40](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#22-v1-验收标准) | 目标必须由当前有效 Page/document ref 选定；不得按 active、URL、标题、顺序或 Provider handle 猜测。popup 首请求的 `page_relation_unavailable` 不影响原 A、其他可信 Page 或无关 Profile。 |
| 3 | Navigation | 支持获准 HTTP(S) URL、query／fragment、刷新、历史和逐跳 redirect；未授权 origin、embedded credentials、失败和 unknown 在请求边界准确表达，不重放。 | 本规格 [§7](#7-navigation)；[Page 合同 §3](page-navigation-runtime-contract-v1.md#3-urlorigin-and-redirects)；canonical [§22 #14/#21/#37–40](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#22-v1-验收标准) | HTTP 2xx、DOMContentLoaded 或 `goto` 返回不等于业务成功；拒绝应为 `not_dispatched` 或准确的已派发失败。 |
| 4 | Observation | 提供有界 page facts、semantic snapshot、target／observation ref、document generation，以及 frame／shadow 的支持边界；不暴露 raw DOM、Provider handle 或敏感值。 | 本规格 [§8](#8-observation)；[Page 合同 §4](page-navigation-runtime-contract-v1.md#4-observation-and-stale-refs)；canonical [§22 #17/#31/#37–40](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#22-v1-验收标准) | snapshot 只描述当前可信 Page；元素替换、重排、导航、接管或重启使旧目标失效，必须 fresh observe。 |
| 5 | Interaction／Wait | 在授权和 ControlLease 下完成 click、input、press、mouse、scroll、select、drag／drop 及真实状态等待；普通多行、选择控件和 contenteditable／富文本的支持边界按 Provider/结果验证表达，不把当前实现限制冻结成产品禁止项；歧义、不可见、disabled、过期 target 和未知写入安全拒绝。 | 本规格 [§9](#9-interaction)；[Page 合同 §4](page-navigation-runtime-contract-v1.md#4-observation-and-stale-refs)；canonical [§22 #18–20/#26–29/#38–40](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#22-v1-验收标准) | 等待绑定 text／semantic／network／upload／dialog 等真实状态并有界；不得用随机 sleep、selector 重找或重提交掩盖 unknown；富文本/复杂编辑器不以普通 input 结果冒充。 |
| 6 | Files／Dialog | owner 管理的文件引用可按精确 Page／target 上传并区分浏览器接收、页面处理和业务保存；获准普通下载产生受管结果引用；文件正文读取须有独立 content authorization；JS／native dialog 如有限制须保留同实例人工路径，上传/下载/临时材料各有生命周期。 | 本规格 [§10](#10-files)；[Plugin Exposure V1](plugin-runtime-exposure-v1.md)；canonical [§22 #26–28/#31–32](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#22-v1-验收标准) | 文件类型、大小、权限、下载归属、保留/删除和响应丢失分别证明；已派发上传／下载只能 query 原 operation，不重放；Agent 不因 operation 成功自动取得正文。 |
| 7 | Network | 以 Page／Frame／operation 关联观察 request／response／failure lifecycle、状态、时序、redirect、bounded wait 和必要 WebSocket lifecycle；选定响应内容与允许的 headers、拦截和修改按更高权限、精确来源和大小边界处理。 | 本规格 [§11](#11-network)；[Network Contract V1](network-runtime-contract-v1.md)；canonical [§22 #31](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#22-v1-验收标准) | 默认过滤 Cookie、Set-Cookie、Authorization、body、未脱敏 query 与 raw HAR；允许 headers 需显式 allowlist，每跳授权失败不得先发请求。 |
| 8 | Console／Page errors | 以可信 Page／Frame／document 关联有界暴露 warn、error、pageerror、uncaught exception 和 unhandled rejection、脱敏 source location；空窗口不推断“没有错误”。 | 本规格 [§12](#12-consolepage-errors)；[Console Contract V1](console-runtime-contract-v1.md)；canonical [§22 #31](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#22-v1-验收标准) | 文本、数量和保留有界，先脱敏再截断；缺事件保持 unknown；观察不取得 ControlLease，也不等于任意脚本执行。 |
| 9 | Controlled evaluation | 只执行有 stable id／source／version／hash、world、精确参数、目标 Page／Frame、timeout／cancel、effect class 和有界结果的受控脚本；read-only 与 mutation 分开授权、记录和恢复。 | 本规格 [§13](#13-controlled-evaluation)；[ADR 0012 §7](../adr/0012-runtime-capability-plane-and-plugin-first.md#7-skill-是知识与效率层)；canonical [§22 #24/#31](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#22-v1-验收标准) | 普通 Agent 不获得任意 JS、CDP、Juggler 或 Provider endpoint；不要求所有脚本类型或 world 等级都支持；SKILL 不能补齐 Runtime 或扩权。 |
| 10 | Screenshot／Frame | 取得绑定原 Page／Instance、时间和权限的静态截图；frame stream 可以 limited，但不得以截图冒充输入、原生焦点或高帧率交互。临时观看与显式保存是不同生命周期。 | 本规格 [§14](#14-screenshotframe)；[ADR 0012 §6](../adr/0012-runtime-capability-plane-and-plugin-first.md#6-app-完整产品化后移但最小-owner-control-plane-保留)；canonical [§22 #17/#23/#35](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#22-v1-验收标准) | 临时观看默认不录制、不保留；显式保存才生成受管 evidence／asset ref 并按脱敏和 retention；Provider／平台的实际支持与人工体验分开记录。 |
| 11 | Storage／Permissions | 管理 Profile 自有存储、站点权限、upload／download 临时材料、cache／service worker 等与运行一致性相关的状态及迁移／归档／删除边界；普通 Agent 默认不能导出 Cookie、完整 storage、凭据或 Profile 路径。 | 本规格 [§15](#15-storagepermissions-boundary)；[Profile Environment V1](profile-environment-v1.md)；canonical [§22 #1–4/#21–22/#41–42](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#22-v1-验收标准) | 环境／身份连续性、撤销、到期和恢复只按 owner 事实核验；cache／service worker 变化不得静默改变身份或权限；不以配置保存成功推断活动 Instance 已应用。 |
| 12 | Control／Recovery | mutating 操作服从 ControlLease、Run／operation、dispatch state、取消和 receipt；owner 可停止、撤销或接管，交还后 fresh observe；取消只停止后续执行，不回滚已发生的外部效果。响应丢失或 unknown 只 query／reconcile／接管，不换 key 重放。 | 本规格 [§16](#16-controlrecovery)；[ADR 0012 §4–6](../adr/0012-runtime-capability-plane-and-plugin-first.md#4-能力存在工具暴露授权和实际执行相互分离)；canonical [§18、§22 #18–20/#27–29/#40](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md#18-人工接管) | `ConnectionState`、`InstanceState`、`ControlState`、`RunState` 和 `ExternalOutcome` 分离；撤销阻止新动作但不倒写历史；失败必须局部化，不以重启或替代页面伪造恢复。 |

各类别的默认效果等级、ControlLease 和 Plugin exposure 仍见下列章节与正式合同；本矩阵只锁定“最低结果 + 来源”，不新增 wire 字段、Provider enum、Grant 维度或第二状态机。

## 5. Instance

### 5.1 必需语义

V1 必须支持：

- 启动获准 Profile 的主 Instance；
- 复用已经运行的同一 Instance；
- 读取 lifecycle、Provider、Profile、控制者和可用性事实；
- 显式停止；
- Provider／Profile 锁冲突时局部拒绝；
- App、Plugin 和 Runtime 重连不创建第二套实例。

### 5.2 约束

- 一个 Profile 同一时间最多一个主 Instance。
- `start` 不得用新实例替代已指定但丢失的 Instance。
- Runtime 重启后旧 Instance 必须准确显示不存在，不能伪造恢复。
- Instance 停止不等于网站侧 ExternalOutcome 被撤销。
- 启动和停止必须有可查询 operation；启动结果未知时不能自动再启动第二个实例。

## 6. Page／Tab／Window

### 6.1 必需语义

V1 公共能力至少覆盖：

- 列出当前 Instance 的 Page／Tab／Window；
- 打开新 Page；
- 切换活动 Page；
- 关闭明确 Page；
- 获取 URL、title、document／loading 状态和父子关系；
- 识别 popup、新窗口和浏览器 dialog；
- 保持所有页面属于同一原 Instance。

### 6.2 引用和关系

Page ref 必须与 Instance 和 document generation 关联。Popup 必须指出 opener 或无法确认；不得把另开浏览器实例当成 popup 支持。

### 6.3 支持边界

如果 Provider 对多窗口或某类原生弹窗只支持人工处理，`limited` 必须说明：

- Agent 能看到什么事实；
- 用户怎样打开同一原生 Instance；
- ControlLease 怎样转移；
- 交还后哪些引用失效；
- 原 Run 怎样继续或结束。

## 7. Navigation

### 7.1 必需语义

- navigate；
- reload；
- back／forward；
- query string 和 fragment 的明确支持；
- redirect chain 的准确结果；
- same-origin 与 cross-origin 的授权检查；
- navigation complete、failed、blocked 或 unknown；
- 导航后返回新 Page/document facts。

### 7.2 Origin 和 URL

授权应至少绑定 origin；任务或 SKILL 可以进一步限制路径、目标集合或业务对象。URL 中的 embedded credentials 必须拒绝。

不能为了允许正常重定向而全局取消 origin 检查。跨 origin 重定向应在跳转前或可证明的边界重新授权；若 Provider 无法安全中途授权，应准确拒绝或进入用户确认路径。

### 7.3 结果

`goto` 返回、HTTP 2xx 或 DOMContentLoaded 不等于业务页面可用。Runtime 只报告浏览器导航事实；站点业务结果由 SKILL／业务 owner 验证。

## 8. Observation

### 8.1 Page facts

至少包括有界的：

- current URL／origin；
- title；
- readiness／loading；
- document generation；
- frame／window 事实；
- challenge/login/identity 等由正式 owner 发布的状态引用；
- 当前控制者与观察时间。

### 8.2 Semantic snapshot

至少支持：

- 可见、稳定、可用的交互目标；
- role、name、enabled／selected／checked 等必要状态；
- 普通非敏感输入值；
- 可见文本的有界投影；
- target ref 和 observation ref；
- `truncated`／unsupported boundary。

不得默认输出：

- raw DOM／HTML；
- hidden input；
- password／token／Cookie；
- 所有 aria 或 data 属性；
- 页面脚本对象；
- Provider element handle。

### 8.3 Frame 与 Shadow DOM

V1 必须定义 frame 和 shadow boundary 的支持状态：

- snapshot 中目标属于哪个 document／frame；
- cross-origin frame 的观察和操作限制；
- closed／open shadow root 的支持；
- 引用失效和权限检查；
- unsupported 时的人工路径。

不要求将所有 frame 内容拼成一份无边界 DOM。

## 9. Interaction

### 9.1 必需操作

- click；
- input／fill；
- press／keyboard；
- mouse／scroll；
- select；
- drag and drop；
- wait for state；
- 操作后返回新观察或明确结果引用。

### 9.2 目标选择

Runtime 执行的目标必须来自当前有效 observation：

- 不接受站点 SKILL 直接注入 Provider handle；
- 不以固定坐标作为普通可靠路径；
- 不在引用失效后自动使用 selector 重找并点击；
- 歧义、不可见、disabled、被遮挡、替换元素应拒绝或要求新观察。

### 9.3 输入

- 普通字段使用可靠 Provider 原生输入；
- 依赖键盘事件时支持按键；
- password、验证码、token、Cookie、Authorization 等敏感字段不通过普通 input 能力暴露；
- 富文本、canvas editor 和 contenteditable 必须声明支持范围；
- 输入动作已经派发但返回丢失时，不得换 key 重发。

### 9.4 等待

等待必须针对真实状态：

- page/document changed；
- target enabled／visible／stable；
- text／semantic condition；
- network result；
- upload processed；
- dialog／download；
- custom state ref。

禁止随机 sleep、无限轮询或通过重复提交掩盖未知状态。

## 10. Files

### 10.1 Upload

V1 upload 必须：

- 使用 owner 管理的文件／asset ref，不向 Agent 暴露任意本地路径；
- 核对文件类型、大小、任务和 Profile 权限；
- 绑定准确 Page／target；
- 区分“文件已交给浏览器”“页面已接收”“页面已处理”“业务已保存／发布”；
- 产生独立 operation／ExternalOutcome；
- 响应丢失时查询原操作，不重新上传；
- 系统文件选择器无法自动化时提供同实例人工路径。

### 10.2 Download

V1 download 必须：

- 关联触发页面和 operation；
- 返回受管 download／asset ref，而不是任意路径；
- 记录文件名、类型、大小、完成／失败／unknown；
- 不自动执行下载文件；
- 遵守保留和删除策略；
- Agent 读取内容需要独立数据授权。

### 10.3 Dialog

浏览器 JS dialog 应能观察并在明确能力下 accept／dismiss。系统原生 dialog 可以是 `limited`，但必须能转到同一 Instance 的人工处理路径。

## 11. Network

Network 能力分为不同权限层，不使用单一 `network` 权限。

### 11.1 Metadata observation

V1 至少应观察：

- request／response lifecycle；
- method；
- sanitized URL／origin；
- resource kind；
- status；
- timing；
- redirect facts；
- failure class；
- Page／Frame／operation 关联；
- 必要 WebSocket lifecycle facts。

默认不得包含：

- Cookie／Set-Cookie；
- Authorization／Proxy-Authorization；
- 完整 request／response body；
- 未脱敏 query；
- credentials；
- raw HAR。

### 11.2 Wait for network result

Agent／SKILL 可以等待一个有界 network condition，但必须：

- 绑定当前 Page／operation；
- 使用明确 predicate contract，而不是任意脚本；
- 有超时；
- 返回匹配引用和截断事实；
- 不因超时自动重发触发动作。

### 11.3 Selected headers／response content

读取选定响应内容需要比 metadata 更强的授权：

- 精确 request／response ref；
- 获准 origin／content type／size；
- headers allowlist；
- body redaction；
- binary／large content 返回 asset ref；
- 敏感内容缺少授权时拒绝，不以截断伪装安全。

### 11.4 Interception／modification

请求拦截或修改属于改变页面或网络状态的能力：

- 必须有专门 capability 和 Grant；
- 绑定 Profile／Instance／Page／origin；
- 需要 operation／Run 和 dispatch state；
- 不得默认修改 Cookie、Authorization、身份 header 或安全挑战；
- 不得用于绕过平台安全机制；
- 结果未知时不重复安装或执行拦截规则；
- 规则结束、接管或 Page 关闭时有明确清理语义。

## 12. Console／Page Errors

V1 至少观察：

- console warn；
- console error；
- 可选的有界 console log；
- uncaught exception；
- unhandled rejection；
- page error；
- source URL／line／column 的脱敏引用；
- Page／Frame／operation／time 关联。

输出必须：

- 限制数量和长度；
- 过滤凭据、Cookie、Authorization、表单敏感值和长 payload；
- 标记截断；
- 不把 console 文本当作指令；
- 不因为“console 无错误”推导业务成功。

Console observation 与执行任意 JavaScript 是不同能力。

## 13. Controlled Evaluation

### 13.1 基本要求

受控脚本必须可追溯到：

- stable script/capability id；
- source、version、hash；
- execution world；
- exact arguments；
- target Page／Frame；
- timeout／cancel；
- expected data class；
- effect class；
- result schema 或 bounded projection。

### 13.2 暴露规则

普通 Agent 不直接获得 Provider 原生 `evaluate`、DevTools console 或任意脚本文本执行。

V1 可以提供：

- 已安装、版本化、确定性的只读 script；
- 由 Runtime 内置并审查的诊断 script；
- 经过单独高权限授权的有限 mutation script。

脚本来自 SKILL 资产时，仍需来源、版本、完整性、Runtime capability 和当前授权；SKILL 文件本身不能执行。

### 13.3 Execution world

必须显式记录 isolated／main／其他 Provider world。主世界执行、注入和页面可见副作用不能静默发生。Provider-specific world 语义由 Driver 封装，但事实必须可审计。

## 14. Screenshot／Frame

### 14.1 Screenshot

V1 至少支持原 Page 的静态截图：

- 绑定 Profile／Instance／Page／时间；
- 来自当前原实例；
- 观看不取得 ControlLease；
- 默认只临时使用；
- 保存时生成 evidence／asset ref 并执行脱敏与保留策略；
- 截图失败不等于 Instance 或 Run 失败。

### 14.2 Frame stream

低频 preview／frame stream 的 Provider 支持可以是 `limited`。高帧率、跨平台交互 viewer 和布局属于 App／viewer 验收，不应阻塞静态截图和基础画面能力。

## 15. Storage／Permissions Boundary

Runtime 需要管理：

- Profile 自有浏览器存储生命周期；
- site permission；
- download/upload 临时材料；
- cache／service worker 等与运行一致性相关的状态；
- 迁移／归档／删除时的数据边界。

普通 Agent 不直接获得：

- Cookie 原文；
- local/session storage 全量导出；
- password／token；
- profile path；
- browser credential store；
- 任意 storage mutation。

确需检查或修改某类状态时，应提供目标明确、数据最小化的 capability，并使用环境／身份／破坏性权限，而不是导出原始存储。

## 16. Control／Recovery

### 16.1 ControlLease

导航、点击、输入、按键、鼠标、滚动、上传、dialog 处理、脚本 mutation 和网络修改等改变现场的操作必须核对 ControlLease。

只读 snapshot、network metadata 和 console error 可以不取得 Lease，但不得与活动输入形成不安全竞态。

用户交还后，只有严格处于 `control_owner=none` 且 `ControlLease={owner:none,state:released,holder_ref:null}` 的 Instance 才可接受 Core 的新 snapshot；该读取仍不取得或续租 Lease。需要输入时，Core 必须以新 snapshot 为依据，由同一 Principal 通过正常 acquire 取得输入 Lease；handoff、用户接管、其他 holder 或期间发生的控制变化都会使观察失效。

### 16.2 Dispatch state

至少区分：

- `not_dispatched`：动作未送达 Provider；
- `dispatched`：动作已送达或无法证明未送达。

`not_dispatched` 才允许在修正参数后以新的明确任务重新提交；`dispatched + unknown` 只能查询、对账或人工处理。

### 16.3 Cancel

取消表示停止后续执行，不自动回滚已派发页面／网络／文件／外部操作。能力必须说明：

- 是否可在派发前取消；
- Provider 是否支持中止；
- 已完成部分怎样记录；
- ExternalOutcome 是否仍 unknown。

### 16.4 Query／reconcile

断线或响应丢失后：

- 使用原 operation／Run ref 或原 idempotency key 查询；
- Runtime receipt 与 Core Run 必须可关联；
- 查询不得重发原动作；
- 后续页面现状不能覆盖历史 unknown；
- 人工接管后的事实以新观察记录，不改写旧终态。

## 17. 授权分级

V1 Grant 至少能区分以下权限族；具体 schema 由实现 Work Item 冻结：

| 权限族 | 示例 |
|---|---|
| browser observation | page facts、snapshot、console error、network metadata |
| browser interaction | navigate、click、input、scroll、select |
| content inspection | selected response、download content、screenshot save |
| browser mutation | upload、dialog accept、controlled script mutation、network modification |
| instance management | start、reuse、stop、page/window management |
| environment management | proxy、locale、timezone、device configuration |
| identity management | discover、bind、conflict resolution、BusinessTarget |
| asset management | SKILL／AccountSystem install、update、disable |
| destructive | storage clear、Profile delete、migration cutover、backup delete |

有效权限仍为：

```text
Profile ceiling
∩ Principal Grant
∩ task authorization
∩ current Runtime safety
```

Agent 自报 task scope 是进一步收窄，不是人类批准来源。

## 18. Plugin Exposure

Plugin 应从 Runtime capability catalog 和当前授权上下文生成有界工具集合。工具呈现可以受：

- host capability；
- Provider support；
- Profile policy；
- Grant；
- task scope；
- SKILL required／recommended capability；
- 数据敏感等级；

影响。

但正式调用时 Core／Harbor必须再次检查，不能信任 Plugin 已过滤。

Plugin 不得：

- 自己保存更宽权限；
- 将多个底层调用合并后丢失 operation／unknown；
- 直接持有 owner／supervisor 凭据；
- 将 raw Provider endpoint 暴露为“高级工具”；
- 让站点 SKILL 动态注册未授权协议旁路。

## 19. 验证和完成条件

每项 V1 capability 的完成记录必须回答：

1. 公共语义和版本是什么；
2. 哪些 Provider／平台为 supported／limited／unsupported；
3. 哪些实现路径被使用；
4. fixture／mock、真实 Provider、正式安装路径、真实第三方 Agent、真人操作和真实第三方站点分别证明什么；
5. 成功、必要拒绝和恢复是否覆盖；
6. Grant、ControlLease、数据脱敏和 unknown 规则是否覆盖；
7. 实际安装资产、Driver 和 Runtime 版本是什么；
8. 后续变更是否使证据 stale。

### 19.1 不构成完成的证据

- 底层库文档说支持；
- TypeScript interface 已存在；
- Provider 私有方法可调用；
- 只通过 fixture；
- Plugin 只显示工具名；
- 普通 HTTP 2xx；
- 将未实现能力标记 `unsupported`；
- 用人工重做整个任务掩盖 Runtime 缺口；
- 将站点专用 probe 冒充公共能力。

### 19.2 Work Item 粒度

不为每个底层方法创建 Issue。Work Item 应围绕完整用户结果，例如：

- 在原 Page 关联 network failure 与 console error 并完成诊断；
- 上传一个文件并验证页面接收、响应丢失后安全对账；
- 在 popup 中完成操作并在原 Instance 交还恢复。

## 20. 明确非目标

- 复制完整 CDP／Playwright／Juggler；
- raw DevTools endpoint；
- 任意 JavaScript／shell 后门；
- Hosted Browser；
- 通用自主 Browser Agent；
- raw HAR／DOM／storage 默认导出；
- 验证码或平台风控绕过；
- 通过代理、指纹或身份轮换自动重试；
- 将站点业务状态机放入 Harbor／Core；
- 实现、模拟或长期补偿 Provider 缺失的浏览器核心语义；
- 维护自有浏览器 fork／内核补丁链来使候选 Provider 达到资格；
- 要求所有 Provider 的实现方式和能力等级完全一致。
