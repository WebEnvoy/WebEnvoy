# Runtime Capability Plane 架构

> 状态：现行 V1 架构基线
> 日期：2026-09-09
> 决策依据：[canonical v1.1](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)、[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)
> 规范依据：[Browser Runtime 能力规格](../specs/browser-runtime-capabilities-v1.md)、[Profile 环境规格](../specs/profile-environment-v1.md)
> 产品归口：[Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497)

本文定义 WebEnvoy Browser Runtime capability plane 的模块关系、所有权、调用路径和不可跨越边界。它不冻结最终 HTTP／MCP 字段、JSON Schema 或 Provider 私有实现。

## 1. 架构目标

WebEnvoy Runtime 必须同时满足：

1. **能力类别完整**：现代网页任务所需的主要 browser capability 有统一归口。
2. **Provider 无关**：公共语义不等同于 CDP、Playwright、Juggler 或站点脚本。
3. **Plugin-first**：已安装 Plugin 是第一完整 Agent 消费入口。
4. **同一真实现场**：Agent、用户和 App 使用同一个受管 Profile／Instance／Page。
5. **能力与放权分离**：能力存在、工具展示、授权和当前可执行性分别判断。
6. **结果可恢复**：有影响的动作保留 Run／operation／receipt，结果未知时不自动重放。
7. **长期环境连续**：Provider 深层能力不能破坏 Profile 的设备环境、账号和存储连续性。
8. **站点知识外置**：网站入口、业务语义和流程主要属于 SKILL／Lode。

## 2. 总体分层

```text
Third-party Agent Host
        │
        ▼
WebEnvoy Plugin / Host Adapter
  - capability discovery
  - filtered tool presentation
  - SKILL delivery
  - result projection
        │
        ▼
Core API / Authorization / Run Boundary
  - Principal / Connection / Grant
  - task scope and action risk
  - Run / idempotency / ExternalOutcome
  - query / reconcile / recovery
        │
        ▼
Harbor Runtime Capability Plane
  - Profile / Environment / Instance / Page
  - deterministic browser semantics
  - ControlLease and runtime safety
  - observations, receipts and evidence refs
        │
        ▼
Provider Driver
  - maps WebEnvoy semantics to a concrete browser
  - contains provider-private handles and protocol details
        │
        ▼
Original Browser Instance
```

并行知识与人类控制路径：

```text
Lode / SKILL
  ── declares required/recommended capabilities
  ── provides site/account/business knowledge
  ── never grants permission

Trusted Owner Control Plane
  ── establishes or narrows trust
  ── handles sensitive decisions
  ── takes over and hands back the same Instance
  ── never owns a second Runtime truth
```

## 3. 四个必须分离的平面

### 3.1 Capability existence

回答：

- WebEnvoy 是否定义了该能力；
- 当前 Provider Driver 是否实现；
- 支持状态是 `supported`、`limited` 还是 `unsupported`；
- 哪个版本和证据支持该结论。

Owner：Harbor capability catalog 与 Provider facts。

### 3.2 Exposure

回答：

- 当前 Plugin／宿主向 Agent 展示哪些工具；
- 结果以何种有界形式呈现；
- SKILL 是否建议使用该能力；
- 宿主是否具备相应交互能力。

Owner：Plugin／host adapter。Exposure 不签发权限。

### 3.3 Authorization

回答：

- 当前 Principal 是否获得对应 Grant；
- Profile ceiling、Grant、任务范围和动作风险的交集是否允许；
- 读取内容、网络修改、脚本、存储和破坏性操作是否具备专门授权。

Owner：Core。SKILL、工具名、宿主批准和隐藏 UI 均不能替代该判定。

### 3.4 Runtime availability

回答：

- 目标 Profile／Instance／Page 是否仍然存在；
- 当前 ControlLease 是否允许输入；
- 页面引用是否新鲜；
- 身份、BusinessTarget、环境或 Provider 是否出现冲突；
- 当前动作是否已经派发、可取消、结果未知或需要人工处理。

Owner：Harbor 现场事实，Core 记录业务运行与结果。

因此：

```text
implemented
≠ exposed
≠ authorized
≠ currently executable
```

## 4. 模块所有权

