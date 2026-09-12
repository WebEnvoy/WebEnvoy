# WebEnvoy 跨仓架构

> 2026-09-12：产品方向和模块职责以 [canonical v1.4](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)、[ADR 0011](../adr/0011-v1-managed-browser-and-skill-delivery.md) 与 [ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md) 为准。本文只维护现行模块间接口边界，不替代字段级 spec、Issue 状态或逐模块实现设计。

本文定义 `WebEnvoy/WebEnvoy` monorepo 中 Core、Desktop、Plugin／agent-entry、Harbor 与独立 `WebEnvoy/Lode` 的协作边界。

ADR 记录为什么选择某个方向；spec 定义能力、状态、JSON Schema、API 和校验语义；architecture 回答：

- 各模块分别拥有什么；
- 数据和控制如何跨模块／跨仓流动；
- 哪些边界不能跨；
- Browser Runtime capability plane 与站点 capability／SKILL 如何共存；
- 后续逐模块设计不应突破哪些边界。

## 权威文档

- 产品范围：[canonical v1.4](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md)
- 实施决策：[ADR 0012](../adr/0012-runtime-capability-plane-and-plugin-first.md)
- Browser Runtime：[Runtime Capability Plane](runtime-capability-plane.md)
- 能力语义：[Browser Runtime Capabilities V1](../specs/browser-runtime-capabilities-v1.md)
- 长期环境：[Profile Environment V1](../specs/profile-environment-v1.md)
- 稳定合同索引：[contracts/README.md](../contracts/README.md)

本文中的字段名和流程名称只作架构引用；最终 wire contract 以 `docs/specs/`、schema 和 contracts 索引为准。

## 仓库与模块角色

| 位置 | 架构角色 | 真相源 | 不拥有 |
|---|---|---|---|
| `WebEnvoy/WebEnvoy` Core | 授权、任务和结果边界 | Principal、Connection、Grant、task scope、Task、Run、Result Envelope、ExternalOutcome、Lode pin、capability admission、failure attribution、公共 API | 浏览器 Profile data、Provider 私有连接、页面 handle、站点知识、Plugin 状态 |
| `WebEnvoy/WebEnvoy` Harbor | Browser Runtime 与长期运行现场 | Profile、Environment、Provider facts、Instance、Page、ControlLease、Browser Runtime capability、Snapshot、Network／Console runtime facts、operation receipt、Evidence refs | Grant、站点业务成功、SKILL 内容、Core Run Record |
| `WebEnvoy/WebEnvoy` Plugin／agent-entry | 第三方 Agent 宿主适配 | 安装入口、宿主连接、capability discovery、工具呈现、SKILL 分发、结果投影 | 第二套 Profile、Account、Grant、Run、恢复或浏览器状态真相 |
| `WebEnvoy/Lode` | 站点能力资产与共享知识 | SKILL／Capability package、AccountSystem 模板、workflow、input/output/source schema、fixtures、post-check、asset registry | Runtime Session、真实账号现场、当前授权、Run Record、Plugin 会话 |
| `WebEnvoy/WebEnvoy` Desktop／可信 owner 入口 | 人类控制面 | 用户意图、Principal／Grant 管理、敏感决定、待处理事项、同实例接管／交还和展示状态 | Core／Harbor 状态机、Lode 资产真相、Provider 私有控制 |
| Provider | 浏览器和原生环境 | 浏览器内核、设备环境能力、底层输入、私有协议 | WebEnvoy 授权、业务结果、站点流程 |

## 核心原则

