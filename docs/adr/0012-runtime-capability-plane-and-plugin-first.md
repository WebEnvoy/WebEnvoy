# ADR 0012：V1 Runtime Capability Plane 与 Plugin-first 交付基线

- 状态：Accepted
- 日期：2026-09-09
- 产品规范：[WebEnvoy v1.1 产品与架构方向规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)；2026-09-12 Provider 职责修订以待合并的 [canonical 修订 .github#20](https://github.com/WebEnvoy/.github/pull/20) 为前提
- 产品归口：[Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497)
- 首批执行项：[Network／Console #498](https://github.com/WebEnvoy/WebEnvoy/issues/498)、[Camoufox 环境连续性 #499](https://github.com/WebEnvoy/WebEnvoy/issues/499)

## 背景

[ADR 0011](0011-v1-managed-browser-and-skill-delivery.md) 终止了按对象、预测性合同和单站点形态横向铺设的实施方式，确立了围绕真实用户结果、受管 Profile、统一授权、同实例协作和 SKILL 纵向路径推进 V1 的原则。该决策仍然有效。

随着 #490 和 #494 交付已安装 Agent 入口、独立 Runtime、受管多 Profile、普通页面观察与交互，新的风险开始显现：

1. 如果继续把“当前网站是否需要”作为 Runtime 是否拥有某类基础能力的前提，Network、Console、页面／窗口、文件、画面和受控执行会按站点逐步长成特例。
2. 如果能力实现、向 Agent 展示工具和当前是否授权被混为一体，隐藏工具会被误当成权限控制，或 Runtime 缺失被误写成 SKILL 能力。
3. 如果完整产品能力先围绕 Desktop App 实现，Plugin 可能长期只能消费子集，形成 App 内部状态、特殊入口或第二套业务逻辑。
4. Camoufox 不能只作为一个可启动的浏览器程序使用；长期 Profile 需要可解释的 Provider／设备环境连续性、实际生效事实和漂移处理。
5. Issue 可以定义交付目标，但不足以长期承担能力平面、模块关系和跨项一致性的全部架构语义。

因此需要在不回退到“大而全、分层串行建设”的前提下，冻结 V1 Runtime 能力完整性和 Plugin-first 的实施基线。

## 决策

### 1. V1 先定义 Browser Runtime 的主要能力类别

V1 在产品规范和 [Browser Runtime 能力规格](../specs/browser-runtime-capabilities-v1.md) 中完整定义主要能力类别。当前消费者暂未使用某类基础能力，不构成从规划中省略该类别的理由。

“完整”表示现代网页任务所需的主要能力类别和边界得到定义、实现、验证或明确支持范围；不表示复制 CDP、Playwright 或 Juggler 的全部协议方法。

### 2. 实现仍按完整用户结果切片

能力类别先完整定义，不等于先在 Harbor 内部完成所有能力，再串行开发 Core 和 Plugin。

每个执行 Work Item 仍必须贯穿该用户结果所需的 Provider Driver、Harbor、Core、安装入口和 Plugin，并证明成功、必要拒绝与恢复。只实现底层方法或只展示工具名都不构成交付。

### 3. WebEnvoy 拥有 Provider 无关的公共能力语义

具体浏览器能力由 Provider 原生接口实现，Provider Driver 负责适配；Harbor 暴露 WebEnvoy 自己的稳定 browser capability plane。

公共能力不得长期等同于：

- Chrome CDP domain；
- Playwright API；
- Firefox Juggler 私有协议；
- 某个站点 selector、store、接口或业务状态。

确有无法合理统一的 Provider-specific extension 时，必须显式标记其 Provider、版本、能力状态和使用边界，不能反向污染公共合同。

### 4. 能力存在、工具暴露、授权和实际执行相互分离

以下四个事实不得混淆：

```text
Runtime 已实现某项能力
≠ Plugin 向当前 Agent 展示该工具
≠ 当前主体被授权调用
≠ 当前现场允许实际执行
```

- Runtime／Provider capability catalog 描述能力存在和支持状态；
- Plugin／宿主根据任务、SKILL、Provider 和用户体验选择工具呈现；
- Core 根据 Profile ceiling、Principal Grant、任务范围和动作风险判定授权；
- Harbor 根据 Instance、Page、身份、ControlLease、页面状态和敏感边界判定当前可执行性。

工具隐藏、宿主批准和 SKILL 元数据不能替代 Core／Runtime 授权。

### 5. Plugin 是第一完整产品消费者

在完整 App 产品化之前，一个明确支持的第三方 Agent 宿主必须通过已安装 WebEnvoy Plugin，完整消费 V1 中允许委托给 Agent 的资源管理和浏览器能力。

Plugin 保持薄层，只负责：

- 宿主适配；
- 能力发现与有界工具呈现；
- SKILL 分发和选择；
- 调用 WebEnvoy 正式入口；
- 将结果和恢复提示投影给宿主。

Plugin 不拥有第二套 Profile、Account、Environment、Grant、Run、结果、恢复或浏览器状态真相。

### 6. App 完整产品化后移，但最小 owner control plane 保留

完整 Account／Profile／Provider／SKILL／Activity 工作台和高级多实例布局在 Plugin 完整体验检查点之后集中产品化。

在此之前，App 或其他可信 owner 入口仍必须提供：

- Principal／Grant 的建立、查看、收紧和撤销；
- 必须由人作出的敏感决定；
- 同一原 Instance 的接管和交还；
- 身份冲突、迁移、删除等明确待处理入口；
- 当前 Profile、Instance、控制者和待处理状态的最小可理解展示。

App 不得成为 Runtime 生命周期或普通 Agent 操作的隐藏依赖。

### 7. SKILL 是知识与效率层

没有站点 SKILL 时，Agent 仍可在授权范围内使用通用 Runtime 能力。

站点 SKILL 可以声明 required／recommended capability，选择更小工具集合，并提供站点入口、页面语义、业务流程、等待条件、Account／BusinessTarget 核对、结果判断和恢复方法；但 SKILL：

- 不提供 Runtime 缺失的基础能力；
- 不签发或扩大权限；
- 不拥有运行现场；
- 不允许通过站点脚本形成 Network、Console、DOM 或输入旁路。

### 8. 长期设备环境有独立的规范性边界

Profile 的 Provider 和设备环境按 [Profile 环境规格](../specs/profile-environment-v1.md) 管理。系统必须区分 configured、effective、pending、observed 和 drift，并明确 Provider 原生生成、WebEnvoy 持久化、启动时应用和每次观测的责任。

Camoufox 的设备环境能力以固定版本和实测证据为依据，不以宣传或“开启所有隐身选项”作为验收，也不承诺不可检测或不会封号。

### 9. 深层能力按数据和副作用分级

Network、Console、受控脚本、存储、下载等深层能力可以在 Runtime 内存在，但必须按元数据观察、内容读取、状态修改、敏感／破坏性操作分别授权和脱敏。

普通 Agent 不直接获得 raw DevTools／CDP／Juggler／Playwright endpoint、Cookie、token、密码、验证码、未脱敏凭据或内部数据库写入口。

## 2026-09-12 Provider 职责与 Qualification Gate 修订

本节在仓内替代 [ADR 0011](0011-v1-managed-browser-and-skill-delivery.md) 第 3 条的“默认 Provider 验证目标”解释，并收紧本 ADR 第 3 条的 Driver 适配边界。它不复制产品 canonical；产品方向以待合并的 [.github#20](https://github.com/WebEnvoy/.github/pull/20) 为前提，该 PR 若改变则本修订必须先对账，不得自行成为第二份产品真相。

### Provider 职责边界

WebEnvoy 管理、约束、调用、组合、观察和验证 Provider 已经具备的浏览器能力。Harbor、Driver、App、Plugin、SKILL、安装脚本和站点脚本都不得实现、模拟或长期补偿 Provider 缺失的浏览器渲染／命中、键盘／IME、窗口／弹窗／对话框、下载、Web Storage／IndexedDB、站点权限或浏览器级设备身份；也不以自维护浏览器 fork／内核补丁链作为交付路线。

允许的正常工作包括：

- 适配 Provider 已有协议、启动方式及页面、输入、文件、网络和窗口接口；
- 管理受管目录、进程、Profile／账号归属、授权、ControlLease、Run／结果和恢复；
- 保存并重放 Provider 已支持的配置、seed 或官方生成结果，核对 effective／observed／drift；
- 管理 Provider 原生持久数据的生命周期、备份、导入、迁移和版本兼容；
- 转发原 Instance 画面与可靠输入，且在不改变浏览器语义时组合调用、等待状态、诊断和处理失败。

### Qualification Gate

先将候选问题分成三类，不得在未分类前创建正式接入面：

1. **接口差异**：Provider 已有真实能力，只是协议、启动或调用方式不同，可由 Driver 适配。
2. **可接受能力差异**：限制不破坏已承诺用户结果，可准确报告 `limited`／`unsupported` 并局部处理；不要求所有 Provider 同等级。
3. **浏览器核心能力缺失**：交付已承诺结果需要 WebEnvoy 建设或模拟底层浏览器行为，候选停止采用，不转为普通 Driver 任务。

资格工作按固定顺序进行：

```text
产品场景与职责边界初筛
→ 固定版本文档／源码和最小黑盒核对
→ 必要的可丢弃适配 spike
→ 有证据的采用／不采用决定
→ 正式 Driver、Provider 注册、持久合同、App／Plugin 和安装交付
```

每次 spike 必须预先写明产品问题、已有能力证据、允许范围和输出决定。资格未通过时，不加入正式 Provider enum、持久合同、用户安装、App 选项或支持承诺。发现必须补浏览器核心语义、维护 fork／内核补丁链，或放弃身份隔离、可信控制与结果真实性时立即停止。

Obscura 在当前愿景完成前明确不采用。不继续研发、适配、验证、分发准备、候选跟踪或版本监控，也不以待授权、新版本或临时补丁自动重启。当前愿景完成也不自动重开，届时需新的显式产品决定。历史目标、实验和失败证据保留在 [#511](https://github.com/WebEnvoy/WebEnvoy/issues/511)；`not_planned` 不表示功能验收成功。

退出该候选不缩小 [Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497) 的能力基线，不改变 [Plugin FR #474](https://github.com/WebEnvoy/WebEnvoy/issues/474) 的真实第三方 Agent 消费要求，也不代替 [V1 验收 FR #482](https://github.com/WebEnvoy/WebEnvoy/issues/482) 的完整证据汇合；三项均按各自原验收继续开放。

### 验收证据语义

每份验收按用户结果选择必要证据，并分别记录六类上下文：

| 证据类型 | 证明范围 |
| --- | --- |
| 确定性测试 | fixture、mock 或单元测试；可标记 `fixture_verified`，不证明真实浏览器或用户路径。 |
| 真实 Provider | 真实二进制与原 Instance 的实际行为；可标记 `live_verified`。 |
| 正式安装路径 | 正式构建与隔离安装资产经正式接口调用；测试客户端可以证明这一类。 |
| 真实 Agent | 真实第三方 Agent 通过已安装 Plugin 完成声明路径；只有这一类可标记 `plugin_verified`。 |
| 真人操作 | 真实人类完成观看、输入、接管等；中文 IME 不得由 `insertText` 或脚本替代。 |
| 真实第三方站点 | 记录站点、版本／时间和具体场景；受控站点不算第三方站点，只读也不证明登录或写入。 |

六类不是互斥等级，也不是每个 Work Item 必须凑齐的六项门槛。`fixture_verified`、`live_verified`、`plugin_verified` 保持现有合同名称和原义。安装脚本、检查器、独立 MCP 辅助客户端、直接 HTTP 或仅工具可见都不是真实第三方 Agent，不得写为 `plugin_verified`。`provider_claim` 仍只是上游声明；支持状态、证据来源、运行可用性和授权分别判断。

每份证据至少记录用户结果、实际消费者、固定 source／build／config、平台与是否原 Instance、场景与身份／授权边界、成功／拒绝／恢复、脱敏证据地址和未执行项。API 成功、CI 通过、PR APPROVE 或 Issue 关闭都不自动等于用户结果验收。

### 本修订的 Design Obligation Gate

本修订只收紧已有架构、能力和验收语义，不新增或改变稳定跨进程 API、MCP／Plugin tool projection、wire payload、持久字段或 enum。因此 `DO-PLUGIN-EXPOSURE`、`DO-GRANT-WIRE`、`DO-NETWORK-CONTRACT`、`DO-CONSOLE-CONTRACT`、`DO-PROVIDER-PRIVATE-SCHEMA` 和 `DO-APP-IA` 均为 `not-triggered`。[#516](https://github.com/WebEnvoy/WebEnvoy/issues/516) 未来实现 Provider preference 时的持久、Plugin、Grant 和 App 义务由该 Work Item 另行声明并在其产品合同 PR 冻结，不在本治理修订中预建字段或 operation。

## 对 ADR 0011 的关系

本 ADR **部分替代** ADR 0011 第 1 条的下列过度实施解释：

> 只有当前消费者已使用的 Runtime 基础能力才需要进入 V1 规划；未被当前消费者使用的能力类别可以不定义。

替代后的规则是：

> V1 基础能力类别先完整定义；对象、字段、Schema、API 和实现仍只细化到当前与下一批真实交付需要的程度。

ADR 0011 的以下决策继续有效：

- 以用户或 Agent 的完整纵向结果为交付单元；
- 先验证可能推翻设计的 Provider 和页面假设；
- Core、Harbor、Desktop、Lode 的单一 owner 边界；
- SKILL 是站点知识主要载体；
- 不预建第二套站点状态机、Provider 市场或预测性全形态平台；
- 历史数据、Run、Issue、PR 和证据不因规划调整被删除或改写。

## 后果

### 正向后果

- 新网站不会继续推动 Harbor／Core 增加站点专用基础能力。
- Runtime 能力是否完整可以独立于 Agent 工具数量和 App 完成度验收。
- Plugin 从第一批开始成为真实消费者，避免最后才发现入口、授权和安装生命周期缺口。
- App 后续可以消费稳定 owner facts，而不是替底层能力发明第二套模型。
- Camoufox 的价值从“可启动 Provider”提升为“长期、可解释的 Profile 设备环境”。

### 成本与约束

- 需要维护 capability catalog、Provider support facts、能力规格和验证证据之间的一致性。
- 深层能力的数据分类、授权和脱敏会增加设计与测试成本。
- 某项能力已由底层库提供，不再足以证明 WebEnvoy 已交付。
- Plugin-first 不能演变为 Codex-specific 架构；首个宿主只是第一适配器。

## 被拒绝的方案

### 完全由站点消费者按需定义 Runtime

拒绝。它会把通用能力按站点散落到 Runtime，并使第二网站无法检验 SKILL 扩展成本。

### 一次复制完整 CDP／Playwright／Juggler

拒绝。底层协议并非稳定产品语义，也会扩大敏感数据和 Provider 耦合。

### 先完成完整 App，再开放给 Agent

拒绝。它会增加 App-only 状态和特殊入口的风险，与 Agent 原生平台定位相反。

### 只更新 Issue，不创建正式架构和规格

拒绝。Issue 负责交付范围和状态，不适合作为长期能力语义与模块边界的唯一来源。

## 验证与演进

- [Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497) 拥有 V1 browser capability plane 的产品完成真相。
- [#474](https://github.com/WebEnvoy/WebEnvoy/issues/474) 拥有已安装 Plugin 的完整消费。
- [#471](https://github.com/WebEnvoy/WebEnvoy/issues/471) 和 [#499](https://github.com/WebEnvoy/WebEnvoy/issues/499) 拥有长期 Provider／设备环境连续性。
- [#475](https://github.com/WebEnvoy/WebEnvoy/issues/475) 拥有 SKILL 与共享知识资产。
- [#476](https://github.com/WebEnvoy/WebEnvoy/issues/476) 在基础能力和资产消费达到门槛后验证第二网站扩展成本。
- [#482](https://github.com/WebEnvoy/WebEnvoy/issues/482) 仍是唯一完整 V1 验收汇合点。

字段级 JSON Schema、OpenAPI、生成类型和 Provider adapter 细节应在真实实现需要时建立专门合同，并由 `docs/contracts/README.md` 索引；不得把本 ADR 当作 wire schema。