| 模块 | 拥有 | 不拥有 |
|---|---|---|
| Provider | 浏览器内核、原生设备环境能力、底层输入和协议实现 | WebEnvoy Grant、业务结果、站点流程 |
| Provider Driver | Provider 私有连接／handle、能力映射、底层操作和 Provider-specific 诊断 | Principal、Grant、业务结果、SKILL 语义 |
| Harbor | Profile、Environment、Instance、Page、ControlLease、browser capability、运行观测、operation receipt、evidence ref | Agent 授权、站点业务成功、SKILL 内容 |
| Core | Principal、Connection、Grant、任务范围、动作风险、Run、幂等、ExternalOutcome、查询和恢复决定 | Provider 私有 endpoint、Cookie／Profile 目录、站点 selector |
| Plugin | 宿主适配、能力发现、工具呈现、SKILL 分发、正式调用和结果投影 | 第二套授权、Profile、账号、Run 或浏览器状态 |
| Lode／SKILL | AccountSystem 模板、站点知识、capability requirement、工作流、结果判断和恢复指导 | Runtime 能力、当前权限、真实 Cookie／现场 |
| App／Owner 入口 | 人类授权、敏感决定、待处理事项、同实例接管与交还 | Core／Harbor 状态机和重复事实存储 |

## 5. Capability catalog

Harbor 应能发布可版本化的 capability facts。具体 wire schema 后续冻结，但语义至少包括：

- capability identifier；
- public semantic version；
- Provider／Driver identity 和版本；
- support state：`supported | limited | unsupported`；
- limitations／equivalent path；
- effect class；
- sensitive-data class；
- ControlLease requirement；
- validation/evidence refs；
- current availability 与不可用原因。

Catalog 表达“能力可以怎样被实现”，不表达“当前 Agent 已获权”。

Plugin 使用 catalog 生成或选择工具集；SKILL 可以引用 capability identifier 和最低语义版本；Core 在正式执行时仍重新授权，Harbor 在派发前仍重新核对现场。

## 6. 正式执行路径

### 6.1 普通浏览器操作

```text
Agent intent
→ Plugin 生成结构化调用
→ Core authenticate Principal / Connection
→ Core 计算 Profile ceiling ∩ Grant ∩ task scope
→ Core 建立或读取 Run / operation
→ Harbor 核对 Instance / Page / ControlLease / identity / environment
→ Provider Driver 执行
→ Harbor 保存 receipt 与新事实
→ Core 记录 result / failure / unknown
→ Plugin 投影给 Agent
```

改变页面、请求、存储或浏览器状态的动作，不能绕过 Run／operation 和 dispatch state。HTTP 成功或工具调用成功不等于业务结果成功。

### 6.2 只读观察

语义 snapshot、页面事实、Network metadata、Console error 等只读观察通常不需要取得输入 ControlLease，但仍需要：

- 有效 Principal／Connection／Grant；
- 正确 Profile／Instance／Page；
- 对应数据读取权限；
- 脱敏和大小限制；
- 不与活动 Provider 操作形成不安全竞态。

观察不得通过“只读”名义导出 Cookie、Authorization、凭据、完整 storage、raw HAR 或 Provider 私有 endpoint。

### 6.3 Network／Console

```text
Page operation / page lifecycle
→ Provider emits private network/runtime events
→ Driver normalizes and redacts at owner boundary
→ Harbor creates bounded event/observation refs
→ Core authorizes metadata/content/mutation level separately
→ Plugin exposes only the approved projection
```

请求元数据、选定响应内容、请求修改是不同能力；Console error 和任意 JS 执行也是不同能力。不得用一个笼统 `debug` 权限覆盖全部深层能力。

### 6.4 Controlled evaluation

受控执行必须包含或可追溯到：

- script identity、source/version/hash；
- execution world；
- exact arguments；
- target Profile／Instance／Page；
- effect classification；
- timeout／cancel；
- bounded result or result ref；
- authorization decision；
- operation outcome。

Provider 的 `evaluate` 能力不自动成为 Agent 的任意 JavaScript 控制台。

## 7. 人工接管

```text
Agent operating Instance A
→ user requests takeover
→ Harbor prevents new Agent input and drains/marks in-flight work
→ ControlLease transfers to user
→ user operates original native Instance
→ explicit handback
→ Agent takes a fresh observation
→ Core decides continue / reconcile / stop
```

接管只影响指定 Instance。观看不自动取得 ControlLease；交还不允许恢复旧页面引用或自动重放未知动作。

完整 App 后置不改变这条路径。可信 owner 入口可以是最小 App surface 或后续其他本地确认入口，但不得把 owner 凭据交给 Agent。

## 8. Profile 环境与深层能力

Network interception、main-world evaluation、脚本注入、截图和输入策略都可能影响 Provider 的运行方式，因此 Driver 在声明支持时必须同时验证：