1. **正式入口统一。** Plugin、CLI、MCP、SDK 和 App 不绕过 Core／Harbor owner 进入独立执行链。
2. **Core 是授权、Run 和业务结果真相源。** accepted、running、succeeded、failed、unknown outcome、manual recovery 和 ExternalOutcome 由 Core 持久化。
3. **Harbor 是 Runtime 现场真相源。** Profile、Environment、Provider、Instance、Page、ControlLease、Browser capability、operation receipt 和 runtime evidence 来自 Harbor。
4. **Lode 是站点知识和资产真相源。** 网站流程、AccountSystem 模板、业务输入输出、post-check 和失效标记不写入 Harbor／Core。
5. **Plugin 是第一完整 Agent 消费端，但保持薄层。** 它发现和呈现能力，不复制授权、状态或恢复。
6. **Desktop／owner 入口是人类控制面。** 完整 App 产品化可后置，但必要授权、敏感决定和同实例接管不能缺失。
7. **能力存在、工具暴露、授权、当前可执行性分离。** 隐藏工具不等于拒绝权限，工具存在也不等于当前可执行。
8. **Browser Runtime capability 与站点 capability 分离。** Browser Runtime 提供通用确定性操作；SKILL 选择和组合这些能力并解释业务结果。
9. **公共 Runtime 不等同底层协议。** CDP、Playwright、Juggler 和 Provider 私有对象只留在 Driver 边界。
10. **跨仓共享字段以 spec／schema 为准。** ADR 和 architecture 不冻结最终 wire 字段。
11. **拒绝作用域不大于风险作用域。** 身份、授权、控制权和重复写入必须保护；可选 evidence、viewer 或未安装 SKILL 不得全局阻断无关能力。
12. **unknown 禁止重放。** 允许查询、对账、接管和停止后续动作，不允许换 key 重复有影响操作。

## 两类 capability

WebEnvoy 同时使用两类不同含义的 capability，必须在文档和实现中明确区分。

### Browser Runtime capability

由 WebEnvoy Runtime 定义，例如：

- page observation；
- click／input／files；
- Network／Console；
- controlled evaluation；
- screenshot／viewer；
- control／recovery。

Owner：Harbor 公共语义与 Provider Driver；授权和 Run owner：Core。

### Site／task capability

由 Lode 资产定义，例如：

- 发布图文；
- 更新商品；
- 查询订单；
- 检查账号状态。

它声明所需 Runtime capability、AccountSystem／BusinessTarget 和结果规则，但不拥有浏览器实现或当前授权。

```text
Site SKILL / capability
        │ selects and guides
        ▼
Browser Runtime capability
        │ authorized by Core
        ▼
Harbor / Provider / original Instance
```

## Capability、Exposure、Authorization 与 Availability

```text
Harbor capability catalog
        │
        ├── Provider support and limitations
        │
        ▼
Plugin exposure
        │  filtered by host / task / SKILL / UX
        ▼
Core authorization
        │  Profile ceiling ∩ Grant ∩ task scope
        ▼
Harbor runtime availability
           Instance / Page / identity / ControlLease / environment
```

四层必须分别留下拒绝或不可用原因。Plugin 不能因为已经过滤工具而跳过 Core 检查；Core 已授权也不能强迫 Harbor 在错误现场执行。

## Core–Harbor 所有权迁移 v0

WebEnvoy/WebEnvoy#341 冻结 [ADR 0010](../adr/0010-core-harbor-ownership-migration-v0.md) 的责任边界：Core 解析并锁定 Lode version/hash pin，执行 capability/resource admission，校验 Lode output 并生成 normalized Result Envelope、failure attribution 和 Run Record；Harbor 只提供可追溯的站点无关 runtime facts/refs。`site_id`、`task_kind` 和 fact key 只用于选择/匹配 Harbor 的公共运行事实，不构成站点业务结果 schema。

Core 可消费现有 Harbor identity/runtime/resource facts、viewer/control facts、snapshot/refmap/source/evidence refs，以及 Lode package contract 的 refs、版本、lock、resource、output/post-check/failure 声明。当前 page-scene runtime 链还要求 `page_summary.url/title/summary`，校验 URL 并把三项投影进 normalized result；这只是 compatibility-only legacy payload，不是获准的 Harbor business truth，目标面仍是 refs/facts 加 Lode 声明、Core-owned normalization。Core #342 与 Harbor #352 必须在 `cutover-ready` 前删除或替代这项依赖。Redaction/access/retention 仍由 PD-0019 规格化，当前消费面没有这些字段，不能表述为已支持。credential、cookie、token、profile storage、raw DOM/HAR/screenshot/video/network body、provider private endpoint、Lode package body 和 normalizer code 仍留在各自 owner 边界。Harbor 现有 allowlisted read operation 的 `LODE_*_PIN`、`public_summary` 等输出在兼容窗口内仅作为 legacy adapter，不能成为新路径的业务结果真相。

