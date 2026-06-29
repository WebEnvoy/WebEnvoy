# WebEnvoy 跨仓架构

本文档定义 WebEnvoy 四个产品仓库的协作边界。它不是 ADR，也不是字段级 spec。

ADR 记录为什么选择某个方向；spec 定义具体 JSON Schema、API、状态机和校验规则。本文只回答：

- 四个仓库分别拥有什么；
- 数据和控制如何跨仓流动；
- 哪些边界不能跨；
- 后续逐仓架构和 milestone 应基于什么依赖顺序展开。

## 仓库角色

| 仓库 | 架构角色 | 真相源 | 不拥有 |
|---|---|---|---|
| `WebEnvoy/WebEnvoy` | Core 与公共任务路径 | Task、Run、Result Envelope、Run Record、Admission、Action Risk、公共 API 入口 | 浏览器 Profile、Runtime Session 内部细节、站点知识、App UI 状态 |
| `WebEnvoy/Harbor` | 浏览器身份和运行现场 | Profile、Execution Identity、Runtime Session、Provider facts、Snapshot、RefMap、Evidence refs、Viewer / handoff facts | 任务成功判断、站点业务 schema、Lode package、Core Run Record |
| `WebEnvoy/Lode` | 能力资产和站点知识 | Capability package、Workflow package、input/output schema、source schema、fixtures、post-check、asset registry | 浏览器会话、真实账号状态、Core admission、Run Record、App UI 状态 |
| `WebEnvoy/App` | 人类用户入口 | Work / Library / Browser surfaces、用户意图、审批入口、handoff UI、run/evidence/catalog 展示状态 | Core run 状态机、Harbor runtime 状态机、Lode 资产真相、证据原始存储 |

## 核心原则

1. API Server 是稳定任务入口。CLI、MCP、SDK 和 App 不绕过 Core 执行任务。
2. Core 是 run truth source。一次任务是否 accepted、running、succeeded、failed、unknown outcome 或 requires user action，由 Core 记录。
3. Harbor 是 runtime facts source。Profile、Session、Provider、Viewer、Snapshot、RefMap 和 Evidence refs 来自 Harbor。
4. Lode 是 capability source。站点能力、任务包、schema、fixtures、post-check 和失效标记来自 Lode。
5. App 是用户入口。App 展示事实并发送用户意图，不复制上游 truth。
6. 跨仓共享字段以规格文档为准。ADR 和本架构文档中的字段名只作为方向性引用。

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

## 第一批逐仓架构输入

跨仓架构先定依赖，逐仓架构只展开近期需要落地的模块。

### Core

先定义：

- 任务请求与准入路径；
- Run Record 和 Result Envelope 的内部归属；
- 资源需求匹配；
- action risk 和 unknown outcome；
- API Server、CLI、MCP、SDK 共用入口。

暂不定义 Harbor Profile 内部结构、Lode package body 或 App UI 状态。

### Harbor

先定义：

- Profile / Execution Identity / Runtime Session 的边界；
- Provider facts 与 validation evidence；
- Snapshot / RefMap / Evidence refs；
- Viewer / control ownership facts；
- Core 可消费的最小 Runtime API。

暂不定义任务成功、站点 schema 或 Core Run Record。

### Lode

先定义：

- capability package 最小文件结构；
- input/output/source schema 归属；
- fixtures、post-check 和 failure class；
- registry/catalog metadata；
- stable / draft / invalid lifecycle。

暂不定义 runtime session、evidence store 或 Core result envelope。

### App

先定义：

- Work / Library / Browser 三个 surface；
- run viewer 消费 Core facts；
- viewer / takeover 消费 Harbor facts；
- capability browser 消费 Lode metadata；
- evidence display 只消费 refs 和脱敏摘要。

暂不定义 Core run state machine、Harbor session state machine 或 Lode package schema。

## Milestone 依赖顺序

1. Core 最小公共合同和 run path。
2. Harbor 最小 runtime/evidence facts，满足 Core resource matching。
3. Lode 最小 capability package 和 validator，满足 Core admission。
4. Core + Harbor + Lode 打通一个 read capability。
5. App 绑定 read run viewer、evidence display 和 capability catalog。
6. 写侧 safety、approval、handoff 和 unknown outcome。

这个顺序避免 App 先绑定未定字段，也避免 Harbor 或 Lode 把 Core 策略写进自己仓库。

## 权威文档关系

- 方向性决策见各仓 `docs/adr/`。
- 具体字段、enum、API 和状态机以后续规格文档为准。
- 逐仓模块结构以后续各仓 architecture 文档为准。
- 本文档只维护四仓协作边界；不替代任何仓库的实现设计。