- 是否改变设备环境或可观测浏览器属性；
- 是否破坏持久 Profile；
- 是否影响页面正常请求和缓存；
- 是否扩大敏感数据暴露；
- Provider 版本变化后是否仍成立。

Profile 环境的 configured／effective／pending／observed／drift 语义由 [Profile 环境规格](../specs/profile-environment-v1.md) 定义。Runtime capability 不能静默更换 Provider、代理或设备环境以换取成功。

## 9. Plugin-first 消费

首个支持宿主可以是当前 Codex，但接口必须保持 host-neutral：

```text
Host-neutral WebEnvoy API / capability catalog
                 ▲
                 │
          Codex adapter first
```

不得把 Codex 的工具审批、配置格式、会话模型或提示词语义写入 Core／Harbor 公共合同。

Plugin 完整消费检查点至少覆盖：

- 安装、连接和重连；
- capability discovery；
- Grant 与 task scope；
- Profile／Account／Environment／Provider／SKILL／Run 管理；
- 无站点 SKILL 的通用浏览器；
- 站点 SKILL 的版本化消费；
- 同实例人工接管；
- query／unknown／recovery；
- 更新或卸载后长期 Profile 不丢失。

## 10. SKILL 消费

```text
SKILL declares:
  required capabilities
  recommended capabilities
  AccountSystem / BusinessTarget knowledge
  site workflow and result semantics

Runtime provides:
  deterministic browser operations and facts

Core decides:
  whether this Principal may perform the action now
```

SKILL 可以减少 Agent 看到的工具、调用次数和探索成本；它不能：

- 编造 Runtime 不存在的能力；
- 授予权限；
- 直接操作 Provider 私有 endpoint；
- 在 Harbor／Core 中安装站点专用旁路；
- 把工具成功当作业务成功。

## 11. Provider 支持和兼容

不同 Provider 可以拥有不同支持等级，但必须使用同一公共语义解释差异。

`limited` 必须说明：

- 限制是什么；
- 何时触发；
- 是否有同实例人工路径或其他受约束等价路径；
- 对结果、权限和恢复的影响。

`unsupported` 对列为 V1 必需的能力不能单独作为完成依据。应实现、提供等价路径，或通过产品决策调整该 Provider／平台支持范围。

Provider-specific extension 只允许在公共语义无法合理覆盖时存在，并且：

- 显式带 Provider 和版本；
- 不由站点 SKILL 直接取得私有连接；
- 不成为业务成功真相；
- 不绕过 Core 授权和 Harbor ControlLease。

## 12. 状态与失败

必须保持：

```text
ConnectionState
≠ InstanceState
≠ ControlState
≠ Operation/RunState
≠ ExternalOutcome
```

常见失败至少区分：

- 请求未通过授权或现场检查，`not_dispatched`；
- 已派发且明确失败；
- 已派发但结果未知；
- 能力／Provider 不可用；
- 目标引用过期或歧义；
- 需要用户接管；
- 需要对账或迁移。

缺失 Runtime receipt 不证明动作未发生；重连后查询原 operation，不以新 key 重发未知动作。

## 13. 禁止路径

- Plugin、CLI、MCP、SDK 或 App 绕过正式 Core／Harbor owner 入口；
- 向 Agent 直接暴露 raw CDP／Juggler／Playwright endpoint；
- 把 Cookie、token、密码、验证码或 Profile 路径放入公共结果；
- 用工具隐藏代替权限；
- 让 SKILL 执行未授权脚本或网络修改；
- 让 Harbor 判断站点业务成功；
- 让 Core 保存完整 DOM、HAR、network body 或 Provider 私有对象；
- 为某个站点在 Runtime 增加平行状态机；
- 为能力完整性预建 Provider marketplace 或 Hosted Browser。

## 14. 文档与实现关系

- 本文冻结模块关系和调用方向。
- [Browser Runtime 能力规格](../specs/browser-runtime-capabilities-v1.md) 冻结 V1 能力语义和完成条件。
- [Profile 环境规格](../specs/profile-environment-v1.md) 冻结长期设备环境语义。
- 具体 JSON Schema、OpenAPI、MCP schema、生成类型和迁移由实现 Work Item 建立，并从 `docs/contracts/README.md` 索引。
- Issue／Milestone 拥有交付范围和当前状态，不复制本架构全文。
- Verification 文档记录某个版本实际证明了什么，不反向扩大能力范围。