Core `addInferredResourceFacts` 当前的 site-login 推导也只属于兼容期 legacy adapter，不是 Harbor owner-published fact 或新路径 evidence；Core #342 与 Harbor #352 必须在 `cutover-ready` 前删除该推导或用 Harbor 发布的可版本化 fact/ref 替代。

Failure attribution 也保留一个明确的 compatibility drift：Core 请求输入的 `input_invalid` / `private_field_rejected:*` 归为 `input`；Core result projection 的 `public_result_private_field_rejected` 当前是 `result_projection` / `projection` 并归为 `capability`；Harbor admission payload 出现 `forbidden_field:*` 时，当前 `validateHarborAdmission` 则生成 `resource_admission` / `runtime_binding` 并归为 `runtime`。#341 不宣称已经修复；Core #342 必须收敛最终类别/归因，且不得混同这三类边界。

| 迁移阶段 | 新路径 | 旧路径 | 停止条件 |
| --- | --- | --- | --- |
| `compatibility`（当前） | 文档冻结 Core owner；不改变 runtime、字段或 API | 继续服务既有 caller，保留旧 pin/summary adapter | 发现 owner、字段、failure 或 sensitive boundary 冲突即冻结 cutover |
| `cutover-ready` | 所有 consumer 通过 Core-owned pin/admission/projection 的 current-head read-only contract check | 保留回退映射和历史 run 语义；窗口继续有效 | 缺任一 owner/readback、refs-only 或 rollback 证据则不得切换 |
| `cutover-stabilizing` | 新 run 默认走 Core-owned path；Core 写唯一结果/失败 truth | in-flight/history 按原绑定；窗口保持有效并保留 bounded rollback target | 新路径出现任意 mismatch 立即 rollback |
| `retired`（后续 Work Item） | 以显式 post-cutover exit/retirement evidence 定义旧 API/字段退役 | 仅所有 caller 迁移、稳定/rollback 验证完成且无历史/fallback 依赖后删除 | evidence 结束窗口；#341 不授权删除旧路径 |

