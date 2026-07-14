# 0009. 统一任务授权策略

## 状态

Accepted for Core #290/#291, 2026-07-14.

本 ADR supersede ADR 0004 中 approval-request-first 的产品模型。ADR 0004 的
resource matching、target binding、idempotency、unknown outcome 和结果对账边界继续
有效。

## 背景

App、CLI、MCP、API、SDK 和 Agent 共用 Core 任务路径，但旧合同把写侧表达为散落的
risk classification、approval request、expiry 和 evidence display。不同入口容易形成
各自的确认流程，个人本机产品也被迫模拟组织审批。

授权的核心问题只有两个：用户允许什么动作，以及允许范围有多大。授权决定必须由
Core 统一解析，不能由 App、Harbor 或单个 Lode capability 分别实现。

## 决策

### 动作类别

| 类别 | 含义 | 示例 |
| --- | --- | --- |
| `read` | 不产生目标网站外部变化 | 导航、搜索、读取页面 |
| `prepare` | 只在本机或页面内准备变更，不向外部系统传输材料或产生持久变化 | 本地生成草稿、在确认无自动保存/上传时填写表单、生成预览 |
| `commit` | 向外部系统传输材料或产生外部变化 | 上传、发布、发送、提交、创建或修改对象 |
| `destructive` | 删除、撤销或其他破坏性变化 | 删除、取消、移除 |
| `environment` | 改变本机运行环境 | 安装 provider、修改环境配置 |

Lode capability 声明站点任务可能使用的动作类别、目标范围和外部变化；Harbor 的
稳定 operation catalog 声明 provider/session 生命周期中的 `environment` 动作。Core
只消费这些权威声明，不从 UI 文案、站点名称或运行时行为临时猜测动作类别。若页面
填写可能自动保存、上传或向外部发送材料，声明必须使用 `commit`，不能降级为
`prepare`。

### 策略层级

Core 从低到高按以下优先级解析有效策略：

1. **全局默认**：用户对所有入口的默认授权模式；
2. **当前 scope 覆盖**：task 绑定账号身份、站点、capability、目标和输入摘要；
   非 task environment operation 绑定 provider/session operation、目标环境和参数摘要；
3. **单次授权**：仅允许当前待执行动作一次。

第一版全局模式：

- `read_only`：只允许 `read`；
- `ask_before_change`：允许 `read` 和 `prepare`，`commit`、`destructive`、
  `environment` 在执行前确认；
- `scope_authorized`：在 task 创建或 environment operation 发起时确认声明范围，
  当前 scope 内自动执行该范围。

在声明范围、目标绑定和有效期等硬边界内，更具体的显式决定覆盖较宽泛决定：有效的
scope 覆盖可以覆盖全局默认，有效的单次决定可以覆盖 scope 覆盖；同一层级冲突时拒绝优先。
因此 `read_only` 下可以由用户对一个已声明且精确绑定的 `commit` 动作授予单次权限，
但不会扩大为后续动作或整个任务权限。任何超出权威动作声明、task/operation scope、
目标绑定或有效期的动作属于硬拒绝，不能由更具体策略覆盖。

### 入口一致性

App、CLI、MCP、API、SDK 和 Agent 只能提供策略选择、任务覆盖或单次决定。API Server
归一化这些输入，Core 计算唯一有效决定。入口不得建立私有 risk enum、approval store
或绕过 Core evaluator。

### 跨仓职责

- Lode 声明站点 capability 动作和目标范围；Harbor 声明 provider/session operation
  的 `environment` 动作和目标范围；
- Core 对 task 和非 task environment intent 使用同一 evaluator，解析策略、请求确认、
  记录决定并控制 progression；
- Harbor 只执行 Core 已允许且符合 session/resource facts 的浏览器或环境动作；用户在
  App 中点击安装、修复或启动是授权输入，不是绕过 Core evaluator 的执行许可；
- App/CLI/MCP/API/SDK 投影同一授权语义。

登录确认、验证码处理、session control ownership 和 provider 安装权限可以触发用户
动作，但它们不等同于站点任务授权。

### 决定记录

Core 为 task 和非 task environment operation 生成统一 Authorization Decision 摘要：
策略来源、允许动作类别、绑定 scope、决定时间、有效期（如有）、一次性 grant 是否已
消费和拒绝原因。Task 决定由 Run Record 引用；非 task environment 决定由 Harbor
operation record 引用同一 decision ref。完整 UI 交互、工具调用和内部 trace 属于诊断
记录，不要求 App 默认展示。精确持久化 schema 和 API 由 Core #293 实现，不由本 ADR
伪定字段。

## 影响

- Core #233 迁移小红书写前验证的旧 approval 状态。
- App #246 消费统一策略，不保存授权 truth。
- Lode #281 为当前能力声明动作类别。
- Harbor 只消费有效 Core grant，不拥有授权决策。
- `execute_after_approval` 逐步迁移为 `commit` 动作加有效授权，不继续作为独立产品模式扩散。

## 非目标

- 不建立 RBAC、多级审批、组织策略服务或 hosted policy control plane。
- 不在本 ADR 中定义持久化 schema、API 路由或 UI 布局。
- 不降低 target binding、idempotency、post-check、unknown outcome 或 reconciliation 要求。
