# 0009. 统一任务授权策略

## 状态

Accepted for Core #290/#291, 2026-07-14. Clarified by Core #292, 2026-07-21.

本 ADR supersede ADR 0004 中 approval-request-first 的产品模型。ADR 0004 的
resource matching、target binding、idempotency、unknown outcome 和结果对账边界继续
有效。

## 背景

App、CLI、MCP、API、SDK 和 Agent 共用 Core 任务路径，但旧合同把写侧表达为散落的
risk classification、approval request、expiry 和 evidence display。不同入口容易形成
各自的确认流程，个人本机产品也被迫模拟组织审批。

授权的核心问题只有两个：当前具体业务动作是什么，以及用户当前允许以何种方式执行。
授权决定必须由 Core 统一解析，不能由 App、Harbor、调用入口或单个 Lode capability
分别实现。

## 决策

### 业务动作与方式

统一业务动作只有四类：

| 类别 | 含义 | 示例 |
| --- | --- | --- |
| `read` | 读取或下载，不产生目标系统外部变化 | 导航、搜索、读取页面、下载文件 |
| `prepare` | 填写或准备但不提交，不上传、不自动保存、不向外部系统传输材料 | 本地草稿、无自动保存的表单填写、预览 |
| `commit` | 发布、发送、提交、上传或产生其他外部变化 | 发布内容、发送消息、提交表单、创建或修改对象 |
| `destructive` | 删除、撤销或其他破坏性变化 | 删除、取消、移除、撤销 |

每类只允许 `auto`、`confirm`、`deny`。用户可以将 `destructive` 配置为 `auto`；
Core 不静默升级为更严格方式，但决定必须保留 `destructive` 风险标记、有效方式和来源。

Harbor provider/session 生命周期等系统环境操作不形成第五类 `environment`。Harbor
operation catalog 必须按其业务影响映射到上述四类，例如只读检测为 `read`、安装或修改
环境为 `commit`、删除环境为 `destructive`。Core 不按 click、type、scroll 等浏览器原子
动作分类或授权。

### Owner 声明与硬边界

Lode 声明站点 capability 的具体 `action_id`、类别、目标范围和资源要求；Harbor 声明
系统 operation 的同类事实。Core evaluator 不接受调用方自称 owner 的裸声明，只消费
Lode package admission 或 Harbor admission matcher 产出的唯一匹配证明。证明至少绑定：

- owner declaration ref/version；
- 具体 `action_id` 与唯一业务类别；
- 当前目标范围；
- resource match ref/version 与资源要求 refs。

缺少证明、证明冲突、重复类别、目标或资源不匹配、无法分类，或出现 click/type/scroll
原子动作类别时一律停止，不能通过确认扩大 owner 声明边界。

### 策略来源与优先级

Core 先解析不含单次决定的当前有效策略，从高到低固定为：

1. 当前线程修订；
2. 已安装技能用户版本；
3. 全局用户配置。

每个来源按动作类别保存 `auto`、`confirm` 或 `deny`，并携带稳定 source ref/version。
不适用于当前线程、技能或动作类别的来源显式跳过。技能推荐只用于安装初始化；安装后
形成已安装技能用户版本，不作为运行时第五个策略来源。

只有当前有效策略仍为 `confirm` 时，Core 才消费当前动作的单次 `allow_once` 或
`deny_once`。单次决定必须精确绑定：owner matcher 与 declaration ref/version、当前有效策略
source 类型/ref/version、action instance/id/category、完整目标、resource match ref/version、
issued_at 和 expires_at。完成、取消、过期、目标变化，或任一绑定/version 变化后直接
失效并回到当前有效策略。单次决定不能绕过当前 `deny`，也不能收紧或覆盖当前 `auto`。

### 入口一致性

App、CLI、MCP、API、SDK、Agent 和非 task 系统操作只提供当前事实与策略来源。公共入口
必须经过同一严格 parser 和 Core evaluator；未知 caller、字段、枚举、非法 RFC3339
时间或低层浏览器原子动作稳定返回 `invalid_input` 并停止，不抛异常，不建立入口特例。

真正执行前的动态重新计算、确认/拒绝协调和单次决定生命周期接入由 Core #293 完成。
#292 提供确定性纯 evaluator、匹配证明输入和可消费的当前动作确认合同。

### 决定记录

Core 为 task 和非 task operation 生成统一 Authorization Decision 摘要：具体业务动作、
目标、风险类别、有效方式、有效来源及版本、owner declaration 与 resource match refs、
决定时间和停止原因。Task 决定由 Run Record 引用；非 task operation 决定由 Harbor
operation record 引用同一 decision ref。精确持久化、查询与失效历史由 Core #293 实现。

完整 UI 交互、工具调用和内部 trace 属于诊断记录，不要求 App 默认展示。Core 不保存
Cookie、token、password、Profile storage、raw evidence、完整 DOM/HAR/截图/视频或网络正文。

## 影响

- Core #292 实现唯一 deterministic evaluator 和公共合同。
- Core #293 接入执行时重算、确认生命周期、决定记录与查询。
- App #246 消费统一策略，不保存授权 truth。
- Lode #281 提供当前 capability 的动作声明。
- Harbor 只执行 Core 已允许且符合 session/resource facts 的动作，不拥有授权决策。

## 非目标

- 不建立 RBAC、多级审批、组织策略服务或 hosted policy control plane。
- 不按浏览器原子动作授权。
- 不降低 target binding、idempotency、post-check、unknown outcome 或 reconciliation 要求。