兼容窗口贯穿 cutover stabilization/rollback，只在显式 post-cutover exit/retirement evidence、下一版不兼容合同或 conflict stop 三者中先发生者结束；冲突时先 rollback，再结束本轮窗口并保留 legacy path。Rollback 只切换后续 admission 路由，不删除旧路径或改写已 accepted/terminal Run Record。字段/API 迁移、Harbor/Lode/App 的最终 wire schema 仍由 [PD-0019](../adr/pending-decisions.md#pd-0019) 和后续跨仓规格处理。

ADR 0012 不取消该迁移边界。新增 Browser Runtime capability 必须继续让 Harbor 只发布站点无关 runtime facts／operations，由 Core 决定授权、Run 和业务结果。

## 依赖方向

### Agent／Plugin 管理与浏览器路径

```text
Third-party Agent
  -> installed WebEnvoy Plugin / host adapter
  -> WebEnvoy API Server / Core authorization
  -> Harbor Runtime Capability Plane
  -> Provider Driver
  -> original Browser Instance
  -> Harbor receipt / facts
  -> Core Run / result / recovery
  -> Plugin result projection
```

### 网站任务路径

```text
Agent
  -> installed Site SKILL / AccountSystem assets from Lode
  -> Core capability and resource admission
  -> Harbor Browser Runtime capabilities
  -> Provider Driver / original Instance
  -> Harbor runtime facts / evidence refs
  -> Core validates site output and records business result
```

### 人类控制路径

```text
Core / Harbor requires user action
  -> trusted owner control plane
  -> user reviews / authorizes / takes over original Instance
  -> explicit handback
  -> Harbor publishes fresh runtime facts
  -> Core continues / reconciles / stops
```

依赖只在需要的层级发生：

- Core 读取 Lode 的稳定声明，不读取 authoring 草稿。
- Core 消费 Harbor 的 refs／facts，不读取 Cookie、Token、完整 storage 或 Provider secrets。
- Harbor 提供 Runtime capability，不决定某项站点业务是否成功。
- Plugin 调用正式入口，不直接持有 owner／supervisor 凭据。
- App／owner 入口读取并操作正式 owner facts，不成为第二份 truth。
- Lode 声明 resource／capability／verification requirements，不选择具体 Runtime Session。
- SKILL 可以减少工具呈现，但不参与权限计算。

## 主要数据流

### 1. Browser capability 发现

```text
Provider Driver support facts
  -> Harbor capability catalog
  -> Core adds authorization / policy context
  -> Plugin presents bounded tools
  -> Agent chooses through task / SKILL
```

Catalog 说明 capability、版本、support state、limitations 和 evidence；它不包含当前 Grant 的秘密内容，也不替代调用时授权。

### 2. 站点资产发布与发现

```text
Lode SKILL / workflow / AccountSystem package
  -> Lode registry / catalog metadata
  -> installed asset verification
  -> Plugin / Agent selection
  -> Core site capability admission
```

Lode 负责资产版本、schema、fixtures、post-check 和失效标记。Plugin 可以分发、选择和展示，不能更改用户本地 AccountSystem 或 Profile 权限。

### 3. Runtime 操作

```text
Plugin call
  -> Core authenticates Principal / Connection
  -> Core evaluates Grant / task / action risk
  -> Core creates or reads operation / Run
  -> Harbor validates Instance / Page / Lease / identity / environment
  -> Driver dispatches
  -> Harbor stores receipt and facts
  -> Core records result / failure / unknown
```

输入、Network 修改、脚本 mutation、upload、dialog accept 等有影响动作必须保留 dispatch state。响应丢失后查询原 operation，不重新派发。

### 4. Network／Console／深层能力

```text
Provider private events
  -> Driver normalization and first redaction
  -> Harbor bounded observation / refs
  -> Core data-level authorization
  -> Plugin approved projection
```

Network metadata、response content、request modification、Console error 和 controlled evaluation 分别授权。raw DevTools endpoint、Cookie／Authorization、完整 HAR 或任意 JS 不直接进入普通 Agent 面。

### 5. Runtime 与证据

```text
Core evidence policy
  -> Harbor capture / observation
  -> Harbor evidence refs
  -> Core Run Record references
  -> Plugin / App bounded display
```

Harbor 负责 capture mechanics、runtime provenance 和 evidence refs；Core 保存引用和结果摘要；Plugin／App 只展示获准投影。具体 redaction／retention 合同仍需按 owner 冻结。

### 6. 长期 Profile 环境

```text
configured environment
  -> Harbor persisted owner facts
  -> Provider launch mapping
  -> effective / observed readback
  -> verified or drift
  -> Plugin / owner display
```

运行中不能安全应用的变更进入 pending。Provider／schema 不兼容走迁移，不静默换 Provider、代理或设备环境。

### 7. 人工接管与恢复

```text
Core / Harbor recovery signal
  -> owner handoff prompt
  -> user takeover through original native Instance
  -> explicit handback
  -> fresh observation
  -> Core resume / reconcile / stop
```

Harbor 拥有 viewer／control facts；Core 拥有 Run recovery decision；owner 入口拥有人类操作。交还后旧引用失效。

### 8. 能力失效与修复

```text
Core failure / Harbor facts / user report
  -> classify runtime vs site capability problem
  -> Runtime Work Item or Lode repair draft
  -> new version / validation
  -> Plugin consumes verified update
```

Runtime 缺失不能伪装成 SKILL 修复；单次运行失败也不自动等于 Lode 资产失效。

## 禁止跨界

| 禁止事项 | 原因 |
|---|---|
| Plugin／CLI／MCP／SDK 绕过 API Server 和 owner 入口 | 会破坏授权、Run 和恢复一致性 |
| Plugin 保存第二套 Grant、Profile、Account 或 Run | 会产生分叉真相 |
| App 直接写 Core Run Record | 会形成第二套 run truth |
| App 直接操作 Harbor process／user data dir | 会绕过 Runtime ownership 和证据策略 |
| Core 保存 Cookie、Token、完整 DOM、完整 HAR、完整 screenshot 或 network body | 会扩大隐私边界并复制 Harbor owner 数据 |
| Harbor 判断任务业务成功 | Harbor 不知道 SKILL／业务语义 |
| Harbor／Core 内置站点 selector、store 或业务 schema | 会把站点知识从 Lode 搬入 Runtime |
| Lode 选择具体 Runtime Session | Lode 声明需求，Core／Harbor完成匹配 |
| SKILL／工具隐藏替代正式授权 | 能力选择不等于权限 |
| Agent 直接取得 raw CDP／Juggler／Playwright endpoint | 会绕过公共语义、数据过滤和 ControlLease |
| Benchmark／crawler job 直接变成产品 task contract | 评测循环不是稳定用户结果 |
| 为能力完整性复制全部底层协议或建设 Provider marketplace | 超出 V1 目标 |

## 逐模块架构边界提示

### Core

可以展开：

- Principal／Connection／Grant；
- Profile ceiling 与 task authorization；
- action risk；
- Task／Run／ExternalOutcome；
- idempotency、dispatch、unknown、query 和 reconcile；
- API Server、CLI、MCP、Plugin、SDK、App 共用入口；
- Lode capability 和 Harbor resource matching。

不得定义 Provider 私有 endpoint、Profile 目录、页面 handle 或站点业务实现。

### Harbor

可以展开：

- Profile／Environment／Execution Identity；
- Provider facts 和 capability catalog；
- Instance／Page／Frame／Window；
- semantic observation、Network／Console、files、viewer；
- ControlLease、operation receipt、runtime evidence；
- Provider Driver 公共适配面。

不得签发 Grant、定义站点业务成功、保存 Lode workflow 或 Core Run truth。

### Plugin／agent-entry

可以展开：

- 安装／发现／连接；
- host-neutral capability discovery；
- 宿主工具投影；
- SKILL 分发；
- operation/query 映射；
- 主体身份和本地凭据安全存放。

不得维护第二套状态、直接调用 Provider 或把宿主审批当 Core 权限。

### Lode

可以展开：

- SKILL／site capability package；
- AccountSystem template；
- required／recommended Runtime capability；
- input/output/source schema；
- fixtures、post-check、failure；
- registry、version、invalid／draft／stable。

不得定义 Runtime Session、当前授权或真实登录状态。

### Desktop／可信 owner 入口

可以展开：

- Principal／Grant 管理；
- Account／Profile／Environment／Provider／SKILL 展示和敏感管理意图；
- Activity／Run／evidence 投影；
- 同实例 viewer／takeover／handback；
- 待处理与恢复体验。

不得直接实现浏览器操作、复制 Core／Harbor 状态机或成为 Runtime 启动的隐藏前置。

## 文档和规划关系

- canonical 定义产品和 V1 约束。
- ADR 定义为什么采用当前边界。
- architecture 定义模块关系和依赖。
- spec／schema 定义能力、字段、状态和校验。
- Issue／Milestone／Project 定义交付范围和当前状态。
- verification 定义某个版本实际证明的范围。
- 历史 ADR、Run、Issue 和 evidence 不因新基线被改写。
- 当前与下一批具体实现由 Work Item 细化，不在本文维护排期或完成百分比。
