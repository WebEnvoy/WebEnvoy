# WebEnvoy 跨仓架构

> 2026-09-06：产品方向和模块职责以 [canonical v1 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 与 [ADR 0011](../adr/0011-v1-managed-browser-and-skill-delivery.md) 为准。本文只保留现行模块间接口边界，不构成独立 App／Harbor 仓库或合同先行依据。

本文档定义 `WebEnvoy/WebEnvoy` monorepo 中 Core、Desktop、Harbor 与独立 `WebEnvoy/Lode` 的协作边界。它不是 ADR，也不是字段级 spec。

ADR 记录为什么选择某个方向；spec 定义具体 JSON Schema、API、状态机和校验规则。本文只回答：

- 各模块分别拥有什么；
- 数据和控制如何跨仓流动；
- 哪些边界不能跨；
- 后续逐仓架构不应突破哪些边界。

## 仓库角色

| 位置 | 架构角色 | 真相源 | 不拥有 |
|---|---|---|---|
| `WebEnvoy/WebEnvoy` Core | 公共任务路径 | Task、Run、Result Envelope、Run Record、Lode pin、capability admission、结果归一化、failure attribution、公共 API 入口 | 浏览器 Profile、Runtime Session 内部细节、站点知识、Lode package body、Desktop UI 状态 |
| `WebEnvoy/WebEnvoy` Harbor | 浏览器身份和运行现场 | Profile、Execution Identity、Runtime Session、Provider facts、Snapshot、RefMap、Evidence refs、Viewer / handoff facts | Lode pin、capability admission、normalized business output、task outcome、Core Run Record |
| `WebEnvoy/Lode` | 能力资产和站点知识 | Capability package、Workflow package、input/output schema、source schema、fixtures、post-check、asset registry | 浏览器会话、真实账号状态、Core admission、Run Record、App UI 状态 |
| `WebEnvoy/WebEnvoy` Desktop | 人类用户入口 | Activity、用户意图、确认与接管入口、run/evidence/catalog 展示状态 | Core run 状态机、Harbor runtime 状态机、Lode 资产真相、证据原始存储 |

## 核心原则

1. API Server 是稳定任务入口。CLI、MCP、SDK 和 App 不绕过 Core 执行任务。
2. Core 是 run truth source。一次任务是否 accepted、running、succeeded、failed、unknown outcome 或 requires user action，由 Core 记录。
3. Harbor 是 runtime facts source。Profile、Session、Provider、Viewer、Snapshot、RefMap 和 Evidence refs 来自 Harbor。
4. Lode 是 capability source。站点能力、任务包、schema、fixtures、post-check 和失效标记来自 Lode。
5. App 是用户入口。App 展示事实并发送用户意图，不复制上游 truth。
6. 跨仓共享字段以规格文档为准。ADR 和本架构文档中的字段名只作为方向性引用。

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

## 依赖方向

```text
User / Agent / CLI / MCP / SDK / App
  -> WebEnvoy API Server
  -> Core task path
      -> Lode: capability / workflow / schema / checks
      -> Harbor: runtime facts / session / snapshot / evidence
  -> Core result envelope / run record
  -> App: run viewer / evidence view / recovery UI
```

依赖只在需要的层级发生：

- Core 读取 Lode 的能力声明，不读取 Lode 的 authoring 草稿。
- Core 消费 Harbor 的 refs 和 facts，不读取 Cookie、Token、完整 storage 或 provider secrets。
- App 读取 Core、Harbor、Lode 的展示用 facts，不成为第二份 truth。
- Lode 声明 resource requirements 和 verification requirements，不选择具体 runtime。
- Harbor 提供 runtime capabilities，不决定某个 capability 是否应执行。

## 主要数据流

### 1. 能力发布与发现

```text
Lode capability / workflow package
  -> Lode registry / catalog metadata
  -> Core capability admission
  -> App Library display
```

Lode 负责资产版本、schema、fixtures、post-check 和失效标记。Core 只接受满足稳定准入要求的 capability。App 可以展示、安装、锁定、上报和创建草稿，但不直接改写平台资产真相。

### 2. 任务执行

```text
Caller
  -> Core task request
  -> Core admission
  -> Lode package lookup
  -> Harbor runtime binding
  -> Core run execution
  -> Core result envelope / run record
```

Core 在 accepted 前完成能力、资源和动作风险准入。accepted 后，Core 写 Run Record，并在终态记录 result、failure、unknown outcome 或 manual recovery requirement。

### 3. Runtime 与证据

```text
Core evidence policy
  -> Harbor capture request
  -> Harbor evidence refs
  -> Core Run Record references
  -> App evidence display
```

Harbor 负责 capture mechanics、redaction、retention、runtime provenance 和 evidence refs。Core 只保存引用和摘要，不复制完整 evidence store。App 只展示 refs、thumbnail 或脱敏摘要。

### 4. 人工接管与恢复

```text
Core / Harbor recovery signal
  -> App handoff prompt
  -> User takeover through Harbor viewer
  -> App sends user intent
  -> Core resumes / reconciles / records unknown outcome
```

Harbor 拥有 viewer 和 control facts。App 拥有用户交互入口。Core 拥有 run recovery decision、resume、retry、stop、reconcile 和 final outcome。

### 5. 能力失效与修复

```text
Core failure / Harbor evidence / App report
  -> Lode invalidation marker or repair draft
  -> Lode package update
  -> Core admission consumes new package version
```

运行失败不自动等于 Lode 能力失效。Core 记录失败分类，Harbor 提供证据，App 允许用户上报，Lode 决定资产是否失效、修复或发布新版本。

## 禁止跨界

| 禁止事项 | 原因 |
|---|---|
| App 直接写 Core Run Record | 会形成第二套 run truth |
| App 直接操作 Harbor process / user data dir | 会绕过 Harbor runtime ownership 和证据策略 |
| Core 保存 Cookie、Token、完整 DOM、完整 HAR 或完整截图 | 会扩大隐私和安全边界 |
| Harbor 判断任务业务成功 | Harbor 只知道 runtime facts，不知道 capability semantics |
| Lode 选择具体 Runtime Session | Lode 声明需求，Core 和 Harbor 完成匹配与绑定 |
| Core 内置站点知识和业务 schema | 会把能力资产从 Lode 搬进 Core |
| CLI / MCP / SDK 绕过 API Server 走独立执行链 | 会破坏准入、结果和证据一致性 |
| Benchmark task 或 crawler job 直接变成产品 task contract | 评测/采集循环不是稳定用户任务合同 |

## 逐仓架构边界提示

逐仓架构可以细化本仓内部模块，但不应在本仓替其他仓库定义 truth source、状态机或持久载体。

### Core

Core 逐仓架构可以展开：

- 任务请求与准入路径；
- Run Record 和 Result Envelope 的内部归属；
- 资源需求匹配；
- action risk 和 unknown outcome；
- API Server、CLI、MCP、SDK 共用入口。

暂不定义 Harbor Profile 内部结构、Lode package body 或 App UI 状态。

### Harbor

Harbor 逐仓架构可以展开：

- Profile / Execution Identity / Runtime Session 的边界；
- Provider facts 与 validation evidence；
- Snapshot / RefMap / Evidence refs；
- Viewer / control ownership facts；
- Core 可消费的最小 Runtime API。

暂不定义任务成功、站点 schema 或 Core Run Record。

### Lode

Lode 逐仓架构可以展开：

- capability package 最小文件结构；
- input/output/source schema 归属；
- fixtures、post-check 和 failure class；
- registry/catalog metadata；
- stable / draft / invalid lifecycle。

暂不定义 runtime session、evidence store 或 Core result envelope。

### App

App 逐仓架构可以展开：

- Work / Library / Browser 三个 surface；
- run viewer 消费 Core facts；
- viewer / takeover 消费 Harbor facts；
- capability browser 消费 Lode metadata；
- evidence display 只消费 refs 和脱敏摘要。

暂不定义 Core run state machine、Harbor session state machine 或 Lode package schema。

## 权威文档关系

- 方向性决策见各仓 `docs/adr/`。
- 具体字段、enum、API 和状态机以后续规格文档为准。
- 逐仓模块结构以后续各仓 architecture 文档为准。
- Milestone、issue tree 和交付顺序应进入 planning 文档或 issue，不放在本文。
- 本文档只维护四仓协作边界；不替代任何仓库的实现设计。
