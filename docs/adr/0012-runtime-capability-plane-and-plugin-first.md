# ADR 0012：V1 Runtime Capability Plane 与 Plugin-first 交付基线

- 状态：Accepted
- 日期：2026-09-09
- 产品规范：[WebEnvoy v1.2 产品与架构方向规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)
- 产品归口：[Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497)
- 首批执行项：[Network／Console #498](https://github.com/WebEnvoy/WebEnvoy/issues/498)、[Camoufox 环境连续性 #499](https://github.com/WebEnvoy/WebEnvoy/issues/499)
- 后续关系：[ADR 0013](0013-provider-choice-and-obscura-validation.md) 固定 Provider 用户选择、推荐／默认／绑定分离与 Obscura 有界验证；本 ADR 的完整能力和 Plugin-first 基线继续有效。

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
